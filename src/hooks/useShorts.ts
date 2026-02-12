import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

// NIP-71 Video kinds
const KIND_HORIZONTAL_VIDEO = 34235;
const KIND_VERTICAL_VIDEO = 34236;
const VIDEO_KINDS = [KIND_HORIZONTAL_VIDEO, KIND_VERTICAL_VIDEO];

export interface ShortVideo {
  id: string;
  pubkey: string;
  title: string;
  description: string;
  videoUrl: string;
  thumbnailUrl?: string;
  duration?: number;
  bitrate?: number;
  dimensions?: string;
  blurhash?: string;
  publishedAt: number;
  event: NostrEvent;
}

function parseShortFromEvent(event: NostrEvent): ShortVideo | null {
  const title = event.tags.find(t => t[0] === 'title')?.[1];
  if (!title) return null;

  // Parse imeta tag for video URL and metadata
  const imetaTag = event.tags.find(t => t[0] === 'imeta');
  if (!imetaTag) return null;

  let videoUrl: string | undefined;
  let thumbnailUrl: string | undefined;
  let dimensions: string | undefined;
  let duration: number | undefined;
  let bitrate: number | undefined;
  let blurhash: string | undefined;

  // Parse imeta parts (format: "key value")
  for (let i = 1; i < imetaTag.length; i++) {
    const part = imetaTag[i];
    if (part.startsWith('url ')) {
      videoUrl = part.slice(4);
    } else if (part.startsWith('image ')) {
      thumbnailUrl = part.slice(6);
    } else if (part.startsWith('dim ')) {
      dimensions = part.slice(4);
    } else if (part.startsWith('duration ')) {
      duration = parseFloat(part.slice(9));
    } else if (part.startsWith('bitrate ')) {
      bitrate = parseInt(part.slice(8));
    } else if (part.startsWith('blurhash ')) {
      blurhash = part.slice(9);
    }
  }

  if (!videoUrl) return null;

  const publishedAtTag = event.tags.find(t => t[0] === 'published_at')?.[1];

  return {
    id: event.id,
    pubkey: event.pubkey,
    title,
    description: event.content,
    videoUrl,
    thumbnailUrl,
    duration,
    bitrate,
    dimensions,
    blurhash,
    publishedAt: publishedAtTag ? parseInt(publishedAtTag) : event.created_at,
    event,
  };
}

interface UseShortsOptions {
  /** Limit number of shorts to fetch */
  limit?: number;
  /** Filter by specific pubkeys (e.g., followed users) */
  authors?: string[];
}

export function useShorts({ limit = 20, authors }: UseShortsOptions = {}) {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['shorts', { limit, authors }],
    queryFn: async (c) => {
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(5000)]);

      const filter: NostrFilter = {
        kinds: VIDEO_KINDS,
        limit,
      };

      if (authors?.length) {
        filter.authors = authors;
      }

      const events = await nostr.query([filter], { signal });

      // Parse and filter valid shorts
      const shorts = events
        .map(parseShortFromEvent)
        .filter((s): s is ShortVideo => s !== null)
        .sort((a, b) => b.publishedAt - a.publishedAt);

      return shorts;
    },
    staleTime: 30_000, // 30 seconds
  });
}

/** Hook to get a single short by event ID */
export function useShort(eventId: string | undefined) {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['short', eventId],
    queryFn: async (c) => {
      if (!eventId) return null;

      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(3000)]);
      const events = await nostr.query([{ ids: [eventId] }], { signal });

      if (events.length === 0) return null;
      return parseShortFromEvent(events[0]);
    },
    enabled: !!eventId,
  });
}

/** Hook to get shorts from specific authors (for followed users) */
export function useShortsFromAuthors(authors: string[] | undefined, limit = 10) {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['shorts', 'authors', { limit, authors }],
    queryFn: async (c) => {
      if (!authors?.length) return [];

      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(5000)]);

      const events = await nostr.query([{
        kinds: VIDEO_KINDS,
        authors,
        limit,
      }], { signal });

      return events
        .map(parseShortFromEvent)
        .filter((s): s is ShortVideo => s !== null)
        .sort((a, b) => b.publishedAt - a.publishedAt);
    },
    enabled: !!authors?.length,
    staleTime: 30_000,
  });
}

