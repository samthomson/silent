import { useEffect } from 'react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNewDMContext } from '@/contexts/NewDMContext';
import { setFavicon, resetFavicon } from '@/lib/favicon';

/**
 * Keeps the favicon in sync with unread count (purple bubble + number when unread, default icon otherwise).
 * Mounted inside NewDMProvider so it runs for all routes when user is logged in.
 */
export function FaviconSync() {
  const { user } = useCurrentUser();
  const { unreadTotal } = useNewDMContext();

  useEffect(() => {
    if (!user) resetFavicon();
    else setFavicon(unreadTotal);
  }, [user, unreadTotal]);

  return null;
}
