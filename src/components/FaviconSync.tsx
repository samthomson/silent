import { useEffect } from 'react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useDMContext } from '@/contexts/DMProviderWrapper';
import { setFavicon, resetFavicon } from '@/lib/favicon';

/**
 * Keeps the favicon in sync with unread count (purple bubble + number when unread, default icon otherwise).
 * Mounted inside DMProvider so it runs for all routes when user is logged in.
 */
export function FaviconSync() {
  const { user } = useCurrentUser();
  const { unreadTotal } = useDMContext();

  useEffect(() => {
    if (!user) resetFavicon();
    else setFavicon(unreadTotal);
  }, [user, unreadTotal]);

  return null;
}
