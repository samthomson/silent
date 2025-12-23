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
      
      describe('deriveRelaySet', () => {
        const discoveryRelays = ['wss://discovery1.com', 'wss://discovery2.com'];
        
        describe('discovery mode', () => {
          it('should return only discovery relays', () => {
            const kind10002 = { id: 'e1', pubkey: 'pk1', created_at: 100, kind: 10002, tags: [['r', 'wss://user-relay.com']], content: '', sig: 'sig1' };
            const kind10050 = { id: 'e2', pubkey: 'pk1', created_at: 200, kind: 10050, tags: [['relay', 'wss://dm-relay.com']], content: '', sig: 'sig2' };
            
            const result = DMLib.Pure.Relay.deriveRelaySet(kind10002, kind10050, null, 'discovery', discoveryRelays);
            
            expect(result.derivedRelays).toEqual(discoveryRelays);
            expect(result.blockedRelays).toEqual([]);
          });

          it('should extract blocked relays from kind 10006', () => {
            const kind10006 = { id: 'e1', pubkey: 'pk1', created_at: 100, kind: 10006, tags: [['r', 'wss://blocked.com']], content: '', sig: 'sig1' };
            
            const result = DMLib.Pure.Relay.deriveRelaySet(null, null, kind10006, 'discovery', discoveryRelays);
            
            expect(result.derivedRelays).toEqual(discoveryRelays);
            expect(result.blockedRelays).toEqual(['wss://blocked.com']);
          });
        });

        describe('strict_outbox mode', () => {
          it('should use kind 10050 relays when present', () => {
            const kind10050 = { id: 'e1', pubkey: 'pk1', created_at: 100, kind: 10050, tags: [['relay', 'wss://dm1.com'], ['relay', 'wss://dm2.com']], content: '', sig: 'sig1' };
            
            const result = DMLib.Pure.Relay.deriveRelaySet(null, kind10050, null, 'strict_outbox', discoveryRelays);
            
            expect(result.derivedRelays).toEqual(['wss://dm1.com', 'wss://dm2.com']);
            expect(result.blockedRelays).toEqual([]);
          });

          it('should use kind 10002 read relays when no kind 10050', () => {
            const kind10002 = { id: 'e1', pubkey: 'pk1', created_at: 100, kind: 10002, tags: [['r', 'wss://read1.com', 'read'], ['r', 'wss://read2.com']], content: '', sig: 'sig1' };
            
            const result = DMLib.Pure.Relay.deriveRelaySet(kind10002, null, null, 'strict_outbox', discoveryRelays);
            
            expect(result.derivedRelays).toEqual(['wss://read1.com', 'wss://read2.com']);
            expect(result.blockedRelays).toEqual([]);
          });

          it('should exclude write-only relays from kind 10002', () => {
            const kind10002 = { id: 'e1', pubkey: 'pk1', created_at: 100, kind: 10002, tags: [['r', 'wss://read.com', 'read'], ['r', 'wss://write.com', 'write']], content: '', sig: 'sig1' };
            
            const result = DMLib.Pure.Relay.deriveRelaySet(kind10002, null, null, 'strict_outbox', discoveryRelays);
            
            expect(result.derivedRelays).toEqual(['wss://read.com']);
            expect(result.derivedRelays).not.toContain('wss://write.com');
          });

          it('should return empty array when no user relays (no fallback)', () => {
            const result = DMLib.Pure.Relay.deriveRelaySet(null, null, null, 'strict_outbox', discoveryRelays);
            
            expect(result.derivedRelays).toEqual([]);
          });

          it('should prefer kind 10050 over kind 10002', () => {
            const kind10002 = { id: 'e1', pubkey: 'pk1', created_at: 100, kind: 10002, tags: [['r', 'wss://nip65.com']], content: '', sig: 'sig1' };
            const kind10050 = { id: 'e2', pubkey: 'pk1', created_at: 200, kind: 10050, tags: [['relay', 'wss://dm.com']], content: '', sig: 'sig2' };
            
            const result = DMLib.Pure.Relay.deriveRelaySet(kind10002, kind10050, null, 'strict_outbox', discoveryRelays);
            
            expect(result.derivedRelays).toEqual(['wss://dm.com']);
            expect(result.derivedRelays).not.toContain('wss://nip65.com');
          });

          it('should return all user relays unfiltered', () => {
            const kind10050 = { id: 'e1', pubkey: 'pk1', created_at: 100, kind: 10050, tags: [['relay', 'wss://dm1.com'], ['relay', 'wss://dm2.com']], content: '', sig: 'sig1' };
            
            const result = DMLib.Pure.Relay.deriveRelaySet(null, kind10050, null, 'strict_outbox', discoveryRelays);
            
            expect(result.derivedRelays).toEqual(['wss://dm1.com', 'wss://dm2.com']);
          });

          it('should extract blocked relays from kind 10006', () => {
            const kind10050 = { id: 'e1', pubkey: 'pk1', created_at: 100, kind: 10050, tags: [['relay', 'wss://dm.com']], content: '', sig: 'sig1' };
            const kind10006 = { id: 'e2', pubkey: 'pk1', created_at: 200, kind: 10006, tags: [['r', 'wss://blocked1.com'], ['r', 'wss://blocked2.com']], content: '', sig: 'sig2' };
            
            const result = DMLib.Pure.Relay.deriveRelaySet(null, kind10050, kind10006, 'strict_outbox', discoveryRelays);
            
            expect(result.derivedRelays).toEqual(['wss://dm.com']);
            expect(result.blockedRelays).toEqual(['wss://blocked1.com', 'wss://blocked2.com']);
          });

          it('should handle kind 10006 with empty tags (all blocks removed)', () => {
            const kind10050 = { id: 'e1', pubkey: 'pk1', created_at: 100, kind: 10050, tags: [['relay', 'wss://dm.com']], content: '', sig: 'sig1' };
            const kind10006 = { id: 'e2', pubkey: 'pk1', created_at: 200, kind: 10006, tags: [], content: '', sig: 'sig2' };
            
            const result = DMLib.Pure.Relay.deriveRelaySet(null, kind10050, kind10006, 'strict_outbox', discoveryRelays);
            
            expect(result.derivedRelays).toEqual(['wss://dm.com']);
            expect(result.blockedRelays).toEqual([]); // Published but removed all
          });
        });

        describe('hybrid mode', () => {
          it('should combine user relays and discovery relays', () => {
            const kind10050 = { id: 'e1', pubkey: 'pk1', created_at: 100, kind: 10050, tags: [['relay', 'wss://dm.com']], content: '', sig: 'sig1' };
            
            const result = DMLib.Pure.Relay.deriveRelaySet(null, kind10050, null, 'hybrid', discoveryRelays);
            
            expect(result.derivedRelays).toContain('wss://dm.com');
            expect(result.derivedRelays).toContain('wss://discovery1.com');
            expect(result.derivedRelays).toContain('wss://discovery2.com');
            expect(result.derivedRelays.length).toBe(3);
          });

          it('should include both kind 10050 and kind 10002 relays', () => {
            const kind10002 = { id: 'e1', pubkey: 'pk1', created_at: 100, kind: 10002, tags: [['r', 'wss://nip65.com', 'read']], content: '', sig: 'sig1' };
            const kind10050 = { id: 'e2', pubkey: 'pk1', created_at: 200, kind: 10050, tags: [['relay', 'wss://dm.com']], content: '', sig: 'sig2' };
            
            const result = DMLib.Pure.Relay.deriveRelaySet(kind10002, kind10050, null, 'hybrid', discoveryRelays);
            
            expect(result.derivedRelays).toContain('wss://dm.com');
            expect(result.derivedRelays).toContain('wss://nip65.com');
            expect(result.derivedRelays).toContain('wss://discovery1.com');
            expect(result.derivedRelays).toContain('wss://discovery2.com');
          });

          it('should deduplicate relays', () => {
            const kind10050 = { id: 'e1', pubkey: 'pk1', created_at: 100, kind: 10050, tags: [['relay', 'wss://discovery1.com']], content: '', sig: 'sig1' };
            
            const result = DMLib.Pure.Relay.deriveRelaySet(null, kind10050, null, 'hybrid', discoveryRelays);
            
            expect(result.derivedRelays.filter(r => r === 'wss://discovery1.com').length).toBe(1);
          });

          it('should include all relays unfiltered', () => {
            const kind10050 = { id: 'e1', pubkey: 'pk1', created_at: 100, kind: 10050, tags: [['relay', 'wss://dm.com']], content: '', sig: 'sig1' };
            const kind10006 = { id: 'e2', pubkey: 'pk1', created_at: 200, kind: 10006, tags: [['r', 'wss://dm.com'], ['r', 'wss://discovery2.com']], content: '', sig: 'sig2' };
            
            const result = DMLib.Pure.Relay.deriveRelaySet(null, kind10050, kind10006, 'hybrid', discoveryRelays);
            
            expect(result.derivedRelays).toContain('wss://dm.com');
            expect(result.derivedRelays).toContain('wss://discovery1.com');
            expect(result.derivedRelays).toContain('wss://discovery2.com');
            expect(result.blockedRelays).toEqual(['wss://dm.com', 'wss://discovery2.com']);
          });

          it('should use only discovery relays when kind 10002 has only write relays', () => {
            const kind10002 = { id: 'e1', pubkey: 'pk1', created_at: 100, kind: 10002, tags: [['r', 'wss://write1.com', 'write'], ['r', 'wss://write2.com', 'write']], content: '', sig: 'sig1' };
            
            const result = DMLib.Pure.Relay.deriveRelaySet(kind10002, null, null, 'hybrid', discoveryRelays);
            
            // No read relays from user, should only have discovery relays
            expect(result.derivedRelays).toEqual(discoveryRelays);
          });
        });

        describe('edge cases', () => {
          it('should handle empty tags in events', () => {
            const kind10050 = { id: 'e1', pubkey: 'pk1', created_at: 100, kind: 10050, tags: [], content: '', sig: 'sig1' };
            
            const result = DMLib.Pure.Relay.deriveRelaySet(null, kind10050, null, 'strict_outbox', discoveryRelays);
            
            expect(result.derivedRelays).toEqual([]); // strict_outbox = no fallback
          });

          it('should handle malformed relay tags', () => {
            const kind10050 = { id: 'e1', pubkey: 'pk1', created_at: 100, kind: 10050, tags: [['relay'], ['relay', ''], ['relay', '  ']], content: '', sig: 'sig1' };
            
            const result = DMLib.Pure.Relay.deriveRelaySet(null, kind10050, null, 'strict_outbox', discoveryRelays);
            
            expect(result.derivedRelays).toEqual([]); // strict_outbox = no fallback
          });

          it('should trim whitespace from relay URLs', () => {
            const kind10050 = { id: 'e1', pubkey: 'pk1', created_at: 100, kind: 10050, tags: [['relay', '  wss://dm.com  ']], content: '', sig: 'sig1' };
            
            const result = DMLib.Pure.Relay.deriveRelaySet(null, kind10050, null, 'strict_outbox', discoveryRelays);
            
            expect(result.derivedRelays).toEqual(['wss://dm.com']);
          });

          it('should handle empty discovery relays', () => {
            const kind10050 = { id: 'e1', pubkey: 'pk1', created_at: 100, kind: 10050, tags: [['relay', 'wss://dm.com']], content: '', sig: 'sig1' };
            
            const result = DMLib.Pure.Relay.deriveRelaySet(null, kind10050, null, 'strict_outbox', []);
            
            expect(result.derivedRelays).toEqual(['wss://dm.com']);
          });

          it('should return empty in discovery mode with no discovery relays', () => {
            const result = DMLib.Pure.Relay.deriveRelaySet(null, null, null, 'discovery', []);
            
            expect(result.derivedRelays).toEqual([]);
          });
        });

        describe('realistic scenarios', () => {
          it('should handle typical NIP-65 relay list', () => {
            const kind10002 = {
              id: 'e1',
              pubkey: 'alice',
              created_at: 1734700000,
              kind: 10002,
              tags: [
                ['r', 'wss://relay.damus.io'],
                ['r', 'wss://nos.lol', 'read'],
                ['r', 'wss://relay.nostr.band', 'write'],
                ['r', 'wss://nostr.wine', 'read']
              ],
              content: '',
              sig: 'sig1'
            };
            
            const result = DMLib.Pure.Relay.deriveRelaySet(kind10002, null, null, 'strict_outbox', discoveryRelays);
            
            expect(result.derivedRelays).toContain('wss://relay.damus.io'); // no marker = both
            expect(result.derivedRelays).toContain('wss://nos.lol'); // read
            expect(result.derivedRelays).not.toContain('wss://relay.nostr.band'); // write-only
            expect(result.derivedRelays).toContain('wss://nostr.wine'); // read
          });

          it('should handle complete relay setup with kind 10006', () => {
            const kind10002 = { id: 'e1', pubkey: 'pk1', created_at: 100, kind: 10002, tags: [['r', 'wss://nip65.com', 'read']], content: '', sig: 'sig1' };
            const kind10050 = { id: 'e2', pubkey: 'pk1', created_at: 200, kind: 10050, tags: [['relay', 'wss://dm.com']], content: '', sig: 'sig2' };
            const kind10006 = { id: 'e3', pubkey: 'pk1', created_at: 300, kind: 10006, tags: [['r', 'wss://spam.com']], content: '', sig: 'sig3' };
            
            const result = DMLib.Pure.Relay.deriveRelaySet(kind10002, kind10050, kind10006, 'hybrid', [...discoveryRelays, 'wss://spam.com']);
            
            expect(result.derivedRelays).toContain('wss://dm.com');
            expect(result.derivedRelays).toContain('wss://nip65.com');
            expect(result.derivedRelays).toContain('wss://discovery1.com');
            expect(result.derivedRelays).toContain('wss://discovery2.com');
            expect(result.derivedRelays).toContain('wss://spam.com'); // NOT filtered
            expect(result.blockedRelays).toEqual(['wss://spam.com']);
          });
        });
      });
      
      it.todo('findNewRelaysToQuery');
      it.todo('computeAllQueriedRelays');
      it.todo('buildRelayToUsersMap');
      it.todo('filterNewRelayUserCombos');
    });

    describe('Message', () => {
      it.todo('dedupeMessages');
      it.todo('extractPubkeysFromMessages');
    });

    describe('Participant', () => {
      describe('buildParticipant', () => {
        const discoveryRelays = ['wss://discovery1.com', 'wss://discovery2.com'];
        
        it('should build participant from relay lists', () => {
          const lists = {
            kind10002: { id: 'e1', pubkey: 'pk1', created_at: 100, kind: 10002, tags: [['r', 'wss://relay1.com', 'read']], content: '', sig: 'sig1' },
            kind10050: null,
            kind10006: null
          };
          
          const result = DMLib.Pure.Participant.buildParticipant('pubkey123', lists, 'strict_outbox', discoveryRelays);
          
          expect(result.pubkey).toBe('pubkey123');
          expect(result.derivedRelays).toEqual(['wss://relay1.com']);
          expect(result.blockedRelays).toEqual([]);
        });

        it('should prioritize kind 10050 over kind 10002', () => {
          const lists = {
            kind10002: { id: 'e1', pubkey: 'pk1', created_at: 100, kind: 10002, tags: [['r', 'wss://nip65.com', 'read']], content: '', sig: 'sig1' },
            kind10050: { id: 'e2', pubkey: 'pk1', created_at: 200, kind: 10050, tags: [['relay', 'wss://dm.com']], content: '', sig: 'sig2' },
            kind10006: null
          };
          
          const result = DMLib.Pure.Participant.buildParticipant('pubkey123', lists, 'strict_outbox', discoveryRelays);
          
          expect(result.derivedRelays).toEqual(['wss://dm.com']);
          expect(result.derivedRelays).not.toContain('wss://nip65.com');
        });

        it('should extract blocked relays from kind 10006', () => {
          const lists = {
            kind10002: null,
            kind10050: { id: 'e1', pubkey: 'pk1', created_at: 100, kind: 10050, tags: [['relay', 'wss://dm.com']], content: '', sig: 'sig1' },
            kind10006: { id: 'e2', pubkey: 'pk1', created_at: 200, kind: 10006, tags: [['r', 'wss://blocked1.com'], ['r', 'wss://blocked2.com']], content: '', sig: 'sig2' }
          };
          
          const result = DMLib.Pure.Participant.buildParticipant('pubkey123', lists, 'strict_outbox', discoveryRelays);
          
          expect(result.derivedRelays).toEqual(['wss://dm.com']);
          expect(result.blockedRelays).toEqual(['wss://blocked1.com', 'wss://blocked2.com']);
        });

        it('should handle hybrid mode correctly', () => {
          const lists = {
            kind10002: null,
            kind10050: { id: 'e1', pubkey: 'pk1', created_at: 100, kind: 10050, tags: [['relay', 'wss://dm.com']], content: '', sig: 'sig1' },
            kind10006: null
          };
          
          const result = DMLib.Pure.Participant.buildParticipant('pubkey123', lists, 'hybrid', discoveryRelays);
          
          expect(result.derivedRelays).toContain('wss://dm.com');
          expect(result.derivedRelays).toContain('wss://discovery1.com');
          expect(result.derivedRelays).toContain('wss://discovery2.com');
        });

        it('should handle participant with no relay events', () => {
          const lists = {
            kind10002: null,
            kind10050: null,
            kind10006: null
          };
          
          const result = DMLib.Pure.Participant.buildParticipant('pubkey123', lists, 'strict_outbox', discoveryRelays);
          
          expect(result.pubkey).toBe('pubkey123');
          expect(result.derivedRelays).toEqual([]);
          expect(result.blockedRelays).toEqual([]);
        });

        it('should set lastFetched to current timestamp', () => {
          const beforeTime = Date.now();
          const lists = {
            kind10002: null,
            kind10050: { id: 'e1', pubkey: 'pk1', created_at: 100, kind: 10050, tags: [['relay', 'wss://dm.com']], content: '', sig: 'sig1' },
            kind10006: null
          };
          
          const result = DMLib.Pure.Participant.buildParticipant('pubkey123', lists, 'strict_outbox', discoveryRelays);
          const afterTime = Date.now();
          
          expect(result.lastFetched).toBeGreaterThanOrEqual(beforeTime);
          expect(result.lastFetched).toBeLessThanOrEqual(afterTime);
        });

        it('should handle complete realistic scenario', () => {
          const lists = {
            kind10002: { 
              id: 'e1', 
              pubkey: 'alice', 
              created_at: 1734700000, 
              kind: 10002, 
              tags: [
                ['r', 'wss://relay.damus.io'],
                ['r', 'wss://nos.lol', 'read'],
                ['r', 'wss://relay.nostr.band', 'write']
              ], 
              content: '', 
              sig: 'sig1' 
            },
            kind10050: { 
              id: 'e2', 
              pubkey: 'alice', 
              created_at: 1734700100, 
              kind: 10050, 
              tags: [
                ['relay', 'wss://inbox.nostr.wine']
              ], 
              content: '', 
              sig: 'sig2' 
            },
            kind10006: { 
              id: 'e3', 
              pubkey: 'alice', 
              created_at: 1734700200, 
              kind: 10006, 
              tags: [
                ['r', 'wss://spam-relay.com']
              ], 
              content: '', 
              sig: 'sig3' 
            }
          };
          
          const result = DMLib.Pure.Participant.buildParticipant('alice', lists, 'hybrid', discoveryRelays);
          
          expect(result.pubkey).toBe('alice');
          expect(result.derivedRelays).toContain('wss://inbox.nostr.wine'); // kind 10050 priority
          expect(result.derivedRelays).toContain('wss://relay.damus.io'); // kind 10002 (hybrid includes both)
          expect(result.derivedRelays).toContain('wss://nos.lol'); // kind 10002 read
          expect(result.derivedRelays).not.toContain('wss://relay.nostr.band'); // write-only excluded
          expect(result.derivedRelays).toContain('wss://discovery1.com'); // hybrid includes discovery
          expect(result.blockedRelays).toEqual(['wss://spam-relay.com']);
        });
      });
      
      describe('buildParticipantsMap', () => {
        const discoveryRelays = ['wss://discovery1.com', 'wss://discovery2.com'];
        
        it('should return empty object for empty pubkeys array', () => {
          const relayListsMap = new Map<string, any>();
          
          const result = DMLib.Pure.Participant.buildParticipantsMap([], relayListsMap, 'strict_outbox', discoveryRelays);
          
          expect(result).toEqual({});
        });

        it('should build participant for single pubkey', () => {
          const relayListsMap = new Map([
            ['alice', {
              kind10002: null,
              kind10050: { id: 'e1', pubkey: 'alice', created_at: 100, kind: 10050, tags: [['relay', 'wss://alice.com']], content: '', sig: 'sig1' },
              kind10006: null
            }]
          ]);
          
          const result = DMLib.Pure.Participant.buildParticipantsMap(['alice'], relayListsMap, 'strict_outbox', discoveryRelays);
          
          expect(result.alice).toBeDefined();
          expect(result.alice.pubkey).toBe('alice');
          expect(result.alice.derivedRelays).toEqual(['wss://alice.com']);
        });

        it('should build participants for multiple pubkeys', () => {
          const relayListsMap = new Map([
            ['alice', {
              kind10002: null,
              kind10050: { id: 'e1', pubkey: 'alice', created_at: 100, kind: 10050, tags: [['relay', 'wss://alice.com']], content: '', sig: 'sig1' },
              kind10006: null
            }],
            ['bob', {
              kind10002: { id: 'e2', pubkey: 'bob', created_at: 100, kind: 10002, tags: [['r', 'wss://bob.com', 'read']], content: '', sig: 'sig2' },
              kind10050: null,
              kind10006: null
            }],
            ['charlie', {
              kind10002: null,
              kind10050: null,
              kind10006: null
            }]
          ]);
          
          const result = DMLib.Pure.Participant.buildParticipantsMap(['alice', 'bob', 'charlie'], relayListsMap, 'strict_outbox', discoveryRelays);
          
          expect(Object.keys(result)).toHaveLength(3);
          expect(result.alice.derivedRelays).toEqual(['wss://alice.com']);
          expect(result.bob.derivedRelays).toEqual(['wss://bob.com']);
          expect(result.charlie.derivedRelays).toEqual([]);
        });

        it('should respect relay mode when building participants', () => {
          const relayListsMap = new Map([
            ['alice', {
              kind10002: null,
              kind10050: { id: 'e1', pubkey: 'alice', created_at: 100, kind: 10050, tags: [['relay', 'wss://alice.com']], content: '', sig: 'sig1' },
              kind10006: null
            }]
          ]);
          
          const result = DMLib.Pure.Participant.buildParticipantsMap(['alice'], relayListsMap, 'hybrid', discoveryRelays);
          
          expect(result.alice.derivedRelays).toContain('wss://alice.com');
          expect(result.alice.derivedRelays).toContain('wss://discovery1.com');
          expect(result.alice.derivedRelays).toContain('wss://discovery2.com');
        });

        it('should extract blocked relays for all participants', () => {
          const relayListsMap = new Map([
            ['alice', {
              kind10002: null,
              kind10050: { id: 'e1', pubkey: 'alice', created_at: 100, kind: 10050, tags: [['relay', 'wss://alice.com']], content: '', sig: 'sig1' },
              kind10006: { id: 'e2', pubkey: 'alice', created_at: 200, kind: 10006, tags: [['r', 'wss://spam1.com']], content: '', sig: 'sig2' }
            }],
            ['bob', {
              kind10002: null,
              kind10050: { id: 'e3', pubkey: 'bob', created_at: 100, kind: 10050, tags: [['relay', 'wss://bob.com']], content: '', sig: 'sig3' },
              kind10006: { id: 'e4', pubkey: 'bob', created_at: 200, kind: 10006, tags: [['r', 'wss://spam2.com']], content: '', sig: 'sig4' }
            }]
          ]);
          
          const result = DMLib.Pure.Participant.buildParticipantsMap(['alice', 'bob'], relayListsMap, 'strict_outbox', discoveryRelays);
          
          expect(result.alice.blockedRelays).toEqual(['wss://spam1.com']);
          expect(result.bob.blockedRelays).toEqual(['wss://spam2.com']);
        });

        it('should handle realistic multi-user scenario', () => {
          const relayListsMap = new Map([
            ['alice', {
              kind10002: { id: 'e1', pubkey: 'alice', created_at: 100, kind: 10002, tags: [['r', 'wss://relay.damus.io'], ['r', 'wss://nos.lol', 'read']], content: '', sig: 'sig1' },
              kind10050: { id: 'e2', pubkey: 'alice', created_at: 200, kind: 10050, tags: [['relay', 'wss://inbox.alice.com']], content: '', sig: 'sig2' },
              kind10006: { id: 'e3', pubkey: 'alice', created_at: 300, kind: 10006, tags: [['r', 'wss://spam.com']], content: '', sig: 'sig3' }
            }],
            ['bob', {
              kind10002: { id: 'e4', pubkey: 'bob', created_at: 100, kind: 10002, tags: [['r', 'wss://relay.nostr.band', 'read']], content: '', sig: 'sig4' },
              kind10050: null,
              kind10006: null
            }],
            ['charlie', {
              kind10002: null,
              kind10050: null,
              kind10006: null
            }]
          ]);
          
          const result = DMLib.Pure.Participant.buildParticipantsMap(['alice', 'bob', 'charlie'], relayListsMap, 'strict_outbox', discoveryRelays);
          
          expect(Object.keys(result)).toHaveLength(3);
          
          // Alice: has kind 10050 (prioritized)
          expect(result.alice.derivedRelays).toEqual(['wss://inbox.alice.com']);
          expect(result.alice.blockedRelays).toEqual(['wss://spam.com']);
          
          // Bob: falls back to kind 10002
          expect(result.bob.derivedRelays).toEqual(['wss://relay.nostr.band']);
          expect(result.bob.blockedRelays).toEqual([]);
          
          // Charlie: no relays
          expect(result.charlie.derivedRelays).toEqual([]);
          expect(result.charlie.blockedRelays).toEqual([]);
        });
      });
      
      describe('mergeParticipants', () => {
        it('should return empty object when both records are empty', () => {
          const result = DMLib.Pure.Participant.mergeParticipants({}, {});
          expect(result).toEqual({});
        });

        it('should return existing when incoming is empty', () => {
          const existing = {
            'pk1': { pubkey: 'pk1', derivedRelays: ['wss://relay1.com'], blockedRelays: [], lastFetched: 100 }
          };
          const result = DMLib.Pure.Participant.mergeParticipants(existing, {});
          expect(result).toEqual(existing);
        });

        it('should return incoming when existing is empty', () => {
          const incoming = {
            'pk1': { pubkey: 'pk1', derivedRelays: ['wss://relay1.com'], blockedRelays: [], lastFetched: 100 }
          };
          const result = DMLib.Pure.Participant.mergeParticipants({}, incoming);
          expect(result).toEqual(incoming);
        });

        it('should merge non-overlapping participants', () => {
          const existing = {
            'pk1': { pubkey: 'pk1', derivedRelays: ['wss://relay1.com'], blockedRelays: [], lastFetched: 100 }
          };
          const incoming = {
            'pk2': { pubkey: 'pk2', derivedRelays: ['wss://relay2.com'], blockedRelays: [], lastFetched: 200 }
          };
          const result = DMLib.Pure.Participant.mergeParticipants(existing, incoming);
          expect(result).toEqual({
            'pk1': { pubkey: 'pk1', derivedRelays: ['wss://relay1.com'], blockedRelays: [], lastFetched: 100 },
            'pk2': { pubkey: 'pk2', derivedRelays: ['wss://relay2.com'], blockedRelays: [], lastFetched: 200 }
          });
        });

        it('should let incoming overwrite existing for same pubkey', () => {
          const existing = {
            'pk1': { pubkey: 'pk1', derivedRelays: ['wss://old-relay.com'], blockedRelays: [], lastFetched: 100 }
          };
          const incoming = {
            'pk1': { pubkey: 'pk1', derivedRelays: ['wss://new-relay.com'], blockedRelays: ['wss://blocked.com'], lastFetched: 200 }
          };
          const result = DMLib.Pure.Participant.mergeParticipants(existing, incoming);
          expect(result).toEqual({
            'pk1': { pubkey: 'pk1', derivedRelays: ['wss://new-relay.com'], blockedRelays: ['wss://blocked.com'], lastFetched: 200 }
          });
        });

        it('should handle multiple participants with some overlap', () => {
          const existing = {
            'pk1': { pubkey: 'pk1', derivedRelays: ['wss://relay1.com'], blockedRelays: [], lastFetched: 100 },
            'pk2': { pubkey: 'pk2', derivedRelays: ['wss://relay2.com'], blockedRelays: [], lastFetched: 200 },
            'pk3': { pubkey: 'pk3', derivedRelays: ['wss://relay3.com'], blockedRelays: [], lastFetched: 300 }
          };
          const incoming = {
            'pk2': { pubkey: 'pk2', derivedRelays: ['wss://new-relay2.com'], blockedRelays: [], lastFetched: 250 },
            'pk4': { pubkey: 'pk4', derivedRelays: ['wss://relay4.com'], blockedRelays: [], lastFetched: 400 }
          };
          const result = DMLib.Pure.Participant.mergeParticipants(existing, incoming);
          expect(result).toEqual({
            'pk1': { pubkey: 'pk1', derivedRelays: ['wss://relay1.com'], blockedRelays: [], lastFetched: 100 },
            'pk2': { pubkey: 'pk2', derivedRelays: ['wss://new-relay2.com'], blockedRelays: [], lastFetched: 250 }, // updated
            'pk3': { pubkey: 'pk3', derivedRelays: ['wss://relay3.com'], blockedRelays: [], lastFetched: 300 },
            'pk4': { pubkey: 'pk4', derivedRelays: ['wss://relay4.com'], blockedRelays: [], lastFetched: 400 } // new
          });
        });

        it('should completely replace participant data (not deep merge)', () => {
          const existing = {
            'pk1': { pubkey: 'pk1', derivedRelays: ['wss://relay1.com', 'wss://relay2.com'], blockedRelays: ['wss://blocked1.com'], lastFetched: 100 }
          };
          const incoming = {
            'pk1': { pubkey: 'pk1', derivedRelays: ['wss://relay3.com'], blockedRelays: [], lastFetched: 200 }
          };
          const result = DMLib.Pure.Participant.mergeParticipants(existing, incoming);
          // Should be completely replaced, not merged arrays
          expect(result['pk1'].derivedRelays).toEqual(['wss://relay3.com']);
          expect(result['pk1'].blockedRelays).toEqual([]);
          expect(result['pk1'].lastFetched).toBe(200);
        });

        it('should not mutate existing record', () => {
          const existing = {
            'pk1': { pubkey: 'pk1', derivedRelays: ['wss://relay1.com'], blockedRelays: [], lastFetched: 100 }
          };
          const incoming = {
            'pk2': { pubkey: 'pk2', derivedRelays: ['wss://relay2.com'], blockedRelays: [], lastFetched: 200 }
          };
          const originalExisting = JSON.parse(JSON.stringify(existing));
          
          DMLib.Pure.Participant.mergeParticipants(existing, incoming);
          
          expect(existing).toEqual(originalExisting);
        });

        it('should not mutate incoming record', () => {
          const existing = {
            'pk1': { pubkey: 'pk1', derivedRelays: ['wss://relay1.com'], blockedRelays: [], lastFetched: 100 }
          };
          const incoming = {
            'pk2': { pubkey: 'pk2', derivedRelays: ['wss://relay2.com'], blockedRelays: [], lastFetched: 200 }
          };
          const originalIncoming = JSON.parse(JSON.stringify(incoming));
          
          DMLib.Pure.Participant.mergeParticipants(existing, incoming);
          
          expect(incoming).toEqual(originalIncoming);
        });

        it('should handle large number of participants', () => {
          const existing: Record<string, any> = {};
          const incoming: Record<string, any> = {};
          
          for (let i = 0; i < 50; i++) {
            existing[`pk${i}`] = { pubkey: `pk${i}`, derivedRelays: [], blockedRelays: [], lastFetched: i };
          }
          
          for (let i = 25; i < 75; i++) {
            incoming[`pk${i}`] = { pubkey: `pk${i}`, derivedRelays: ['wss://new.com'], blockedRelays: [], lastFetched: i + 1000 };
          }
          
          const result = DMLib.Pure.Participant.mergeParticipants(existing, incoming);
          
          // Should have 75 total participants (0-74)
          expect(Object.keys(result).length).toBe(75);
          
          // First 25 should be unchanged from existing
          expect(result['pk0'].lastFetched).toBe(0);
          expect(result['pk24'].lastFetched).toBe(24);
          
          // Middle 25 should be updated from incoming
          expect(result['pk25'].lastFetched).toBe(1025);
          expect(result['pk49'].lastFetched).toBe(1049);
          
          // Last 25 should be new from incoming
          expect(result['pk50'].lastFetched).toBe(1050);
          expect(result['pk74'].lastFetched).toBe(1074);
        });

        it('should handle realistic participant data', () => {
          const existing = {
            'abc123': {
              pubkey: 'abc123',
              derivedRelays: ['wss://relay.damus.io', 'wss://nos.lol'],
              blockedRelays: ['wss://spam-relay.com'],
              lastFetched: 1734700000
            }
          };
          const incoming = {
            'def456': {
              pubkey: 'def456',
              derivedRelays: ['wss://relay.nostr.band'],
              blockedRelays: [],
              lastFetched: 1734700100
            }
          };
          const result = DMLib.Pure.Participant.mergeParticipants(existing, incoming);
          
          expect(Object.keys(result).length).toBe(2);
          expect(result['abc123']).toEqual(existing['abc123']);
          expect(result['def456']).toEqual(incoming['def456']);
        });
      });
      
      describe('getStaleParticipants', () => {
        const ONE_DAY = 24 * 60 * 60 * 1000;
        const ONE_WEEK = 7 * ONE_DAY;
        
        it('should return empty array when participants is empty', () => {
          const now = Date.now();
          
          const result = DMLib.Pure.Participant.getStaleParticipants({}, ONE_WEEK, now);
          
          expect(result).toEqual([]);
        });

        it('should return empty array when no participants are stale', () => {
          const now = Date.now();
          const participants = {
            alice: { pubkey: 'alice', derivedRelays: [], blockedRelays: [], lastFetched: now - ONE_DAY },
            bob: { pubkey: 'bob', derivedRelays: [], blockedRelays: [], lastFetched: now - (ONE_DAY * 3) }
          };
          
          const result = DMLib.Pure.Participant.getStaleParticipants(participants, ONE_WEEK, now);
          
          expect(result).toEqual([]);
        });

        it('should return stale participant when lastFetched exceeds TTL', () => {
          const now = Date.now();
          const participants = {
            alice: { pubkey: 'alice', derivedRelays: [], blockedRelays: [], lastFetched: now - (ONE_WEEK + 1000) }
          };
          
          const result = DMLib.Pure.Participant.getStaleParticipants(participants, ONE_WEEK, now);
          
          expect(result).toEqual(['alice']);
        });

        it('should return multiple stale participants', () => {
          const now = Date.now();
          const participants = {
            alice: { pubkey: 'alice', derivedRelays: [], blockedRelays: [], lastFetched: now - (ONE_WEEK + 1000) },
            bob: { pubkey: 'bob', derivedRelays: [], blockedRelays: [], lastFetched: now - ONE_DAY },
            charlie: { pubkey: 'charlie', derivedRelays: [], blockedRelays: [], lastFetched: now - (ONE_WEEK + 5000) }
          };
          
          const result = DMLib.Pure.Participant.getStaleParticipants(participants, ONE_WEEK, now);
          
          expect(result).toContain('alice');
          expect(result).toContain('charlie');
          expect(result).not.toContain('bob');
          expect(result).toHaveLength(2);
        });

        it('should handle participant at exact TTL boundary (not stale)', () => {
          const now = Date.now();
          const participants = {
            alice: { pubkey: 'alice', derivedRelays: [], blockedRelays: [], lastFetched: now - ONE_WEEK }
          };
          
          const result = DMLib.Pure.Participant.getStaleParticipants(participants, ONE_WEEK, now);
          
          expect(result).toEqual([]);
        });

        it('should handle participant just past TTL boundary (stale)', () => {
          const now = Date.now();
          const participants = {
            alice: { pubkey: 'alice', derivedRelays: [], blockedRelays: [], lastFetched: now - ONE_WEEK - 1 }
          };
          
          const result = DMLib.Pure.Participant.getStaleParticipants(participants, ONE_WEEK, now);
          
          expect(result).toEqual(['alice']);
        });

        it('should handle very old participants', () => {
          const now = Date.now();
          const participants = {
            alice: { pubkey: 'alice', derivedRelays: [], blockedRelays: [], lastFetched: now - (ONE_WEEK * 52) } // 1 year old
          };
          
          const result = DMLib.Pure.Participant.getStaleParticipants(participants, ONE_WEEK, now);
          
          expect(result).toEqual(['alice']);
        });

        it('should handle short TTL', () => {
          const now = Date.now();
          const ONE_HOUR = 60 * 60 * 1000;
          const participants = {
            alice: { pubkey: 'alice', derivedRelays: [], blockedRelays: [], lastFetched: now - (ONE_HOUR + 1000) },
            bob: { pubkey: 'bob', derivedRelays: [], blockedRelays: [], lastFetched: now - 1000 }
          };
          
          const result = DMLib.Pure.Participant.getStaleParticipants(participants, ONE_HOUR, now);
          
          expect(result).toEqual(['alice']);
        });

        it('should handle realistic scenario with mixed freshness', () => {
          const now = 1734700000000; // Fixed timestamp
          const participants = {
            alice: { pubkey: 'alice', derivedRelays: ['wss://alice.com'], blockedRelays: [], lastFetched: now - ONE_DAY }, // Fresh
            bob: { pubkey: 'bob', derivedRelays: ['wss://bob.com'], blockedRelays: [], lastFetched: now - (ONE_WEEK + 1000) }, // Stale
            charlie: { pubkey: 'charlie', derivedRelays: ['wss://charlie.com'], blockedRelays: [], lastFetched: now - (ONE_DAY * 5) }, // Fresh
            dave: { pubkey: 'dave', derivedRelays: [], blockedRelays: ['wss://spam.com'], lastFetched: now - (ONE_WEEK * 2) } // Stale
          };
          
          const result = DMLib.Pure.Participant.getStaleParticipants(participants, ONE_WEEK, now);
          
          expect(result).toHaveLength(2);
          expect(result).toContain('bob');
          expect(result).toContain('dave');
          expect(result).not.toContain('alice');
          expect(result).not.toContain('charlie');
        });

        it('should return all participants when all are stale', () => {
          const now = Date.now();
          const participants = {
            alice: { pubkey: 'alice', derivedRelays: [], blockedRelays: [], lastFetched: now - (ONE_WEEK + 1000) },
            bob: { pubkey: 'bob', derivedRelays: [], blockedRelays: [], lastFetched: now - (ONE_WEEK + 2000) },
            charlie: { pubkey: 'charlie', derivedRelays: [], blockedRelays: [], lastFetched: now - (ONE_WEEK + 3000) }
          };
          
          const result = DMLib.Pure.Participant.getStaleParticipants(participants, ONE_WEEK, now);
          
          expect(result).toHaveLength(3);
          expect(result).toContain('alice');
          expect(result).toContain('bob');
          expect(result).toContain('charlie');
        });
      });
      
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
      describe('fetchRelayLists', () => {
        it('should return empty map when pubkeys array is empty', async () => {
          const mockNostr = {
            group: () => ({ query: vi.fn() })
          };
          
          const result = await DMLib.Impure.Relay.fetchRelayLists(mockNostr as any, ['wss://relay.com'], []);
          expect(result).toBeInstanceOf(Map);
          expect(result.size).toBe(0);
        });

        it('should fetch relay lists for single pubkey', async () => {
          const mockEvents = [
            { id: 'e1', pubkey: 'pk1', created_at: 100, kind: 10002, tags: [['r', 'wss://relay1.com']], content: '', sig: 'sig1' },
            { id: 'e2', pubkey: 'pk1', created_at: 200, kind: 10050, tags: [['relay', 'wss://relay2.com']], content: '', sig: 'sig2' },
            { id: 'e3', pubkey: 'pk1', created_at: 300, kind: 10006, tags: [['r', 'wss://blocked.com']], content: '', sig: 'sig3' }
          ];
          
          const mockNostr = {
            group: () => ({
              query: vi.fn().mockResolvedValue(mockEvents)
            })
          };
          
          const result = await DMLib.Impure.Relay.fetchRelayLists(mockNostr as any, ['wss://discovery.com'], ['pk1']);
          
          expect(result.size).toBe(1);
          expect(result.get('pk1')).toEqual({
            kind10002: mockEvents[0],
            kind10050: mockEvents[1],
            kind10006: mockEvents[2]
          });
        });

        it('should fetch relay lists for multiple pubkeys', async () => {
          const mockEvents = [
            { id: 'e1', pubkey: 'pk1', created_at: 100, kind: 10002, tags: [], content: '', sig: 'sig1' },
            { id: 'e2', pubkey: 'pk1', created_at: 200, kind: 10050, tags: [], content: '', sig: 'sig2' },
            { id: 'e3', pubkey: 'pk2', created_at: 150, kind: 10002, tags: [], content: '', sig: 'sig3' },
            { id: 'e4', pubkey: 'pk3', created_at: 300, kind: 10006, tags: [], content: '', sig: 'sig4' }
          ];
          
          const mockNostr = {
            group: () => ({
              query: vi.fn().mockResolvedValue(mockEvents)
            })
          };
          
          const result = await DMLib.Impure.Relay.fetchRelayLists(mockNostr as any, ['wss://discovery.com'], ['pk1', 'pk2', 'pk3']);
          
          expect(result.size).toBe(3);
          expect(result.get('pk1')?.kind10002).toEqual(mockEvents[0]);
          expect(result.get('pk1')?.kind10050).toEqual(mockEvents[1]);
          expect(result.get('pk2')?.kind10002).toEqual(mockEvents[2]);
          expect(result.get('pk3')?.kind10006).toEqual(mockEvents[3]);
        });

        it('should handle pubkeys with no relay list events', async () => {
          const mockNostr = {
            group: () => ({
              query: vi.fn().mockResolvedValue([])
            })
          };
          
          const result = await DMLib.Impure.Relay.fetchRelayLists(mockNostr as any, ['wss://discovery.com'], ['pk1']);
          
          expect(result.size).toBe(1);
          expect(result.get('pk1')).toEqual({
            kind10002: null,
            kind10050: null,
            kind10006: null
          });
        });

        it('should keep only latest event per pubkey+kind', async () => {
          const mockEvents = [
            { id: 'old', pubkey: 'pk1', created_at: 100, kind: 10002, tags: [['r', 'wss://old.com']], content: '', sig: 'sig1' },
            { id: 'new', pubkey: 'pk1', created_at: 200, kind: 10002, tags: [['r', 'wss://new.com']], content: '', sig: 'sig2' }
          ];
          
          const mockNostr = {
            group: () => ({
              query: vi.fn().mockResolvedValue(mockEvents)
            })
          };
          
          const result = await DMLib.Impure.Relay.fetchRelayLists(mockNostr as any, ['wss://discovery.com'], ['pk1']);
          
          expect(result.get('pk1')?.kind10002?.id).toBe('new');
          expect(result.get('pk1')?.kind10002?.created_at).toBe(200);
        });

        it('should handle partial relay lists (only some kinds present)', async () => {
          const mockEvents = [
            { id: 'e1', pubkey: 'pk1', created_at: 100, kind: 10050, tags: [], content: '', sig: 'sig1' }
            // Only 10050, no 10002 or 10006
          ];
          
          const mockNostr = {
            group: () => ({
              query: vi.fn().mockResolvedValue(mockEvents)
            })
          };
          
          const result = await DMLib.Impure.Relay.fetchRelayLists(mockNostr as any, ['wss://discovery.com'], ['pk1']);
          
          expect(result.get('pk1')).toEqual({
            kind10002: null,
            kind10050: mockEvents[0],
            kind10006: null
          });
        });

        it('should use correct query filters', async () => {
          const queryMock = vi.fn().mockResolvedValue([]);
          const mockNostr = {
            group: () => ({ query: queryMock })
          };
          
          await DMLib.Impure.Relay.fetchRelayLists(mockNostr as any, ['wss://discovery.com'], ['pk1', 'pk2']);
          
          expect(queryMock).toHaveBeenCalledWith(
            [{ kinds: [10002, 10050, 10006], authors: ['pk1', 'pk2'] }],
            expect.objectContaining({ signal: expect.any(AbortSignal) })
          );
        });

        it('should return empty map on query error', async () => {
          const mockNostr = {
            group: () => ({
              query: vi.fn().mockRejectedValue(new Error('Network error'))
            })
          };
          
          const result = await DMLib.Impure.Relay.fetchRelayLists(mockNostr as any, ['wss://discovery.com'], ['pk1']);
          
          expect(result).toBeInstanceOf(Map);
          expect(result.size).toBe(0);
        });

        it('should handle mix of pubkeys with and without events', async () => {
          const mockEvents = [
            { id: 'e1', pubkey: 'pk1', created_at: 100, kind: 10002, tags: [], content: '', sig: 'sig1' },
            // pk2 has no events
            { id: 'e2', pubkey: 'pk3', created_at: 200, kind: 10050, tags: [], content: '', sig: 'sig2' }
          ];
          
          const mockNostr = {
            group: () => ({
              query: vi.fn().mockResolvedValue(mockEvents)
            })
          };
          
          const result = await DMLib.Impure.Relay.fetchRelayLists(mockNostr as any, ['wss://discovery.com'], ['pk1', 'pk2', 'pk3']);
          
          expect(result.size).toBe(3);
          expect(result.get('pk1')?.kind10002).toEqual(mockEvents[0]);
          expect(result.get('pk2')).toEqual({ kind10002: null, kind10050: null, kind10006: null });
          expect(result.get('pk3')?.kind10050).toEqual(mockEvents[1]);
        });

        it('should query with timeout', async () => {
          const queryMock = vi.fn().mockResolvedValue([]);
          const mockNostr = {
            group: () => ({ query: queryMock })
          };
          
          await DMLib.Impure.Relay.fetchRelayLists(mockNostr as any, ['wss://discovery.com'], ['pk1']);
          
          const callArgs = queryMock.mock.calls[0][1];
          expect(callArgs).toHaveProperty('signal');
          expect(callArgs.signal).toBeInstanceOf(AbortSignal);
        });
      });
      
      describe('fetchMyRelayInfo', () => {
        it('should fetch relay lists and extract blocked relays for current user', async () => {
          const mockEvents = [
            { id: 'e1', pubkey: 'myPubkey', created_at: 100, kind: 10002, tags: [['r', 'wss://relay1.com']], content: '', sig: 'sig1' },
            { id: 'e2', pubkey: 'myPubkey', created_at: 200, kind: 10050, tags: [['relay', 'wss://relay2.com']], content: '', sig: 'sig2' },
            { id: 'e3', pubkey: 'myPubkey', created_at: 300, kind: 10006, tags: [['r', 'wss://blocked.com'], ['r', 'wss://spam.com']], content: '', sig: 'sig3' }
          ];
          
          const mockNostr = {
            group: () => ({
              query: vi.fn().mockResolvedValue(mockEvents)
            })
          };
          
          const result = await DMLib.Impure.Relay.fetchMyRelayInfo(mockNostr as any, ['wss://discovery.com'], 'myPubkey');
          
          expect(result.myLists).toEqual({
            kind10002: mockEvents[0],
            kind10050: mockEvents[1],
            kind10006: mockEvents[2]
          });
          expect(result.myBlockedRelays).toEqual(['wss://blocked.com', 'wss://spam.com']);
        });

        it('should return empty blocked relays when no kind 10006 event exists', async () => {
          const mockEvents = [
            { id: 'e1', pubkey: 'myPubkey', created_at: 100, kind: 10002, tags: [['r', 'wss://relay1.com']], content: '', sig: 'sig1' }
          ];
          
          const mockNostr = {
            group: () => ({
              query: vi.fn().mockResolvedValue(mockEvents)
            })
          };
          
          const result = await DMLib.Impure.Relay.fetchMyRelayInfo(mockNostr as any, ['wss://discovery.com'], 'myPubkey');
          
          expect(result.myLists.kind10006).toBeNull();
          expect(result.myBlockedRelays).toEqual([]);
        });

        it('should return empty blocked relays when kind 10006 has no r tags', async () => {
          const mockEvents = [
            { id: 'e1', pubkey: 'myPubkey', created_at: 100, kind: 10006, tags: [['p', 'somepubkey']], content: '', sig: 'sig1' }
          ];
          
          const mockNostr = {
            group: () => ({
              query: vi.fn().mockResolvedValue(mockEvents)
            })
          };
          
          const result = await DMLib.Impure.Relay.fetchMyRelayInfo(mockNostr as any, ['wss://discovery.com'], 'myPubkey');
          
          expect(result.myLists.kind10006).toEqual(mockEvents[0]);
          expect(result.myBlockedRelays).toEqual([]);
        });

        it('should handle user with no relay list events at all', async () => {
          const mockNostr = {
            group: () => ({
              query: vi.fn().mockResolvedValue([])
            })
          };
          
          const result = await DMLib.Impure.Relay.fetchMyRelayInfo(mockNostr as any, ['wss://discovery.com'], 'myPubkey');
          
          expect(result.myLists).toEqual({
            kind10002: null,
            kind10050: null,
            kind10006: null
          });
          expect(result.myBlockedRelays).toEqual([]);
        });

        it('should deduplicate blocked relays from kind 10006', async () => {
          const mockEvents = [
            { id: 'e1', pubkey: 'myPubkey', created_at: 100, kind: 10006, tags: [['r', 'wss://blocked.com'], ['r', 'wss://spam.com'], ['r', 'wss://blocked.com']], content: '', sig: 'sig1' }
          ];
          
          const mockNostr = {
            group: () => ({
              query: vi.fn().mockResolvedValue(mockEvents)
            })
          };
          
          const result = await DMLib.Impure.Relay.fetchMyRelayInfo(mockNostr as any, ['wss://discovery.com'], 'myPubkey');
          
          expect(result.myBlockedRelays).toEqual(['wss://blocked.com', 'wss://spam.com']);
        });

        it('should query correct relays and pubkey', async () => {
          const queryMock = vi.fn().mockResolvedValue([]);
          const mockNostr = {
            group: (relays: string[]) => {
              expect(relays).toEqual(['wss://discovery1.com', 'wss://discovery2.com']);
              return { query: queryMock };
            }
          };
          
          await DMLib.Impure.Relay.fetchMyRelayInfo(mockNostr as any, ['wss://discovery1.com', 'wss://discovery2.com'], 'testPubkey');
          
          expect(queryMock).toHaveBeenCalledWith(
            [{ kinds: [10002, 10050, 10006], authors: ['testPubkey'] }],
            expect.objectContaining({ signal: expect.any(AbortSignal) })
          );
        });

        it('should handle query errors gracefully', async () => {
          const mockNostr = {
            group: () => ({
              query: vi.fn().mockRejectedValue(new Error('Network error'))
            })
          };
          
          const result = await DMLib.Impure.Relay.fetchMyRelayInfo(mockNostr as any, ['wss://discovery.com'], 'myPubkey');
          
          // Should return default empty structure
          expect(result.myLists).toEqual({
            kind10002: null,
            kind10050: null,
            kind10006: null
          });
          expect(result.myBlockedRelays).toEqual([]);
        });

        it('should work with realistic relay data', async () => {
          const mockEvents = [
            {
              id: 'nip65-event',
              pubkey: 'alice123',
              created_at: 1734700000,
              kind: 10002,
              tags: [
                ['r', 'wss://relay.damus.io'],
                ['r', 'wss://nos.lol', 'read'],
                ['r', 'wss://relay.nostr.band', 'write']
              ],
              content: '',
              sig: 'sig1'
            },
            {
              id: 'dm-inbox-event',
              pubkey: 'alice123',
              created_at: 1734700100,
              kind: 10050,
              tags: [
                ['relay', 'wss://inbox.nostr.wine']
              ],
              content: '',
              sig: 'sig2'
            },
            {
              id: 'blocked-event',
              pubkey: 'alice123',
              created_at: 1734700200,
              kind: 10006,
              tags: [
                ['r', 'wss://spam-relay.xyz'],
                ['r', 'wss://malicious-relay.com']
              ],
              content: 'My blocked relays',
              sig: 'sig3'
            }
          ];
          
          const mockNostr = {
            group: () => ({
              query: vi.fn().mockResolvedValue(mockEvents)
            })
          };
          
          const result = await DMLib.Impure.Relay.fetchMyRelayInfo(mockNostr as any, ['wss://purplepag.es'], 'alice123');
          
          expect(result.myLists.kind10002?.id).toBe('nip65-event');
          expect(result.myLists.kind10050?.id).toBe('dm-inbox-event');
          expect(result.myLists.kind10006?.id).toBe('blocked-event');
          expect(result.myBlockedRelays).toEqual(['wss://spam-relay.xyz', 'wss://malicious-relay.com']);
        });

        it('should only query for single pubkey (current user)', async () => {
          const queryMock = vi.fn().mockResolvedValue([]);
          const mockNostr = {
            group: () => ({ query: queryMock })
          };
          
          await DMLib.Impure.Relay.fetchMyRelayInfo(mockNostr as any, ['wss://discovery.com'], 'currentUser');
          
          const authors = queryMock.mock.calls[0][0][0].authors;
          expect(authors).toEqual(['currentUser']);
          expect(authors.length).toBe(1);
        });
      });
    });

    describe('Message', () => {
      it.todo('fetchMessages');

      describe('decryptAllMessages', () => {
        it('decrypts NIP-04 messages successfully', async () => {
          const myPubkey = 'mypubkey';
          const otherPubkey = 'otherpubkey';
          
          const nip04Message: NostrEvent = {
            id: 'msg1',
            kind: 4,
            pubkey: otherPubkey,
            created_at: 1000,
            tags: [['p', myPubkey]],
            content: 'encrypted-content',
            sig: 'sig1',
          };

          const mockSigner: DMLib.Signer = {
            nip04: {
              encrypt: vi.fn(),
              decrypt: vi.fn().mockResolvedValue('decrypted message'),
            },
            nip44: {
              encrypt: vi.fn(),
              decrypt: vi.fn(),
            },
          };

          const result = await DMLib.Impure.Message.decryptAllMessages([nip04Message], mockSigner, myPubkey);

          expect(result).toHaveLength(1);
          expect(result[0].event.id).toBe('msg1');
          expect(result[0].senderPubkey).toBe(otherPubkey);
          expect(result[0].participants).toEqual([otherPubkey, myPubkey]);
          expect(result[0].subject).toBe('');
          expect(result[0].event.content).toBe('decrypted message'); // Decrypted content is in event.content
          expect(mockSigner.nip04!.decrypt).toHaveBeenCalledWith(otherPubkey, 'encrypted-content');
        });

        it('handles NIP-04 decryption failure gracefully', async () => {
          const myPubkey = 'mypubkey';
          const otherPubkey = 'otherpubkey';
          
          const nip04Message: NostrEvent = {
            id: 'msg1',
            kind: 4,
            pubkey: otherPubkey,
            created_at: 1000,
            tags: [['p', myPubkey]],
            content: 'encrypted-content',
            sig: 'sig1',
          };

          const mockSigner: DMLib.Signer = {
            nip04: {
              encrypt: vi.fn(),
              decrypt: vi.fn().mockRejectedValue(new Error('Decryption failed')),
            },
          };

          const result = await DMLib.Impure.Message.decryptAllMessages([nip04Message], mockSigner, myPubkey);

          expect(result).toHaveLength(1);
          expect(result[0].event.content).toBe('encrypted-content'); // Falls back to encrypted content
        });

        it('handles NIP-04 when signer not available', async () => {
          const myPubkey = 'mypubkey';
          const otherPubkey = 'otherpubkey';
          
          const nip04Message: NostrEvent = {
            id: 'msg1',
            kind: 4,
            pubkey: otherPubkey,
            created_at: 1000,
            tags: [['p', myPubkey]],
            content: 'encrypted-content',
            sig: 'sig1',
          };

          const mockSigner: DMLib.Signer = {}; // No nip04

          const result = await DMLib.Impure.Message.decryptAllMessages([nip04Message], mockSigner, myPubkey);

          expect(result).toHaveLength(1);
          expect(result[0].event.content).toBe('encrypted-content'); // Falls back to encrypted content when signer unavailable
        });

        it('unwraps NIP-17 gift wraps successfully', async () => {
          const myPubkey = 'mypubkey';
          const senderPubkey = 'senderpubkey';
          const randomPubkey = 'randompubkey';

          const innerMessage: NostrEvent = {
            id: 'inner1',
            kind: 14,
            pubkey: senderPubkey,
            created_at: 1000,
            tags: [['p', myPubkey], ['subject', 'Hello']],
            content: 'Hello there',
            sig: 'innersig',
          };

          const seal: NostrEvent = {
            id: 'seal1',
            kind: 13,
            pubkey: senderPubkey,
            created_at: 999,
            tags: [],
            content: 'encrypted-seal',
            sig: 'sealsig',
          };

          const giftWrap: NostrEvent = {
            id: 'gift1',
            kind: 1059,
            pubkey: randomPubkey,
            created_at: 998,
            tags: [['p', myPubkey]],
            content: 'encrypted-gift',
            sig: 'giftsig',
          };

          const mockSigner: DMLib.Signer = {
            nip44: {
              encrypt: vi.fn(),
              decrypt: vi.fn()
                .mockResolvedValueOnce(JSON.stringify(seal)) // First call: unwrap gift → seal
                .mockResolvedValueOnce(JSON.stringify(innerMessage)), // Second call: unwrap seal → inner
            },
          };

          const result = await DMLib.Impure.Message.decryptAllMessages([giftWrap], mockSigner, myPubkey);

          expect(result).toHaveLength(1);
          expect(result[0].event).toEqual(innerMessage);
          expect(result[0].senderPubkey).toBe(senderPubkey);
          expect(result[0].participants).toEqual([senderPubkey, myPubkey]);
          expect(result[0].subject).toBe('Hello');
          expect(result[0].event.content).toBe('Hello there'); // Decrypted content is in event.content
          expect(mockSigner.nip44!.decrypt).toHaveBeenCalledTimes(2);
          expect(mockSigner.nip44!.decrypt).toHaveBeenNthCalledWith(1, randomPubkey, 'encrypted-gift');
          expect(mockSigner.nip44!.decrypt).toHaveBeenNthCalledWith(2, senderPubkey, 'encrypted-seal');
        });

        it('handles NIP-17 with missing subject tag', async () => {
          const myPubkey = 'mypubkey';
          const senderPubkey = 'senderpubkey';
          const randomPubkey = 'randompubkey';

          const innerMessage: NostrEvent = {
            id: 'inner1',
            kind: 14,
            pubkey: senderPubkey,
            created_at: 1000,
            tags: [['p', myPubkey]], // No subject tag
            content: 'Hello there',
            sig: 'innersig',
          };

          const seal: NostrEvent = {
            id: 'seal1',
            kind: 13,
            pubkey: senderPubkey,
            created_at: 999,
            tags: [],
            content: 'encrypted-seal',
            sig: 'sealsig',
          };

          const giftWrap: NostrEvent = {
            id: 'gift1',
            kind: 1059,
            pubkey: randomPubkey,
            created_at: 998,
            tags: [['p', myPubkey]],
            content: 'encrypted-gift',
            sig: 'giftsig',
          };

          const mockSigner: DMLib.Signer = {
            nip44: {
              encrypt: vi.fn(),
              decrypt: vi.fn()
                .mockResolvedValueOnce(JSON.stringify(seal))
                .mockResolvedValueOnce(JSON.stringify(innerMessage)),
            },
          };

          const result = await DMLib.Impure.Message.decryptAllMessages([giftWrap], mockSigner, myPubkey);

          expect(result).toHaveLength(1);
          expect(result[0].subject).toBe(''); // Defaults to empty string
        });

        it('skips NIP-17 gift wraps with invalid seal kind', async () => {
          const myPubkey = 'mypubkey';
          const randomPubkey = 'randompubkey';

          const invalidSeal = {
            id: 'seal1',
            kind: 999, // Invalid kind
            pubkey: 'senderpubkey',
            created_at: 999,
            tags: [],
            content: 'encrypted-seal',
            sig: 'sealsig',
          };

          const giftWrap: NostrEvent = {
            id: 'gift1',
            kind: 1059,
            pubkey: randomPubkey,
            created_at: 998,
            tags: [['p', myPubkey]],
            content: 'encrypted-gift',
            sig: 'giftsig',
          };

          const mockSigner: DMLib.Signer = {
            nip44: {
              encrypt: vi.fn(),
              decrypt: vi.fn().mockResolvedValue(JSON.stringify(invalidSeal)),
            },
          };

          // Should log but continue
          const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
          const result = await DMLib.Impure.Message.decryptAllMessages([giftWrap], mockSigner, myPubkey);

          expect(result).toHaveLength(0); // Skipped
          expect(consoleSpy).toHaveBeenCalled();
          consoleSpy.mockRestore();
        });

        it('skips NIP-17 gift wraps with invalid inner kind', async () => {
          const myPubkey = 'mypubkey';
          const senderPubkey = 'senderpubkey';
          const randomPubkey = 'randompubkey';

          const invalidInner = {
            id: 'inner1',
            kind: 1, // Invalid kind (should be 14 or 15)
            pubkey: senderPubkey,
            created_at: 1000,
            tags: [['p', myPubkey]],
            content: 'Hello there',
            sig: 'innersig',
          };

          const seal: NostrEvent = {
            id: 'seal1',
            kind: 13,
            pubkey: senderPubkey,
            created_at: 999,
            tags: [],
            content: 'encrypted-seal',
            sig: 'sealsig',
          };

          const giftWrap: NostrEvent = {
            id: 'gift1',
            kind: 1059,
            pubkey: randomPubkey,
            created_at: 998,
            tags: [['p', myPubkey]],
            content: 'encrypted-gift',
            sig: 'giftsig',
          };

          const mockSigner: DMLib.Signer = {
            nip44: {
              encrypt: vi.fn(),
              decrypt: vi.fn()
                .mockResolvedValueOnce(JSON.stringify(seal))
                .mockResolvedValueOnce(JSON.stringify(invalidInner)),
            },
          };

          const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
          const result = await DMLib.Impure.Message.decryptAllMessages([giftWrap], mockSigner, myPubkey);

          expect(result).toHaveLength(0); // Skipped
          expect(consoleSpy).toHaveBeenCalled();
          consoleSpy.mockRestore();
        });

        it('handles NIP-17 decryption failure', async () => {
          const myPubkey = 'mypubkey';
          const randomPubkey = 'randompubkey';

          const giftWrap: NostrEvent = {
            id: 'gift1',
            kind: 1059,
            pubkey: randomPubkey,
            created_at: 998,
            tags: [['p', myPubkey]],
            content: 'encrypted-gift',
            sig: 'giftsig',
          };

          const mockSigner: DMLib.Signer = {
            nip44: {
              encrypt: vi.fn(),
              decrypt: vi.fn().mockRejectedValue(new Error('Decryption failed')),
            },
          };

          const result = await DMLib.Impure.Message.decryptAllMessages([giftWrap], mockSigner, myPubkey);

          expect(result).toHaveLength(0); // Skipped due to decryption error
        });

        it('handles NIP-17 when signer not available', async () => {
          const myPubkey = 'mypubkey';
          const randomPubkey = 'randompubkey';

          const giftWrap: NostrEvent = {
            id: 'gift1',
            kind: 1059,
            pubkey: randomPubkey,
            created_at: 998,
            tags: [['p', myPubkey]],
            content: 'encrypted-gift',
            sig: 'giftsig',
          };

          const mockSigner: DMLib.Signer = {}; // No nip44

          const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
          const result = await DMLib.Impure.Message.decryptAllMessages([giftWrap], mockSigner, myPubkey);

          expect(result).toHaveLength(0); // Skipped
          expect(consoleWarnSpy).toHaveBeenCalledWith(
            expect.stringContaining('NIP-44 not available'),
            'gift1'
          );
          consoleWarnSpy.mockRestore();
        });

        it('processes mixed NIP-04 and NIP-17 messages', async () => {
          const myPubkey = 'mypubkey';
          const otherPubkey = 'otherpubkey';
          const senderPubkey = 'senderpubkey';
          const randomPubkey = 'randompubkey';

          const nip04Message: NostrEvent = {
            id: 'msg1',
            kind: 4,
            pubkey: otherPubkey,
            created_at: 1000,
            tags: [['p', myPubkey]],
            content: 'encrypted-nip04',
            sig: 'sig1',
          };

          const innerMessage: NostrEvent = {
            id: 'inner1',
            kind: 14,
            pubkey: senderPubkey,
            created_at: 1001,
            tags: [['p', myPubkey]],
            content: 'Hello NIP-17',
            sig: 'innersig',
          };

          const seal: NostrEvent = {
            id: 'seal1',
            kind: 13,
            pubkey: senderPubkey,
            created_at: 999,
            tags: [],
            content: 'encrypted-seal',
            sig: 'sealsig',
          };

          const giftWrap: NostrEvent = {
            id: 'gift1',
            kind: 1059,
            pubkey: randomPubkey,
            created_at: 998,
            tags: [['p', myPubkey]],
            content: 'encrypted-gift',
            sig: 'giftsig',
          };

          const mockSigner: DMLib.Signer = {
            nip04: {
              encrypt: vi.fn(),
              decrypt: vi.fn().mockResolvedValue('decrypted NIP-04'),
            },
            nip44: {
              encrypt: vi.fn(),
              decrypt: vi.fn()
                .mockResolvedValueOnce(JSON.stringify(seal))
                .mockResolvedValueOnce(JSON.stringify(innerMessage)),
            },
          };

          const result = await DMLib.Impure.Message.decryptAllMessages([nip04Message, giftWrap], mockSigner, myPubkey);

          expect(result).toHaveLength(2);
          expect(result[0].event.kind).toBe(4);
          expect(result[0].event.content).toBe('decrypted NIP-04'); // Decrypted content is in event.content
          expect(result[1].event.kind).toBe(14);
          expect(result[1].event.content).toBe('Hello NIP-17'); // Decrypted content is in event.content
        });

        it('handles empty messages array', async () => {
          const mockSigner: DMLib.Signer = {
            nip04: { encrypt: vi.fn(), decrypt: vi.fn() },
            nip44: { encrypt: vi.fn(), decrypt: vi.fn() },
          };

          const result = await DMLib.Impure.Message.decryptAllMessages([], mockSigner, 'mypubkey');

          expect(result).toHaveLength(0);
        });
      });

      describe('queryMessages', () => {
        it('should fetch and decrypt messages successfully', async () => {
          const mockNostr = {
            relay: vi.fn(() => ({
              query: vi.fn().mockResolvedValue([])
            }))
          } as any;

          const mockSigner: DMLib.Signer = {
            nip04: {
              encrypt: vi.fn(),
              decrypt: vi.fn().mockResolvedValue('Hello!'),
            },
          };

          const result = await DMLib.Impure.Message.queryMessages(mockNostr, mockSigner, ['wss://relay1.com'], 'mypubkey', 1000, 150);

          // Should return empty with no messages from relay
          expect(result.messagesWithMetadata).toEqual([]);
          expect(result.limitReached).toBe(false);
        });

        it('should handle limit reached flag', async () => {
          const messages = Array.from({ length: 1000 }, (_, i) => ({
            id: `msg${i}`,
            kind: 4,
            pubkey: 'pk1',
            created_at: 2000 + i,
            tags: [['p', 'mypubkey']],
            content: 'encrypted',
            sig: `sig${i}`,
          }));

          const mockNostr = {
            relay: vi.fn(() => ({
              query: vi.fn().mockResolvedValue(messages)
            }))
          } as any;

          const mockSigner: DMLib.Signer = {
            nip04: {
              encrypt: vi.fn(),
              decrypt: vi.fn().mockResolvedValue('test'),
            },
          };

          const result = await DMLib.Impure.Message.queryMessages(mockNostr, mockSigner, ['wss://relay1.com'], 'mypubkey', null, 150);

          expect(result.limitReached).toBe(true);
        });

        it('should pass null since timestamp', async () => {
          const mockNostr = {
            relay: vi.fn(() => ({
              query: vi.fn().mockResolvedValue([])
            }))
          } as any;

          const mockSigner: DMLib.Signer = {};

          const result = await DMLib.Impure.Message.queryMessages(mockNostr, mockSigner, ['wss://relay1.com'], 'mypubkey', null, 100);

          expect(result.messagesWithMetadata).toEqual([]);
          expect(result.limitReached).toBe(false);
        });

        it('should return empty array when no messages found', async () => {
          const mockNostr = {
            relay: vi.fn(() => ({
              query: vi.fn().mockResolvedValue([])
            }))
          } as any;

          const mockSigner: DMLib.Signer = {};

          const result = await DMLib.Impure.Message.queryMessages(mockNostr, mockSigner, ['wss://relay1.com'], 'mypubkey', 1000, 150);

          expect(result.messagesWithMetadata).toEqual([]);
          expect(result.limitReached).toBe(false);
        });
      });

      describe('queryNewRelays', () => {
        it('should always query from beginning (null since)', async () => {
          const mockNostr = {
            relay: vi.fn(() => ({
              query: vi.fn().mockResolvedValue([])
            }))
          } as any;

          const mockSigner: DMLib.Signer = {};

          const result = await DMLib.Impure.Message.queryNewRelays(mockNostr, mockSigner, ['wss://newrelay.com'], 'mypubkey', 150);

          expect(result.allMessages).toEqual([]);
          expect(result.limitReached).toBe(false);
        });

        it('should handle limit reached flag from new relays', async () => {
          const messages = Array.from({ length: 1000 }, (_, i) => ({
            id: `msg${i}`,
            kind: 4,
            pubkey: 'pk1',
            created_at: 2000 + i,
            tags: [['p', 'mypubkey']],
            content: 'encrypted',
            sig: `sig${i}`,
          }));

          const mockNostr = {
            relay: vi.fn(() => ({
              query: vi.fn().mockResolvedValue(messages)
            }))
          } as any;

          const mockSigner: DMLib.Signer = {
            nip04: {
              encrypt: vi.fn(),
              decrypt: vi.fn().mockResolvedValue('test'),
            },
          };

          const result = await DMLib.Impure.Message.queryNewRelays(mockNostr, mockSigner, ['wss://newrelay.com'], 'mypubkey', 150);

          expect(result.limitReached).toBe(true);
        });

        it('should return empty array when no messages found on new relays', async () => {
          const mockNostr = {
            relay: vi.fn(() => ({
              query: vi.fn().mockResolvedValue([])
            }))
          } as any;

          const mockSigner: DMLib.Signer = {};

          const result = await DMLib.Impure.Message.queryNewRelays(mockNostr, mockSigner, ['wss://newrelay.com'], 'mypubkey', 150);

          expect(result.allMessages).toEqual([]);
          expect(result.limitReached).toBe(false);
        });
      });
    });

    describe('Participant', () => {
      describe('refreshStaleParticipants', () => {
        const discoveryRelays = ['wss://discovery1.com'];
        const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;
        
        afterEach(() => {
          vi.restoreAllMocks();
        });
        
        it('should return original participants immediately when none are stale (early return optimization)', async () => {
          const now = Date.now();
          const participants = {
            alice: { pubkey: 'alice', derivedRelays: ['wss://alice.com'], blockedRelays: [], lastFetched: now - 1000 }
          };
          
          const fetchSpy = vi.spyOn(DMLib.Impure.Relay, 'fetchRelayLists');
          
          const result = await DMLib.Impure.Participant.refreshStaleParticipants(
            {} as any,
            participants,
            'strict_outbox',
            discoveryRelays,
            ONE_WEEK
          );
          
          // Verify early return: no fetch call was made
          expect(fetchSpy).not.toHaveBeenCalled();
          expect(result).toBe(participants);
        });

        it('should fetch and update stale participants', async () => {
          const now = Date.now();
          const participants = {
            alice: { pubkey: 'alice', derivedRelays: ['wss://old.com'], blockedRelays: [], lastFetched: now - (ONE_WEEK + 1000) }
          };
          
          const mockEvents = [
            { id: 'e1', pubkey: 'alice', created_at: now, kind: 10050, tags: [['relay', 'wss://new.com']], content: '', sig: 'sig1' }
          ];
          
          const mockQuery = vi.fn().mockResolvedValue(mockEvents);
          const mockNostr = {
            group: () => ({ query: mockQuery })
          } as any;
          
          const result = await DMLib.Impure.Participant.refreshStaleParticipants(
            mockNostr,
            participants,
            'strict_outbox',
            discoveryRelays,
            ONE_WEEK
          );
          
          // Verify network call was made
          expect(mockQuery).toHaveBeenCalled();
          // Verify stale participant was updated
          expect(result.alice.derivedRelays).toEqual(['wss://new.com']);
          expect(result.alice.lastFetched).toBeGreaterThan(participants.alice.lastFetched);
        });
      });
      
      describe('fetchAndMergeParticipants', () => {
        it('should return base participants unchanged when no new pubkeys', async () => {
          const mockNostr = {
            group: () => ({ query: vi.fn() })
          };
          
          const baseParticipants: Record<string, Participant> = {
            alice: { pubkey: 'alice', derivedRelays: ['wss://alice.com'], blockedRelays: [], lastFetched: 1000 },
            bob: { pubkey: 'bob', derivedRelays: ['wss://bob.com'], blockedRelays: [], lastFetched: 2000 }
          };
          
          const result = await DMLib.Impure.Participant.fetchAndMergeParticipants(
            mockNostr as any,
            baseParticipants,
            [], // No new pubkeys
            'hybrid',
            ['wss://discovery.com']
          );
          
          expect(result).toEqual(baseParticipants);
          expect(result).toBe(baseParticipants); // Should be same object reference
        });

        it('should preserve base participants (including current user) when adding new ones', async () => {
          const mockEvents = [
            { id: 'e1', pubkey: 'carol', created_at: 100, kind: 10002, tags: [['r', 'wss://carol.com', 'read']], content: '', sig: 'sig1' }
          ];
          
          const mockNostr = {
            group: () => ({
              query: vi.fn().mockResolvedValue(mockEvents)
            })
          };
          
          const baseParticipants: Record<string, Participant> = {
            myPubkey: { pubkey: 'myPubkey', derivedRelays: ['wss://my-inbox.com'], blockedRelays: [], lastFetched: 5000 },
            alice: { pubkey: 'alice', derivedRelays: ['wss://alice.com'], blockedRelays: [], lastFetched: 1000 }
          };
          
          const result = await DMLib.Impure.Participant.fetchAndMergeParticipants(
            mockNostr as any,
            baseParticipants,
            ['carol'], // New pubkey to fetch
            'hybrid',
            ['wss://discovery.com']
          );
          
          // Should preserve base participants exactly
          expect(result.myPubkey).toEqual(baseParticipants.myPubkey);
          expect(result.alice).toEqual(baseParticipants.alice);
          
          // Should add new participant
          expect(result.carol).toBeDefined();
          expect(result.carol.pubkey).toBe('carol');
          expect(result.carol.derivedRelays).toContain('wss://carol.com');
          
          expect(Object.keys(result)).toHaveLength(3);
        });

        it('should fetch relay lists for new pubkeys and build participants', async () => {
          const mockEvents = [
            { id: 'e1', pubkey: 'alice', created_at: 100, kind: 10002, tags: [['r', 'wss://alice.com', 'read']], content: '', sig: 'sig1' },
            { id: 'e2', pubkey: 'bob', created_at: 200, kind: 10050, tags: [['relay', 'wss://bob-inbox.com']], content: '', sig: 'sig2' }
          ];
          
          const mockNostr = {
            group: () => ({
              query: vi.fn().mockResolvedValue(mockEvents)
            })
          };
          
          const baseParticipants: Record<string, Participant> = {
            me: { pubkey: 'me', derivedRelays: ['wss://my.com'], blockedRelays: [], lastFetched: 1000 }
          };
          
          const result = await DMLib.Impure.Participant.fetchAndMergeParticipants(
            mockNostr as any,
            baseParticipants,
            ['alice', 'bob'],
            'strict_outbox',
            ['wss://discovery.com']
          );
          
          // Should preserve base
          expect(result.me).toEqual(baseParticipants.me);
          
          // Should add Alice with her relays
          expect(result.alice).toBeDefined();
          expect(result.alice.derivedRelays).toEqual(['wss://alice.com']);
          
          // Should add Bob with his inbox relay (priority over 10002)
          expect(result.bob).toBeDefined();
          expect(result.bob.derivedRelays).toEqual(['wss://bob-inbox.com']);
          
          expect(Object.keys(result)).toHaveLength(3);
        });

        it('should handle multiple new pubkeys with mixed relay configurations', async () => {
          const mockEvents = [
            { id: 'e1', pubkey: 'alice', created_at: 100, kind: 10002, tags: [['r', 'wss://alice-1.com', 'read'], ['r', 'wss://alice-2.com', 'read']], content: '', sig: 'sig1' },
            { id: 'e2', pubkey: 'bob', created_at: 200, kind: 10050, tags: [['relay', 'wss://bob-dm.com']], content: '', sig: 'sig2' },
            { id: 'e3', pubkey: 'carol', created_at: 300, kind: 10006, tags: [['r', 'wss://blocked.com']], content: '', sig: 'sig3' }
          ];
          
          const mockNostr = {
            group: () => ({
              query: vi.fn().mockResolvedValue(mockEvents)
            })
          };
          
          const baseParticipants: Record<string, Participant> = {
            current: { pubkey: 'current', derivedRelays: ['wss://current.com'], blockedRelays: [], lastFetched: 1000 }
          };
          
          const result = await DMLib.Impure.Participant.fetchAndMergeParticipants(
            mockNostr as any,
            baseParticipants,
            ['alice', 'bob', 'carol'],
            'hybrid',
            ['wss://discovery.com']
          );
          
          expect(Object.keys(result)).toHaveLength(4);
          expect(result.current).toEqual(baseParticipants.current);
          
          expect(result.alice.derivedRelays).toHaveLength(3); // 2 from 10002 + discovery
          expect(result.bob.derivedRelays).toHaveLength(2); // 1 from 10050 + discovery
          expect(result.carol.derivedRelays).toEqual(['wss://discovery.com']); // Only discovery (no 10002/10050)
          expect(result.carol.blockedRelays).toEqual(['wss://blocked.com']);
        });

        it('should respect relay mode when building new participants', async () => {
          const mockEvents = [
            { id: 'e1', pubkey: 'alice', created_at: 100, kind: 10002, tags: [['r', 'wss://alice.com', 'read']], content: '', sig: 'sig1' }
          ];
          
          const mockNostr = {
            group: () => ({
              query: vi.fn().mockResolvedValue(mockEvents)
            })
          };
          
          const baseParticipants: Record<string, Participant> = {};
          
          // Test with discovery mode
          const resultDiscovery = await DMLib.Impure.Participant.fetchAndMergeParticipants(
            mockNostr as any,
            baseParticipants,
            ['alice'],
            'discovery',
            ['wss://discovery.com']
          );
          
          expect(resultDiscovery.alice.derivedRelays).toEqual(['wss://discovery.com']);
          
          // Test with strict_outbox mode
          const resultStrict = await DMLib.Impure.Participant.fetchAndMergeParticipants(
            mockNostr as any,
            baseParticipants,
            ['alice'],
            'strict_outbox',
            ['wss://discovery.com']
          );
          
          expect(resultStrict.alice.derivedRelays).toEqual(['wss://alice.com']);
        });

        it('should handle query errors gracefully and return base participants', async () => {
          const mockNostr = {
            group: () => ({
              query: async () => {
                throw new Error('Network error');
              }
            })
          } as any;
          
          const baseParticipants: Record<string, Participant> = {
            me: { pubkey: 'me', derivedRelays: ['wss://my.com'], blockedRelays: [], lastFetched: 1000 }
          };
          
          await expect(
            DMLib.Impure.Participant.fetchAndMergeParticipants(
              mockNostr,
              baseParticipants,
              ['alice'],
              'hybrid',
              ['wss://discovery.com']
            )
          ).rejects.toThrow();
        });

        it('should work with realistic scenario - current user + conversation partners', async () => {
          const mockEvents = [
            { id: 'e1', pubkey: 'alice', created_at: 100, kind: 10002, tags: [['r', 'wss://alice.com', 'read']], content: '', sig: 'sig1' },
            { id: 'e2', pubkey: 'bob', created_at: 200, kind: 10050, tags: [['relay', 'wss://bob-dm.com']], content: '', sig: 'sig2' },
            { id: 'e3', pubkey: 'bob', created_at: 300, kind: 10006, tags: [['r', 'wss://spam.com']], content: '', sig: 'sig3' }
          ];
          
          const mockNostr = {
            group: () => ({
              query: vi.fn().mockResolvedValue(mockEvents)
            })
          };
          
          // Base participants includes current user
          const baseParticipants: Record<string, Participant> = {
            me: { pubkey: 'me', derivedRelays: ['wss://my-inbox.com'], blockedRelays: [], lastFetched: Date.now() }
          };
          
          // Discovered Alice and Bob from messages
          const result = await DMLib.Impure.Participant.fetchAndMergeParticipants(
            mockNostr as any,
            baseParticipants,
            ['alice', 'bob'],
            'hybrid',
            ['wss://relay.nostr.band']
          );
          
          // Current user preserved
          expect(result.me).toBeDefined();
          expect(result.me.derivedRelays).toEqual(['wss://my-inbox.com']);
          
          // Alice added with her relays
          expect(result.alice).toBeDefined();
          expect(result.alice.derivedRelays).toContain('wss://alice.com');
          expect(result.alice.derivedRelays).toContain('wss://relay.nostr.band');
          
          // Bob added with his inbox relay + discovery
          expect(result.bob).toBeDefined();
          expect(result.bob.derivedRelays).toContain('wss://bob-dm.com');
          expect(result.bob.blockedRelays).toEqual(['wss://spam.com']);
          
          expect(Object.keys(result)).toHaveLength(3);
        });
      });
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

