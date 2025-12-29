import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  validateDMEvent,
  getRecipientPubkey,
  getConversationPartner,
  formatConversationTime,
  formatFullDateTime,
  parseConversationId,
  getPubkeyColor,
  isGroupConversation,
} from './dmUtils';
import { Pure as DMLib } from './dmLib';

describe('dmUtils', () => {
  describe('validateDMEvent', () => {
    it('validates a proper NIP-04 DM event', () => {
      const event: NostrEvent = {
        id: 'test-id',
        pubkey: 'sender-pubkey',
        created_at: Math.floor(Date.now() / 1000),
        kind: 4,
        tags: [['p', 'recipient-pubkey']],
        content: 'encrypted content',
        sig: 'test-sig',
      };

      expect(validateDMEvent(event)).toBe(true);
    });

    it('rejects events with wrong kind', () => {
      const event: NostrEvent = {
        id: 'test-id',
        pubkey: 'sender-pubkey',
        created_at: Math.floor(Date.now() / 1000),
        kind: 1, // wrong kind
        tags: [['p', 'recipient-pubkey']],
        content: 'encrypted content',
        sig: 'test-sig',
      };

      expect(validateDMEvent(event)).toBe(false);
    });

    it('rejects events without p tag', () => {
      const event: NostrEvent = {
        id: 'test-id',
        pubkey: 'sender-pubkey',
        created_at: Math.floor(Date.now() / 1000),
        kind: 4,
        tags: [], // no p tag
        content: 'encrypted content',
        sig: 'test-sig',
      };

      expect(validateDMEvent(event)).toBe(false);
    });

    it('rejects events without content', () => {
      const event: NostrEvent = {
        id: 'test-id',
        pubkey: 'sender-pubkey',
        created_at: Math.floor(Date.now() / 1000),
        kind: 4,
        tags: [['p', 'recipient-pubkey']],
        content: '', // empty content
        sig: 'test-sig',
      };

      expect(validateDMEvent(event)).toBe(false);
    });
  });

  describe('getRecipientPubkey', () => {
    it('extracts recipient pubkey from p tag', () => {
      const event: NostrEvent = {
        id: 'test-id',
        pubkey: 'sender-pubkey',
        created_at: Math.floor(Date.now() / 1000),
        kind: 4,
        tags: [['p', 'recipient-pubkey']],
        content: 'encrypted content',
        sig: 'test-sig',
      };

      expect(getRecipientPubkey(event)).toBe('recipient-pubkey');
    });

    it('returns undefined when no p tag exists', () => {
      const event: NostrEvent = {
        id: 'test-id',
        pubkey: 'sender-pubkey',
        created_at: Math.floor(Date.now() / 1000),
        kind: 4,
        tags: [],
        content: 'encrypted content',
        sig: 'test-sig',
      };

      expect(getRecipientPubkey(event)).toBeUndefined();
    });
  });

  describe('getConversationPartner', () => {
    it('returns recipient when user is sender', () => {
      const event: NostrEvent = {
        id: 'test-id',
        pubkey: 'user-pubkey',
        created_at: Math.floor(Date.now() / 1000),
        kind: 4,
        tags: [['p', 'other-pubkey']],
        content: 'encrypted content',
        sig: 'test-sig',
      };

      expect(getConversationPartner(event, 'user-pubkey')).toBe('other-pubkey');
    });

    it('returns sender when user is recipient', () => {
      const event: NostrEvent = {
        id: 'test-id',
        pubkey: 'other-pubkey',
        created_at: Math.floor(Date.now() / 1000),
        kind: 4,
        tags: [['p', 'user-pubkey']],
        content: 'encrypted content',
        sig: 'test-sig',
      };

      expect(getConversationPartner(event, 'user-pubkey')).toBe('other-pubkey');
    });

    it('handles self-messaging (user sent message to themselves)', () => {
      const event: NostrEvent = {
        id: 'test-id',
        pubkey: 'user-pubkey',
        created_at: Math.floor(Date.now() / 1000),
        kind: 4,
        tags: [['p', 'user-pubkey']], // sent to self
        content: 'encrypted content',
        sig: 'test-sig',
      };

      expect(getConversationPartner(event, 'user-pubkey')).toBe('user-pubkey');
    });
  });

  describe('formatConversationTime', () => {
    it('shows time for messages today', () => {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 15);
      const todayTimestamp = Math.floor(today.getTime() / 1000);
      const formatted = formatConversationTime(todayTimestamp);
      
      // Should show time like "10:15 AM"
      expect(formatted).toMatch(/\d{1,2}:\d{2}/);
    });

    it('shows "Yesterday" for messages from yesterday', () => {
      const now = new Date();
      const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 20, 0);
      const yesterdayTimestamp = Math.floor(yesterday.getTime() / 1000);
      const formatted = formatConversationTime(yesterdayTimestamp);
      
      expect(formatted).toBe('Yesterday');
    });

    it('shows day name for messages this week', () => {
      const now = new Date();
      // Get the start of this week (Sunday)
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - now.getDay());
      weekStart.setHours(0, 0, 0, 0);
      
      // Create a date that's definitely in this week but not today/yesterday
      // Use the week start + 2 days (Tuesday), but if today is Sun/Mon/Tue, use Thursday instead
      const daysToAdd = now.getDay() <= 2 ? 4 : 2;
      const thisWeek = new Date(weekStart);
      thisWeek.setDate(weekStart.getDate() + daysToAdd);
      thisWeek.setHours(12, 0, 0, 0);
      
      const thisWeekTimestamp = Math.floor(thisWeek.getTime() / 1000);
      const formatted = formatConversationTime(thisWeekTimestamp);
      
      // Should show day name like "Sat" or "Saturday" (abbreviated 3+ chars)
      expect(formatted).toMatch(/^\w{3,}/);
      // Should NOT contain year or comma
      expect(formatted).not.toMatch(/\d{4}|,/);
    });

    it('shows month and day for messages this year', () => {
      const now = new Date();
      // Create a date 3 months ago to ensure it's in the past but still this year
      const thisYear = new Date(now.getFullYear(), now.getMonth() - 3, 15, 12, 0);
      const thisYearTimestamp = Math.floor(thisYear.getTime() / 1000);
      const formatted = formatConversationTime(thisYearTimestamp);
      
      // Should show month and day (format varies by locale: "Jan 15", "15 Jan", or "15 Sept")
      expect(formatted).toMatch(/^(\w{3,4}\s+\d{1,2}|\d{1,2}\s+\w{3,4})$/);
      // Should NOT contain year
      expect(formatted).not.toMatch(/\d{4}/);
    });

    it('shows full date for messages from previous years', () => {
      const now = new Date();
      const lastYear = new Date(now.getFullYear() - 1, 11, 25, 12, 0);
      const oldTimestamp = Math.floor(lastYear.getTime() / 1000);
      const formatted = formatConversationTime(oldTimestamp);
      
      // Should include month, day, and year (format varies by locale)
      expect(formatted).toMatch(/\d{4}/); // Must have year
      expect(formatted).toMatch(/\w{3,4}/); // Must have month abbreviation (3-4 chars like Jan or Sept)
      expect(formatted).toMatch(/\d{1,2}/); // Must have day
    });
  });

  describe('formatFullDateTime', () => {
    it('formats timestamp as full date and time', () => {
      const timestamp = Math.floor(new Date('2024-01-15T14:30:00').getTime() / 1000);
      const formatted = formatFullDateTime(timestamp);
      
      // Should include weekday, date, and time
      expect(formatted).toMatch(/\w{3}/); // Weekday
      expect(formatted).toMatch(/\d{4}/); // Year
      expect(formatted).toMatch(/\d{1,2}:\d{2}/); // Time
    });
  });

  describe('computeConversationId', () => {
    it('creates ID for self-messaging', () => {
      const id = DMLib.Conversation.computeConversationId(['alice'], '');
      expect(id).toBe('group:alice:');
    });

    it('creates ID for 1-on-1 conversation', () => {
      const id = DMLib.Conversation.computeConversationId(['alice', 'bob'], '');
      // Should be sorted alphabetically
      expect(id).toBe('group:alice,bob:');
    });

    it('creates ID for group conversation', () => {
      const id = DMLib.Conversation.computeConversationId(['alice', 'bob', 'charlie'], '');
      expect(id).toBe('group:alice,bob,charlie:');
    });

    it('sorts participants alphabetically', () => {
      const id1 = DMLib.Conversation.computeConversationId(['charlie', 'alice', 'bob'], '');
      const id2 = DMLib.Conversation.computeConversationId(['bob', 'alice', 'charlie'], '');
      
      expect(id1).toBe(id2);
      expect(id1).toBe('group:alice,bob,charlie:');
    });

    it('removes duplicate participants', () => {
      const id = DMLib.Conversation.computeConversationId(['alice', 'bob', 'alice', 'bob'], '');
      expect(id).toBe('group:alice,bob:');
    });

    it('ensures same ID regardless of input order', () => {
      const id1 = DMLib.Conversation.computeConversationId(['bob', 'alice'], '');
      const id2 = DMLib.Conversation.computeConversationId(['alice', 'bob'], '');
      
      expect(id1).toBe(id2);
      expect(id1).toBe('group:alice,bob:');
    });

    it('includes subject when provided', () => {
      const id = DMLib.Conversation.computeConversationId(['alice', 'bob'], 'Project discussion');
      expect(id).toBe('group:alice,bob:Project discussion');
    });

    it('handles empty subject same as no subject', () => {
      const id = DMLib.Conversation.computeConversationId(['alice', 'bob'], '');
      expect(id).toBe('group:alice,bob:');
    });
  });

  describe('parseConversationId', () => {
    it('parses new format conversation ID', () => {
      const participants = parseConversationId('group:alice,bob,charlie');
      expect(participants).toEqual(['alice', 'bob', 'charlie']);
    });

    it('parses self-messaging ID', () => {
      const participants = parseConversationId('group:alice');
      expect(participants).toEqual(['alice']);
    });

    it('handles legacy format (bare pubkey)', () => {
      const participants = parseConversationId('bob-pubkey');
      expect(participants).toEqual(['bob-pubkey']);
    });

    it('parses 1-on-1 conversation ID', () => {
      const participants = parseConversationId('group:alice,bob');
      expect(participants).toEqual(['alice', 'bob']);
    });
  });

  describe('getPubkeyColor', () => {
    it('returns consistent color for same pubkey', () => {
      const pubkey = 'test-pubkey-123';
      const color1 = getPubkeyColor(pubkey);
      const color2 = getPubkeyColor(pubkey);
      
      expect(color1).toBe(color2);
    });

    it('returns valid hex color format', () => {
      const color = getPubkeyColor('test-pubkey');
      
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    });

    it('generates different colors for different pubkeys', () => {
      const color1 = getPubkeyColor('pubkey1');
      const color2 = getPubkeyColor('pubkey2');
      const color3 = getPubkeyColor('pubkey3');
      
      // At least some should be different (extremely unlikely all 3 are same)
      const uniqueColors = new Set([color1, color2, color3]);
      expect(uniqueColors.size).toBeGreaterThan(1);
    });

    it('handles typical Nostr pubkey format', () => {
      const pubkey = 'e4690a13290739da123aa17d553851dec4cdd0e9d89aa18de3741c446caf8761';
      const color = getPubkeyColor(pubkey);
      
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    });
  });

  describe('isGroupConversation', () => {
    it('returns false for self-messaging', () => {
      expect(isGroupConversation('group:alice')).toBe(false);
    });

    it('returns false for 1-on-1 conversation', () => {
      expect(isGroupConversation('group:alice,bob')).toBe(false);
    });

    it('returns true for 3+ participants', () => {
      expect(isGroupConversation('group:alice,bob,charlie')).toBe(true);
    });

    it('returns true for large groups', () => {
      expect(isGroupConversation('group:alice,bob,charlie,david,eve')).toBe(true);
    });

    it('handles legacy format (bare pubkey) as 1-on-1', () => {
      expect(isGroupConversation('bob-pubkey')).toBe(false);
    });
  });
});

