/* eslint-disable */
// @ts-nocheck
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDB } from 'idb';
import * as DMLib from './dmLib';
import type { MessagingState } from './dmTypes';

describe('DMLib', () => {
  describe('Pure', () => {
    describe('Relay', () => {
      it.todo('extractBlockedRelays');
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
      it.todo('getNewPubkeys');
      it.todo('extractNewPubkeys');
      it.todo('determineNewPubkeys');
    });

    describe('Conversation', () => {
      it.todo('computeConversationId');
      it.todo('groupMessagesIntoConversations');
    });

    describe('Sync', () => {
      it.todo('computeSinceTimestamp');
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
      const dbName = 'nostr-dm-cache-v2';
      const storeName = 'dm-cache';

      beforeEach(async () => {
        const db = await openDB(dbName, 1, {
          upgrade(db) {
            if (!db.objectStoreNames.contains(storeName)) {
              db.createObjectStore(storeName);
            }
          },
        });
        await db.clear(storeName);
      });

      afterEach(async () => {
        const db = await openDB(dbName, 1);
        await db.clear(storeName);
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

        const db = await openDB(dbName, 1);
        await db.put(storeName, validData, `dm-cache:${testPubkey}`);
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

        const db = await openDB(dbName, 1);
        await db.put(storeName, invalidData, `dm-cache:${testPubkey}`);
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

        const db = await openDB(dbName, 1);
        await db.put(storeName, invalidData, `dm-cache:${testPubkey}`);
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

        const db = await openDB(dbName, 1);
        await db.put(storeName, invalidData, `dm-cache:${testPubkey}`);
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

        const db = await openDB(dbName, 1);
        await db.put(storeName, invalidData, `dm-cache:${testPubkey}`);
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

        const db = await openDB(dbName, 1);
        await db.put(storeName, invalidData, `dm-cache:${testPubkey}`);
        db.close();

        const result = await DMLib.Impure.Cache.loadFromCache(testPubkey);
        expect(result).toBeNull();
      });

      it.todo('saveToCache');
      it.todo('buildAndSaveCache');
    });
  });
});

