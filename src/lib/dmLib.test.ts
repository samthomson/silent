/* eslint-disable */
// @ts-nocheck
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDB } from 'idb';
import * as DMLib from './dmLib';
import { CACHE_DB_NAME, CACHE_STORE_NAME, CACHE_KEY_PREFIX } from './dmLib';
import type { MessagingState } from './dmTypes';

describe('DMLib', () => {
  describe('Pure', () => {
    describe('Relay', () => {
      describe('extractBlockedRelays', () => {
        it('should return empty array when event is null', () => {
          const result = DMLib.Pure.Relay.extractBlockedRelays(null);
          expect(result).toEqual([]);
        });

        it('should return empty array when event has no tags', () => {
          const event = {
            id: 'event1',
            pubkey: 'pubkey1',
            created_at: 123456,
            kind: 10006,
            tags: [],
            content: '',
            sig: 'sig1'
          };
          const result = DMLib.Pure.Relay.extractBlockedRelays(event);
          expect(result).toEqual([]);
        });

        it('should extract single relay from r tag', () => {
          const event = {
            id: 'event1',
            pubkey: 'pubkey1',
            created_at: 123456,
            kind: 10006,
            tags: [
              ['r', 'wss://relay1.com']
            ],
            content: '',
            sig: 'sig1'
          };
          const result = DMLib.Pure.Relay.extractBlockedRelays(event);
          expect(result).toEqual(['wss://relay1.com']);
        });

        it('should extract multiple relays from r tags', () => {
          const event = {
            id: 'event1',
            pubkey: 'pubkey1',
            created_at: 123456,
            kind: 10006,
            tags: [
              ['r', 'wss://relay1.com'],
              ['r', 'wss://relay2.com'],
              ['r', 'wss://relay3.com']
            ],
            content: '',
            sig: 'sig1'
          };
          const result = DMLib.Pure.Relay.extractBlockedRelays(event);
          expect(result).toEqual(['wss://relay1.com', 'wss://relay2.com', 'wss://relay3.com']);
        });

        it('should ignore non-r tags', () => {
          const event = {
            id: 'event1',
            pubkey: 'pubkey1',
            created_at: 123456,
            kind: 10006,
            tags: [
              ['r', 'wss://relay1.com'],
              ['p', 'somepubkey'],
              ['e', 'someevent'],
              ['r', 'wss://relay2.com']
            ],
            content: '',
            sig: 'sig1'
          };
          const result = DMLib.Pure.Relay.extractBlockedRelays(event);
          expect(result).toEqual(['wss://relay1.com', 'wss://relay2.com']);
        });

        it('should deduplicate relay URLs', () => {
          const event = {
            id: 'event1',
            pubkey: 'pubkey1',
            created_at: 123456,
            kind: 10006,
            tags: [
              ['r', 'wss://relay1.com'],
              ['r', 'wss://relay2.com'],
              ['r', 'wss://relay1.com'],
              ['r', 'wss://relay2.com']
            ],
            content: '',
            sig: 'sig1'
          };
          const result = DMLib.Pure.Relay.extractBlockedRelays(event);
          expect(result).toEqual(['wss://relay1.com', 'wss://relay2.com']);
        });

        it('should ignore r tags with missing or empty relay URL', () => {
          const event = {
            id: 'event1',
            pubkey: 'pubkey1',
            created_at: 123456,
            kind: 10006,
            tags: [
              ['r'],
              ['r', ''],
              ['r', 'wss://relay1.com'],
              ['r', '   ']
            ],
            content: '',
            sig: 'sig1'
          };
          const result = DMLib.Pure.Relay.extractBlockedRelays(event);
          expect(result).toEqual(['wss://relay1.com']);
        });

        it('should trim whitespace from relay URLs', () => {
          const event = {
            id: 'event1',
            pubkey: 'pubkey1',
            created_at: 123456,
            kind: 10006,
            tags: [
              ['r', '  wss://relay1.com  '],
              ['r', 'wss://relay2.com']
            ],
            content: '',
            sig: 'sig1'
          };
          const result = DMLib.Pure.Relay.extractBlockedRelays(event);
          expect(result).toEqual(['wss://relay1.com', 'wss://relay2.com']);
        });

        it('should ignore r tags with non-string relay values', () => {
          const event = {
            id: 'event1',
            pubkey: 'pubkey1',
            created_at: 123456,
            kind: 10006,
            tags: [
              ['r', 'wss://relay1.com'],
              ['r', 123],
              ['r', null],
              ['r', undefined],
              ['r', 'wss://relay2.com']
            ],
            content: '',
            sig: 'sig1'
          };
          const result = DMLib.Pure.Relay.extractBlockedRelays(event);
          expect(result).toEqual(['wss://relay1.com', 'wss://relay2.com']);
        });

        it('should handle event with only invalid tags', () => {
          const event = {
            id: 'event1',
            pubkey: 'pubkey1',
            created_at: 123456,
            kind: 10006,
            tags: [
              ['p', 'pubkey'],
              ['e', 'eventid'],
              ['d', 'identifier']
            ],
            content: '',
            sig: 'sig1'
          };
          const result = DMLib.Pure.Relay.extractBlockedRelays(event);
          expect(result).toEqual([]);
        });

        it('should handle complex real-world scenario', () => {
          const event = {
            id: 'event1',
            pubkey: 'pubkey1',
            created_at: 123456,
            kind: 10006,
            tags: [
              ['r', 'wss://spam-relay.com'],
              ['r', '  wss://malicious-relay.com  '],
              ['p', 'somepubkey'],
              ['r', 'wss://spam-relay.com'], // duplicate
              ['r', ''],
              ['r', 'wss://blocked-relay.io'],
              ['alt', 'Blocked relay list']
            ],
            content: 'My blocked relays',
            sig: 'sig1'
          };
          const result = DMLib.Pure.Relay.extractBlockedRelays(event);
          expect(result).toEqual([
            'wss://spam-relay.com',
            'wss://malicious-relay.com',
            'wss://blocked-relay.io'
          ]);
        });
      });
      it.todo('deriveRelaySet');
      it.todo('findNewRelaysToQuery');
      it.todo('computeAllQueriedRelays');
      it.todo('buildRelayToUsersMap');
      it.todo('filterNewRelayUserCombos');
    });

    describe('Message', () => {
      it.todo('buildMessageFilters');
      it.todo('dedupeMessages');
      it.todo('extractPubkeysFromMessages');
    });

    describe('Participant', () => {
      it.todo('buildParticipant');
      it.todo('buildParticipantsMap');
      it.todo('mergeParticipants');
      it.todo('getStaleParticipants');
      
      describe('getNewPubkeys', () => {
        it('should return empty array when foundPubkeys is empty', () => {
          const result = DMLib.Pure.Participant.getNewPubkeys([], ['existing1', 'existing2']);
          expect(result).toEqual([]);
        });

        it('should return empty array when existingPubkeys is empty and foundPubkeys is empty', () => {
          const result = DMLib.Pure.Participant.getNewPubkeys([], []);
          expect(result).toEqual([]);
        });

        it('should return all pubkeys when existingPubkeys is empty', () => {
          const foundPubkeys = ['pk1', 'pk2', 'pk3'];
          const result = DMLib.Pure.Participant.getNewPubkeys(foundPubkeys, []);
          expect(result).toEqual(['pk1', 'pk2', 'pk3']);
        });

        it('should return empty array when all foundPubkeys already exist', () => {
          const foundPubkeys = ['pk1', 'pk2'];
          const existingPubkeys = ['pk1', 'pk2', 'pk3'];
          const result = DMLib.Pure.Participant.getNewPubkeys(foundPubkeys, existingPubkeys);
          expect(result).toEqual([]);
        });

        it('should return only new pubkeys', () => {
          const foundPubkeys = ['pk1', 'pk2', 'pk3', 'pk4'];
          const existingPubkeys = ['pk1', 'pk3'];
          const result = DMLib.Pure.Participant.getNewPubkeys(foundPubkeys, existingPubkeys);
          expect(result).toEqual(['pk2', 'pk4']);
        });

        it('should preserve order from foundPubkeys', () => {
          const foundPubkeys = ['pk5', 'pk1', 'pk3', 'pk2'];
          const existingPubkeys = ['pk1'];
          const result = DMLib.Pure.Participant.getNewPubkeys(foundPubkeys, existingPubkeys);
          expect(result).toEqual(['pk5', 'pk3', 'pk2']);
        });

        it('should deduplicate foundPubkeys', () => {
          const foundPubkeys = ['pk1', 'pk2', 'pk1', 'pk3', 'pk2'];
          const existingPubkeys = [];
          const result = DMLib.Pure.Participant.getNewPubkeys(foundPubkeys, existingPubkeys);
          expect(result).toEqual(['pk1', 'pk2', 'pk3']);
        });

        it('should deduplicate and filter existing pubkeys', () => {
          const foundPubkeys = ['pk1', 'pk2', 'pk1', 'pk3', 'pk2', 'pk4'];
          const existingPubkeys = ['pk2'];
          const result = DMLib.Pure.Participant.getNewPubkeys(foundPubkeys, existingPubkeys);
          expect(result).toEqual(['pk1', 'pk3', 'pk4']);
        });

        it('should handle single new pubkey', () => {
          const foundPubkeys = ['new-pubkey'];
          const existingPubkeys = ['old1', 'old2'];
          const result = DMLib.Pure.Participant.getNewPubkeys(foundPubkeys, existingPubkeys);
          expect(result).toEqual(['new-pubkey']);
        });

        it('should handle realistic hex pubkeys', () => {
          const foundPubkeys = [
            'a1b2c3d4e5f67890abcdef1234567890abcdef1234567890abcdef1234567890',
            'b2c3d4e5f67890abcdef1234567890abcdef1234567890abcdef1234567890ab',
            'c3d4e5f67890abcdef1234567890abcdef1234567890abcdef1234567890abc3'
          ];
          const existingPubkeys = [
            'b2c3d4e5f67890abcdef1234567890abcdef1234567890abcdef1234567890ab'
          ];
          const result = DMLib.Pure.Participant.getNewPubkeys(foundPubkeys, existingPubkeys);
          expect(result).toEqual([
            'a1b2c3d4e5f67890abcdef1234567890abcdef1234567890abcdef1234567890',
            'c3d4e5f67890abcdef1234567890abcdef1234567890abcdef1234567890abc3'
          ]);
        });

        it('should handle large arrays efficiently', () => {
          const foundPubkeys = Array.from({ length: 100 }, (_, i) => `pk${i}`);
          const existingPubkeys = Array.from({ length: 50 }, (_, i) => `pk${i * 2}`);
          const result = DMLib.Pure.Participant.getNewPubkeys(foundPubkeys, existingPubkeys);
          
          // Should contain odd numbered pubkeys (pk1, pk3, pk5, etc.)
          expect(result.length).toBe(50);
          expect(result[0]).toBe('pk1');
          expect(result[1]).toBe('pk3');
          expect(result[2]).toBe('pk5');
        });

        it('should handle duplicates in existingPubkeys without issue', () => {
          const foundPubkeys = ['pk1', 'pk2', 'pk3'];
          const existingPubkeys = ['pk1', 'pk1', 'pk2', 'pk2'];
          const result = DMLib.Pure.Participant.getNewPubkeys(foundPubkeys, existingPubkeys);
          expect(result).toEqual(['pk3']);
        });

        it('should return empty when all found are duplicates of existing', () => {
          const foundPubkeys = ['pk1', 'pk2', 'pk1', 'pk2'];
          const existingPubkeys = ['pk1', 'pk2'];
          const result = DMLib.Pure.Participant.getNewPubkeys(foundPubkeys, existingPubkeys);
          expect(result).toEqual([]);
        });
      });
      
      it.todo('extractNewPubkeys');
      it.todo('determineNewPubkeys');
    });

    describe('Conversation', () => {
      it.todo('computeConversationId');
      it.todo('groupMessagesIntoConversations');
    });

    describe('Sync', () => {
      describe('computeSinceTimestamp', () => {
        const SECONDS_PER_DAY = 24 * 60 * 60; // 86400

        it('should return null when lastCacheTime is null', () => {
          const result = DMLib.Pure.Sync.computeSinceTimestamp(null, 2);
          expect(result).toBeNull();
        });

        it('should return lastCacheTime when nip17FuzzDays is 0', () => {
          const lastCacheTime = 1000000;
          const result = DMLib.Pure.Sync.computeSinceTimestamp(lastCacheTime, 0);
          expect(result).toBe(1000000);
        });

        it('should subtract 1 day when nip17FuzzDays is 1', () => {
          const lastCacheTime = 1000000;
          const result = DMLib.Pure.Sync.computeSinceTimestamp(lastCacheTime, 1);
          expect(result).toBe(lastCacheTime - SECONDS_PER_DAY);
          expect(result).toBe(913600);
        });

        it('should subtract 2 days when nip17FuzzDays is 2', () => {
          const lastCacheTime = 1000000;
          const result = DMLib.Pure.Sync.computeSinceTimestamp(lastCacheTime, 2);
          expect(result).toBe(lastCacheTime - 2 * SECONDS_PER_DAY);
          expect(result).toBe(827200);
        });

        it('should subtract 7 days when nip17FuzzDays is 7', () => {
          const lastCacheTime = 2000000;
          const result = DMLib.Pure.Sync.computeSinceTimestamp(lastCacheTime, 7);
          expect(result).toBe(lastCacheTime - 7 * SECONDS_PER_DAY);
          expect(result).toBe(1395200);
        });

        it('should handle fractional days correctly', () => {
          const lastCacheTime = 1000000;
          const result = DMLib.Pure.Sync.computeSinceTimestamp(lastCacheTime, 0.5);
          expect(result).toBe(lastCacheTime - 0.5 * SECONDS_PER_DAY);
          expect(result).toBe(956800);
        });

        it('should handle very large timestamps (realistic Nostr timestamps)', () => {
          const lastCacheTime = 1734700000; // Around Dec 2024
          const result = DMLib.Pure.Sync.computeSinceTimestamp(lastCacheTime, 2);
          expect(result).toBe(lastCacheTime - 2 * SECONDS_PER_DAY);
          expect(result).toBe(1734527200);
        });

        it('should handle zero lastCacheTime', () => {
          const result = DMLib.Pure.Sync.computeSinceTimestamp(0, 2);
          expect(result).toBe(-2 * SECONDS_PER_DAY);
        });

        it('should handle negative result (lastCacheTime smaller than fuzz period)', () => {
          const lastCacheTime = 100000; // ~1.15 days in seconds
          const result = DMLib.Pure.Sync.computeSinceTimestamp(lastCacheTime, 2);
          expect(result).toBe(lastCacheTime - 2 * SECONDS_PER_DAY);
          expect(result).toBe(-72800);
        });

        it('should return null for null lastCacheTime regardless of fuzz days', () => {
          expect(DMLib.Pure.Sync.computeSinceTimestamp(null, 0)).toBeNull();
          expect(DMLib.Pure.Sync.computeSinceTimestamp(null, 1)).toBeNull();
          expect(DMLib.Pure.Sync.computeSinceTimestamp(null, 10)).toBeNull();
          expect(DMLib.Pure.Sync.computeSinceTimestamp(null, 100)).toBeNull();
        });

        it('should handle real-world warm start scenario', () => {
          const now = 1734700000;
          const oneHourAgo = now - 3600;
          
          // With 2 days of fuzz, we should query from 2 days before the cache time
          const result = DMLib.Pure.Sync.computeSinceTimestamp(oneHourAgo, 2);
          expect(result).toBe(oneHourAgo - 2 * SECONDS_PER_DAY);
          
          // Verify the result is about 2 days and 1 hour before now
          const expectedDiff = 2 * SECONDS_PER_DAY + 3600;
          expect(now - result).toBe(expectedDiff);
        });

        it('should correctly calculate days to seconds conversion', () => {
          const lastCacheTime = 1000000;
          
          const oneDayResult = DMLib.Pure.Sync.computeSinceTimestamp(lastCacheTime, 1);
          expect(oneDayResult).toBe(lastCacheTime - SECONDS_PER_DAY);
          
          const threeDaysResult = DMLib.Pure.Sync.computeSinceTimestamp(lastCacheTime, 3);
          expect(threeDaysResult).toBe(lastCacheTime - 3 * SECONDS_PER_DAY);
        });
      });
      it.todo('buildCachedData');
    });
  });

  describe('Impure', () => {
    describe('Relay', () => {
      it.todo('fetchRelayLists');
      it.todo('fetchMyRelayInfo');
    });

    describe('Message', () => {
      it.todo('fetchMessages');
      it.todo('unwrapAllGiftWraps');
      it.todo('queryMessages');
      it.todo('queryNewRelays');
    });

    describe('Participant', () => {
      it.todo('refreshStaleParticipants');
      it.todo('fetchAndMergeParticipants');
    });

    describe('Cache', () => {
      const testPubkey = 'test-pubkey-123';

      beforeEach(async () => {
        const db = await openDB(CACHE_DB_NAME, 1, {
          upgrade(db) {
            if (!db.objectStoreNames.contains(CACHE_STORE_NAME)) {
              db.createObjectStore(CACHE_STORE_NAME);
            }
          },
        });
        await db.clear(CACHE_STORE_NAME);
      });

      afterEach(async () => {
        const db = await openDB(CACHE_DB_NAME, 1);
        await db.clear(CACHE_STORE_NAME);
        db.close();
      });

      it('should return null when no data exists for pubkey', async () => {
        const result = await DMLib.Impure.Cache.loadFromCache('nonexistent-pubkey');
        expect(result).toBeNull();
      });

      it('should return valid MessagingState when data exists', async () => {
        const validData: MessagingState = {
          participants: { 'pubkey1': { pubkey: 'pubkey1', derivedRelays: [], blockedRelays: [], lastFetched: 0 } },
          conversations: { 'conv1': { id: 'conv1', participantPubkeys: ['pubkey1'], subject: '', lastActivity: 0, lastReadAt: 0, hasNIP04: false, hasNIP17: true, isKnown: true, isRequest: false, lastMessage: null, hasNIP4Messages: false } },
          messages: { 'conv1': [] },
          syncState: { lastCacheTime: 123456, queriedRelays: [], queryLimitReached: false },
          relayInfo: {}
        };

        const db = await openDB(CACHE_DB_NAME, 1);
        await db.put(CACHE_STORE_NAME, validData, `${CACHE_KEY_PREFIX}${testPubkey}`);
        db.close();

        const result = await DMLib.Impure.Cache.loadFromCache(testPubkey);
        expect(result).toEqual(validData);
      });

      it('should return null when data is missing participants key', async () => {
        const invalidData = {
          conversations: {},
          messages: {},
          syncState: { lastCacheTime: 123456, queriedRelays: [], queryLimitReached: false },
          relayInfo: {}
        };

        const db = await openDB(CACHE_DB_NAME, 1);
        await db.put(CACHE_STORE_NAME, invalidData, `${CACHE_KEY_PREFIX}${testPubkey}`);
        db.close();

        const result = await DMLib.Impure.Cache.loadFromCache(testPubkey);
        expect(result).toBeNull();
      });

      it('should return null when data is missing conversations key', async () => {
        const invalidData = {
          participants: {},
          messages: {},
          syncState: { lastCacheTime: 123456, queriedRelays: [], queryLimitReached: false },
          relayInfo: {}
        };

        const db = await openDB(CACHE_DB_NAME, 1);
        await db.put(CACHE_STORE_NAME, invalidData, `${CACHE_KEY_PREFIX}${testPubkey}`);
        db.close();

        const result = await DMLib.Impure.Cache.loadFromCache(testPubkey);
        expect(result).toBeNull();
      });

      it('should return null when data is missing messages key', async () => {
        const invalidData = {
          participants: {},
          conversations: {},
          syncState: { lastCacheTime: 123456, queriedRelays: [], queryLimitReached: false },
          relayInfo: {}
        };

        const db = await openDB(CACHE_DB_NAME, 1);
        await db.put(CACHE_STORE_NAME, invalidData, `${CACHE_KEY_PREFIX}${testPubkey}`);
        db.close();

        const result = await DMLib.Impure.Cache.loadFromCache(testPubkey);
        expect(result).toBeNull();
      });

      it('should return null when data is missing syncState key', async () => {
        const invalidData = {
          participants: {},
          conversations: {},
          messages: {},
          relayInfo: {}
        };

        const db = await openDB(CACHE_DB_NAME, 1);
        await db.put(CACHE_STORE_NAME, invalidData, `${CACHE_KEY_PREFIX}${testPubkey}`);
        db.close();

        const result = await DMLib.Impure.Cache.loadFromCache(testPubkey);
        expect(result).toBeNull();
      });

      it('should return null when data is missing relayInfo key', async () => {
        const invalidData = {
          participants: {},
          conversations: {},
          messages: {},
          syncState: { lastCacheTime: 123456, queriedRelays: [], queryLimitReached: false }
        };

        const db = await openDB(CACHE_DB_NAME, 1);
        await db.put(CACHE_STORE_NAME, invalidData, `${CACHE_KEY_PREFIX}${testPubkey}`);
        db.close();

        const result = await DMLib.Impure.Cache.loadFromCache(testPubkey);
        expect(result).toBeNull();
      });

      it('should save MessagingState to IndexedDB', async () => {
        const testData: MessagingState = {
          participants: { 'pk1': { pubkey: 'pk1', derivedRelays: ['wss://relay1.com'], blockedRelays: [], lastFetched: 123 } },
          conversations: { 'conv1': { id: 'conv1', participantPubkeys: ['pk1'], subject: '', lastActivity: 456, lastReadAt: 0, hasNIP04: true, hasNIP17: false, isKnown: true, isRequest: false, lastMessage: null, hasNIP4Messages: true } },
          messages: { 'conv1': [{ id: 'msg1', event: { id: 'msg1', pubkey: 'pk1', created_at: 789, kind: 4, tags: [], content: 'encrypted', sig: 'sig1' }, conversationId: 'conv1', protocol: 'nip04' }] },
          syncState: { lastCacheTime: 999, queriedRelays: ['wss://relay1.com'], queryLimitReached: false },
          relayInfo: { 'wss://relay1.com': { lastQuerySucceeded: true, lastQueryError: null, isBlocked: false } }
        };

        await DMLib.Impure.Cache.saveToCache(testPubkey, testData);

        const db = await openDB(CACHE_DB_NAME, 1);
        const retrieved = await db.get(CACHE_STORE_NAME, `${CACHE_KEY_PREFIX}${testPubkey}`);
        db.close();

        expect(retrieved).toEqual(testData);
      });

      it('should allow data to be saved and loaded (round-trip)', async () => {
        const testData: MessagingState = {
          participants: { 'pk2': { pubkey: 'pk2', derivedRelays: [], blockedRelays: [], lastFetched: 0 } },
          conversations: {},
          messages: {},
          syncState: { lastCacheTime: 111, queriedRelays: [], queryLimitReached: true },
          relayInfo: {}
        };

        await DMLib.Impure.Cache.saveToCache(testPubkey, testData);
        const loaded = await DMLib.Impure.Cache.loadFromCache(testPubkey);

        expect(loaded).toEqual(testData);
      });

      it('should overwrite existing data for same pubkey', async () => {
        const firstData: MessagingState = {
          participants: {},
          conversations: {},
          messages: {},
          syncState: { lastCacheTime: 111, queriedRelays: [], queryLimitReached: false },
          relayInfo: {}
        };

        const secondData: MessagingState = {
          participants: { 'new': { pubkey: 'new', derivedRelays: [], blockedRelays: [], lastFetched: 0 } },
          conversations: {},
          messages: {},
          syncState: { lastCacheTime: 222, queriedRelays: [], queryLimitReached: true },
          relayInfo: {}
        };

        await DMLib.Impure.Cache.saveToCache(testPubkey, firstData);
        await DMLib.Impure.Cache.saveToCache(testPubkey, secondData);

        const loaded = await DMLib.Impure.Cache.loadFromCache(testPubkey);
        expect(loaded).toEqual(secondData);
        expect(loaded?.syncState.lastCacheTime).toBe(222);
      });

      it('should store data for multiple pubkeys independently', async () => {
        const pubkey1Data: MessagingState = {
          participants: { 'pk1': { pubkey: 'pk1', derivedRelays: [], blockedRelays: [], lastFetched: 0 } },
          conversations: {},
          messages: {},
          syncState: { lastCacheTime: 111, queriedRelays: [], queryLimitReached: false },
          relayInfo: {}
        };

        const pubkey2Data: MessagingState = {
          participants: { 'pk2': { pubkey: 'pk2', derivedRelays: [], blockedRelays: [], lastFetched: 0 } },
          conversations: {},
          messages: {},
          syncState: { lastCacheTime: 222, queriedRelays: [], queryLimitReached: false },
          relayInfo: {}
        };

        await DMLib.Impure.Cache.saveToCache('pubkey1', pubkey1Data);
        await DMLib.Impure.Cache.saveToCache('pubkey2', pubkey2Data);

        const loaded1 = await DMLib.Impure.Cache.loadFromCache('pubkey1');
        const loaded2 = await DMLib.Impure.Cache.loadFromCache('pubkey2');

        expect(loaded1).toEqual(pubkey1Data);
        expect(loaded2).toEqual(pubkey2Data);
      });

      it.todo('buildAndSaveCache');
    });
  });
});

