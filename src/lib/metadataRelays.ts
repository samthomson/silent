/**
 * Standard relays used for fetching profile metadata.
 * Queries user's selected relay plus popular relays for better coverage.
 */
export function getMetadataRelays(userRelayUrl: string): string[] {
  const relays = [
    userRelayUrl,
    'wss://relay.damus.io',
    'wss://relay.nostr.band',
    'wss://relay.primal.net',
    'wss://nos.lol',
  ];
  
  // Remove duplicates if user's relay is already in the list
  return Array.from(new Set(relays));
}

