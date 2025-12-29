import type { NostrEvent } from '@nostrify/nostrify';

/**
 * Validate that an event is a proper DM event
 */
export function validateDMEvent(event: NostrEvent): boolean {
  // Must be kind 4 (NIP-04 DM)
  if (event.kind !== 4) return false;

  // Must have a 'p' tag
  const hasRecipient = event.tags?.some(([name]) => name === 'p');
  if (!hasRecipient) return false;

  // Must have content (even if encrypted)
  if (!event.content) return false;

  return true;
}

/**
 * Get the recipient pubkey from a DM event
 */
export function getRecipientPubkey(event: NostrEvent): string | undefined {
  return event.tags?.find(([name]) => name === 'p')?.[1];
}

/**
 * Get the conversation partner pubkey from a DM event
 * (the other person in the conversation, not the current user)
 */
export function getConversationPartner(event: NostrEvent, userPubkey: string): string | undefined {
  const isFromUser = event.pubkey === userPubkey;
  
  if (isFromUser) {
    // If we sent it, the partner is the recipient
    return getRecipientPubkey(event);
  } else {
    // If they sent it, the partner is the author
    return event.pubkey;
  }
}

/**
 * Format timestamp for display (matches Signal/WhatsApp/Telegram pattern)
 * Today: Show time (e.g., "2:45 PM")
 * Yesterday: "Yesterday"
 * This week: Day name (e.g., "Mon")
 * This year: Month and day (e.g., "Jan 15")
 * Older: Full date (e.g., "Jan 15, 2024")
 */
export function formatConversationTime(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const now = new Date();
  
  // Start of today (midnight)
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  // Start of yesterday
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  
  // Start of this week (assuming week starts on Sunday, adjust if needed)
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  
  if (date >= todayStart) {
    // Today: Show time (e.g., "2:45 PM")
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  } else if (date >= yesterdayStart) {
    // Yesterday
    return 'Yesterday';
  } else if (date >= weekStart) {
    // This week: Show day name (e.g., "Monday")
    return date.toLocaleDateString(undefined, { weekday: 'short' });
  } else if (date.getFullYear() === now.getFullYear()) {
    // This year: Show month and day (e.g., "Jan 15")
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } else {
    // Older: Show full date (e.g., "Jan 15, 2024")
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
}

/**
 * Format timestamp as full date and time for tooltips
 * e.g., "Mon, Jan 15, 2024, 2:45 PM"
 */
export function formatFullDateTime(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toLocaleString(undefined, { 
    weekday: 'short',
    year: 'numeric', 
    month: 'short', 
    day: 'numeric', 
    hour: 'numeric', 
    minute: '2-digit'
  });
}

// TODO: This old parser will be replaced by the new dmLib.parseConversationId format
// The new system (NewDMContext) uses "group:pubkeys:subject" format consistently
// This old parser is only used by the legacy DMContext.tsx
/**
 * Parse a conversation ID to get all participant pubkeys.
 * 
 * Handles both formats for backwards compatibility:
 * - New: "group:alice,bob" 
 * - Old: "bob" (bare pubkey from before this refactor)
 * 
 * @param conversationId - Either "group:pubkey1,pubkey2" or bare pubkey (legacy)
 * @returns Array of participant pubkeys
 */
export function parseConversationId(conversationId: string): string[] {
  if (conversationId.startsWith('group:')) {
    return conversationId.substring(6).split(',');
  }
  // Legacy format: bare pubkey (treat as 1-on-1)
  return [conversationId];
}

/**
 * Generate a consistent color for a pubkey (used for avatars and names).
 * Returns a hex color string that can be used as inline styles.
 * 
 * @param pubkey - The user's public key
 * @returns Hex color string (e.g., '#dc2626')
 */
export function getPubkeyColor(pubkey: string): string {
  const colors = [
    '#dc2626', // red
    '#ea580c', // orange
    '#d97706', // amber
    '#ca8a04', // yellow
    '#65a30d', // lime
    '#16a34a', // green
    '#059669', // emerald
    '#0d9488', // teal
    '#0891b2', // cyan
    '#0284c7', // sky
    '#2563eb', // blue
    '#4f46e5', // indigo
    '#7c3aed', // violet
    '#9333ea', // purple
    '#c026d3', // fuchsia
    '#db2777', // pink
    '#e11d48', // rose
  ];
  
  // Hash pubkey to get consistent color index
  let hash = 0;
  for (let i = 0; i < pubkey.length; i++) {
    hash = ((hash << 5) - hash) + pubkey.charCodeAt(i);
    hash = hash & hash;
  }
  
  return colors[Math.abs(hash) % colors.length];
}

/**
 * Check if a conversation represents a multi-person group (3+ participants).
 * 
 * Note: With the new format, all conversations use "group:..." format,
 * but this function specifically checks for 3+ people (actual group chats).
 * 
 * - Self-messaging: "group:alice" → false (1 person)
 * - 1-on-1: "group:alice,bob" → false (2 people)
 * - Group: "group:alice,bob,charlie" → true (3+ people)
 * 
 * @param conversationId - Conversation ID to check
 * @returns true if 3+ participants (actual group chat)
 */
export function isGroupConversation(conversationId: string): boolean {
  const participants = parseConversationId(conversationId);
  return participants.length >= 3;
}
