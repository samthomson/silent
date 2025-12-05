import type { NPool } from '@nostrify/nostrify';
import type { RelayEntry, RelayListResult } from '@/hooks/useRelayList';

/**
 * Bulk fetch relay lists (both 10050 and 10002) for multiple pubkeys
 * Returns a Map of pubkey -> RelayListResult
 * Uses priority: 10050 > 10002 > discovery relays
 * More efficient than individual queries
 */
export async function fetchRelayListsBulk(
  nostr: NPool,
  discoveryRelays: string[],
  pubkeys: string[]
): Promise<Map<string, RelayListResult>> {
  if (pubkeys.length === 0) {
    return new Map();
  }

  const relayGroup = nostr.group(discoveryRelays);
  const results = new Map<string, RelayListResult>();

  try {
    // Single query for all pubkeys, query both 10050 and 10002
    // Replaceable events: each relay stores only the latest per pubkey+kind
    // But different relays may have different "latest" events if user published updates to only some relays
    const events = await relayGroup.query(
      [{ kinds: [10002, 10050], authors: pubkeys }],
      { signal: AbortSignal.timeout(15000) }
    );

    // Group events by pubkey and kind, keep only latest per pubkey+kind
    // This handles cases where different relays return different "latest" events
    // (e.g., user published newer event to relay A but not relay B)
    const eventsByPubkeyAndKind = new Map<string, typeof events[0]>();
    for (const event of events) {
      const key = `${event.pubkey}:${event.kind}`;
      const existing = eventsByPubkeyAndKind.get(key);
      if (!existing || event.created_at > existing.created_at) {
        eventsByPubkeyAndKind.set(key, event);
      }
    }

    // Parse events and build RelayListResult for each pubkey
    for (const pubkey of pubkeys) {
      const result: RelayListResult = {};
      
      // Check for 10050 first (highest priority)
      const dmEvent = eventsByPubkeyAndKind.get(`${pubkey}:10050`);
      if (dmEvent) {
        const relays = dmEvent.tags
          .filter(tag => tag[0] === 'relay')
          .map(tag => tag[1])
          .filter(Boolean);
        if (relays.length > 0) {
          result.dmInbox = { relays, eventId: dmEvent.id };
        }
      }
      
      // Check for 10002 (fallback)
      const nip65Event = eventsByPubkeyAndKind.get(`${pubkey}:10002`);
      if (nip65Event) {
        const relays: RelayEntry[] = [];
        for (const tag of nip65Event.tags) {
          if (tag[0] !== 'r') continue;
          const url = tag[1];
          const marker = tag[2];
          if (!url) continue;

          switch (marker) {
            case 'read':
              relays.push({ url, read: true, write: false });
              break;
            case 'write':
              relays.push({ url, read: false, write: true });
              break;
            default:
              relays.push({ url, read: true, write: true });
          }
        }
        if (relays.length > 0) {
          result.nip65 = { relays, eventId: nip65Event.id };
        }
      }
      
      if (Object.keys(result).length > 0) {
        results.set(pubkey, result);
      }
    }
  } catch (error) {
    console.error('[RelayUtils] Failed to fetch relay lists in bulk:', error);
  }

  return results;
}

/**
 * Batch process pubkeys in chunks to avoid overwhelming relays
 * Useful for large lists of participants
 */
export async function fetchRelayListsBatched(
  nostr: NPool,
  discoveryRelays: string[],
  pubkeys: string[],
  batchSize = 50
): Promise<Map<string, RelayListResult>> {
  const results = new Map<string, RelayListResult>();

  // Split into batches
  for (let i = 0; i < pubkeys.length; i += batchSize) {
    const batch = pubkeys.slice(i, i + batchSize);
    const batchResults = await fetchRelayListsBulk(nostr, discoveryRelays, batch);
    
    // Merge into results
    batchResults.forEach((relayListResult, pubkey) => {
      results.set(pubkey, relayListResult);
    });
  }

  return results;
}

/**
 * Extract read relays (inbox) from a relay list
 */
export function getInboxRelays(relays: RelayEntry[]): string[] {
  return relays.filter(r => r.read).map(r => r.url);
}

/**
 * Extract write relays (outbox) from a relay list
 */
export function getOutboxRelays(relays: RelayEntry[]): string[] {
  return relays.filter(r => r.write).map(r => r.url);
}

/**
 * Extract inbox relays from RelayListResult using priority:
 * 1. 10050 DM inbox relays
 * 2. 10002 read relays
 * 3. Discovery relays (fallback)
 * 
 * This is the canonical function for determining which relays to use for reading DMs.
 */
export function extractInboxRelays(
  relayListResult: RelayListResult | null | undefined,
  discoveryRelays: string[]
): string[] {
  // Priority 1: NIP-17 DM inbox relays (kind 10050)
  if (relayListResult?.dmInbox?.relays && relayListResult.dmInbox.relays.length > 0) {
    return relayListResult.dmInbox.relays;
  }
  
  // Priority 2: NIP-65 read relays (kind 10002)
  const readRelays = relayListResult?.nip65?.relays?.filter(r => r.read)?.map(r => r.url);
  if (readRelays && readRelays.length > 0) {
    return readRelays;
  }
  
  // Priority 3: Discovery relays
  return discoveryRelays;
}

/**
 * Extract outbox relays from RelayListResult using priority:
 * 1. 10002 write relays
 * 2. Discovery relays (fallback)
 * 
 * This is the canonical function for determining which relays to use for reading/writing profiles and other non-DM content.
 */
export function extractOutboxRelays(
  relayListResult: RelayListResult | null | undefined,
  discoveryRelays: string[]
): string[] {
  // Priority 1: NIP-65 write relays (kind 10002)
  const writeRelays = relayListResult?.nip65?.relays?.filter(r => r.write)?.map(r => r.url);
  if (writeRelays && writeRelays.length > 0) {
    return writeRelays;
  }
  
  // Priority 2: Discovery relays
  return discoveryRelays;
}

