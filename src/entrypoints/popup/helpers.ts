export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const elem = document.createElement(tag);
  if (className) elem.className = className;
  if (text) elem.textContent = text;
  return elem;
}

/**
 * Mono icon names available in the sprite (icons-sprite.svg).
 * Each maps to a `<symbol id="i-mono-{name}">` in the sprite.
 */
export type IconName =
  | 'magnify'
  | 'close'
  | 'close-circle'
  | 'alert-triangle'
  | 'info'
  | 'copy'
  | 'chevron-down'
  | 'chevron-up';

/**
 * Create an SVG element that references a symbol from the inline sprite.
 * Sizing is handled by CSS on the parent or the SVG element itself.
 */
export function svgIcon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-mono-${name}`);
  svg.appendChild(use);
  return svg;
}

const SEVERITY_ICON: Record<string, IconName> = {
  error: 'close-circle',
  warning: 'alert-triangle',
  info: 'info',
};

export function severityIcon(severity: string): IconName {
  return SEVERITY_ICON[severity] || 'info';
}

const STATUS_TITLE: Record<string, string> = {
  '301': 'Moved Permanently',
  '302': 'Found (Temporary)',
  '303': 'See Other',
  '307': 'Temporary Redirect',
  '308': 'Permanent Redirect',
  HSTS: 'HSTS Upgrade',
  '0': 'HSTS Upgrade',
  JS: 'Client-side Redirect',
};

/** Short tooltip for a redirect status code badge. */
export function statusTitle(code: string): string {
  return STATUS_TITLE[code] || '';
}
