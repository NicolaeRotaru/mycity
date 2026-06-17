import React from 'react';

/**
 * MyCity Badge — inline pill, single source of truth for the marketplace's
 * promo/status micro-labels. Corrects the off-brand "rose" discount colour to
 * `secondary` (wine), per "Mediterranean Modern".
 */

const VARIANTS = {
  discount: { background: 'var(--secondary-600)', color: '#fff', textTransform: 'uppercase', letterSpacing: '0.03em' },
  new:      { background: 'var(--olive-600)', color: '#fff', textTransform: 'uppercase', letterSpacing: '0.03em' },
  soldout:  { background: 'var(--ink-700)', color: '#fff', textTransform: 'uppercase', letterSpacing: '0.03em' },
  lowstock: { background: 'var(--secondary-500)', color: '#fff', textTransform: 'uppercase', letterSpacing: '0.03em' },
  free:     { background: 'var(--olive-50)', color: 'var(--olive-700)' },
  cod:      { background: 'var(--olive-50)', color: 'var(--olive-700)' },
  local:    { background: 'var(--primary-50)', color: 'var(--primary-700)' },
  urgency:  { background: 'var(--accent-500)', color: 'var(--ink-900)' },
};

const SIZES = {
  sm: { fontSize: '10px', padding: '2px 6px', gap: '2px' },
  md: { fontSize: '12px', padding: '4px 8px', gap: '4px' },
};

export function Badge({ variant = 'local', size = 'sm', icon, children, style, ...rest }) {
  const v = VARIANTS[variant] || VARIANTS.local;
  const s = SIZES[size] || SIZES.sm;
  const iconSize = size === 'sm' ? 11 : 13;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      fontFamily: 'var(--font-sans)', fontWeight: 600,
      borderRadius: 'var(--radius-sm)', lineHeight: 1.2,
      ...s, ...v, ...style,
    }} {...rest}>
      {icon && <i data-lucide={icon} ref={(el) => { if (el && window.lucide) try { window.lucide.createIcons({ attrs: { width: iconSize, height: iconSize, 'stroke-width': 2.4 } }); } catch (e) {} }} style={{ width: iconSize, height: iconSize, display: 'inline-flex' }} />}
      {children}
    </span>
  );
}
