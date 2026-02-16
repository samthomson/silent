const DEFAULT_FAVICON_HREF = '/icon.svg';

/**
 * Build an SVG favicon: purple speech bubble with white unread count.
 * Bubble maximized to fill available space with minimal margin.
 */
function buildFaviconSvg(count: number): string {
  const display = count > 99 ? '99' : String(count);
  const fontSize = display.length > 1 ? 280 : 360;
  // Path: rounded rect body y=3 to y=17 (14 units), tail y=17 to y=21 (4 units)
  // x: 3-21 (18 units), y: 3-21 (18 units total)
  const margin = 4;
  const scale = (512 - margin * 2) / 18;
  const offsetX = margin - 3 * scale;
  const offsetY = margin - 3 * scale;
  // Center number in bubble body: midpoint between y=3 and y=17 is y=10
  // Adjust down slightly (10.5) for better visual centering
  const textY = 10.5 * scale + offsetY;
  const svg = `<svg width="512" height="512" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bubble" x1="0" y1="0" x2="512" y2="512" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#a855f7"/>
      <stop offset="100%" stop-color="#7c3aed"/>
    </linearGradient>
  </defs>
  <g transform="translate(${offsetX},${offsetY}) scale(${scale})">
    <path d="M21 15a2.5 2.5 0 0 1-2.5 2.5H7l-4 4V5a2.5 2.5 0 0 1 2.5-2.5h14a2.5 2.5 0 0 1 2.5 2.5z" fill="url(#bubble)"/>
  </g>
  <text x="256" y="${textY}" text-anchor="middle" dominant-baseline="middle" font-size="${fontSize}" font-weight="bold" fill="white" font-family="system-ui, sans-serif">${display}</text>
</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function setFavicon(unreadTotal: number): void {
  if (typeof document === 'undefined') return;
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/svg+xml';
    document.head.appendChild(link);
  }
  link.href = unreadTotal > 0 ? buildFaviconSvg(unreadTotal) : DEFAULT_FAVICON_HREF;
}

export function resetFavicon(): void {
  setFavicon(0);
}
