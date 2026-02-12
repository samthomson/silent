import { useMutation } from '@tanstack/react-query';
import { encode } from 'blurhash';
import { useNostrPublish } from './useNostrPublish';
import { useUploadFile } from './useUploadFile';

interface PublishShortParams {
  videoBlob: Blob;
  title: string;
  description: string;
}

// NIP-71 Kind 34236 for vertical videos
const KIND_VERTICAL_VIDEO = 34236;

interface VideoMetadata {
  width: number;
  height: number;
  duration: number;
  bitrate?: number;
  blurhash?: string;
  thumbnailUrl?: string;
}

// Extract comprehensive video metadata
async function extractVideoMetadata(blob: Blob): Promise<VideoMetadata> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    video.preload = 'metadata';
    video.muted = true;
    
    video.onloadedmetadata = async () => {
      const width = video.videoWidth || 1080;
      const height = video.videoHeight || 1920;
      const duration = video.duration || 0;
      
      // Estimate bitrate from file size and duration
      const bitrate = duration > 0 ? Math.round((blob.size * 8) / duration) : undefined;
      
      let blurhash: string | undefined;
      let thumbnailUrl: string | undefined;
      
      // Generate thumbnail and blurhash from first frame
      if (ctx && width > 0 && height > 0) {
        try {
          canvas.width = Math.min(width, 320);
          canvas.height = Math.min(height, 320 * (height / width));
          
          video.currentTime = Math.min(1, duration * 0.1); // 10% into video or 1s
          
          await new Promise<void>((resolveFrame) => {
            video.onseeked = () => {
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              
              // Generate blurhash
              const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              blurhash = encode(imageData.data, canvas.width, canvas.height, 4, 4);
              
              // Generate thumbnail as data URL
              thumbnailUrl = canvas.toDataURL('image/jpeg', 0.8);
              
              resolveFrame();
            };
          });
        } catch (error) {
          console.warn('Failed to generate thumbnail/blurhash:', error);
        }
      }
      
      URL.revokeObjectURL(video.src);
      resolve({ width, height, duration, bitrate, blurhash, thumbnailUrl });
    };
    
    video.onerror = () => {
      URL.revokeObjectURL(video.src);
      // Default fallback
      resolve({ width: 1080, height: 1920, duration: 0 });
    };
    
    video.src = URL.createObjectURL(blob);
  });
}

export function usePublishShort() {
  const { mutateAsync: publishEvent } = useNostrPublish();
  const { mutateAsync: uploadFile } = useUploadFile();

  return useMutation({
    mutationFn: async ({ videoBlob, title, description }: PublishShortParams) => {
      // Extract comprehensive video metadata
      const metadata = await extractVideoMetadata(videoBlob);
      
      // Convert blob to File for upload
      const videoFile = new File([videoBlob], `short-${Date.now()}.webm`, { 
        type: videoBlob.type || 'video/webm' 
      });

      // Upload to Blossom
      const tags = await uploadFile(videoFile);
      
      // tags is string[][] for unencrypted uploads
      if (!Array.isArray(tags) || !Array.isArray(tags[0])) {
        throw new Error('Unexpected upload response format');
      }

      // Extract URL from upload response (first tag is ["url", "https://..."])
      const urlTag = tags.find(t => t[0] === 'url');
      const url = urlTag?.[1];
      if (!url) {
        throw new Error('No URL returned from upload');
      }

      // Extract other metadata from upload response
      const mimeType = tags.find(t => t[0] === 'm')?.[1] || videoBlob.type || 'video/webm';
      const size = tags.find(t => t[0] === 'size')?.[1];
      const hash = tags.find(t => t[0] === 'x')?.[1];

      const dim = `${metadata.width}x${metadata.height}`;
      
      // Determine if video is vertical or horizontal
      const isVertical = metadata.height > metadata.width;
      // Use kind 34236 for vertical, 34235 for horizontal
      const kind = isVertical ? KIND_VERTICAL_VIDEO : 34235;

      // Build imeta tag per NIP-71/NIP-92
      const imetaParts = [
        `url ${url}`,
        `m ${mimeType}`,
        `dim ${dim}`,
      ];
      if (size) imetaParts.push(`size ${size}`);
      if (hash) imetaParts.push(`x ${hash}`);
      if (metadata.duration) imetaParts.push(`duration ${metadata.duration.toFixed(3)}`);
      if (metadata.bitrate) imetaParts.push(`bitrate ${metadata.bitrate}`);
      if (metadata.blurhash) imetaParts.push(`blurhash ${metadata.blurhash}`);
      if (metadata.thumbnailUrl) imetaParts.push(`image ${metadata.thumbnailUrl}`);

      // Generate unique d-tag
      const dTag = crypto.randomUUID();
      const publishedAt = Math.floor(Date.now() / 1000).toString();

      // Build event tags
      const eventTags = [
        ['d', dTag],
        ['title', title],
        ['published_at', publishedAt],
        ['imeta', ...imetaParts],
        ['t', 'short'],
      ];

      // Add alt tag for accessibility (same as description)
      if (description) {
        eventTags.push(['alt', description]);
      }

      // Publish NIP-71 video event
      const event = await publishEvent({
        kind,
        content: description,
        tags: eventTags,
      });

      return event;
    },
  });
}

