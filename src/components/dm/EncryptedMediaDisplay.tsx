import { useState, useEffect, useRef } from 'react';
import { Blurhash } from 'react-blurhash';
import { Pure as DMLib } from '@/lib/dmLib';
import type { FileMetadata } from '@/lib/dmTypes';
import { formatBytes, formatSpeed } from '@/lib/dmUtils';
import { getCachedDecryptedBlob, cacheDecryptedBlob } from '@/lib/dmMediaCache';
import { Loader2, AlertCircle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface EncryptedMediaDisplayProps {
	fileMetadata: FileMetadata;
	className?: string;
}

/**
 * Component to display encrypted media files
 * - Downloads and decrypts encrypted files automatically
 * - Shows download progress with speed indicator
 */
export function EncryptedMediaDisplay({ fileMetadata, className }: EncryptedMediaDisplayProps) {
	const [decryptedBlob, setDecryptedBlob] = useState<Blob | null>(null);
	const [decryptedUrl, setDecryptedUrl] = useState<string | null>(null);
	const [isDecrypting, setIsDecrypting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [videoError, setVideoError] = useState<string | null>(null);
	const [retryKey, setRetryKey] = useState(0); // Force useEffect to re-run on retry
	const [downloadProgress, setDownloadProgress] = useState<{
		loaded: number;
		total: number | null;
		speed: number | null; // bytes per second
	} | null>(null);

	const downloadStartTime = useRef<number | null>(null);
	const isDownloading = useRef(false);
	const downloadControllerRef = useRef<AbortController | null>(null);

	const isEncrypted = !!(
		fileMetadata.encryptionAlgorithm &&
		fileMetadata.decryptionKey &&
		fileMetadata.decryptionNonce
	);

	const isImage = fileMetadata.mimeType?.startsWith('image/');
	const isVideo = fileMetadata.mimeType?.startsWith('video/');

	// Determine what to display (defined here to be available for useEffect below)
	const displayUrl = decryptedUrl || (!isEncrypted ? fileMetadata.url : null);

	// Decrypt main file if encrypted
	useEffect(() => {
		if (!isEncrypted || !fileMetadata.url || decryptedBlob || decryptedUrl) return;
		if (isDownloading.current) return; // Prevent duplicate downloads

		// Cancel any previous download
		if (downloadControllerRef.current) {
			downloadControllerRef.current.abort();
		}
		downloadControllerRef.current = new AbortController();

		const decryptAndDisplay = async () => {
			isDownloading.current = true;
			setIsDecrypting(true);
			setError(null);
			setDownloadProgress(null);

			try {
				// Check cache first
				const cached = await getCachedDecryptedBlob(fileMetadata);
				if (cached) {
					const url = URL.createObjectURL(cached);
					setDecryptedBlob(cached);
					setDecryptedUrl(url);
					setIsDecrypting(false);
					isDownloading.current = false;
					return;
				}

				// Not cached - download and decrypt
				downloadStartTime.current = Date.now();
				const proxyUrl = `/media-proxy/${fileMetadata.url!}`;
				console.log('[EncryptedMedia] Downloading via proxy:', proxyUrl);

				const response = await fetch(proxyUrl, {
					cache: 'no-cache',
					signal: downloadControllerRef.current?.signal
				});
				console.log('[EncryptedMedia] Proxy response status:', response.status, response.statusText);

				if (!response.ok) {
					throw new Error(`Download failed: ${response.status} ${response.statusText}`);
				}

				// Download with progress tracking
				const contentLength = response.headers.get('content-length');
				const total = contentLength ? parseInt(contentLength, 10) : null;

				let encryptedBlob: Blob;
				if (response.body) {
					const reader = response.body.getReader();
					const chunks: Uint8Array[] = [];
					let loaded = 0;

					while (true) {
						const { done, value } = await reader.read();
						if (done) break;
						chunks.push(value);
						loaded += value.length;

						// Calculate speed
						const elapsed = (Date.now() - downloadStartTime.current!) / 1000;
						const speed = elapsed > 0 ? loaded / elapsed : null;
						setDownloadProgress({ loaded, total, speed });
					}

					encryptedBlob = new Blob(chunks);
				} else {
					encryptedBlob = await response.blob();
				}

				console.log('[EncryptedMedia] Downloaded blob, size:', encryptedBlob.size, 'bytes');

				// Verify hash if provided
				if (fileMetadata.hash) {
					const isValid = await DMLib.Message.verifyFileHash(encryptedBlob, fileMetadata.hash);
					if (!isValid) {
						throw new Error('File integrity check failed - hash mismatch');
					}
				}

				// Decrypt file
				setDownloadProgress(null); // Clear progress, now decrypting
				console.log('[EncryptedMedia] Decrypting...');

				const decrypted = await DMLib.Message.decryptFile(
					encryptedBlob,
					fileMetadata.decryptionKey!,
					fileMetadata.decryptionNonce!,
					fileMetadata.encryptionAlgorithm || 'aes-gcm'
				);

				// Create blob with correct MIME type for proper playback
				const mimeType = fileMetadata.mimeType || 'application/octet-stream';
				const typedBlob = new Blob([decrypted], { type: mimeType });

				// Cache decrypted blob
				await cacheDecryptedBlob(fileMetadata, typedBlob);

				setDecryptedBlob(typedBlob);
				const url = URL.createObjectURL(typedBlob);
				setDecryptedUrl(url);
				console.log('[EncryptedMedia] Decryption complete, mimeType:', mimeType);
			} catch (err) {
				// Don't set error if download was aborted
				if (err instanceof Error && err.name === 'AbortError') {
					return;
				}
				console.error('[EncryptedMedia] Download/decryption failed:', err);
				setError(err instanceof Error ? err.message : 'Failed to download or decrypt file');
			} finally {
				setIsDecrypting(false);
				isDownloading.current = false;
			}
		};

		decryptAndDisplay();

		// Cleanup object URL on unmount
		return () => {
			if (decryptedUrl) {
				URL.revokeObjectURL(decryptedUrl);
			}
			if (downloadControllerRef.current) {
				downloadControllerRef.current.abort();
			}
		};
	}, [isEncrypted, fileMetadata, decryptedBlob, decryptedUrl, retryKey]);

	const handleRetry = () => {
		// Reset state to trigger retry
		setError(null);
		setDecryptedBlob(null);
		setDecryptedUrl(null);
		setDownloadProgress(null);
		isDownloading.current = false;
		setRetryKey(prev => prev + 1); // Force useEffect to re-run
	};

	// Reset video error when URL changes (for videos)
	useEffect(() => {
		if (isVideo) {
			setVideoError(null);
		}
	}, [displayUrl, isVideo]);

	// Error state
	if (error) {
		return (
			<div className={cn("p-4 border border-amber-500/50 rounded-md bg-amber-950/50", className)}>
				<div className="flex items-start gap-2 text-amber-200">
					<AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0 text-amber-400" />
					<div className="flex-1">
						<div className="text-sm font-medium text-amber-100">Failed to decrypt file</div>
						<div className="text-sm mt-1 text-amber-200/90">{error}</div>
					</div>
					<Button
						variant="ghost"
						size="icon"
						onClick={handleRetry}
						className="h-7 w-7 text-amber-200 hover:text-amber-100 hover:bg-amber-900/50"
						title="Retry download"
					>
						<RotateCcw className="h-4 w-4" />
					</Button>
				</div>
			</div>
		);
	}

	// Loading/downloading state
	if (isDecrypting && !decryptedUrl) {
		const progressPercent = downloadProgress?.total
			? Math.round((downloadProgress.loaded / downloadProgress.total) * 100)
			: null;

		// Parse dimensions for blurhash sizing (format: "WIDTHxHEIGHT")
		let blurhashWidth = 300;
		let blurhashHeight = 200;
		if (fileMetadata.dim) {
			const [w, h] = fileMetadata.dim.split('x').map(Number);
			if (w && h) {
				// Scale to reasonable display size while preserving aspect ratio
				const maxWidth = 400;
				const scale = Math.min(1, maxWidth / w);
				blurhashWidth = Math.round(w * scale);
				blurhashHeight = Math.round(h * scale);
			}
		}

		return (
			<div className={cn("relative", className)}>
				<div className="relative rounded-md overflow-hidden" style={{ width: blurhashWidth, height: blurhashHeight }}>
					{/* Show blurhash placeholder if available */}
					{fileMetadata.blurhash ? (
						<Blurhash
							hash={fileMetadata.blurhash}
							width={blurhashWidth}
							height={blurhashHeight}
							resolutionX={32}
							resolutionY={32}
							punch={1}
						/>
					) : (
						<div className="w-full h-full bg-muted" />
					)}

					{/* Overlay with progress info */}
					<div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40">
						<Loader2 className="h-6 w-6 animate-spin text-white" />
						<span className="text-sm text-white mt-2">
							{downloadProgress ? 'Downloading...' : 'Decrypting...'}
						</span>
						{downloadProgress && (
							<div className="text-xs text-white/80 space-y-1 text-center mt-1">
								<div>
									{formatBytes(downloadProgress.loaded)}
									{downloadProgress.total && ` / ${formatBytes(downloadProgress.total)}`}
									{progressPercent !== null && ` (${progressPercent}%)`}
								</div>
								{downloadProgress.speed && (
									<div className="text-white/60">
										{formatSpeed(downloadProgress.speed)}
									</div>
								)}
								{downloadProgress.total && (
									<div className="w-32 h-1 bg-white/20 rounded-full overflow-hidden">
										<div
											className="h-full bg-white transition-all duration-300"
											style={{ width: `${progressPercent}%` }}
										/>
									</div>
								)}
							</div>
						)}
					</div>
				</div>
			</div>
		);
	}

	if (!displayUrl) {
		return null;
	}

	// Render image
	if (isImage) {
		return (
			<div className={cn("relative", className)}>
				<img
					src={displayUrl}
					alt={fileMetadata.name || 'Attached image'}
					className="max-w-full rounded-md"
					style={{ maxHeight: '400px' }}
				/>
			</div>
		);
	}

	// Render video
	if (isVideo) {
		return (
			<div className={cn("relative", className)}>
				{videoError ? (
					<div className="p-4 border border-amber-500/50 rounded-md bg-amber-950/50">
						<div className="flex flex-col gap-3">
							<div className="flex items-start gap-2 text-amber-200">
								<AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0 text-amber-400" />
								<div className="flex-1">
									<div className="text-sm font-medium text-amber-100">Video playback failed</div>
									<div className="text-sm mt-1 text-amber-200/90">{videoError}</div>
									<div className="text-xs mt-2 text-amber-200/70">
										The video file may use a codec not supported by your browser (e.g., AVI files often use unsupported codecs).
									</div>
								</div>
							</div>
							{displayUrl && (
								<a
									href={displayUrl}
									download={fileMetadata.name || 'video'}
									className="text-sm text-amber-300 hover:text-amber-200 underline flex items-center gap-2"
								>
									📥 Download video file
								</a>
							)}
						</div>
					</div>
				) : (
					<video
						src={displayUrl}
						controls
						preload="metadata"
						className="max-w-full rounded-md"
						style={{ maxHeight: '400px' }}
						onError={(e) => {
							const video = e.currentTarget;
							const error = video.error;
							let errorMsg = 'Unknown error';
							if (error) {
								switch (error.code) {
									case MediaError.MEDIA_ERR_ABORTED:
										errorMsg = 'Video loading aborted';
										break;
									case MediaError.MEDIA_ERR_NETWORK:
										errorMsg = 'Network error while loading video';
										break;
									case MediaError.MEDIA_ERR_DECODE:
										errorMsg = 'Video codec not supported or corrupted file';
										break;
									case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
										errorMsg = 'Video format not supported by browser';
										break;
									default:
										errorMsg = `Video error: ${error.message || 'Unknown'}`;
								}
							}
							console.error('[EncryptedMedia] Video playback error:', errorMsg, error);
							setVideoError(errorMsg);
						}}
					/>
				)}
			</div>
		);
	}

	// Fallback for other file types - download link
	return (
		<div className={cn("p-3 border rounded-md bg-muted/50", className)}>
			<a
				href={displayUrl}
				download={fileMetadata.name || 'file'}
				className="text-sm text-primary hover:underline flex items-center gap-2"
			>
				📎 {fileMetadata.name || 'Download file'}
				{fileMetadata.size && (
					<span className="text-muted-foreground">({formatBytes(fileMetadata.size)})</span>
				)}
			</a>
		</div>
	);
}
