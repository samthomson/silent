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


/**
 * Generate a consistent color for a pubkey (used for avatars and names).
 * Returns a hex color string that can be used as inline styles.
 * 
 * @param pubkey - The user's public key
 * @returns Hex color string (e.g., '#dc2626')
 */
/**
 * Format bytes to human-readable string (e.g., "1.5 MB")
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Format bytes per second to human-readable speed (e.g., "1.5 MB/s")
 */
export function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)} B/s`;
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
}

/**
 * Check if a file is a media file (image, video, or audio)
 */
export function isMediaFile(file: File): boolean {
  // Check MIME type first
  if (file.type.startsWith('image/') || file.type.startsWith('video/') || file.type.startsWith('audio/')) {
    return true;
  }

  // Fallback: check file extension if MIME type is missing or incorrect
  // Some browsers don't set MIME types correctly for certain formats (e.g., .mov files)
  const fileName = file.name.toLowerCase();
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.ico'];
  const videoExtensions = ['.mp4', '.webm', '.ogg', '.mov', '.avi', '.mkv', '.flv', '.wmv', '.m4v'];
  const audioExtensions = ['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.opus', '.wma'];

  const extension = imageExtensions.concat(videoExtensions, audioExtensions).find(ext => fileName.endsWith(ext));
  return !!extension;
}

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

