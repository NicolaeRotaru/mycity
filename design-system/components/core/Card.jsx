import React from 'react';

/**
 * MyCity Card — standard surface container.
 * bordered (default) · elevated (warm shadow) · flat (cream).
 * Optional `hover` adds the universal lift used on product/store cards.
 */

const VARIANTS = {
  bordered: { background: 'var(--surface-0)', border: '1px solid var(--cream-300)' },
  elevated: { background: 'var(--surface-0)', border: '1px solid var(--cream-300)', boxShadow: 'var(--shadow-warm)' },
  flat:     { background: 'var(--cream-50)', border: '1px solid transparent' },
};
const PADDINGS = { none: '0', sm: '12px', md: '16px', lg: '24px' };

export function Card({ variant = 'bordered', padding = 'md', hover = false, as: Tag = 'div', children, style, ...rest }) {
  const v = VARIANTS[variant] || VARIANTS.bordered;
  const [h, setH] = React.useState(false);
  const lift = hover ? {
    transform: h ? 'translateY(-3px)' : 'translateY(0)',
    boxShadow: h ? 'var(--shadow-hover)' : (v.boxShadow || 'none'),
    transition: 'transform var(--dur-base) var(--ease-out-quint), box-shadow var(--dur-base) var(--ease-out)',
  } : {};
  const hoverProps = hover ? { onMouseEnter: () => setH(true), onMouseLeave: () => setH(false) } : {};
  return (
    <Tag style={{ borderRadius: 'var(--radius-lg)', padding: PADDINGS[padding], ...v, ...lift, ...style }} {...hoverProps} {...rest}>
      {children}
    </Tag>
  );
}
