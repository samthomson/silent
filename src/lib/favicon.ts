const DEFAULT_FAVICON_HREF = '/icon.svg';

/**
 * Build an SVG favicon: purple speech bubble with white unread count.
 * Bubble maximized to fill available space with minimal margin.
 */
function buildFaviconSvg(count: number): string {
  const display = count > 99 ? '99+' : String(count);
  const fontSize = display.length > 2 ? 240 : display.length > 1 ? 300 : 380;
  // Path with l-5 5: x: 2-21 (19 units), y: 2-22 (20 units) - using larger dimension
  const margin = 4;
  const scale = (512 - margin * 2) / 20;
  const offsetX = margin - 2 * scale;
  const offsetY = margin - 2 * scale;
  // Center number in bubble body: y=2 to y=18 (body), midpoint y=10
  const textY = 10 * scale + offsetY;
  const svg = `<svg width="512" height="512" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bubble" x1="0" y1="0" x2="512" y2="512" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#a855f7"/>
      <stop offset="100%" stop-color="#7c3aed"/>
    </linearGradient>
  </defs>
  <g transform="translate(${offsetX},${offsetY}) scale(${scale})">
    <path d="M21 15a3 3 0 0 1-3 3H7l-5 5V5a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3z" fill="url(#bubble)"/>
  </g>
  <text x="256" y="${textY}" text-anchor="middle" dominant-baseline="middle" font-size="${fontSize}" font-weight="600" fill="white" font-family="system-ui, -apple-system, sans-serif">${display}</text>
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
