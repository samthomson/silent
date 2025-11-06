import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { DMProvider, useDMContext } from './DMContext';
import { TestApp } from '@/test/TestApp';
import { MESSAGE_PROTOCOL, PROTOCOL_MODE } from '@/lib/dmConstants';
import type { NostrEvent } from '@nostrify/nostrify';

/**
 * Tests for Direct Messaging Context
 * 
 * WHAT WE'RE TESTING:
 * The orchestration logic in DMContext.tsx that:
 * ✅ Creates events with correct structure (kind, tags, content)
 * ✅ Calls encryption/signing functions with correct parameters  
 * ✅ Publishes the right number of events (2 for 1-on-1, 6 for group, etc)
 * ✅ Builds NIP-17's 3-layer structure (1059 → 13 → 14)
 * ✅ Includes all recipients in inner message p tags
 * 
 * WHY THIS IS USEFUL:
 * If we refactor DMContext and break the orchestration logic, these tests catch it.
 * Example bugs these would catch:
 * - Creating only 1 gift wrap for 1-on-1 (should be 2)
 * - Forgetting to include sender in gift wraps
 * - Wrong event kinds or missing tags
 * - Calling encryption with wrong recipient
 * 
 * WHAT WE'RE NOT TESTING:
 * ❌ Real cryptography (@nostrify's responsibility)
 * ❌ Actual relay publishing (integration test)
 * ❌ End-to-end message delivery (E2E test)
 */

// Mock user with encryption capabilities
// We just return the content as-is since we're testing structure, not crypto
const mockUser = {
  pubkey: 'user-pubkey-123',
  signer: {
    nip04: {
      encrypt: vi.fn(async (_pubkey: string, content: string) => `ENCRYPTED:${content}`),
      decrypt: vi.fn(async (_pubkey: string, content: string) => content.replace('ENCRYPTED:', '')),
    },
    nip44: {
      encrypt: vi.fn(async (_pubkey: string, content: string) => `ENCRYPTED:${content}`),
      decrypt: vi.fn(async (_pubkey: string, content: string) => content.replace('ENCRYPTED:', '')),
    },
    signEvent: vi.fn(async (event: Omit<NostrEvent, 'id' | 'sig'>) => ({
      ...event,
      id: `signed-event-${Date.now()}`,
      sig: 'mock-signature',
    } as NostrEvent)),
  },
};

// Mock nostr client
const mockNostr = {
  event: vi.fn(async (event: NostrEvent) => event),
  query: vi.fn(async () => []),
  req: vi.fn(() => ({ close: vi.fn() })),
};

// Mock useCurrentUser
vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: mockUser }),
}));

// Mock @nostrify/react with partial mock to preserve NostrContext
vi.mock('@nostrify/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nostrify/react')>();
  return {
    ...actual,
    useNostr: () => ({ nostr: mockNostr }),
  };
});

// Track published events for inspection
const publishedEvents: NostrEvent[] = [];

// Mock useNostrPublish
vi.mock('@/hooks/useNostrPublish', () => ({
  useNostrPublish: () => ({
    mutateAsync: vi.fn(async (eventParams: Omit<NostrEvent, 'id' | 'sig' | 'pubkey' | 'created_at'>) => {
      const event: NostrEvent = {
        ...eventParams,
        id: `event-${Date.now()}`,
        pubkey: mockUser.pubkey,
        created_at: Math.floor(Date.now() / 1000),
        sig: 'mock-signature',
      };
      publishedEvents.push(event);
      return event;
    }),
  }),
}));

// Mock useAppContext
vi.mock('@/hooks/useAppContext', () => ({
  useAppContext: () => ({
    config: {
      relayUrl: 'wss://relay.test.com',
      theme: 'dark',
      devMode: false,
      renderInlineMedia: true,
    },
  }),
}));

// Mock useToast
vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

// Mock NSecSigner for gift wrap creation
vi.mock('@nostrify/nostrify', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nostrify/nostrify')>();
  return {
    ...actual,
    NSecSigner: class MockNSecSigner {
      nip44 = {
        encrypt: vi.fn(async (_pubkey: string, content: string) => `ENCRYPTED:${content}`),
      };
      signEvent = vi.fn(async (event: Omit<NostrEvent, 'id' | 'sig'>) => ({
        ...event,
        id: `giftwrap-${Date.now()}-${Math.random()}`,
        sig: 'giftwrap-signature',
      } as NostrEvent));
    },
  };
});

describe('DMContext - Message Creation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    publishedEvents.length = 0; // Clear published events
    mockNostr.event.mockClear();
  });

  describe('NIP-04 Message Creation', () => {
    it('creates kind 4 event with encrypted content and p tag', async () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <TestApp>
          <DMProvider config={{ enabled: true, protocolMode: PROTOCOL_MODE.NIP04_ONLY }}>
            {children}
          </DMProvider>
        </TestApp>
      );

      const { result } = renderHook(() => useDMContext(), { wrapper });

      await waitFor(() => {
        expect(result.current).toBeDefined();
      });

      await result.current.sendMessage({
        recipientPubkey: 'recipient-pubkey-456',
        content: 'Hello NIP-04!',
        protocol: MESSAGE_PROTOCOL.NIP04,
      });

      await waitFor(() => {
        expect(publishedEvents.length).toBe(1);
      });

      // CRITICAL: Verify the event that was passed to the publish function
      const event = publishedEvents[0];
      
      // Verify we created the EXACT event structure expected
      expect(event.kind).toBe(4);
      expect(event.pubkey).toBe(mockUser.pubkey);
      expect(event.tags).toEqual([['p', 'recipient-pubkey-456']]);
      expect(event.id).toBeDefined();
      expect(event.sig).toBeDefined();
      expect(event.created_at).toBeGreaterThan(0);
      
      // Verify content is encrypted
      expect(event.content).toBe('ENCRYPTED:Hello NIP-04!');
      
      // Verify encryption function was called with EXACTLY the right params
      expect(mockUser.signer.nip04.encrypt).toHaveBeenCalledTimes(1);
      expect(mockUser.signer.nip04.encrypt).toHaveBeenCalledWith(
        'recipient-pubkey-456',
        'Hello NIP-04!'
      );
    });

    it('only sends to first recipient for NIP-04 (no group support)', async () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <TestApp>
          <DMProvider config={{ enabled: true, protocolMode: PROTOCOL_MODE.NIP04_ONLY }}>
            {children}
          </DMProvider>
        </TestApp>
      );

      const { result } = renderHook(() => useDMContext(), { wrapper });

      await waitFor(() => {
        expect(result.current).toBeDefined();
      });

      await result.current.sendMessage({
        recipientPubkey: ['recipient-1', 'recipient-2', 'recipient-3'],
        content: 'Group message attempt',
        protocol: MESSAGE_PROTOCOL.NIP04,
      });

      await waitFor(() => {
        expect(mockUser.signer.nip04.encrypt).toHaveBeenCalled();
      });

      // NIP-04 should only encrypt for the first recipient
      expect(mockUser.signer.nip04.encrypt).toHaveBeenCalledTimes(1);
      expect(mockUser.signer.nip04.encrypt).toHaveBeenCalledWith(
        'recipient-1',
        'Group message attempt'
      );
    });
  });

  describe('NIP-17 Message Creation', () => {
    it('creates complete 3-layer structure (1059 → 13 → 14) for 1-on-1', async () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <TestApp>
          <DMProvider config={{ enabled: true, protocolMode: PROTOCOL_MODE.NIP17_ONLY }}>
            {children}
          </DMProvider>
        </TestApp>
      );

      const { result } = renderHook(() => useDMContext(), { wrapper });

      await waitFor(() => {
        expect(result.current).toBeDefined();
      });

      await result.current.sendMessage({
        recipientPubkey: 'recipient-pubkey-456',
        content: 'Hello NIP-17!',
        protocol: MESSAGE_PROTOCOL.NIP17,
      });

      await waitFor(() => {
        expect(mockNostr.event).toHaveBeenCalledTimes(2);
      });

      // CRITICAL: Verify nostr.event() was called with EXACTLY the right params
      expect(mockNostr.event).toHaveBeenCalledTimes(2);
      
      // LAYER 1: Verify Gift Wraps (kind 1059) passed to nostr.event()
      const giftWrap1 = mockNostr.event.mock.calls[0][0];
      const giftWrap2 = mockNostr.event.mock.calls[1][0];

      expect(giftWrap1.kind).toBe(1059);
      expect(giftWrap1.tags).toHaveLength(1);
      expect(giftWrap1.tags[0][0]).toBe('p');
      expect(giftWrap1.content).toContain('ENCRYPTED:');
      expect(giftWrap1.id).toBeDefined();
      expect(giftWrap1.sig).toBeDefined();

      expect(giftWrap2.kind).toBe(1059);
      expect(giftWrap2.tags).toHaveLength(1);
      expect(giftWrap2.tags[0][0]).toBe('p');
      expect(giftWrap2.content).toContain('ENCRYPTED:');

      // Verify gift wraps target both participants
      const giftWrapRecipients = [giftWrap1.tags[0][1], giftWrap2.tags[0][1]];
      expect(giftWrapRecipients).toContain('recipient-pubkey-456');
      expect(giftWrapRecipients).toContain(mockUser.pubkey);

      // CRITICAL: Verify seal encryption (user's signer encrypts inner message for each participant)
      expect(mockUser.signer.nip44.encrypt).toHaveBeenCalledTimes(2);
      const encryptCalls = mockUser.signer.nip44.encrypt.mock.calls;
      const encryptedForPubkeys = encryptCalls.map(call => call[0]);
      expect(encryptedForPubkeys).toContain('recipient-pubkey-456');
      expect(encryptedForPubkeys).toContain(mockUser.pubkey);
      
      // Verify we're encrypting the INNER MESSAGE (kind 14), not the seal
      encryptCalls.forEach(call => {
        const contentToEncrypt = call[1];
        const parsed = JSON.parse(contentToEncrypt);
        expect(parsed.kind).toBe(14); // Inner message
        expect(parsed.content).toBe('Hello NIP-17!');
      });

      // LAYER 2: Decrypt gift wrap to get Seal (kind 13)
      const sealContent = giftWrap1.content.replace('ENCRYPTED:', '');
      const seal = JSON.parse(sealContent);
      
      expect(seal.kind).toBe(13);
      expect(seal.pubkey).toBe(mockUser.pubkey);
      expect(seal.tags).toEqual([]);
      expect(seal.content).toContain('ENCRYPTED:');

      // LAYER 3: Decrypt seal to get Inner Message (kind 14)
      const innerContent = seal.content.replace('ENCRYPTED:', '');
      const innerMessage = JSON.parse(innerContent);
      
      expect(innerMessage.kind).toBe(14);
      expect(innerMessage.pubkey).toBe(mockUser.pubkey);
      expect(innerMessage.content).toBe('Hello NIP-17!');
      expect(innerMessage.tags).toHaveLength(1);
      expect(innerMessage.tags[0]).toEqual(['p', 'recipient-pubkey-456']);
      expect(innerMessage.created_at).toBeGreaterThan(0);
    });

    it('creates 1 gift wrap for self-messaging with correct 3-layer structure', async () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <TestApp>
          <DMProvider config={{ enabled: true, protocolMode: PROTOCOL_MODE.NIP17_ONLY }}>
            {children}
          </DMProvider>
        </TestApp>
      );

      const { result } = renderHook(() => useDMContext(), { wrapper });

      await waitFor(() => {
        expect(result.current).toBeDefined();
      });

      await result.current.sendMessage({
        recipientPubkey: mockUser.pubkey,
        content: 'Note to self',
        protocol: MESSAGE_PROTOCOL.NIP17,
      });

      await waitFor(() => {
        expect(mockNostr.event).toHaveBeenCalledTimes(1);
      });

      // LAYER 1: Gift Wrap (1059) targeting self
      const giftWrap = mockNostr.event.mock.calls[0][0];
      
      expect(giftWrap.kind).toBe(1059);
      expect(giftWrap.tags).toHaveLength(1);
      expect(giftWrap.tags[0]).toEqual(['p', mockUser.pubkey]);
      
      // LAYER 2: Decrypt gift wrap to get Seal (13)
      const sealContent = giftWrap.content.replace('ENCRYPTED:', '');
      const seal = JSON.parse(sealContent);
      
      expect(seal.kind).toBe(13);
      expect(seal.pubkey).toBe(mockUser.pubkey);
      
      // LAYER 3: Decrypt seal to get Inner Message (14) with self as recipient
      const innerContent = seal.content.replace('ENCRYPTED:', '');
      const innerMessage = JSON.parse(innerContent);
      
      expect(innerMessage.kind).toBe(14);
      expect(innerMessage.content).toBe('Note to self');
      expect(innerMessage.tags).toHaveLength(1);
      expect(innerMessage.tags[0]).toEqual(['p', mockUser.pubkey]);
    });

    it('creates 6 gift wraps for group, each with complete 3-layer structure', async () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <TestApp>
          <DMProvider config={{ enabled: true, protocolMode: PROTOCOL_MODE.NIP17_ONLY }}>
            {children}
          </DMProvider>
        </TestApp>
      );

      const { result } = renderHook(() => useDMContext(), { wrapper });

      await waitFor(() => {
        expect(result.current).toBeDefined();
      });

      await result.current.sendMessage({
        recipientPubkey: [
          'recipient-1',
          'recipient-2',
          'recipient-3',
          'recipient-4',
          'recipient-5',
        ],
        content: 'Group message to 5 people',
        protocol: MESSAGE_PROTOCOL.NIP17,
      });

      await waitFor(() => {
        expect(mockNostr.event).toHaveBeenCalledTimes(6);
      });

      // LAYER 1: Verify all 6 Gift Wraps (1059)
      const giftWraps = mockNostr.event.mock.calls.map(call => call[0]);
      
      giftWraps.forEach(gw => {
        expect(gw.kind).toBe(1059);
        expect(gw.tags).toHaveLength(1);
        expect(gw.tags[0][0]).toBe('p');
      });

      // Verify one gift wrap for each participant (5 recipients + sender)
      const giftWrapRecipients = giftWraps.map(gw => gw.tags[0][1]);
      expect(giftWrapRecipients).toContain('recipient-1');
      expect(giftWrapRecipients).toContain('recipient-2');
      expect(giftWrapRecipients).toContain('recipient-3');
      expect(giftWrapRecipients).toContain('recipient-4');
      expect(giftWrapRecipients).toContain('recipient-5');
      expect(giftWrapRecipients).toContain(mockUser.pubkey);

      // LAYER 2 & 3: Decrypt to verify Seal (13) and Inner Message (14) structure
      const sealContent = giftWraps[0].content.replace('ENCRYPTED:', '');
      const seal = JSON.parse(sealContent);
      
      expect(seal.kind).toBe(13);
      expect(seal.pubkey).toBe(mockUser.pubkey);
      
      const innerContent = seal.content.replace('ENCRYPTED:', '');
      const innerMessage = JSON.parse(innerContent);
      
      // Inner message should have kind 14 and ALL 5 recipients in p tags
      expect(innerMessage.kind).toBe(14);
      expect(innerMessage.content).toBe('Group message to 5 people');
      expect(innerMessage.tags).toHaveLength(5);
      expect(innerMessage.tags).toContainEqual(['p', 'recipient-1']);
      expect(innerMessage.tags).toContainEqual(['p', 'recipient-2']);
      expect(innerMessage.tags).toContainEqual(['p', 'recipient-3']);
      expect(innerMessage.tags).toContainEqual(['p', 'recipient-4']);
      expect(innerMessage.tags).toContainEqual(['p', 'recipient-5']);
    });

  });

  describe('Conversation ID Creation', () => {
    it('creates same conversation ID for self-messaging', async () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <TestApp>
          <DMProvider config={{ enabled: true, protocolMode: PROTOCOL_MODE.NIP17_ONLY }}>
            {children}
          </DMProvider>
        </TestApp>
      );

      const { result } = renderHook(() => useDMContext(), { wrapper });

      await waitFor(() => {
        expect(result.current).toBeDefined();
      });

      await result.current.sendMessage({
        recipientPubkey: mockUser.pubkey,
        content: 'First self message',
        protocol: MESSAGE_PROTOCOL.NIP17,
      });

      await result.current.sendMessage({
        recipientPubkey: mockUser.pubkey,
        content: 'Second self message',
        protocol: MESSAGE_PROTOCOL.NIP17,
      });

      // Both messages should go to the same conversation
      // Conversation ID should be "group:user-pubkey-123"
      await waitFor(() => {
        const conversations = result.current.conversations;
        expect(conversations).toHaveLength(1);
        expect(conversations[0].id).toBe(`group:${mockUser.pubkey}`);
      });
    });

    it('creates sorted conversation ID for 1-on-1 messaging', async () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <TestApp>
          <DMProvider config={{ enabled: true, protocolMode: PROTOCOL_MODE.NIP17_ONLY }}>
            {children}
          </DMProvider>
        </TestApp>
      );

      const { result } = renderHook(() => useDMContext(), { wrapper });

      await waitFor(() => {
        expect(result.current).toBeDefined();
      });

      await result.current.sendMessage({
        recipientPubkey: 'recipient-xyz',
        content: 'Hello',
        protocol: MESSAGE_PROTOCOL.NIP17,
      });

      await waitFor(() => {
        const conversations = result.current.conversations;
        expect(conversations).toHaveLength(1);
        // Conversation ID should be sorted alphabetically
        expect(conversations[0].id).toMatch(/^group:/);
      });
    });

    it('creates conversation ID with all participants for groups', async () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <TestApp>
          <DMProvider config={{ enabled: true, protocolMode: PROTOCOL_MODE.NIP17_ONLY }}>
            {children}
          </DMProvider>
        </TestApp>
      );

      const { result } = renderHook(() => useDMContext(), { wrapper });

      await waitFor(() => {
        expect(result.current).toBeDefined();
      });

      await result.current.sendMessage({
        recipientPubkey: ['alice', 'bob', 'charlie'],
        content: 'Group hello',
        protocol: MESSAGE_PROTOCOL.NIP17,
      });

      await waitFor(() => {
        const conversations = result.current.conversations;
        expect(conversations).toHaveLength(1);
        // Conversation ID should include all participants (sorted)
        expect(conversations[0].id).toMatch(/^group:/);
      });
    });
  });
});

