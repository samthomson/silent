import { useState, useCallback, useEffect } from 'react';
import {
  ShortVideoRecorder,
  ShortVideoPreview,
  ShortVideoFeed,
  useShortsFromAuthors,
  useShorts,
  usePublishShort,
} from '@samthomson/nostr-messaging/ui';
import { useFollows } from '@/hooks/useFollows';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useToast } from '@/hooks/useToast';
import { Button } from '@/components/ui/button';
import { LoginArea } from '@/components/auth/LoginArea';
import { Plus, ArrowLeft, User } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { cn } from '@/lib/utils';

type ViewState = 'feed' | 'recording' | 'preview';
type FeedTab = 'following' | 'mine';

export default function Shorts() {
  const [searchParams, setSearchParams] = useSearchParams();
  const shouldRecord = searchParams.get('record') === 'true';

  const [viewState, setViewState] = useState<ViewState>(shouldRecord ? 'recording' : 'feed');
  const [feedTab, setFeedTab] = useState<FeedTab>('following');
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);

  const { user } = useCurrentUser();
  const { data: follows } = useFollows();

  const { data: followedShorts, isLoading: isLoadingFollowed, refetch } = useShortsFromAuthors(follows, 50);
  const { data: myShorts, isLoading: isLoadingMine } = useShorts({
    limit: 50,
    authors: user?.pubkey ? [user.pubkey] : undefined,
  });

  const { mutateAsync: publishShort, isPending: isPublishing } = usePublishShort();
  const { toast } = useToast();

  useEffect(() => {
    if (shouldRecord && viewState === 'recording') {
      setSearchParams({}, { replace: true });
    }
  }, [shouldRecord, viewState, setSearchParams]);

  const shorts = feedTab === 'mine' ? myShorts : followedShorts;
  const isLoading = feedTab === 'mine' ? isLoadingMine : isLoadingFollowed;

  const handleVideoRecorded = useCallback((blob: Blob) => {
    setRecordedBlob(blob);
    setViewState('preview');
  }, []);

  const handleCancelRecording = useCallback(() => {
    setViewState('feed');
    setRecordedBlob(null);
  }, []);

  const handleBackToRecording = useCallback(() => {
    setViewState('recording');
    setRecordedBlob(null);
  }, []);

  const handlePublish = useCallback(
    async (title: string, description: string) => {
      if (!recordedBlob) return;
      try {
        await publishShort({ videoBlob: recordedBlob, title, description });
        toast({ title: 'Short published successfully!' });
        setViewState('feed');
        setRecordedBlob(null);
        refetch();
      } catch (error) {
        console.error('Shorts: Failed to publish', error);
        toast({
          title: 'Failed to publish',
          description: error instanceof Error ? error.message : 'Please try again',
          variant: 'destructive',
        });
      }
    },
    [recordedBlob, publishShort, toast, refetch]
  );

  if (viewState === 'recording') {
    return (
      <div className="h-screen">
        <ShortVideoRecorder onVideoRecorded={handleVideoRecorded} onCancel={handleCancelRecording} />
      </div>
    );
  }

  if (viewState === 'preview' && recordedBlob) {
    return (
      <div className="h-screen">
        <ShortVideoPreview
          videoBlob={recordedBlob}
          onPublish={handlePublish}
          onBack={handleBackToRecording}
          isPublishing={isPublishing}
        />
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-black">
      <header className="flex items-center justify-between p-4 bg-black/80 backdrop-blur-sm z-10">
        <div className="flex items-center gap-3">
          <Link to="/">
            <Button variant="ghost" size="icon" className="text-white hover:bg-white/20">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <h1 className="text-xl font-bold text-white">Shorts</h1>
        </div>
        <div className="flex items-center gap-2">
          {user ? (
            <Button onClick={() => setViewState('recording')} size="sm" className="gap-2">
              <Plus className="h-4 w-4" />
              Create
            </Button>
          ) : (
            <LoginArea className="max-w-40" />
          )}
        </div>
      </header>

      {user && (
        <div className="flex gap-4 px-4 py-2 bg-black/60">
          <button
            onClick={() => setFeedTab('following')}
            className={cn('text-sm font-medium transition-colors', feedTab === 'following' ? 'text-white' : 'text-white/50 hover:text-white/80')}
          >
            Following
          </button>
          <button
            onClick={() => setFeedTab('mine')}
            className={cn('text-sm font-medium transition-colors flex items-center gap-1.5', feedTab === 'mine' ? 'text-white' : 'text-white/50 hover:text-white/80')}
          >
            <User className="h-3.5 w-3.5" />
            My Shorts
          </button>
        </div>
      )}

      <div className="flex-1 overflow-hidden">
        <ShortVideoFeed shorts={shorts ?? []} isLoading={isLoading} />
      </div>
    </div>
  );
}
