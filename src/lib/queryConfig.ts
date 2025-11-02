/**
 * Centralized React Query configuration for different query types.
 * All staleTime and gcTime settings are defined here for consistency.
 */

/**
 * Query options for author/profile metadata queries.
 * Profile metadata changes infrequently, so we cache for 24 hours.
 */
export const authorQueryOptions = {
  staleTime: 24 * 60 * 60 * 1000, // 24 hours
  retry: 3,
} as const;

/**
 * Query options for follow list queries.
 * Follow lists update occasionally, cache for 15 minutes.
 */
export const followsQueryOptions = {
  staleTime: 15 * 60 * 1000, // 15 minutes
  retry: 2,
} as const;

/**
 * Query options for zap/payment queries.
 * Zaps are real-time financial data, keep fresh but cache briefly for performance.
 */
export const zapsQueryOptions = {
  staleTime: 30 * 1000, // 30 seconds
} as const;

