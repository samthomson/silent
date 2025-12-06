import { nip19 } from 'nostr-tools';
import type { NostrMetadata } from '@nostrify/nostrify';

/**
 * Generate a fallback display name for a pubkey by showing truncated npub format.
 * Returns format like: npub1u36g...8761
 * 
 * Note: Prefer using getDisplayName() which checks metadata first before falling back to this.
 */
export function genUserName(pubkey: string): string {
  const npub = nip19.npubEncode(pubkey);
  return `${npub.slice(0, 8)}...${npub.slice(-4)}`;
}

/**
 * Get display name for a user from their metadata
 * Prioritizes: display_name > name > truncated npub
 */
export function getDisplayName(pubkey: string, metadata?: NostrMetadata): string {
  if (metadata?.display_name) {
    return metadata.display_name;
  }
  if (metadata?.name) {
    return metadata.name;
  }
  return genUserName(pubkey);
}