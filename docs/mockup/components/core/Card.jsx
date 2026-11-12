import React from 'react';

// 12/11/2026 (R12-010) — Ricostruito da _ds_bundle.js, che lo conteneva già compilato: la
// cartella core/ mancava, e ProductCard.jsx importava '../core/Badge.jsx' da un file assente.
// È la stessa versione che il deck mostra. NON è il componente del sito: quello vero, che le
// persone vedono, è components/ui/Card.tsx, e se i due non vanno d'accordo ha ragione quello
// (docs/mockup/LEGGIMI.md). Questo serve a chi disegna, come specifica da guardare.

function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * MyCity Card — standard surface container.
 * bordered (default) · elevated (warm shadow) · flat (cream).
 * Optional `hover` adds the universal lift used on product/store cards.
 */

const VARIANTS = {
  bordered: {
    background: 'var(--surface-0)',
    border: '1px solid var(--cream-300)'
  },
  elevated: {
    background: 'var(--surface-0)',
    border: '1px solid var(--cream-300)',
    boxShadow: 'var(--shadow-warm)'
  },
  flat: {
    background: 'var(--cream-50)',
    border: '1px solid transparent'
  }
};
const PADDINGS = {
  none: '0',
  sm: '12px',
  md: '16px',
  lg: '24px'
};
export function Card({
  variant = 'bordered',
  padding = 'md',
  hover = false,
  as: Tag = 'div',
  children,
  style,
  ...rest
}) {
  const v = VARIANTS[variant] || VARIANTS.bordered;
  const [h, setH] = React.useState(false);
  const lift = hover ? {
    transform: h ? 'translateY(-3px)' : 'translateY(0)',
    boxShadow: h ? 'var(--shadow-hover)' : v.boxShadow || 'none',
    transition: 'transform var(--dur-base) var(--ease-out-quint), box-shadow var(--dur-base) var(--ease-out)'
  } : {};
  const hoverProps = hover ? {
    onMouseEnter: () => setH(true),
    onMouseLeave: () => setH(false)
  } : {};
  return /*#__PURE__*/React.createElement(Tag, _extends({
    style: {
      borderRadius: 'var(--radius-lg)',
      padding: PADDINGS[padding],
      ...v,
      ...lift,
      ...style
    }
  }, hoverProps, rest), children);
}
