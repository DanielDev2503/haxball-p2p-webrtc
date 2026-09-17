import { createElement, IconNode, Crown, ShieldCheck, Lock, Unlock, Settings, Play, Square, Wifi, Timer, MoreVertical } from 'lucide';

export { Crown, ShieldCheck, Lock, Unlock, Settings, Play, Square, Wifi, Timer, MoreVertical };

export function renderIcon(iconNode: IconNode, attrs: Record<string, string | number> = {}): SVGElement | HTMLElement {
  if (typeof document !== 'undefined' && typeof (document as any).createElementNS === 'function') {
    try {
      const el = createElement(iconNode);
      for (const [k, v] of Object.entries(attrs)) {
        el.setAttribute(k, String(v));
      }
      return el;
    } catch {
      // fallback
    }
  }
  const fallback = typeof document !== 'undefined' && document.createElement
    ? document.createElement('span')
    : ({ setAttribute: () => {}, innerHTML: '' } as any);
  return fallback;
}

export function renderIconHTML(iconNode: IconNode, attrs: Record<string, string | number> = {}): string {
  const width = attrs.width ?? 16;
  const height = attrs.height ?? 16;
  const stroke = attrs.stroke ?? 'currentColor';
  const strokeWidth = attrs['stroke-width'] ?? 2;
  const className = attrs.class ?? 'lucide-icon';

  const children = iconNode
    .map(([tag, elAttrs]) => {
      const attrStr = Object.entries(elAttrs)
        .map(([k, v]) => `${k}="${v}"`)
        .join(' ');
      return `<${tag} ${attrStr}></${tag}>`;
    })
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" class="${className}">${children}</svg>`;
}
