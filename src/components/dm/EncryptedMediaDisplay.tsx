import { useState, useEffect, useRef } from 'react';
import { Blurhash } from 'react-blurhash';
import { Pure as DMLib } from '@/lib/dmLib';
import type { FileMetadata } from '@/lib/dmTypes';
import { formatBytes, formatSpeed, isDisplayableMediaType } from '@/lib/dmUtils';
import { getCachedDecryptedBlob, cacheDecryptedBlob } from '@/lib/dmMediaCache';
import { Loader2, AlertCircle, RotateCcw, FileQuestion } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface EncryptedMediaDisplayProps {
	fileMetadata: FileMetadata;
	className?: string;
	showVideoControls?: boolean;
	isSidebar?: boolean;
	isLightbox?: boolean;
	onClick?: () => void;
}

/**
 * Component to display encrypted media files
 * - Downloads and decrypts encrypted files automatically
 * - Shows download progress with speed indicator
 */
export function EncryptedMediaDisplay({ fileMetadata, className, showVideoControls = true, isSidebar = false, isLightbox = false, onClick }: EncryptedMediaDisplayProps) {
	const [decryptedBlob, setDecryptedBlob] = useState<Blob | null>(null);
	const [decryptedUrl, setDecryptedUrl] = useState<string | null>(null);
	const [isDecrypting, setIsDecrypting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [videoError, setVideoError] = useState<string | null>(null);
	const [retryKey, setRetryKey] = useState(0); // Force useEffect to re-run on retry
	const [showFallback, setShowFallback] = useState(false);
	const [hashMismatch, setHashMismatch] = useState(false);
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
	const isDisplayable = isDisplayableMediaType(fileMetadata.mimeType, fileMetadata.url);

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

				try {
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
				} catch (decryptError: any) {
					console.error('[EncryptedMedia] Decryption failed:', decryptError);
					
					// Check if it's a hash mismatch
					if (decryptError.message?.includes('hash mismatch') || decryptError.message?.includes('integrity check failed')) {
						setHashMismatch(true);
						if (isLightbox) {
							// In lightbox, offer fallback option
							setError('File integrity verification failed. The encrypted file may be corrupted.');
						} else {
							setError('File integrity check failed - hash mismatch');
						}
					} else {
						setError(decryptError.message || 'Decryption failed');
					}
					throw decryptError; // Re-throw to be caught by outer catch
				}
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
						<div className="text-sm font-medium text-amber-100">
							{hashMismatch ? 'File integrity verification failed' : 'Failed to decrypt file'}
						</div>
						<div className="text-sm mt-1 text-amber-200/90">{error}</div>
						
						{hashMismatch && !showFallback && (
							<div className="mt-3 space-y-2">
								<p className="text-xs text-amber-200/80">
									The file appears corrupted or tampered with. You can still view the original file, but it may not display correctly.
								</p>
								<Button
									variant="outline"
									size="sm"
									onClick={() => setShowFallback(true)}
									className="h-7 text-xs bg-amber-900/30 border-amber-600/50 text-amber-200 hover:bg-amber-800/50"
								>
									Show original file anyway
								</Button>
							</div>
						)}
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

	// Loading/downloading state - don't show for lightbox videos to avoid overlay issues
	if (isDecrypting && !decryptedUrl && !(isLightbox && isVideo)) {
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

	// Show fallback for hash mismatch if user requested it
	if (hashMismatch && showFallback && fileMetadata.url) {
		const fallbackUrl = fileMetadata.url;
		const isImage = fileMetadata.mimeType?.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?.*)?$/i.test(fallbackUrl);
		const isVideo = fileMetadata.mimeType?.startsWith('video/') || /\.(mp4|webm|ogg|mov|avi|mkv)(\?.*)?$/i.test(fallbackUrl);
		
		return (
			<div className={cn("relative", className)}>
				{/* Warning banner */}
				<div className="absolute top-0 left-0 right-0 z-10 bg-amber-600/90 text-white text-xs px-2 py-1 rounded-t-md">
					⚠️ Showing original encrypted file - integrity not verified
				</div>
				
				<div className="pt-6">
					{isImage ? (
					<img
						src={fallbackUrl}
						alt={fileMetadata.name || 'Attached image (unverified)'}
						className={cn(
							"max-w-full", 
							isSidebar ? "rounded-sm" : "rounded-md",
							isLightbox ? "w-full h-full object-contain" : "",
							onClick && !isSidebar ? "cursor-pointer hover:opacity-90 transition-opacity" : ""
						)}
						style={{ maxHeight: isSidebar ? '100%' : isLightbox ? '100%' : '400px' }}
						onClick={onClick && !isSidebar ? (e) => {
							e.preventDefault();
							e.stopPropagation();
							onClick();
						} : undefined}
					/>
					) : isVideo ? (
					<video
						src={fallbackUrl}
						controls={showVideoControls}
						preload={isLightbox ? "none" : "metadata"}
						className={cn(
							"max-w-full", 
							isSidebar ? "rounded-sm" : "rounded-md",
							isLightbox ? "w-full h-full object-contain" : ""
						)}
						style={{ maxHeight: isSidebar ? '100%' : isLightbox ? '100%' : '400px' }}
						muted
						playsInline
						onClick={onClick && !isSidebar ? onClick : undefined}
					/>
					) : (
						<div className="p-3 border rounded-md bg-muted/50">
							<a
								href={fallbackUrl}
								download={fileMetadata.name || 'file'}
								className="text-sm text-primary hover:underline flex items-center gap-2"
							>
								📎 {fileMetadata.name || 'Download file (unverified)'}
								{fileMetadata.size && (
									<span className="text-muted-foreground">({formatBytes(fileMetadata.size)})</span>
								)}
							</a>
						</div>
					)}
				</div>
			</div>
		);
	}

	if (!displayUrl) {
		return null;
	}

	// Show generic placeholder for unsupported file types (HEIC, unsupported videos, etc.)
	if ((isImage || isVideo) && !isDisplayable) {
		if (isSidebar) {
			// Sidebar variant - compact, no download link
			return (
				<div className={cn("w-full h-full flex flex-col items-center justify-center p-2 bg-amber-950/30 border border-amber-500/30 rounded-sm", className)}>
					<FileQuestion className="h-6 w-6 text-amber-400 mb-1" />
					<p className="text-xs text-amber-200 text-center line-clamp-2 break-words px-1">
						{fileMetadata.name || 'Unsupported file'}
					</p>
				</div>
			);
		}
		
		// Main chat variant - full error message with download
		return (
			<div className={cn("p-4 border border-amber-500/50 rounded-md bg-amber-950/50", className)}>
				<div className="flex flex-col gap-3">
					<div className="flex items-start gap-2 text-amber-200">
						<FileQuestion className="h-4 w-4 mt-0.5 flex-shrink-0 text-amber-400" />
						<div className="flex-1">
							<div className="text-sm font-medium text-amber-100">File format not supported</div>
							<div className="text-sm mt-1 text-amber-200/90">
								This file type cannot be displayed in your browser (e.g., HEIC files or unsupported video codecs).
							</div>
						</div>
					</div>
					{displayUrl && (
						<a
							href={displayUrl}
							download={fileMetadata.name || 'file'}
							className="text-sm text-amber-300 hover:text-amber-200 underline flex items-center gap-2"
						>
							📥 Download file
						</a>
					)}
				</div>
			</div>
		);
	}

	// Render image
	if (isImage && isDisplayable) {
		return (
			<div className={cn("relative", className)}>
				<img
					src={displayUrl}
					alt={fileMetadata.name || 'Attached image'}
					className={cn(
						"max-w-full", 
						isSidebar ? "rounded-sm" : "rounded-md",
						isLightbox ? "w-full h-full object-contain" : "",
						onClick && !isSidebar ? "cursor-pointer hover:opacity-90 transition-opacity" : ""
					)}
					style={{ maxHeight: isSidebar ? '100%' : isLightbox ? '100%' : '400px' }}
					onClick={onClick && !isSidebar ? (e) => {
						e.preventDefault();
						e.stopPropagation();
						onClick();
					} : undefined}
				/>
			</div>
		);
	}

	// Render video
	if (isVideo && isDisplayable) {
		return (
			<div className={cn("relative", isLightbox ? "bg-transparent" : "", className)}>
				{videoError ? (
					// Video playback error - use same unified format as unsupported files
					isSidebar ? (
						<div className={cn("w-full h-full flex flex-col items-center justify-center p-2 bg-amber-950/30 border border-amber-500/30 rounded-sm", className)}>
							<FileQuestion className="h-6 w-6 text-amber-400 mb-1" />
							<p className="text-xs text-amber-200 text-center line-clamp-2 break-words px-1">
								{fileMetadata.name || 'Unsupported file'}
							</p>
						</div>
					) : (
						<div className="p-4 border border-amber-500/50 rounded-md bg-amber-950/50">
							<div className="flex flex-col gap-3">
								<div className="flex items-start gap-2 text-amber-200">
									<FileQuestion className="h-4 w-4 mt-0.5 flex-shrink-0 text-amber-400" />
									<div className="flex-1">
										<div className="text-sm font-medium text-amber-100">File format not supported</div>
										<div className="text-sm mt-1 text-amber-200/90">
											This file type cannot be displayed in your browser (e.g., HEIC files or unsupported video codecs).
										</div>
									</div>
								</div>
								{displayUrl && (
									<a
										href={displayUrl}
										download={fileMetadata.name || 'file'}
										className="text-sm text-amber-300 hover:text-amber-200 underline flex items-center gap-2"
									>
										📥 Download file
									</a>
								)}
							</div>
						</div>
					)
				) : (
					<div 
						className={cn(
							"relative",
							isLightbox ? "w-full h-full bg-transparent" : "",
							onClick && !isSidebar ? "cursor-pointer" : ""
						)}
						onClick={onClick && !isSidebar ? onClick : undefined}
					>
						<video
							src={displayUrl}
							controls={showVideoControls}
							preload={isLightbox ? "none" : "metadata"}
							className={cn(
								"max-w-full", 
								isSidebar ? "rounded-sm" : "rounded-md",
								isLightbox ? "w-full h-full object-contain bg-transparent" : ""
							)}
							style={{ maxHeight: isSidebar ? '100%' : isLightbox ? '100%' : '400px' }}
							muted
							playsInline
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
					</div>
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
