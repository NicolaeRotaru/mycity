import React from 'react';

// 12/11/2026 (R12-010) — Ricostruito da _ds_bundle.js, che lo conteneva già compilato: la
// cartella core/ mancava, e ProductCard.jsx importava '../core/Badge.jsx' da un file assente.
// È la stessa versione che il deck mostra. NON è il componente del sito: quello vero, che le
// persone vedono, è components/ui/Badge.tsx, e se i due non vanno d'accordo ha ragione quello
// (docs/mockup/LEGGIMI.md). Questo serve a chi disegna, come specifica da guardare.

function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * MyCity Badge — inline pill, single source of truth for the marketplace's
 * promo/status micro-labels. Corrects the off-brand "rose" discount colour to
 * `secondary` (wine), per "Mediterranean Modern".
 */

const VARIANTS = {
  discount: {
    background: 'var(--secondary-600)',
    color: '#fff',
    textTransform: 'uppercase',
    letterSpacing: '0.03em'
  },
  new: {
    background: 'var(--olive-600)',
    color: '#fff',
    textTransform: 'uppercase',
    letterSpacing: '0.03em'
  },
  soldout: {
    background: 'var(--ink-700)',
    color: '#fff',
    textTransform: 'uppercase',
    letterSpacing: '0.03em'
  },
  lowstock: {
    background: 'var(--secondary-500)',
    color: '#fff',
    textTransform: 'uppercase',
    letterSpacing: '0.03em'
  },
  free: {
    background: 'var(--olive-50)',
    color: 'var(--olive-700)'
  },
  cod: {
    background: 'var(--olive-50)',
    color: 'var(--olive-700)'
  },
  local: {
    background: 'var(--primary-50)',
    color: 'var(--primary-700)'
  },
  urgency: {
    background: 'var(--accent-500)',
    color: 'var(--ink-900)'
  }
};
const SIZES = {
  sm: {
    fontSize: '10px',
    padding: '2px 6px',
    gap: '2px'
  },
  md: {
    fontSize: '12px',
    padding: '4px 8px',
    gap: '4px'
  }
};
export function Badge({
  variant = 'local',
  size = 'sm',
  icon,
  children,
  style,
  ...rest
}) {
  const v = VARIANTS[variant] || VARIANTS.local;
  const s = SIZES[size] || SIZES.sm;
  const iconSize = size === 'sm' ? 11 : 13;
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      fontFamily: 'var(--font-sans)',
      fontWeight: 600,
      borderRadius: 'var(--radius-sm)',
      lineHeight: 1.2,
      ...s,
      ...v,
      ...style
    }
  }, rest), icon && /*#__PURE__*/React.createElement("i", {
    "data-lucide": icon,
    ref: el => {
      if (el && window.lucide) try {
        window.lucide.createIcons({
          attrs: {
            width: iconSize,
            height: iconSize,
            'stroke-width': 2.4
          }
        });
      } catch (e) {}
    },
    style: {
      width: iconSize,
      height: iconSize,
      display: 'inline-flex'
    }
  }), children);
}
