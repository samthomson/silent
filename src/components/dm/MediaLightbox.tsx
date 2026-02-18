import { useEffect, useCallback } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, X, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FileMetadata } from '@samthomson/nostr-messaging/core';
import { formatFullDateTime } from '@samthomson/nostr-messaging/core';
import { EncryptedMediaDisplay } from './EncryptedMediaDisplay';

interface MediaItem {
  fileMetadata: FileMetadata;
  messageId: string;
  timestamp: number;
  displayUrl: string;
}

interface MediaLightboxProps {
  isOpen: boolean;
  onClose: () => void;
  mediaItems: MediaItem[];
  currentIndex: number;
  onIndexChange: (index: number) => void;
  onScrollToMessage?: (messageId: string) => void;
}

export function MediaLightbox({
  isOpen,
  onClose,
  mediaItems,
  currentIndex,
  onIndexChange,
  onScrollToMessage,
}: MediaLightboxProps) {
  const currentItem = mediaItems[currentIndex];

  const goToPrevious = useCallback(() => {
    if (currentIndex > 0) {
      const newIndex = currentIndex - 1;
      onIndexChange(newIndex);
      onScrollToMessage?.(mediaItems[newIndex].messageId);
    }
  }, [currentIndex, onIndexChange, onScrollToMessage, mediaItems]);

  const goToNext = useCallback(() => {
    if (currentIndex < mediaItems.length - 1) {
      const newIndex = currentIndex + 1;
      onIndexChange(newIndex);
      onScrollToMessage?.(mediaItems[newIndex].messageId);
    }
  }, [currentIndex, mediaItems.length, onIndexChange, onScrollToMessage, mediaItems]);

  // Pause all videos when lightbox opens and hide them
  useEffect(() => {
    if (isOpen) {
      // Pause and hide all videos in the document except lightbox videos
      const videos = document.querySelectorAll('video');
      videos.forEach(video => {
        if (!video.paused) {
          video.pause();
        }
        // Hide videos that are not in the lightbox
        if (!video.closest('[data-lightbox]')) {
          video.style.visibility = 'hidden';
        }
      });
    } else {
      // Restore video visibility when lightbox closes
      const videos = document.querySelectorAll('video');
      videos.forEach(video => {
        video.style.visibility = 'visible';
      });
    }
  }, [isOpen]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          onClose();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          goToPrevious();
          break;
        case 'ArrowRight':
          e.preventDefault();
          goToNext();
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, goToPrevious, goToNext]);

  if (!currentItem) {
    return null;
  }

  const handleDownload = () => {
    if (currentItem.fileMetadata.url) {
      const link = document.createElement('a');
      link.href = currentItem.fileMetadata.url;
      link.download = currentItem.fileMetadata.name || 'media';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  // Get meaningful filename for display
  const getDisplayName = (name?: string) => {
    if (!name) return null;
    const cleanName = name.trim();
    if (!cleanName || cleanName.toLowerCase() === 'untitled' || cleanName.toLowerCase() === 'media') {
      return null;
    }
    // Skip hash-only strings (64 chars of hex)
    if (/^[a-f0-9]{64}$/i.test(cleanName)) {
      return null;
    }
    return cleanName;
  };

  const displayName = getDisplayName(currentItem.fileMetadata.name);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-none w-screen h-screen p-0 bg-transparent border-0 [&>button]:hidden">
        <div className="fixed inset-0 flex items-center justify-center">
          {/* Navigation arrows */}
          {mediaItems.length > 1 && (
            <>
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  if (currentIndex > 0) goToPrevious();
                }}
                className={cn(
                  "absolute left-8 top-1/2 -translate-y-1/2 z-10 h-14 w-14 rounded-full cursor-pointer",
                  "bg-primary hover:bg-primary/90 text-primary-foreground shadow-2xl transition-all",
                  "border-2 border-primary-foreground/20 flex items-center justify-center",
                  currentIndex === 0 ? "opacity-30 pointer-events-none" : "hover:scale-105"
                )}
              >
                <ChevronLeft className="h-7 w-7" />
              </div>
              
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  if (currentIndex < mediaItems.length - 1) goToNext();
                }}
                className={cn(
                  "absolute right-8 top-1/2 -translate-y-1/2 z-10 h-14 w-14 rounded-full cursor-pointer",
                  "bg-primary hover:bg-primary/90 text-primary-foreground shadow-2xl transition-all",
                  "border-2 border-primary-foreground/20 flex items-center justify-center",
                  currentIndex === mediaItems.length - 1 ? "opacity-30 pointer-events-none" : "hover:scale-105"
                )}
              >
                <ChevronRight className="h-7 w-7" />
              </div>
            </>
          )}
          
          <div className="w-[90vw] h-[90vh] bg-background border flex flex-col shadow-2xl relative">
            <Button
              variant="outline"
              size="icon"
              onClick={onClose}
              className="absolute top-6 right-6 z-[60] h-12 w-12 shadow-xl"
            >
              <X className="h-6 w-6" />
            </Button>

            <div className="flex-1 flex items-center justify-center p-8 min-h-0 overflow-hidden bg-black/5">
              <div className="w-full h-full flex items-center justify-center" data-lightbox="true">
                {currentItem ? (
                  <div className="relative w-full h-full flex items-center justify-center">
                    <EncryptedMediaDisplay
                      key={`${currentItem.messageId}-${currentIndex}`}
                      fileMetadata={currentItem.fileMetadata}
                      isLightbox={true}
                      showVideoControls={true}
                      className="max-w-full max-h-full relative z-10"
                    />
                  </div>
                ) : (
                  <div className="text-muted-foreground text-center">
                    <p>Media not found</p>
                  </div>
                )}
              </div>
            </div>

            <div className="absolute bottom-0 left-0 right-0 bg-muted/95 backdrop-blur-sm p-4 flex items-center justify-between border-t">
              <div className="flex-1">
                <div className="flex items-center gap-4">
                  {displayName && (
                    <span className="text-sm font-medium">{displayName}</span>
                  )}
                  <span className="text-sm text-white/70">
                    {currentIndex + 1} of {mediaItems.length}
                  </span>
                  <span className="text-sm text-white/70">
                    {formatFullDateTime(currentItem.timestamp)}
                  </span>
                </div>
              </div>
              
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDownload}
                className="text-white hover:bg-white/20"
              >
                <Download className="h-4 w-4 mr-2" />
                Download
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}