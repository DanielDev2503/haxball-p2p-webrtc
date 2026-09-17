import { createElement, IconNode, Crown, ShieldCheck, Lock, Unlock, Settings, Play, Square, Wifi, Timer, MoreVertical, User, PlusCircle, PlusSquare, Search, RefreshCw, X } from 'lucide';

export { Crown, ShieldCheck, Lock, Unlock, Settings, Play, Square, Wifi, Timer, MoreVertical, User, PlusCircle, PlusSquare, Search, RefreshCw, X };

function createIconElement(iconNode: IconNode, attrs: Record<string, string | number> = {}): SVGElement | HTMLElement {
  const normalizedAttrs: Record<string, string | number> = { ...attrs };
  if (attrs.size !== undefined) {
    normalizedAttrs.width = attrs.size;
    normalizedAttrs.height = attrs.size;
    delete normalizedAttrs.size;
  }
  if (attrs.color !== undefined) {
    normalizedAttrs.stroke = attrs.color;
    delete normalizedAttrs.color;
  }

  if (typeof document !== 'undefined' && typeof (document as any).createElementNS === 'function') {
    try {
      const el = createElement(iconNode);
      for (const [k, v] of Object.entries(normalizedAttrs)) {
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

export function renderIcon(
  targetOrIcon: HTMLElement | IconNode,
  iconOrAttrs?: IconNode | Record<string, string | number>,
  attrsOrNothing?: Record<string, string | number>
): SVGElement | HTMLElement {
  if (Array.isArray(targetOrIcon)) {
    const iconNode = targetOrIcon as IconNode;
    const attrs = (iconOrAttrs as Record<string, string | number>) || {};
    return createIconElement(iconNode, attrs);
  } else {
    const target = targetOrIcon as HTMLElement;
    const iconNode = iconOrAttrs as IconNode;
    const attrs = attrsOrNothing || {};
    const el = createIconElement(iconNode, attrs);
    if (target && typeof target.appendChild === 'function') {
      target.innerHTML = '';
      target.appendChild(el);
    }
    return el;
  }
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
