/* @ds-bundle: {"format":3,"namespace":"MyCityDesignSystem_105480","components":[{"name":"OrderStatusBadge","sourcePath":"components/commerce/OrderStatusBadge.jsx"},{"name":"ProductCard","sourcePath":"components/commerce/ProductCard.jsx"},{"name":"Badge","sourcePath":"components/core/Badge.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Card","sourcePath":"components/core/Card.jsx"},{"name":"EmptyState","sourcePath":"components/feedback/EmptyState.jsx"},{"name":"Modal","sourcePath":"components/feedback/Modal.jsx"},{"name":"Checkbox","sourcePath":"components/forms/Checkbox.jsx"},{"name":"Input","sourcePath":"components/forms/Input.jsx"},{"name":"Field","sourcePath":"components/forms/Input.jsx"},{"name":"Select","sourcePath":"components/forms/Select.jsx"}],"sourceHashes":{"components/commerce/OrderStatusBadge.jsx":"ad69353454af","components/commerce/ProductCard.jsx":"fec64a4007bd","components/core/Badge.jsx":"b348f03b7cfa","components/core/Button.jsx":"216766976591","components/core/Card.jsx":"d09bb7b8cb01","components/feedback/EmptyState.jsx":"18a2b1af6820","components/feedback/Modal.jsx":"03a503d742dd","components/forms/Checkbox.jsx":"166ad0d13723","components/forms/Input.jsx":"7b34d4c20c7a","components/forms/Select.jsx":"baada32a54f5","deck/deck-stage.js":"208980974db4","ui_kits/buyer/app.js":"acdd7636dc35","ui_kits/buyer/src/00-ui.js":"aff08b0c81dc","ui_kits/buyer/src/10-navbar.js":"722082a9778c","ui_kits/buyer/src/20-home.js":"69866faf6ff1","ui_kits/buyer/src/25-auth.js":"ca1c7360455d","ui_kits/buyer/src/30-store.js":"96d009a06214","ui_kits/buyer/src/35-checkout.js":"5b7db37c8ecc","ui_kits/buyer/src/40-srp.js":"6f6c2d8d16ba","ui_kits/buyer/src/45-account.js":"2f3f5d255c24","ui_kits/buyer/src/50-product.js":"7954a667ba68","ui_kits/buyer/src/60-cart.js":"0c14cac37574","ui_kits/buyer/src/70-tracking.js":"3a92eb94f51e","ui_kits/buyer/src/90-app.js":"663d441d9288","ui_kits/buyer/src/data.js":"21d31e555ee5","ui_kits/rider/app.js":"f7980322c87a","ui_kits/rider/src/00-shell.js":"cab568732b97","ui_kits/rider/src/00-ui.jsx":"cd92899b4ffb","ui_kits/rider/src/10-screens.jsx":"c8afcd1d67e1","ui_kits/rider/src/20-home.js":"ec7dfb2af8af","ui_kits/rider/src/30-delivery.js":"c00e27b4bd3a","ui_kits/rider/src/40-screens.js":"8d6a56f0b33d","ui_kits/rider/src/90-app.js":"c1074830f494","ui_kits/rider/src/90-app.jsx":"b38142cead52","ui_kits/rider/src/data.js":"f18acd33c6fb","ui_kits/seller/app.js":"41e6f122207f","ui_kits/seller/app.jsx":"55456003f653","ui_kits/seller/src/00-ui.js":"eccaf6408fa2","ui_kits/seller/src/00-ui.jsx":"de5b36bb08eb","ui_kits/seller/src/10-shell.js":"9dd7597dac04","ui_kits/seller/src/10-shell.jsx":"ec8b2b48a0dc","ui_kits/seller/src/20-dashboard.js":"5e3823bfdf73","ui_kits/seller/src/20-dashboard.jsx":"f04a8d21cdc5","ui_kits/seller/src/30-orders.js":"e883c0db0b11","ui_kits/seller/src/30-orders.jsx":"867e6d34975f","ui_kits/seller/src/40-products.js":"cc583861425e","ui_kits/seller/src/40-products.jsx":"750d3e590a7c","ui_kits/seller/src/50-analytics.js":"04fab5a5a0b6","ui_kits/seller/src/50-analytics.jsx":"3503b8add324","ui_kits/seller/src/60-earnings.js":"1f94fb158b22","ui_kits/seller/src/60-more.jsx":"5dbe86b71ef7","ui_kits/seller/src/70-more.js":"3e1b08518a71","ui_kits/seller/src/90-app.js":"ec493b14ef67","ui_kits/seller/src/90-app.jsx":"8e1992c8707b","ui_kits/seller/src/data.js":"6d2dcb9b4bb4"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.MyCityDesignSystem_105480 = window.MyCityDesignSystem_105480 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/commerce/OrderStatusBadge.jsx
try { (() => {
/**
 * MyCity OrderStatusBadge — status pill for the buyer/seller/rider order flow.
 * Tinted background + ring + Lucide icon, one source of truth for 8 states.
 */
const STATUS = {
  NEW: {
    label: 'In attesa di conferma',
    icon: 'clock',
    color: 'var(--status-new)',
    bg: '#FFFBEB'
  },
  ACCEPTED: {
    label: 'In preparazione',
    icon: 'chef-hat',
    color: 'var(--status-accepted)',
    bg: '#EFF6FF'
  },
  READY: {
    label: 'Pronto per il pickup',
    icon: 'package',
    color: 'var(--status-ready)',
    bg: '#F5F3FF'
  },
  ASSIGNED: {
    label: 'Rider in arrivo',
    icon: 'bike',
    color: 'var(--status-assigned)',
    bg: '#EEF2FF'
  },
  PICKED_UP: {
    label: 'Ritirato dal negozio',
    icon: 'hand',
    color: 'var(--status-pickedup)',
    bg: '#ECFEFF'
  },
  OUT_FOR_DELIVERY: {
    label: 'In consegna',
    icon: 'truck',
    color: 'var(--status-delivery)',
    bg: '#FAF5FF'
  },
  DELIVERED: {
    label: 'Consegnato',
    icon: 'check-circle-2',
    color: 'var(--status-delivered)',
    bg: '#ECFDF5'
  },
  CANCELED: {
    label: 'Annullato',
    icon: 'x-circle',
    color: 'var(--status-canceled)',
    bg: '#FFF1F2'
  }
};
const SIZES = {
  sm: {
    fontSize: '12px',
    padding: '3px 10px',
    gap: '5px',
    icon: 12
  },
  md: {
    fontSize: '14px',
    padding: '6px 12px',
    gap: '6px',
    icon: 14
  }
};
function OrderStatusBadge({
  status = 'NEW',
  size = 'md',
  variant = 'pill',
  style
}) {
  const s = STATUS[status] || STATUS.NEW;
  const z = SIZES[size] || SIZES.md;
  const iconEl = /*#__PURE__*/React.createElement("i", {
    "data-lucide": s.icon,
    ref: el => {
      if (el && window.lucide) try {
        window.lucide.createIcons({
          attrs: {
            width: z.icon,
            height: z.icon,
            'stroke-width': 2.2
          }
        });
      } catch (e) {}
    },
    style: {
      width: z.icon,
      height: z.icon,
      display: 'inline-flex'
    }
  });
  if (variant === 'icon-only') return /*#__PURE__*/React.createElement("span", {
    style: {
      color: s.color,
      display: 'inline-flex'
    },
    "aria-label": s.label
  }, iconEl);
  if (variant === 'inline') return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: z.gap,
      color: s.color,
      fontFamily: 'var(--font-sans)',
      fontSize: z.fontSize,
      fontWeight: 500
    }
  }, iconEl, s.label);
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: z.gap,
      fontFamily: 'var(--font-sans)',
      fontSize: z.fontSize,
      fontWeight: 500,
      color: s.color,
      background: s.bg,
      padding: z.padding,
      borderRadius: 'var(--radius-full)',
      boxShadow: 'inset 0 0 0 1px currentColor',
      ...style
    }
  }, iconEl, s.label);
}
Object.assign(__ds_scope, { OrderStatusBadge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/commerce/OrderStatusBadge.jsx", error: String((e && e.message) || e) }); }

// components/core/Badge.jsx
try { (() => {
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
function Badge({
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
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Badge.jsx", error: String((e && e.message) || e) }); }

// components/commerce/ProductCard.jsx
try { (() => {
/**
 * MyCity ProductCard — the marketplace's signature card. Photo dominant
 * (square), compact body: store chip · title · price · discreet "+" add.
 * Hover lifts the card and zooms the photo. Bound to the design tokens.
 */
function formatPrice(n) {
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR'
  }).format(n);
}

// Branded fallback shown if a product photo fails to load (no broken grey boxes).
const MC_FALLBACK_IMG = 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FBF7F0"/><stop offset="1" stop-color="#F5EDD9"/></linearGradient></defs><rect width="400" height="400" fill="url(#g)"/><g fill="none" stroke="#D9B36F" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"><path d="M150 250l45-55 35 40 30-35 40 50"/><circle cx="165" cy="160" r="22"/></g><rect x="120" y="120" width="160" height="160" rx="16" fill="none" stroke="#E6CC95" stroke-width="8"/></svg>`);
function ProductCard({
  name,
  price,
  image,
  storeName,
  discountPercent,
  stock,
  isNew = false,
  freeShipping = false,
  onAdd,
  onFav,
  favorite = false,
  href,
  style
}) {
  const [hover, setHover] = React.useState(false);
  const [fav, setFav] = React.useState(favorite);
  const hasDiscount = discountPercent > 0;
  const finalPrice = hasDiscount ? price * (1 - discountPercent / 100) : price;
  const outOfStock = stock === 0;
  const lowStock = stock > 0 && stock <= 3;
  const initials = (storeName || '').trim().split(/\s+/).map(w => w[0] || '').slice(0, 2).join('').toUpperCase();
  const Tag = href ? 'a' : 'div';
  return /*#__PURE__*/React.createElement(Tag, {
    href: href,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      overflow: 'hidden',
      borderRadius: 'var(--radius-2xl)',
      border: `1px solid ${hover ? 'var(--primary-200)' : 'var(--surface-200)'}`,
      background: 'var(--surface-0)',
      textDecoration: 'none',
      boxShadow: hover ? 'var(--shadow-warm-lg)' : 'none',
      transform: hover ? 'translateY(-4px)' : 'translateY(0)',
      transition: 'transform var(--dur-base) var(--ease-out-quint), box-shadow var(--dur-base), border-color var(--dur-base)',
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      top: '8px',
      left: '8px',
      zIndex: 2,
      display: 'flex',
      flexDirection: 'column',
      gap: '4px'
    }
  }, hasDiscount && /*#__PURE__*/React.createElement(__ds_scope.Badge, {
    variant: "discount"
  }, "-", discountPercent, "%"), isNew && /*#__PURE__*/React.createElement(__ds_scope.Badge, {
    variant: "new"
  }, "Nuovo"), outOfStock && /*#__PURE__*/React.createElement(__ds_scope.Badge, {
    variant: "soldout"
  }, "Esaurito")), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      width: '100%',
      aspectRatio: '1 / 1',
      overflow: 'hidden',
      background: 'var(--surface-100)'
    }
  }, image ? /*#__PURE__*/React.createElement("img", {
    src: image,
    alt: name,
    onError: e => {
      e.currentTarget.onerror = null;
      e.currentTarget.src = MC_FALLBACK_IMG;
    },
    style: {
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      transform: hover ? 'scale(1.08)' : 'scale(1)',
      transition: 'transform var(--dur-slow) var(--ease-out-quint)'
    }
  }) : /*#__PURE__*/React.createElement("img", {
    src: MC_FALLBACK_IMG,
    alt: name,
    style: {
      width: '100%',
      height: '100%',
      objectFit: 'cover'
    }
  }), /*#__PURE__*/React.createElement("button", {
    type: "button",
    "aria-label": "Preferiti",
    onClick: e => {
      e.preventDefault();
      e.stopPropagation();
      setFav(v => !v);
      onFav?.();
    },
    style: {
      position: 'absolute',
      top: '8px',
      right: '8px',
      width: '28px',
      height: '28px',
      borderRadius: 'var(--radius-full)',
      border: 0,
      background: 'rgba(255,255,255,.95)',
      boxShadow: 'var(--shadow-sm)',
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "14",
    height: "14",
    viewBox: "0 0 24 24",
    fill: fav ? 'var(--secondary-500)' : 'none',
    stroke: fav ? 'var(--secondary-500)' : 'var(--ink-400)',
    strokeWidth: "2"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.5 4.04 3 5.5l7 7Z"
  })))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
      flex: 1,
      padding: '10px'
    }
  }, storeName && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '6px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '16px',
      height: '16px',
      flexShrink: 0,
      borderRadius: 'var(--radius-full)',
      background: 'linear-gradient(135deg, var(--primary-500), var(--primary-700))',
      color: '#fff',
      fontSize: '8px',
      fontWeight: 700,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'var(--font-sans)'
    }
  }, initials), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: '11px',
      fontWeight: 600,
      color: 'var(--ink-500)',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, storeName)), /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-sans)',
      fontSize: '13px',
      fontWeight: 600,
      lineHeight: 1.3,
      color: hover ? 'var(--primary-700)' : 'var(--ink-900)',
      transition: 'color var(--dur-base)',
      display: '-webkit-box',
      WebkitLineClamp: 2,
      WebkitBoxOrient: 'vertical',
      overflow: 'hidden',
      minHeight: '2.6em'
    }
  }, name), (freeShipping || lowStock) && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: '4px',
      marginTop: '2px'
    }
  }, lowStock && !outOfStock && /*#__PURE__*/React.createElement(__ds_scope.Badge, {
    variant: "lowstock",
    icon: "flame"
  }, stock === 1 ? 'Ultimo pezzo' : `Ultimi ${stock}`), freeShipping && /*#__PURE__*/React.createElement(__ds_scope.Badge, {
    variant: "free",
    icon: "truck"
  }, "Sped. gratis")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      marginTop: 'auto',
      paddingTop: '4px'
    }
  }, hasDiscount ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: '16px',
      fontWeight: 800,
      color: 'var(--secondary-600)'
    }
  }, formatPrice(finalPrice)), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '11px',
      color: 'var(--ink-400)',
      textDecoration: 'line-through'
    }
  }, formatPrice(price))) : /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: '16px',
      fontWeight: 800,
      color: 'var(--ink-900)'
    }
  }, formatPrice(price)), /*#__PURE__*/React.createElement("button", {
    type: "button",
    "aria-label": "Aggiungi al carrello",
    disabled: outOfStock,
    onClick: e => {
      e.preventDefault();
      e.stopPropagation();
      onAdd?.();
    },
    style: {
      marginLeft: 'auto',
      width: '28px',
      height: '28px',
      flexShrink: 0,
      borderRadius: 'var(--radius-md)',
      border: 0,
      background: outOfStock ? 'var(--cream-200)' : 'var(--primary-600)',
      color: outOfStock ? 'var(--ink-400)' : '#fff',
      cursor: outOfStock ? 'not-allowed' : 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: 'var(--shadow-sm)'
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "16",
    height: "16",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2.6",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M12 5v14M5 12h14"
  }))))));
}
Object.assign(__ds_scope, { ProductCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/commerce/ProductCard.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * MyCity Button — "Mediterranean Modern" primitive.
 * 6 variants · 3 sizes · rounded/pill · loading + icon slots.
 * Styling is bound to the design-system CSS custom properties (no Tailwind).
 *
 * Icons: pass a Lucide icon NAME (e.g. icon="shopping-cart") and load the
 * Lucide UMD script on the page, or pass any React node.
 */

const VARIANTS = {
  primary: {
    bg: 'var(--primary-700)',
    hover: 'var(--primary-800)',
    color: '#fff',
    shadow: 'var(--shadow-warm-sm)'
  },
  accent: {
    bg: 'var(--accent-400)',
    hover: 'var(--accent-500)',
    color: 'var(--ink-900)',
    shadow: 'var(--shadow-sm)'
  },
  secondary: {
    bg: 'var(--surface-0)',
    hover: 'var(--cream-50)',
    color: 'var(--ink-900)',
    border: '1px solid var(--cream-300)'
  },
  ghost: {
    bg: 'transparent',
    hover: 'var(--primary-50)',
    color: 'var(--primary-700)'
  },
  danger: {
    bg: 'var(--danger)',
    hover: '#B91C1C',
    color: '#fff'
  },
  success: {
    bg: 'var(--olive-600)',
    hover: 'var(--olive-700)',
    color: '#fff'
  }
};
const SIZES = {
  sm: {
    padding: '6px 12px',
    fontSize: '12px',
    gap: '4px',
    minHeight: '32px'
  },
  md: {
    padding: '10px 16px',
    fontSize: '14px',
    gap: '6px',
    minHeight: '44px'
  },
  lg: {
    padding: '12px 20px',
    fontSize: '16px',
    gap: '8px',
    minHeight: '48px'
  }
};
const ICON_SIZE = {
  sm: 12,
  md: 14,
  lg: 18
};
function Button({
  variant = 'primary',
  size = 'md',
  shape = 'rounded',
  loading = false,
  disabled = false,
  fullWidth = false,
  icon,
  iconRight,
  href,
  onClick,
  type = 'button',
  children,
  style,
  ...rest
}) {
  const v = VARIANTS[variant] || VARIANTS.primary;
  const s = SIZES[size] || SIZES.md;
  const sz = ICON_SIZE[size];
  const isDisabled = disabled || loading;
  const [hover, setHover] = React.useState(false);
  const [active, setActive] = React.useState(false);
  const styles = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'var(--font-sans)',
    fontWeight: 600,
    lineHeight: 1,
    cursor: isDisabled ? 'not-allowed' : 'pointer',
    opacity: isDisabled ? 0.5 : 1,
    borderRadius: shape === 'pill' ? 'var(--radius-full)' : 'var(--radius-md)',
    border: v.border || '1px solid transparent',
    boxShadow: v.shadow || 'none',
    background: hover && !isDisabled ? v.hover : v.bg,
    color: v.color,
    transform: active && !isDisabled ? 'scale(0.97)' : 'scale(1)',
    transition: 'background-color var(--dur-base) var(--ease-out), transform var(--dur-fast) var(--ease-out)',
    width: fullWidth ? '100%' : undefined,
    textDecoration: 'none',
    whiteSpace: 'nowrap',
    ...s,
    ...style
  };
  const handlers = {
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => {
      setHover(false);
      setActive(false);
    },
    onMouseDown: () => setActive(true),
    onMouseUp: () => setActive(false)
  };
  const content = /*#__PURE__*/React.createElement(React.Fragment, null, loading && /*#__PURE__*/React.createElement(Spinner, {
    size: sz
  }), !loading && icon && /*#__PURE__*/React.createElement(Glyph, {
    icon: icon,
    size: sz
  }), children, !loading && iconRight && /*#__PURE__*/React.createElement(Glyph, {
    icon: iconRight,
    size: sz
  }));
  if (href && !isDisabled) {
    return /*#__PURE__*/React.createElement("a", _extends({
      href: href,
      style: styles
    }, handlers, rest), content);
  }
  return /*#__PURE__*/React.createElement("button", _extends({
    type: type,
    disabled: isDisabled,
    onClick: onClick,
    "aria-busy": loading || undefined,
    style: styles
  }, handlers, rest), content);
}
function Glyph({
  icon,
  size
}) {
  if (typeof icon === 'string') {
    return /*#__PURE__*/React.createElement("i", {
      "data-lucide": icon,
      ref: mountLucide(size),
      style: {
        width: size,
        height: size,
        display: 'inline-flex'
      }
    });
  }
  return icon || null;
}
function Spinner({
  size
}) {
  return /*#__PURE__*/React.createElement("span", {
    style: {
      width: size,
      height: size,
      borderRadius: '50%',
      border: '2px solid currentColor',
      borderTopColor: 'transparent',
      display: 'inline-block',
      animation: 'mc-spin 0.7s linear infinite'
    }
  });
}
function mountLucide(size) {
  return el => {
    if (el && typeof window !== 'undefined' && window.lucide) {
      try {
        window.lucide.createIcons({
          attrs: {
            width: size,
            height: size,
            'stroke-width': 2.4
          }
        });
      } catch (e) {}
    }
  };
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/Card.jsx
try { (() => {
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
function Card({
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
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Card.jsx", error: String((e && e.message) || e) }); }

// components/feedback/EmptyState.jsx
try { (() => {
/**
 * MyCity EmptyState — friendly empty/zero-result placeholder. Soft terracotta
 * icon medallion, serif title, optional action. Bound to the design tokens.
 */
function EmptyState({
  icon = 'package-open',
  title,
  description,
  action,
  tone = 'primary',
  style
}) {
  const TONES = {
    primary: {
      bg: 'var(--primary-50)',
      fg: 'var(--primary-700)'
    },
    olive: {
      bg: 'var(--olive-50)',
      fg: 'var(--olive-700)'
    },
    accent: {
      bg: 'var(--accent-100)',
      fg: 'var(--accent-700)'
    },
    secondary: {
      bg: 'var(--secondary-50)',
      fg: 'var(--secondary-600)'
    }
  };
  const t = TONES[tone] || TONES.primary;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      textAlign: 'center',
      padding: '32px 24px',
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '64px',
      height: '64px',
      borderRadius: 'var(--radius-full)',
      background: t.bg,
      color: t.fg,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: '16px'
    }
  }, /*#__PURE__*/React.createElement("i", {
    "data-lucide": icon,
    ref: el => {
      if (el && window.lucide) try {
        window.lucide.createIcons({
          attrs: {
            width: 28,
            height: 28,
            'stroke-width': 2
          }
        });
      } catch (e) {}
    },
    style: {
      width: 28,
      height: 28,
      display: 'inline-flex'
    }
  })), /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-serif)',
      fontWeight: 700,
      fontSize: '18px',
      color: 'var(--ink-900)'
    }
  }, title), description && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '6px 0 0',
      fontSize: '14px',
      color: 'var(--ink-500)',
      maxWidth: '320px',
      lineHeight: 1.5
    }
  }, description), action && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: '18px'
    }
  }, action));
}
Object.assign(__ds_scope, { EmptyState });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/EmptyState.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Modal.jsx
try { (() => {
const {
  createPortal
} = ReactDOM;
/**
 * MyCity Modal — bottom sheet on mobile, centered dialog on desktop.
 * Body scroll-lock, Esc to close, click-outside, slide-up animation.
 * Bound to the design-system tokens.
 */
const SIZES = {
  sm: '384px',
  md: '448px',
  lg: '512px',
  xl: '672px'
};
function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  closeOnBackdrop = true,
  closeOnEsc = true
}) {
  React.useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = e => {
      if (closeOnEsc && e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, closeOnEsc, onClose]);
  if (!open || typeof document === 'undefined') return null;
  return createPortal(/*#__PURE__*/React.createElement("div", {
    onClick: closeOnBackdrop ? onClose : undefined,
    style: {
      position: 'fixed',
      inset: 0,
      zIndex: 'var(--z-modal)',
      background: 'rgba(0,0,0,.4)',
      backdropFilter: 'blur(2px)',
      display: 'flex',
      alignItems: 'flex-end',
      justifyContent: 'center',
      animation: 'mc-fade-in var(--dur-fast) ease-out'
    },
    "data-modal-backdrop": true
  }, /*#__PURE__*/React.createElement("div", {
    role: "dialog",
    "aria-modal": "true",
    onClick: e => e.stopPropagation(),
    style: {
      background: 'var(--surface-0)',
      width: '100%',
      maxWidth: SIZES[size] || SIZES.md,
      borderRadius: 'var(--radius-2xl) var(--radius-2xl) 0 0',
      boxShadow: 'var(--shadow-warm-xl)',
      overflow: 'hidden',
      maxHeight: '90vh',
      display: 'flex',
      flexDirection: 'column',
      animation: 'mc-slide-up var(--dur-medium) var(--ease-out-quint)',
      margin: '0'
    },
    className: "mc-modal-panel"
  }, /*#__PURE__*/React.createElement("header", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '12px',
      padding: '16px 20px',
      borderBottom: '1px solid var(--cream-200)',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-serif)',
      fontWeight: 700,
      fontSize: '18px',
      color: 'var(--ink-900)'
    }
  }, title), description && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 0',
      fontSize: '12px',
      color: 'var(--ink-500)'
    }
  }, description)), /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: onClose,
    "aria-label": "Chiudi",
    style: {
      flexShrink: 0,
      border: 0,
      background: 'transparent',
      color: 'var(--ink-500)',
      cursor: 'pointer',
      borderRadius: 'var(--radius-full)',
      padding: '6px',
      display: 'inline-flex'
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "20",
    height: "20",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M18 6 6 18M6 6l12 12"
  })))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflowY: 'auto',
      padding: '20px'
    }
  }, children), footer && /*#__PURE__*/React.createElement("footer", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: '8px',
      padding: '16px 20px',
      borderTop: '1px solid var(--cream-200)',
      flexShrink: 0
    }
  }, footer)), /*#__PURE__*/React.createElement("style", null, `@media (min-width:640px){.mc-modal-panel{margin:16px!important;border-radius:var(--radius-2xl)!important}[data-modal-backdrop]{align-items:center!important}}`)), document.body);
}
Object.assign(__ds_scope, { Modal });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Modal.jsx", error: String((e && e.message) || e) }); }

// components/forms/Checkbox.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * MyCity Checkbox — accessible checkbox with a rich (ReactNode) label, for
 * TOS opt-ins, toggles and filters. Accent colour = terracotta.
 */
function Checkbox({
  label,
  id,
  error,
  checked,
  defaultChecked,
  onChange,
  containerStyle,
  style,
  ...props
}) {
  const autoId = React.useId();
  const fieldId = id || autoId;
  return /*#__PURE__*/React.createElement("div", {
    style: containerStyle
  }, /*#__PURE__*/React.createElement("label", {
    htmlFor: fieldId,
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      gap: '8px',
      fontFamily: 'var(--font-sans)',
      fontSize: '14px',
      color: 'var(--ink-700)',
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement("input", _extends({
    id: fieldId,
    type: "checkbox",
    checked: checked,
    defaultChecked: defaultChecked,
    onChange: onChange,
    "aria-invalid": error ? true : undefined,
    style: {
      marginTop: '2px',
      width: '16px',
      height: '16px',
      accentColor: 'var(--primary-600)',
      cursor: 'pointer',
      ...style
    }
  }, props)), label && /*#__PURE__*/React.createElement("span", null, label)), error && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '4px 0 0',
      fontSize: '12px',
      fontWeight: 500,
      color: 'var(--secondary-600)'
    }
  }, error));
}
Object.assign(__ds_scope, { Checkbox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Checkbox.jsx", error: String((e && e.message) || e) }); }

// components/forms/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * MyCity Input — labelled text field with hint/error, optional leading/trailing
 * adornments. 16px text avoids iOS zoom. Bound to the design-system tokens.
 */
function Input({
  label,
  hint,
  error,
  required,
  id,
  leading,
  trailing,
  labelAction,
  containerStyle,
  style,
  ...props
}) {
  const autoId = React.useId();
  const fieldId = id || autoId;
  const [focus, setFocus] = React.useState(false);
  const borderColor = error ? 'var(--secondary-400)' : focus ? 'var(--primary-400)' : 'var(--cream-300)';
  const control = /*#__PURE__*/React.createElement("input", _extends({
    id: fieldId,
    required: required,
    "aria-invalid": error ? true : undefined,
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    style: {
      width: '100%',
      boxSizing: 'border-box',
      fontFamily: 'var(--font-sans)',
      fontSize: '16px',
      color: 'var(--ink-900)',
      background: 'var(--surface-0)',
      borderRadius: 'var(--radius-md)',
      border: `1px solid ${borderColor}`,
      boxShadow: focus ? `0 0 0 3px ${error ? 'rgba(214,62,59,.18)' : 'rgba(228,122,90,.22)'}` : 'none',
      padding: '10px 12px',
      paddingLeft: leading ? '40px' : '12px',
      paddingRight: trailing ? '44px' : '12px',
      outline: 'none',
      transition: 'border-color var(--dur-base), box-shadow var(--dur-base)',
      ...style
    }
  }, props));
  return /*#__PURE__*/React.createElement(Field, {
    id: fieldId,
    label: label,
    required: required,
    hint: hint,
    error: error,
    labelAction: labelAction,
    style: containerStyle
  }, leading || trailing ? /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative'
    }
  }, leading && /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      left: '12px',
      top: '50%',
      transform: 'translateY(-50%)',
      color: 'var(--ink-400)',
      display: 'inline-flex',
      pointerEvents: 'none'
    }
  }, leading), control, trailing && /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      right: '10px',
      top: '50%',
      transform: 'translateY(-50%)',
      display: 'inline-flex'
    }
  }, trailing)) : control);
}

/** Label + control + hint/error wrapper. Exported for custom controls. */
function Field({
  id,
  label,
  required,
  hint,
  error,
  labelAction,
  children,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '5px',
      ...style
    }
  }, (label || labelAction) && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '8px'
    }
  }, label ? /*#__PURE__*/React.createElement("label", {
    htmlFor: id,
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: '14px',
      fontWeight: 500,
      color: 'var(--ink-700)'
    }
  }, label, required && /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--secondary-600)'
    }
  }, " *")) : /*#__PURE__*/React.createElement("span", null), labelAction), children, hint && !error && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '12px',
      color: 'var(--ink-500)'
    }
  }, hint), error && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '12px',
      fontWeight: 500,
      color: 'var(--secondary-600)'
    }
  }, error));
}
Object.assign(__ds_scope, { Input, Field });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Input.jsx", error: String((e && e.message) || e) }); }

// components/forms/Select.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * MyCity Select — native select wrapped in the shared Field shell, with a
 * chevron adornment. Bound to the design-system tokens.
 */
function Select({
  label,
  hint,
  error,
  required,
  id,
  children,
  containerStyle,
  style,
  ...props
}) {
  const autoId = React.useId();
  const fieldId = id || autoId;
  const [focus, setFocus] = React.useState(false);
  const borderColor = error ? 'var(--secondary-400)' : focus ? 'var(--primary-400)' : 'var(--cream-300)';
  return /*#__PURE__*/React.createElement(__ds_scope.Field, {
    id: fieldId,
    label: label,
    required: required,
    hint: hint,
    error: error,
    style: containerStyle
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative'
    }
  }, /*#__PURE__*/React.createElement("select", _extends({
    id: fieldId,
    required: required,
    "aria-invalid": error ? true : undefined,
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    style: {
      width: '100%',
      boxSizing: 'border-box',
      appearance: 'none',
      fontFamily: 'var(--font-sans)',
      fontSize: '16px',
      color: 'var(--ink-900)',
      background: 'var(--surface-0)',
      borderRadius: 'var(--radius-md)',
      border: `1px solid ${borderColor}`,
      boxShadow: focus ? '0 0 0 3px rgba(228,122,90,.22)' : 'none',
      padding: '10px 36px 10px 12px',
      outline: 'none',
      cursor: 'pointer',
      transition: 'border-color var(--dur-base), box-shadow var(--dur-base)',
      ...style
    }
  }, props), children), /*#__PURE__*/React.createElement("span", {
    "aria-hidden": true,
    style: {
      position: 'absolute',
      right: '12px',
      top: '50%',
      transform: 'translateY(-50%)',
      pointerEvents: 'none',
      color: 'var(--ink-400)'
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "16",
    height: "16",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2.4",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("polyline", {
    points: "6 9 12 15 18 9"
  })))));
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Select.jsx", error: String((e && e.message) || e) }); }

// deck/deck-stage.js
try { (() => {
// @ds-adherence-ignore -- omelette starter scaffold (raw elements/hex/px by design)
/* ═══ THIS PROJECT USES DESIGN COMPONENTS (.dc.html) ═══
 * Reference this stage from your <x-dc> template as an import — NEVER as a
 * raw <deck-stage> tag plus a <script src> (that hides the whole deck until
 * the stream finishes):
 *
 *   <x-import component-from-global-scope="deck-stage" from="./deck-stage.js"
 *             width="1920" height="1080" hint-size="100%,100%">
 *     <section data-label="Title" style="...">…</section>
 *     <section data-label="Agenda" style="...">…</section>
 *   </x-import>
 *
 * Slides are inline-styled <section> siblings; do not add a stylesheet or a
 * deck-stage:not(:defined) rule. The plain-HTML "Usage" block in the comment
 * below does NOT apply to .dc.html templates.
 */
/* BEGIN USAGE */
/**
 * <deck-stage> — reusable web component for HTML decks.
 *
 * Handles:
 *  (a) speaker notes — reads <script type="application/json" id="speaker-notes">
 *      and posts {slideIndexChanged: N} to the parent window on nav.
 *  (b) keyboard navigation — ←/→, PgUp/PgDn, Space, Home/End, number keys.
 *      On touch devices, tapping the left/right half of the stage goes
 *      prev/next — taps on links, buttons and other interactive slide
 *      content are left alone.
 *  (c) press R to reset to slide 0 (with a tasteful keyboard hint).
 *  (d) bottom-center overlay showing slide count + hints, fades out on idle.
 *  (e) auto-scaling — inner canvas is a fixed design size (default 1920×1080)
 *      scaled with `transform: scale()` to fit the viewport, letterboxed.
 *      Set the `noscale` attribute to render at authored size (1:1) — the
 *      PPTX exporter sets this so its DOM capture sees unscaled geometry.
 *  (f) print — `@media print` lays every slide out as its own page at the
 *      design size, so the browser's Print → Save as PDF produces a clean
 *      one-page-per-slide PDF with no extra setup.
 *  (g) thumbnail rail — resizable left-hand column of per-slide thumbnails
 *      (static clones). Click to navigate; ↑/↓ with a thumbnail focused to
 *      step between slides; drag to reorder; right-click for
 *      Skip / Move up / Move down / Duplicate / Delete (Delete opens a
 *      Cancel/Delete confirm dialog). Drag the rail's right edge to resize;
 *      width persists to
 *      localStorage. Skipped slides carry `data-deck-skip`, are dimmed in
 *      the rail, omitted from prev/next navigation, and hidden at print.
 *      The rail is suppressed in presenting mode, in the host's Preview
 *      mode (ViewerMode='none'), on `noscale`, on narrow viewports
 *      (≤640px), and via the `no-rail` attribute. Rail mutations dispatch
 *      a `dc-op` CustomEvent on the element (see docs/dc-ops.md) and do
 *      NOT touch the DOM: the host applies the op and re-renders;
 *      structural rail input is locked until the host posts
 *      {__dc_op_ack: true, applied}.
 *
 * Slides are HIDDEN, not unmounted. Non-active slides stay in the DOM with
 * `visibility: hidden` + `opacity: 0`, so their state (videos, iframes,
 * form inputs, React trees) is preserved across navigation.
 *
 * Lifecycle event — the component dispatches a `slidechange` CustomEvent on
 * itself whenever the active slide changes (including the initial mount).
 * The event bubbles and composes out of shadow DOM, so you can listen on
 * the <deck-stage> element or on document:
 *
 *   document.querySelector('deck-stage').addEventListener('slidechange', (e) => {
 *     e.detail.index         // new 0-based index
 *     e.detail.previousIndex // previous index, or -1 on init
 *     e.detail.total         // total slide count
 *     e.detail.slide         // the new active slide element
 *     e.detail.previousSlide // the prior slide element, or null on init
 *     e.detail.reason        // 'init' | 'keyboard' | 'click' | 'tap' | 'api'
 *   });
 *
 * Persistence: none at the deck level. The host app keeps the current slide
 * in its own URL (?slide=) and re-delivers it via location.hash on load, so a
 * bare load with no hash always starts at slide 1.
 *
 * Usage:
 *   <style>deck-stage:not(:defined){visibility:hidden}</style>
 *   <deck-stage width="1920" height="1080">
 *     <section data-label="Title">...</section>
 *     <section data-label="Agenda">...</section>
 *   </deck-stage>
 *   <script src="deck-stage.js"></script>
 *
 * The :not(:defined) rule prevents a flash of the first slide at its
 * authored styles before this script runs and attaches the shadow root.
 *
 * Slides are the direct element children of <deck-stage>. Each slide is
 * automatically tagged with:
 *   - data-screen-label="NN Label"   (1-indexed, for comment flow)
 *   - data-om-validate="no_overflowing_text,no_overlapping_text,slide_sized_text"
 *
 * Speaker notes stay in sync because the component posts {slideIndexChanged: N}
 * to the parent — just include the #speaker-notes script tag if asked for notes.
 *
 * Authoring guidance:
 *   - Write slide bodies as static HTML inside <deck-stage>, with sizing via
 *     CSS custom properties in a <style> block rather than JS constants.
 *     Static slide markup is what lets the user click a heading in edit mode
 *     and retype it directly; a slide rendered through <script type="text/babel">,
 *     React, or a loop over a JS array has to round-trip every tweak through a
 *     chat message instead. Reach for script-generated slides only when the
 *     content genuinely needs interactive behaviour static HTML can't express.
 *   - Do NOT set position/inset/width/height on the slide <section> elements —
 *     the component absolutely positions every slotted child for you.
 *   - Entrance animations: make the visible end-state the base style and
 *     animate *from* hidden, so print and reduced-motion show content.
 *     Gate the animation on [data-deck-active] and the motion query, e.g.
 *     `@media (prefers-reduced-motion:no-preference){ [data-deck-active] .x{animation:fade-in .5s both} }`.
 *     Avoid infinite decorative loops on slide content.
 */
/* END USAGE */

(() => {
  const DESIGN_W_DEFAULT = 1920;
  const DESIGN_H_DEFAULT = 1080;
  const OVERLAY_HIDE_MS = 1800;
  const VALIDATE_ATTR = 'no_overflowing_text,no_overlapping_text,slide_sized_text';
  const FINE_POINTER_MQ = matchMedia('(hover: hover) and (pointer: fine)');
  const NARROW_MQ = matchMedia('(max-width: 640px)');
  // Slide-authored controls that should keep a tap instead of it navigating.
  const INTERACTIVE_SEL = 'a[href], button, input, select, textarea, summary, label, video[controls], audio[controls], [role="button"], [onclick], [tabindex]:not([tabindex^="-"]), [contenteditable]:not([contenteditable="false" i])';
  const pad2 = n => String(n).padStart(2, '0');

  // Label precedence: data-label → data-screen-label (number stripped) → first heading → "Slide".
  const getSlideLabel = el => {
    const explicit = el.getAttribute('data-label');
    if (explicit) return explicit;
    const existing = el.getAttribute('data-screen-label');
    if (existing) return existing.replace(/^\s*\d+\s*/, '').trim() || existing;
    const h = el.querySelector('h1, h2, h3, [data-title]');
    const t = h && (h.textContent || '').trim().slice(0, 40);
    if (t) return t;
    return 'Slide';
  };
  const stylesheet = `
    :host {
      position: fixed;
      inset: 0;
      display: block;
      background: #000;
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif;
      overflow: hidden;
      -webkit-tap-highlight-color: transparent;
    }
    /* connectedCallback holds this until document.fonts.ready (capped 2s) so
     * the first visible paint has the deck's real typography + final rail
     * layout. opacity (not visibility) so the active slide can't un-hide
     * itself via the ::slotted([data-deck-active]) visibility:visible rule.
     * Only the stage/rail hide — the black :host background stays, so the
     * iframe doesn't flash the page's default white. */
    :host([data-fonts-pending]) .stage,
    :host([data-fonts-pending]) .rail { opacity: 0; pointer-events: none; }

    .stage {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .canvas {
      position: relative;
      transform-origin: center center;
      flex-shrink: 0;
      background: #fff;
      will-change: transform;
    }

    /* Slides live in light DOM (via <slot>) so authored CSS still applies.
       We absolutely position each slotted child to stack them. */
    ::slotted(*) {
      position: absolute !important;
      inset: 0 !important;
      width: 100% !important;
      height: 100% !important;
      box-sizing: border-box !important;
      overflow: hidden;
      opacity: 0;
      pointer-events: none;
      visibility: hidden;
    }
    ::slotted([data-deck-active]) {
      opacity: 1;
      pointer-events: auto;
      visibility: visible;
    }

    .overlay {
      position: fixed;
      left: 50%;
      bottom: 22px;
      transform: translate(-50%, 6px) scale(0.92);
      filter: blur(6px);
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px;
      background: #000;
      color: #fff;
      border-radius: 999px;
      font-size: 12px;
      font-feature-settings: "tnum" 1;
      letter-spacing: 0.01em;
      opacity: 0;
      pointer-events: none;
      transition: opacity 260ms ease, transform 260ms cubic-bezier(.2,.8,.2,1), filter 260ms ease;
      transform-origin: center bottom;
      z-index: 2147483000;
      user-select: none;
    }
    .overlay[data-visible] {
      opacity: 1;
      pointer-events: auto;
      transform: translate(-50%, 0) scale(1);
      filter: blur(0);
    }

    .btn {
      appearance: none;
      -webkit-appearance: none;
      background: transparent;
      border: 0;
      margin: 0;
      padding: 0;
      color: inherit;
      font: inherit;
      cursor: default;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      height: 28px;
      min-width: 28px;
      border-radius: 999px;
      color: rgba(255,255,255,0.72);
      transition: background 140ms ease, color 140ms ease;
      -webkit-tap-highlight-color: transparent;
    }
    .btn:hover { background: rgba(255,255,255,0.12); color: #fff; }
    .btn:active { background: rgba(255,255,255,0.18); }
    .btn:focus { outline: none; }
    .btn:focus-visible { outline: none; }
    .btn::-moz-focus-inner { border: 0; }
    .btn svg { width: 14px; height: 14px; display: block; }
    .btn.reset {
      font-size: 11px;
      font-weight: 500;
      letter-spacing: 0.02em;
      padding: 0 10px 0 12px;
      gap: 6px;
      color: rgba(255,255,255,0.72);
    }
    .btn.reset .kbd {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 16px;
      height: 16px;
      padding: 0 4px;
      font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      font-size: 10px;
      line-height: 1;
      color: rgba(255,255,255,0.88);
      background: rgba(255,255,255,0.12);
      border-radius: 4px;
    }

    .count {
      font-variant-numeric: tabular-nums;
      color: #fff;
      font-weight: 500;
      padding: 0 8px;
      min-width: 42px;
      text-align: center;
      font-size: 12px;
    }
    .count .sep { color: rgba(255,255,255,0.45); margin: 0 3px; font-weight: 400; }
    .count .total { color: rgba(255,255,255,0.55); }

    .divider {
      width: 1px;
      height: 14px;
      background: rgba(255,255,255,0.18);
      margin: 0 2px;
    }

    /* ── Thumbnail rail ──────────────────────────────────────────────────
       Fixed column on the left; each thumbnail is a static deep-clone of
       the light-DOM slide scaled into a 16:9 (or design-aspect) frame. The
       stage re-fits around it (see _fit); hidden during present / noscale
       / print so capture geometry and fullscreen output are unchanged. */
    .rail {
      position: fixed;
      left: 0;
      top: 0;
      bottom: 0;
      width: var(--deck-rail-w, 188px);
      background: #141414;
      border-right: 1px solid rgba(255,255,255,0.08);
      overflow-y: auto;
      overflow-x: hidden;
      padding: 12px 10px;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      gap: 12px;
      z-index: 2147482500;
      scrollbar-width: thin;
      scrollbar-color: rgba(255,255,255,0.18) transparent;
    }
    .rail::-webkit-scrollbar { width: 8px; }
    .rail::-webkit-scrollbar-track { background: transparent; margin: 2px; }
    .rail::-webkit-scrollbar-thumb {
      background: rgba(255,255,255,0.18);
      border-radius: 4px;
      border: 2px solid transparent;
      background-clip: content-box;
    }
    .rail::-webkit-scrollbar-thumb:hover {
      background: rgba(255,255,255,0.28);
      border: 2px solid transparent;
      background-clip: content-box;
    }
    :host([no-rail]) .rail,
    :host([noscale]) .rail { display: none; }
    .rail[data-presenting] { display: none; }
    @media (max-width: 640px) {
      .rail, .rail-resize { display: none; }
    }
    /* User-driven show/hide (the TweaksPanel toggle) slides instead of
       popping. Transitions are gated on :host([data-rail-anim]) — set only
       for the 200ms around the toggle — so window-resize and rail-width
       drag (which also call _fit) don't lag behind the cursor. */
    .rail[data-user-hidden] { transform: translateX(-100%); }
    :host([data-rail-anim]) .rail { transition: transform 200ms cubic-bezier(.3,.7,.4,1); }
    :host([data-rail-anim]) .stage { transition: left 200ms cubic-bezier(.3,.7,.4,1); }
    :host([data-rail-anim]) .canvas { transition: transform 200ms cubic-bezier(.3,.7,.4,1); }
    /* transition shorthand replaces rather than merges — repeat the base
       .overlay opacity/transform/filter transitions so visibility changes
       during the 200ms toggle window still fade instead of popping. */
    :host([data-rail-anim]) .overlay {
      transition: margin-left 200ms cubic-bezier(.3,.7,.4,1),
                  opacity 260ms ease,
                  transform 260ms cubic-bezier(.2,.8,.2,1),
                  filter 260ms ease;
    }

    .thumb {
      position: relative;
      display: flex;
      align-items: flex-start;
      gap: 8px;
      cursor: pointer;
      user-select: none;
    }
    .thumb .num {
      width: 16px;
      flex-shrink: 0;
      font-size: 11px;
      font-weight: 500;
      text-align: right;
      color: rgba(255,255,255,0.55);
      padding-top: 2px;
      font-variant-numeric: tabular-nums;
    }
    .thumb .frame {
      position: relative;
      flex: 1;
      min-width: 0;
      aspect-ratio: var(--deck-aspect);
      background: #fff;
      border-radius: 4px;
      outline: 2px solid transparent;
      outline-offset: 0;
      overflow: hidden;
      transition: outline-color 120ms ease;
    }
    .thumb:hover .frame { outline-color: rgba(255,255,255,0.25); }
    .thumb { outline: none; }
    .thumb:focus-visible .frame { outline-color: rgba(255,255,255,0.5); }
    .thumb[data-current] .num { color: #fff; }
    .thumb[data-current] .frame { outline-color: #D97757; }
    .thumb[data-dragging] { opacity: 0.35; }
    .thumb::before {
      content: '';
      position: absolute;
      left: 24px;
      right: 0;
      height: 3px;
      border-radius: 2px;
      background: #D97757;
      opacity: 0;
      pointer-events: none;
    }
    .thumb[data-drop="before"]::before { top: -8px; opacity: 1; }
    .thumb[data-drop="after"]::before { bottom: -8px; opacity: 1; }
    .thumb[data-skip] .frame { opacity: 0.35; }
    .thumb[data-skip] .frame::after {
      content: 'Skipped';
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,0.45);
      color: #fff;
      font-size: 10px;
      font-weight: 500;
      letter-spacing: 0.04em;
    }

    .ctxmenu {
      position: fixed;
      min-width: 150px;
      padding: 4px;
      background: #242424;
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 7px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.45);
      z-index: 2147483100;
      display: none;
      font-size: 12px;
    }
    .ctxmenu[data-open] { display: block; }
    .ctxmenu button {
      display: block;
      width: 100%;
      appearance: none;
      border: 0;
      background: transparent;
      color: #e8e8e8;
      font: inherit;
      text-align: left;
      padding: 6px 10px;
      border-radius: 4px;
      cursor: pointer;
    }
    .ctxmenu button:hover:not(:disabled) { background: rgba(255,255,255,0.08); }
    .ctxmenu button:disabled { opacity: 0.35; cursor: default; }
    .ctxmenu hr {
      border: 0;
      border-top: 1px solid rgba(255,255,255,0.1);
      margin: 4px 2px;
    }

    .rail-resize {
      position: fixed;
      left: calc(var(--deck-rail-w, 188px) - 3px);
      top: 0;
      bottom: 0;
      width: 6px;
      cursor: col-resize;
      z-index: 2147482600;
      touch-action: none;
    }
    .rail-resize:hover,
    .rail-resize[data-dragging] { background: rgba(255,255,255,0.12); }
    :host([no-rail]) .rail-resize,
    :host([noscale]) .rail-resize,
    .rail[data-presenting] + .rail-resize,
    .rail[data-user-hidden] + .rail-resize { display: none; }

    /* Delete-confirm popup — matches the SPA's ConfirmDialog layout
       (title + message body, depressed footer with Cancel / Delete). */
    .confirm-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.45);
      z-index: 2147483200;
      display: none;
      align-items: center;
      justify-content: center;
    }
    .confirm-backdrop[data-open] { display: flex; }
    .confirm {
      width: 320px;
      max-width: calc(100vw - 32px);
      background: #2a2a2a;
      color: #e8e8e8;
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 12px;
      box-shadow: 0 12px 32px rgba(0,0,0,0.5);
      overflow: hidden;
      font-family: inherit;
      animation: deck-confirm-in 0.18s ease;
    }
    @keyframes deck-confirm-in {
      from { opacity: 0; transform: scale(0.96); }
      to { opacity: 1; transform: scale(1); }
    }
    .confirm .body { padding: 20px 20px 16px; }
    .confirm .title { font-size: 14px; font-weight: 600; margin-bottom: 4px; }
    .confirm .msg { font-size: 13px; line-height: 1.5; color: rgba(255,255,255,0.65); }
    .confirm .footer {
      padding: 14px 20px;
      background: #1f1f1f;
      border-top: 1px solid rgba(255,255,255,0.08);
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    .confirm button {
      appearance: none;
      font: inherit;
      font-size: 13px;
      font-weight: 500;
      padding: 8px 16px;
      border-radius: 8px;
      cursor: pointer;
    }
    .confirm .cancel {
      background: transparent;
      border: 0;
      color: rgba(255,255,255,0.8);
    }
    .confirm .cancel:hover { background: rgba(255,255,255,0.08); }
    .confirm .danger {
      background: #c96442;
      border: 1px solid rgba(0,0,0,0.15);
      color: #fff;
      box-shadow: 0 1px 3px rgba(166,50,68,0.3), 0 2px 6px rgba(166,50,68,0.18);
    }
    .confirm .danger:hover { background: #b5563a; }

    /* ── Print: one page per slide, no chrome ────────────────────────────
       The screen layout stacks every slide at inset:0 inside a scaled
       canvas; for print we want them in document flow at the authored
       design size so the browser paginates one slide per sheet. The
       @page size is set from the width/height attributes via the inline
       <style id="deck-stage-print-page"> that _syncPrintPageRule appends
       to the document (the @page at-rule has no effect inside shadow DOM). */
    @media print {
      :host {
        position: static;
        inset: auto;
        background: none;
        overflow: visible;
        color: inherit;
      }
      .stage { position: static; display: block; }
      .canvas {
        transform: none !important;
        width: auto !important;
        height: auto !important;
        background: none;
        will-change: auto;
      }
      ::slotted(*) {
        position: relative !important;
        inset: auto !important;
        width: var(--deck-design-w) !important;
        height: var(--deck-design-h) !important;
        box-sizing: border-box !important;
        opacity: 1 !important;
        visibility: visible !important;
        pointer-events: auto;
        break-after: page;
        page-break-after: always;
        break-inside: avoid;
        overflow: hidden;
      }
      /* :last-child alone isn't enough once data-deck-skip hides the
         trailing slide(s) — the last *visible* slide still carries
         break-after:page and prints a blank sheet. _markLastVisible()
         maintains data-deck-last-visible on the last non-skipped slide. */
      ::slotted(*:last-child),
      ::slotted([data-deck-last-visible]) {
        break-after: auto;
        page-break-after: auto;
      }
      ::slotted([data-deck-skip]) { display: none !important; }
      .overlay, .rail, .rail-resize, .ctxmenu, .confirm-backdrop { display: none !important; }
    }
  `;
  class DeckStage extends HTMLElement {
    static get observedAttributes() {
      return ['width', 'height', 'noscale', 'no-rail'];
    }
    constructor() {
      super();
      this._root = this.attachShadow({
        mode: 'open'
      });
      this._index = 0;
      this._slides = [];
      this._notes = [];
      this._hideTimer = null;
      this._mouseIdleTimer = null;
      this._menuIndex = -1;
      this._onKey = this._onKey.bind(this);
      this._onResize = this._onResize.bind(this);
      this._onSlotChange = this._onSlotChange.bind(this);
      this._onMouseMove = this._onMouseMove.bind(this);
      this._onTap = this._onTap.bind(this);
      this._onMessage = this._onMessage.bind(this);
      // Capture-phase close so a click anywhere dismisses the menu, but
      // ignore clicks that land inside the menu itself — otherwise the
      // capture handler runs before the menu's own (bubble) handler and
      // clears _menuIndex out from under it.
      this._onDocClick = e => {
        if (this._menu && e.composedPath && e.composedPath().includes(this._menu)) return;
        this._closeMenu();
      };
    }
    get designWidth() {
      return parseInt(this.getAttribute('width'), 10) || DESIGN_W_DEFAULT;
    }
    get designHeight() {
      return parseInt(this.getAttribute('height'), 10) || DESIGN_H_DEFAULT;
    }
    connectedCallback() {
      // Presenter-view popup loads deckUrl?_snthumb=...#N for its prev/cur/
      // next thumbnails — the rail has no business rendering inside those
      // (wrong scale, and it offsets the stage so the thumb shows a gutter).
      if (/[?&]_snthumb=/.test(location.search)) this.setAttribute('no-rail', '');
      this._render();
      this._loadNotes();
      this._syncPrintPageRule();
      window.addEventListener('keydown', this._onKey);
      window.addEventListener('resize', this._onResize);
      window.addEventListener('mousemove', this._onMouseMove, {
        passive: true
      });
      window.addEventListener('message', this._onMessage);
      window.addEventListener('click', this._onDocClick, true);
      this.addEventListener('click', this._onTap);
      // Print lays every slide out as its own page, so [data-deck-active]-
      // gated entrance styles need the attribute on every slide (not just
      // the current one) or their content prints at the hidden base style.
      // The transient freeze style lands BEFORE the attributes so any
      // attribute-keyed transition fires at 0s (changing transition-
      // duration after a transition has started doesn't affect it).
      this._onBeforePrint = () => {
        this._syncPrintPageRule();
        if (this._freezeStyle) this._freezeStyle.remove();
        this._freezeStyle = document.createElement('style');
        this._freezeStyle.textContent = '*,*::before,*::after{transition-duration:0s !important}';
        document.head.appendChild(this._freezeStyle);
        this._slides.forEach(s => s.setAttribute('data-deck-active', ''));
      };
      this._onAfterPrint = () => {
        this._applyIndex({
          showOverlay: false,
          broadcast: false
        });
        if (this._freezeStyle) {
          this._freezeStyle.remove();
          this._freezeStyle = null;
        }
      };
      window.addEventListener('beforeprint', this._onBeforePrint);
      window.addEventListener('afterprint', this._onAfterPrint);
      // Initial collection + layout happens via slotchange, which fires on mount.
      this._enableRail();
      // Hold the stage hidden until webfonts are ready so the first visible
      // paint has the deck's real typography — the :not(:defined) guard in
      // the page HTML only covers custom-element upgrade, not font load.
      // Capped so a 404'd font URL can't blank the deck indefinitely.
      this.setAttribute('data-fonts-pending', '');
      const reveal = () => this.removeAttribute('data-fonts-pending');
      // rAF first: fonts.ready is a pre-resolved promise until layout has
      // resolved the slotted text's font-family and pushed a FontFace into
      // 'loading'. Reading it here in connectedCallback (parse-time) would
      // settle the race in a microtask before any font fetch starts.
      requestAnimationFrame(() => {
        Promise.race([document.fonts ? document.fonts.ready : Promise.resolve(), new Promise(r => setTimeout(r, 2000))]).then(reveal, reveal);
      });
    }
    _enableRail() {
      // Idempotent — older host builds still post __omelette_rail_enabled.
      // no-rail guard keeps the observers/stylesheet walk off the cheap path
      // for presenter-popup thumbnail iframes (up to 9 per view).
      if (this._railEnabled || this.hasAttribute('no-rail')) return;
      this._railEnabled = true;
      // Per-viewer preference — restored alongside rail width. Default on;
      // only a stored '0' (from the TweaksPanel toggle) hides it.
      this._railVisible = true;
      try {
        if (localStorage.getItem('deck-stage.railVisible') === '0') this._railVisible = false;
      } catch (e) {}
      // Live thumbnail updates: watch the light-DOM slides for content
      // edits and re-clone just the affected thumb(s), debounced. Ignore
      // the data-deck-* / data-screen-label / data-om-validate attributes
      // this component itself writes so nav doesn't trigger spurious
      // refreshes — except data-deck-skip, which now arrives from the host
      // re-render and is what updates the rail badge, print bookkeeping,
      // and deckSkipped re-broadcast.
      const OWN_ATTRS = /^data-(deck-(?!skip$)|screen-label$|om-validate$)/;
      this._liveDirty = new Set();
      this._liveObserver = new MutationObserver(records => {
        for (const r of records) {
          if (r.type === 'attributes' && OWN_ATTRS.test(r.attributeName || '')) continue;
          let n = r.target;
          while (n && n.parentElement !== this) n = n.parentElement;
          // Skip/unskip is handled below without re-cloning (the badge sits
          // on the thumb wrapper, not the clone) — don't mark the slide
          // dirty for an attr change whose only visible effect is the badge.
          if (n && this._slideSet && this._slideSet.has(n) && !(r.type === 'attributes' && r.attributeName === 'data-deck-skip')) {
            this._liveDirty.add(n);
          }
          // Host-driven skip toggle: sync the rail badge + print + presenter
          // skipped-list the way _toggleSkip used to do locally.
          if (r.type === 'attributes' && r.attributeName === 'data-deck-skip' && n && this._slideSet && this._slideSet.has(n)) {
            const i = this._slides.indexOf(n);
            if (this._thumbs && this._thumbs[i]) {
              if (n.hasAttribute('data-deck-skip')) this._thumbs[i].thumb.setAttribute('data-skip', '');else this._thumbs[i].thumb.removeAttribute('data-skip');
            }
            this._markLastVisible();
            try {
              window.postMessage({
                slideIndexChanged: this._index,
                deckTotal: this._slides.length,
                deckSkipped: this._skippedIndices()
              }, '*');
            } catch (e) {}
          }
        }
        if (this._liveDirty.size && !this._liveTimer) {
          this._liveTimer = setTimeout(() => {
            this._liveTimer = null;
            this._liveDirty.forEach(s => this._refreshThumb(s));
            this._liveDirty.clear();
          }, 200);
        }
      });
      this._liveObserver.observe(this, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true
      });
      // Lazy thumbnail materialization — clone the slide only when its
      // frame scrolls into (or near) the rail viewport. rootMargin gives
      // ~4 thumbs of pre-load so fast scrolling doesn't flash blanks.
      this._railObserver = new IntersectionObserver(entries => {
        entries.forEach(e => {
          if (e.isIntersecting && e.target.__deckThumb) {
            this._materialize(e.target.__deckThumb);
          }
        });
      }, {
        root: this._rail,
        rootMargin: '400px 0px'
      });
      // Tweaks typically change CSS vars / attrs OUTSIDE <deck-stage>
      // (on <html>, <body>, a wrapper div, or a <style> tag), which
      // _liveObserver can't see. Re-snapshot author CSS (constructable
      // sheet is shared by reference, so one replaceSync updates every
      // thumb shadow root) and re-sync each thumb host's attrs + custom
      // properties. In-slide DOM mutations are _liveObserver's job.
      // Debounced so slider drags don't thrash.
      this._onTweakChange = () => {
        clearTimeout(this._tweakTimer);
        this._tweakTimer = setTimeout(() => {
          this._snapshotAuthorCss();
          // One getComputedStyle for the whole batch — each
          // getPropertyValue read below reuses the same computed style
          // as long as nothing invalidates layout between thumbs.
          const cs = getComputedStyle(this);
          (this._thumbs || []).forEach(t => {
            if (t.host) this._syncThumbHostAttrs(t.host, cs);
          });
        }, 120);
      };
      window.addEventListener('tweakchange', this._onTweakChange);
      this._snapshotAuthorCss();
      // Build the rail now that it's enabled — slotchange already fired,
      // so _renderRail's early-return skipped the initial build.
      this._syncRailHidden();
      this._renderRail();
      this._fit();
    }

    /** Snapshot document stylesheets into a constructable sheet that each
     *  thumbnail's nested shadow root adopts — so author CSS styles the
     *  cloned slide content without touching this component's chrome.
     *  Cross-origin sheets throw on .cssRules — skip them. Re-callable:
     *  the existing constructable sheet is reused via replaceSync so every
     *  already-adopted shadow root picks up the fresh CSS without re-adopt. */
    _snapshotAuthorCss() {
      // :root in an adopted sheet inside a shadow root matches nothing
      // (only the document root qualifies), so author rules like
      // `:root[data-voice="modern"] .serif` never reach the clones.
      // Rewrite :root → :host and mirror <html>'s data-*/class/lang onto
      // each thumb host (see _syncThumbHostAttrs) so the same selectors
      // match inside the thumbnail's shadow tree.
      const authorCss = Array.from(document.styleSheets).map(sh => {
        try {
          return Array.from(sh.cssRules).map(r => r.cssText).join('\n');
        } catch (e) {
          return '';
        }
      }).join('\n')
      // The shadow host is featureless outside the functional :host(...)
      // form, so any compound on :root — [attr], .class, #id, :pseudo —
      // must become :host(<compound>) not :host<compound>. Same for the
      // html type selector (Tailwind class-strategy dark mode emits
      // html.dark; Pico uses html[data-theme]), which has nothing to
      // match inside the thumb's shadow tree.
      .replace(/:root((?:\[[^\]]*\]|[.#][-\w]+|:[-\w]+(?:\([^)]*\))?)+)/g, ':host($1)').replace(/:root\b/g, ':host').replace(/(^|[\s,>~+(}])html((?:\[[^\]]*\]|[.#][-\w]+|:[-\w]+(?:\([^)]*\))?)+)(?![-\w])/g, '$1:host($2)').replace(/(^|[\s,>~+(}])html(?![-\w])/g, '$1:host');
      // Every custom property the author references. _syncThumbHostAttrs
      // mirrors each one's *computed* value at <deck-stage> onto the
      // thumb host so the live value wins over the :host default above
      // regardless of which ancestor the tweak wrote to (<html>, <body>,
      // a wrapper div, or the deck-stage element itself all inherit
      // down to getComputedStyle(this)).
      this._authorVars = new Set(authorCss.match(/--[\w-]+/g) || []);
      try {
        if (!this._adoptedSheet) this._adoptedSheet = new CSSStyleSheet();
        this._adoptedSheet.replaceSync(authorCss);
      } catch (e) {
        this._adoptedSheet = null;
        this._authorCss = authorCss;
      }
    }
    _syncThumbHostAttrs(host, cs) {
      const de = document.documentElement;
      // setAttribute overwrites but can't delete — an attr removed from
      // <html> (toggleAttribute off, classList emptied) would linger on
      // the host and :host([data-*]) / :host(.foo) rules would keep
      // matching. Remove stale mirrored attrs first; iterate backward
      // because removeAttribute mutates the live NamedNodeMap.
      for (let i = host.attributes.length - 1; i >= 0; i--) {
        const n = host.attributes[i].name;
        if ((n.startsWith('data-') || n === 'class' || n === 'lang') && !de.hasAttribute(n)) {
          host.removeAttribute(n);
        }
      }
      for (const a of de.attributes) {
        if (a.name.startsWith('data-') || a.name === 'class' || a.name === 'lang') {
          host.setAttribute(a.name, a.value);
        }
      }
      // The :root→:host rewrite in _snapshotAuthorCss pins each custom
      // property to its stylesheet default on the thumb host, shadowing
      // the live value that would otherwise inherit. Tweaks can write the
      // live value on any ancestor — <html>, <body>, a wrapper div, the
      // deck-stage element — so read it as the *computed* value at
      // <deck-stage> (which sees the whole inheritance chain) rather than
      // trying to guess which element the author wrote to. Inline on the
      // host beats the :host{} rule. remove-stale covers vars dropped
      // from the stylesheet between snapshots.
      const vars = this._authorVars || new Set();
      for (let i = host.style.length - 1; i >= 0; i--) {
        const p = host.style[i];
        if (p.startsWith('--') && !vars.has(p)) host.style.removeProperty(p);
      }
      const live = cs || getComputedStyle(this);
      vars.forEach(p => {
        const v = live.getPropertyValue(p);
        if (v) host.style.setProperty(p, v.trim());else host.style.removeProperty(p);
      });
    }
    disconnectedCallback() {
      window.removeEventListener('keydown', this._onKey);
      window.removeEventListener('resize', this._onResize);
      window.removeEventListener('mousemove', this._onMouseMove);
      window.removeEventListener('message', this._onMessage);
      window.removeEventListener('click', this._onDocClick, true);
      window.removeEventListener('beforeprint', this._onBeforePrint);
      window.removeEventListener('afterprint', this._onAfterPrint);
      if (this._freezeStyle) {
        this._freezeStyle.remove();
        this._freezeStyle = null;
      }
      this.removeEventListener('click', this._onTap);
      if (this._hideTimer) clearTimeout(this._hideTimer);
      if (this._mouseIdleTimer) clearTimeout(this._mouseIdleTimer);
      if (this._liveTimer) clearTimeout(this._liveTimer);
      if (this._tweakTimer) clearTimeout(this._tweakTimer);
      if (this._railAnimTimer) clearTimeout(this._railAnimTimer);
      if (this._scaleRaf) cancelAnimationFrame(this._scaleRaf);
      if (this._liveObserver) this._liveObserver.disconnect();
      if (this._railObserver) this._railObserver.disconnect();
      if (this._onTweakChange) window.removeEventListener('tweakchange', this._onTweakChange);
    }
    attributeChangedCallback() {
      if (this._canvas) {
        this._canvas.style.width = this.designWidth + 'px';
        this._canvas.style.height = this.designHeight + 'px';
        this._canvas.style.setProperty('--deck-design-w', this.designWidth + 'px');
        this._canvas.style.setProperty('--deck-design-h', this.designHeight + 'px');
        if (this._rail) {
          this._rail.style.setProperty('--deck-aspect', this.designWidth + '/' + this.designHeight);
        }
        this._fit();
        this._scaleThumbs();
        this._syncPrintPageRule();
      }
    }
    _render() {
      const style = document.createElement('style');
      style.textContent = stylesheet;
      const stage = document.createElement('div');
      stage.className = 'stage';
      const canvas = document.createElement('div');
      canvas.className = 'canvas';
      canvas.style.width = this.designWidth + 'px';
      canvas.style.height = this.designHeight + 'px';
      canvas.style.setProperty('--deck-design-w', this.designWidth + 'px');
      canvas.style.setProperty('--deck-design-h', this.designHeight + 'px');
      const slot = document.createElement('slot');
      slot.addEventListener('slotchange', this._onSlotChange);
      canvas.appendChild(slot);
      stage.appendChild(canvas);

      // Overlay: compact, solid black, with clickable controls.
      const overlay = document.createElement('div');
      overlay.className = 'overlay export-hidden';
      overlay.setAttribute('role', 'toolbar');
      overlay.setAttribute('aria-label', 'Deck controls');
      overlay.setAttribute('data-omelette-chrome', '');
      overlay.innerHTML = `
        <button class="btn prev" type="button" aria-label="Previous slide" title="Previous (←)">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3L5 8l5 5"/></svg>
        </button>
        <span class="count" aria-live="polite"><span class="current">1</span><span class="sep">/</span><span class="total">1</span></span>
        <button class="btn next" type="button" aria-label="Next slide" title="Next (→)">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3l5 5-5 5"/></svg>
        </button>
        <span class="divider"></span>
        <button class="btn reset" type="button" aria-label="Reset to first slide" title="Reset (R)">Reset<span class="kbd">R</span></button>
      `;
      overlay.querySelector('.prev').addEventListener('click', () => this._advance(-1, 'click'));
      overlay.querySelector('.next').addEventListener('click', () => this._advance(1, 'click'));
      overlay.querySelector('.reset').addEventListener('click', () => this._go(0, 'click'));

      // Thumbnail rail + context menu. Thumbnails are populated in
      // _renderRail() after _collectSlides().
      const rail = document.createElement('div');
      rail.className = 'rail export-hidden';
      rail.setAttribute('data-omelette-chrome', '');
      // Edit mode hooks wheel to pan the canvas; this opts the rail's own
      // scrollview out so thumbnails stay scrollable while editing.
      rail.setAttribute('data-dc-wheel-passthru', '');
      rail.style.setProperty('--deck-aspect', this.designWidth + '/' + this.designHeight);
      // Edge auto-scroll while dragging a thumb near the rail's top/bottom
      // so off-screen drop targets are reachable. Native dragover fires
      // continuously while the pointer is stationary, so a per-event nudge
      // (ramped by edge proximity) is enough — no rAF loop needed.
      rail.addEventListener('dragover', e => {
        if (this._dragFrom == null) return;
        const r = rail.getBoundingClientRect();
        const EDGE = 40;
        const dt = e.clientY - r.top;
        const db = r.bottom - e.clientY;
        if (dt < EDGE) rail.scrollTop -= Math.ceil((EDGE - dt) / 3);else if (db < EDGE) rail.scrollTop += Math.ceil((EDGE - db) / 3);
      });
      const menu = document.createElement('div');
      menu.className = 'ctxmenu export-hidden';
      menu.setAttribute('data-omelette-chrome', '');
      menu.innerHTML = `
        <button type="button" data-act="skip">Skip slide</button>
        <button type="button" data-act="up">Move up</button>
        <button type="button" data-act="down">Move down</button>
        <button type="button" data-act="duplicate">Duplicate slide</button>
        <hr>
        <button type="button" data-act="delete">Delete slide</button>
      `;
      menu.addEventListener('click', e => {
        const act = e.target && e.target.getAttribute && e.target.getAttribute('data-act');
        if (!act) return;
        const i = this._menuIndex;
        this._closeMenu();
        if (act === 'skip') this._toggleSkip(i);else if (act === 'up') this._moveSlide(i, i - 1);else if (act === 'down') this._moveSlide(i, i + 1);else if (act === 'duplicate') this._duplicateSlide(i);else if (act === 'delete') this._openConfirm(i);
      });
      menu.addEventListener('contextmenu', e => e.preventDefault());

      // Rail resize handle — drag to set --deck-rail-w, persisted to
      // localStorage so the width survives reloads.
      const resize = document.createElement('div');
      resize.className = 'rail-resize export-hidden';
      resize.setAttribute('data-omelette-chrome', '');
      resize.addEventListener('pointerdown', e => {
        e.preventDefault();
        resize.setPointerCapture(e.pointerId);
        resize.setAttribute('data-dragging', '');
        const move = ev => this._setRailWidth(ev.clientX);
        const up = () => {
          resize.removeEventListener('pointermove', move);
          resize.removeEventListener('pointerup', up);
          resize.removeEventListener('pointercancel', up);
          resize.removeAttribute('data-dragging');
          try {
            localStorage.setItem('deck-stage.railWidth', String(this._railPx));
          } catch (err) {}
        };
        resize.addEventListener('pointermove', move);
        resize.addEventListener('pointerup', up);
        resize.addEventListener('pointercancel', up);
      });

      // Delete-confirm dialog — mirrors the SPA's ConfirmDialog layout.
      const confirm = document.createElement('div');
      confirm.className = 'confirm-backdrop export-hidden';
      confirm.setAttribute('data-omelette-chrome', '');
      confirm.innerHTML = `
        <div class="confirm" role="dialog" aria-modal="true">
          <div class="body">
            <div class="title">Delete slide?</div>
            <div class="msg">This slide will be removed from the deck.</div>
          </div>
          <div class="footer">
            <button type="button" class="cancel">Cancel</button>
            <button type="button" class="danger">Delete</button>
          </div>
        </div>
      `;
      confirm.addEventListener('click', e => {
        if (e.target === confirm) this._closeConfirm();
      });
      confirm.querySelector('.cancel').addEventListener('click', () => this._closeConfirm());
      confirm.querySelector('.danger').addEventListener('click', () => {
        const i = this._confirmIndex;
        this._closeConfirm();
        this._deleteSlide(i);
      });
      this._root.append(style, rail, resize, stage, overlay, menu, confirm);
      this._canvas = canvas;
      this._stage = stage;
      this._slot = slot;
      this._overlay = overlay;
      this._rail = rail;
      this._resize = resize;
      this._menu = menu;
      this._confirm = confirm;
      this._countEl = overlay.querySelector('.current');
      this._totalEl = overlay.querySelector('.total');

      // Restore persisted rail width.
      let rw = 188;
      try {
        const s = localStorage.getItem('deck-stage.railWidth');
        if (s) rw = parseInt(s, 10) || rw;
      } catch (err) {}
      this._setRailWidth(rw);
      this._syncRailHidden();
    }
    _setRailWidth(px) {
      const w = Math.max(120, Math.min(360, Math.round(px)));
      this._railPx = w;
      this.style.setProperty('--deck-rail-w', w + 'px');
      this._fit();
      // _scaleThumbs forces a sync layout (frame.offsetWidth) then writes
      // N transforms. During a resize drag this runs per-pointermove;
      // coalesce to one per frame.
      if (!this._scaleRaf) {
        this._scaleRaf = requestAnimationFrame(() => {
          this._scaleRaf = null;
          this._scaleThumbs();
        });
      }
    }

    /** @page must live in the document stylesheet — it's a no-op inside
     *  shadow DOM. (Re-)append so any author @page landing later in
     *  source order can't reintroduce a margin and push each slide onto
     *  two sheets; called again from beforeprint. */
    _syncPrintPageRule() {
      const id = 'deck-stage-print-page';
      let tag = document.getElementById(id);
      if (!tag) {
        tag = document.createElement('style');
        tag.id = id;
      }
      (document.body || document.head).appendChild(tag);
      tag.textContent = '@page { size: ' + this.designWidth + 'px ' + this.designHeight + 'px; margin: 0; } ' + '@media print { html, body { margin: 0 !important; padding: 0 !important; background: none !important; overflow: visible !important; height: auto !important; } ' + '* { -webkit-print-color-adjust: exact; print-color-adjust: exact; } ' +
      // Jump authored animations/transitions to their end state so print
      // never captures mid-entrance — pairs with the beforeprint handler
      // in connectedCallback that sets data-deck-active on every slide.
      '*, *::before, *::after { animation-delay: -99s !important; animation-duration: .001s !important; ' + 'animation-iteration-count: 1 !important; animation-fill-mode: both !important; ' + 'animation-play-state: running !important; transition-duration: 0s !important; } }';
    }
    _onSlotChange() {
      // Self-mutate path already reconciled synchronously and emitted
      // slidechange; skip the async slotchange it caused.
      if (this._squelchSlotChange) {
        this._squelchSlotChange = false;
        return;
      }
      // Primary lock-clear is the host's __deck_rail_ack; this clears on a
      // dropped ack so the rail can't stay dead.
      this._railLock = false;
      this._collectSlides();
      this._restoreIndex();
      this._applyIndex({
        showOverlay: false,
        broadcast: true,
        reason: 'init'
      });
      this._fit();
    }
    _collectSlides() {
      const assigned = this._slot.assignedElements({
        flatten: true
      });
      this._slides = assigned.filter(el => {
        // Skip template/style/script nodes even if someone slots them.
        const tag = el.tagName;
        return tag !== 'TEMPLATE' && tag !== 'SCRIPT' && tag !== 'STYLE';
      });
      this._slideSet = new Set(this._slides);
      this._slides.forEach((slide, i) => {
        const n = i + 1;
        slide.setAttribute('data-screen-label', `${pad2(n)} ${getSlideLabel(slide)}`);

        // Validation attribute for comment flow / auto-checks.
        if (!slide.hasAttribute('data-om-validate')) {
          slide.setAttribute('data-om-validate', VALIDATE_ATTR);
        }
        slide.setAttribute('data-deck-slide', String(i));
      });
      if (this._totalEl) this._totalEl.textContent = String(this._slides.length || 1);
      if (this._index >= this._slides.length) this._index = Math.max(0, this._slides.length - 1);
      this._markLastVisible();
      this._renderRail();
    }

    /** Tag the last non-skipped slide so print CSS can drop its
     *  break-after (see the @media print comment above — :last-child
     *  alone matches a hidden skipped slide). */
    _markLastVisible() {
      let last = null;
      this._slides.forEach(s => {
        s.removeAttribute('data-deck-last-visible');
        if (!s.hasAttribute('data-deck-skip')) last = s;
      });
      if (last) last.setAttribute('data-deck-last-visible', '');
    }
    _loadNotes() {
      // Per-slide data-speaker-notes is authoritative when present (attrs
      // travel with the element on reorder/dup/delete); a slide without
      // the attr falls through to the legacy #speaker-notes JSON array
      // PER SLIDE so a single attr on a JSON-authored deck doesn't blank
      // the rest.
      const tag = document.getElementById('speaker-notes');
      let json = null;
      if (tag) try {
        const p = JSON.parse(tag.textContent || '[]');
        if (Array.isArray(p)) json = p;
      } catch (e) {
        console.warn('[deck-stage] Failed to parse #speaker-notes JSON:', e);
      }
      this._notes = this._slides.map((s, i) => {
        const a = s.getAttribute('data-speaker-notes');
        return a !== null ? a : json && typeof json[i] === 'string' ? json[i] : '';
      });
    }
    _restoreIndex() {
      // The host's ?slide= param is delivered as a #<int> hash (1-indexed) on
      // the iframe src. No hash → slide 1; the deck itself keeps no position
      // state across loads.
      const h = (location.hash || '').match(/^#(\d+)$/);
      if (h) {
        const n = parseInt(h[1], 10) - 1;
        if (n >= 0 && n < this._slides.length) this._index = n;
      }
    }
    _applyIndex({
      showOverlay = true,
      broadcast = true,
      reason = 'init'
    } = {}) {
      if (!this._slides.length) return;
      const prev = this._prevIndex == null ? -1 : this._prevIndex;
      const curr = this._index;
      // Keep the iframe's own hash in sync so an in-iframe location.reload()
      // (reload banner path in viewer-handle.ts) lands on the current slide,
      // not the stale deep-link hash from initial load.
      try {
        history.replaceState(null, '', '#' + (curr + 1));
      } catch (e) {}
      this._slides.forEach((s, i) => {
        if (i === curr) s.setAttribute('data-deck-active', '');else s.removeAttribute('data-deck-active');
      });
      if (this._countEl) this._countEl.textContent = String(curr + 1);
      // Follow-scroll on every navigation (init deep-link, keyboard, click,
      // tap, external goTo) — the only time we *don't* want the rail to
      // track current is after a rail-internal mutation, where _renderRail
      // has already restored the user's scroll position and yanking back to
      // current would undo it.
      this._syncRail(reason !== 'mutation');
      if (broadcast) {
        // (1) Legacy: host-window postMessage for speaker-notes renderers.
        try {
          window.postMessage({
            slideIndexChanged: curr,
            deckTotal: this._slides.length,
            deckSkipped: this._skippedIndices()
          }, '*');
        } catch (e) {}

        // (2) In-page CustomEvent on the <deck-stage> element itself.
        //     Bubbles and composes out of shadow DOM so slide code can listen:
        //       document.querySelector('deck-stage').addEventListener('slidechange', e => {
        //         e.detail.index, e.detail.previousIndex, e.detail.total, e.detail.slide, e.detail.reason
        //       });
        const detail = {
          index: curr,
          previousIndex: prev,
          total: this._slides.length,
          slide: this._slides[curr] || null,
          previousSlide: prev >= 0 ? this._slides[prev] || null : null,
          reason: reason // 'init' | 'keyboard' | 'click' | 'tap' | 'api'
        };
        this.dispatchEvent(new CustomEvent('slidechange', {
          detail,
          bubbles: true,
          composed: true
        }));
      }
      this._prevIndex = curr;
      if (showOverlay) this._flashOverlay();
    }
    _flashOverlay() {
      // Host posts __omelette_presenting while in fullscreen/tab presentation
      // mode — suppress the nav footer entirely (both hover and slide-change
      // flash) so the audience sees clean slides.
      if (!this._overlay || this._presenting) return;
      this._overlay.setAttribute('data-visible', '');
      if (this._hideTimer) clearTimeout(this._hideTimer);
      this._hideTimer = setTimeout(() => {
        this._overlay.removeAttribute('data-visible');
      }, OVERLAY_HIDE_MS);
    }
    _railWidth() {
      // State-based, no offsetWidth: the first _fit() can run before the
      // rail has had layout on some load paths, and a 0 there paints the
      // slide full-width for one frame before the post-slotchange _fit()
      // corrects it.
      if (!this._railEnabled || !this._railVisible || this.hasAttribute('no-rail') || this.hasAttribute('noscale') || this._presenting || this._previewMode || NARROW_MQ.matches) return 0;
      return this._railPx || 0;
    }
    _fit() {
      if (!this._canvas) return;
      const stage = this._canvas.parentElement;
      // PPTX export sets noscale so the DOM capture sees authored-size
      // geometry — the scaled canvas is in shadow DOM, so the exporter's
      // resetTransformSelector can't reach .canvas.style.transform directly.
      if (this.hasAttribute('noscale')) {
        this._canvas.style.transform = 'none';
        if (stage) stage.style.left = '0';
        if (this._overlay) this._overlay.style.marginLeft = '0';
        return;
      }
      const rw = this._railWidth();
      if (stage) stage.style.left = rw + 'px';
      // Overlay is centred on the viewport via left:50% + translate(-50%);
      // marginLeft shifts the centre by rw/2 so it lands in the middle of
      // the [rw, innerWidth] stage region.
      if (this._overlay) this._overlay.style.marginLeft = rw / 2 + 'px';
      const vw = window.innerWidth - rw;
      const vh = window.innerHeight;
      const s = Math.min(vw / this.designWidth, vh / this.designHeight);
      this._canvas.style.transform = `scale(${s})`;
    }
    _onResize() {
      this._fit();
      // Crossing the narrow-viewport breakpoint reveals the rail — rerun the
      // thumbnail scale the same way _setRailWidth does.
      if (!this._scaleRaf) {
        this._scaleRaf = requestAnimationFrame(() => {
          this._scaleRaf = null;
          this._scaleThumbs();
        });
      }
    }
    _onMouseMove() {
      // Keep overlay visible while mouse moves; hide after idle.
      this._flashOverlay();
    }
    _onMessage(e) {
      const d = e.data;
      if (d && typeof d.__omelette_presenting === 'boolean') {
        this._presenting = d.__omelette_presenting;
        if (this._presenting && this._overlay) {
          this._overlay.removeAttribute('data-visible');
          if (this._hideTimer) clearTimeout(this._hideTimer);
        }
        this._syncRailHidden();
        this._closeMenu();
        this._closeConfirm();
        this._fit();
        this._scaleThumbs();
      }
      // Host's Preview segment (ViewerMode='none'): the rail's drag-reorder /
      // right-click skip-delete affordances are editing chrome, so hide it
      // while the user is just looking at the deck. Same hard-hide path as
      // presenting; independent of the user's _railVisible preference so
      // returning to Edit restores whatever they had.
      if (d && typeof d.__omelette_preview_mode === 'boolean') {
        if (d.__omelette_preview_mode === this._previewMode) return;
        this._previewMode = d.__omelette_preview_mode;
        this._syncRailHidden();
        this._closeMenu();
        this._closeConfirm();
        this._fit();
        this._scaleThumbs();
      }
      // Host has processed a dc-op; rail input is safe again. Not tied to
      // slotchange — setAttr and refusal don't fire one. On refusal,
      // revert the optimistic _index/hash adjustment so the next nav
      // starts from what's actually on screen.
      if (d && d.__dc_op_ack) {
        this._railLock = false;
        if (d.applied === false && this._indexBeforeEmit != null) {
          this._index = this._indexBeforeEmit;
          try {
            history.replaceState(null, '', '#' + (this._index + 1));
          } catch (e) {}
        }
        this._indexBeforeEmit = null;
      }
      // Per-viewer show/hide, driven by the TweaksPanel's auto-injected
      // "Thumbnail rail" toggle (or any author script). Independent of
      // whether the Tweaks panel itself is open — closing the panel
      // doesn't change rail visibility. Persists alongside rail width.
      if (d && d.type === '__deck_rail_visible' && typeof d.on === 'boolean') {
        if (d.on === this._railVisible) return;
        this._railVisible = d.on;
        try {
          localStorage.setItem('deck-stage.railVisible', d.on ? '1' : '0');
        } catch (e) {}
        // Arm the transition, commit it, then flip state — otherwise the
        // browser coalesces both writes and nothing animates on show.
        this.setAttribute('data-rail-anim', '');
        void (this._rail && this._rail.offsetHeight);
        this._syncRailHidden();
        this._fit();
        this._scaleThumbs();
        clearTimeout(this._railAnimTimer);
        this._railAnimTimer = setTimeout(() => this.removeAttribute('data-rail-anim'), 220);
      }
      if (d && d.type === '__omelette_rail_enabled') this._enableRail();
    }
    _syncRailHidden() {
      if (!this._rail) return;
      // data-presenting is the hard hide (display:none) for flag-off,
      // presentation mode, and the host's Preview segment — instant, no
      // transition. data-user-hidden is the soft hide (translateX(-100%))
      // for the viewer's rail toggle, so show/hide slides under
      // :host([data-rail-anim]).
      const hard = !this._railEnabled || this._presenting || this._previewMode;
      if (hard) this._rail.setAttribute('data-presenting', '');else this._rail.removeAttribute('data-presenting');
      if (!this._railVisible) this._rail.setAttribute('data-user-hidden', '');else this._rail.removeAttribute('data-user-hidden');
      // translateX hide leaves thumbs (tabIndex=0) in the tab order —
      // inert keeps them unfocusable while the rail is off-screen.
      this._rail.inert = hard || !this._railVisible;
    }
    _onTap(e) {
      // Touch-only — keyboard + the overlay toolbar cover nav on desktop.
      if (FINE_POINTER_MQ.matches) return;
      // Only taps that land on the stage (slide content or letterbox); the
      // overlay / rail / menus are siblings with their own click handlers.
      const path = e.composedPath();
      if (!this._stage || !path.includes(this._stage)) return;
      // Let interactive slide content keep the tap. composedPath (not
      // e.target.closest) so we see through open shadow roots — a <button>
      // inside a slide-authored custom element retargets e.target to the
      // host but still appears in the composed path.
      if (e.defaultPrevented) return;
      for (const n of path) {
        if (n === this._stage) break;
        if (n.matches && n.matches(INTERACTIVE_SEL)) return;
      }
      e.preventDefault();
      const rw = this._railWidth();
      const mid = rw + (window.innerWidth - rw) / 2;
      this._advance(e.clientX < mid ? -1 : 1, 'tap');
    }
    _onKey(e) {
      // Ignore when the user is typing.
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      // Confirm dialog swallows nav keys while open; Escape cancels. Enter
      // is left to the focused button's native activation so Tab→Cancel
      // →Enter activates Cancel, not the window-level confirm path.
      if (this._confirm && this._confirm.hasAttribute('data-open')) {
        if (e.key === 'Escape') {
          this._closeConfirm();
          e.preventDefault();
        }
        return;
      }
      if (e.key === 'Escape' && this._menu && this._menu.hasAttribute('data-open')) {
        this._closeMenu();
        e.preventDefault();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key;
      let handled = true;
      if (key === 'ArrowRight' || key === 'PageDown' || key === ' ' || key === 'Spacebar') {
        this._advance(1, 'keyboard');
      } else if (key === 'ArrowLeft' || key === 'PageUp') {
        this._advance(-1, 'keyboard');
      } else if (key === 'Home') {
        this._go(0, 'keyboard');
      } else if (key === 'End') {
        this._go(this._slides.length - 1, 'keyboard');
      } else if (key === 'r' || key === 'R') {
        this._go(0, 'keyboard');
      } else if (/^[0-9]$/.test(key)) {
        // 1..9 jump to that slide; 0 jumps to 10.
        const n = key === '0' ? 9 : parseInt(key, 10) - 1;
        if (n < this._slides.length) this._go(n, 'keyboard');
      } else {
        handled = false;
      }
      if (handled) {
        e.preventDefault();
        this._flashOverlay();
      }
    }
    _go(i, reason = 'api') {
      if (!this._slides.length) return;
      const clamped = Math.max(0, Math.min(this._slides.length - 1, i));
      if (clamped === this._index) {
        this._flashOverlay();
        return;
      }
      this._index = clamped;
      this._applyIndex({
        showOverlay: true,
        broadcast: true,
        reason
      });
    }

    /** Step forward/back skipping any slide marked data-deck-skip. Falls
     *  back to _go's clamp-at-ends behaviour (flash overlay) when there's
     *  nothing further in that direction. */
    _advance(dir, reason) {
      if (!this._slides.length) return;
      let i = this._index + dir;
      while (i >= 0 && i < this._slides.length && this._slides[i].hasAttribute('data-deck-skip')) {
        i += dir;
      }
      if (i < 0 || i >= this._slides.length) {
        this._flashOverlay();
        return;
      }
      this._go(i, reason);
    }

    // ── Thumbnail rail ────────────────────────────────────────────────────
    //
    // Thumbs are keyed by slide element and reused across _renderRail()
    // calls, so a reorder/delete is an O(changed) DOM shuffle instead of an
    // O(N) teardown-and-re-clone. Each thumb starts as a lightweight shell
    // (num + empty frame); the clone is materialized lazily by an
    // IntersectionObserver when the frame scrolls into (or near) view, so
    // only visible-ish slides pay the clone + image-decode cost.

    _renderRail() {
      if (!this._rail || !this._railEnabled) {
        this._thumbs = [];
        return;
      }
      // FLIP: record each *materialized* thumb's top before the reconcile.
      // Off-screen (non-materialized) thumbs don't need the animation and
      // skipping their getBoundingClientRect saves a forced layout per
      // off-screen thumb on large decks.
      const prevTops = new Map();
      (this._thumbs || []).forEach(({
        thumb,
        slide,
        host
      }) => {
        if (host) prevTops.set(slide, thumb.getBoundingClientRect().top);
      });
      const st = this._rail.scrollTop;

      // Reconcile: reuse thumbs that already exist for a slide, create
      // shells for new slides, drop thumbs for removed slides.
      const bySlide = new Map();
      (this._thumbs || []).forEach(t => bySlide.set(t.slide, t));
      const next = [];
      this._slides.forEach(slide => {
        let t = bySlide.get(slide);
        if (t) bySlide.delete(slide);else t = this._makeThumb(slide);
        next.push(t);
      });
      // Orphans — slides removed since last render.
      bySlide.forEach(t => {
        if (this._railObserver) this._railObserver.unobserve(t.frame);
        t.thumb.remove();
      });
      // Put thumbs into document order to match _slides. insertBefore on
      // an already-correctly-placed node is a no-op, so this is cheap
      // when nothing moved.
      next.forEach((t, i) => {
        const want = t.thumb;
        const at = this._rail.children[i];
        if (at !== want) this._rail.insertBefore(want, at || null);
        t.i = i;
        t.num.textContent = String(i + 1);
        if (t.slide.hasAttribute('data-deck-skip')) t.thumb.setAttribute('data-skip', '');else t.thumb.removeAttribute('data-skip');
      });
      this._thumbs = next;
      this._rail.scrollTop = st;
      if (prevTops.size) {
        const moved = [];
        this._thumbs.forEach(({
          thumb,
          slide
        }) => {
          const old = prevTops.get(slide);
          if (old == null) return;
          const dy = old - thumb.getBoundingClientRect().top;
          if (Math.abs(dy) < 1) return;
          thumb.style.transition = 'none';
          thumb.style.transform = `translateY(${dy}px)`;
          moved.push(thumb);
        });
        if (moved.length) {
          // Commit the inverted positions before flipping the transition
          // on — otherwise the browser coalesces both style writes and
          // nothing animates.
          void this._rail.offsetHeight;
          moved.forEach(t => {
            t.style.transition = 'transform 180ms cubic-bezier(.2,.7,.3,1)';
            t.style.transform = '';
          });
          setTimeout(() => moved.forEach(t => {
            t.style.transition = '';
          }), 220);
        }
      }
      requestAnimationFrame(() => this._scaleThumbs());
      this._syncRail(false);
    }

    /** Create a lightweight thumb shell for one slide. The clone is
     *  materialized later by the IntersectionObserver. Event handlers
     *  look up the thumb's *current* index (via _thumbs.indexOf) so the
     *  same element can be reused across reorders. */
    _makeThumb(slide) {
      const thumb = document.createElement('div');
      thumb.className = 'thumb';
      thumb.tabIndex = 0;
      const num = document.createElement('div');
      num.className = 'num';
      const frame = document.createElement('div');
      frame.className = 'frame';
      thumb.append(num, frame);
      const entry = {
        thumb,
        num,
        frame,
        slide,
        clone: null,
        host: null,
        i: -1
      };
      // entry.i is refreshed on every _renderRail reconcile pass, so
      // handlers read the thumb's current position without an O(N) scan.
      const idx = () => entry.i;
      thumb.addEventListener('click', () => this._go(idx(), 'click'));
      // ↑/↓ step through the rail when a thumb has focus. _go clamps at the
      // ends and _applyIndex→_syncRail scrolls the new current thumb into
      // view; we move focus to it (preventScroll — _syncRail already
      // scrolled) so a held key walks the whole list. stopPropagation keeps
      // this out of the window-level _onKey nav handler.
      thumb.addEventListener('keydown', e => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        e.preventDefault();
        e.stopPropagation();
        this._go(idx() + (e.key === 'ArrowDown' ? 1 : -1), 'keyboard');
        const cur = this._thumbs && this._thumbs[this._index];
        if (cur) cur.thumb.focus({
          preventScroll: true
        });
      });
      thumb.addEventListener('contextmenu', e => {
        e.preventDefault();
        this._openMenu(idx(), e.clientX, e.clientY);
      });
      thumb.draggable = true;
      thumb.addEventListener('dragstart', e => {
        this._dragFrom = idx();
        thumb.setAttribute('data-dragging', '');
        e.dataTransfer.effectAllowed = 'move';
        try {
          e.dataTransfer.setData('text/plain', String(this._dragFrom));
        } catch (err) {}
      });
      thumb.addEventListener('dragend', () => {
        thumb.removeAttribute('data-dragging');
        this._clearDrop();
        this._dragFrom = null;
      });
      thumb.addEventListener('dragover', e => {
        if (this._dragFrom == null) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const r = thumb.getBoundingClientRect();
        this._setDrop(idx(), e.clientY < r.top + r.height / 2 ? 'before' : 'after');
      });
      thumb.addEventListener('drop', e => {
        if (this._dragFrom == null) return;
        e.preventDefault();
        const i = idx();
        const r = thumb.getBoundingClientRect();
        let to = e.clientY >= r.top + r.height / 2 ? i + 1 : i;
        if (this._dragFrom < to) to--;
        const from = this._dragFrom;
        this._clearDrop();
        this._dragFrom = null;
        if (to !== from) this._moveSlide(from, to);
      });
      if (this._railObserver) this._railObserver.observe(frame);
      frame.__deckThumb = entry;
      return entry;
    }

    /** Lazily build the clone for a thumb that has scrolled into view. */
    _materialize(entry) {
      if (entry.host) return;
      const dw = this.designWidth,
        dh = this.designHeight;
      let clone = entry.slide.cloneNode(true);
      clone.removeAttribute('id');
      clone.removeAttribute('data-deck-active');
      clone.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
      // Neuter heavy media; replace <video> with its poster so the box
      // keeps a visual. <iframe>/<audio> become empty placeholders.
      clone.querySelectorAll('iframe, audio, object, embed').forEach(el => {
        el.removeAttribute('src');
        el.removeAttribute('srcdoc');
        el.removeAttribute('data');
        el.innerHTML = '';
      });
      clone.querySelectorAll('video').forEach(el => {
        if (!el.poster) {
          el.removeAttribute('src');
          el.innerHTML = '';
          return;
        }
        const img = document.createElement('img');
        img.src = el.poster;
        img.alt = '';
        img.style.cssText = el.style.cssText + ';object-fit:cover;width:100%;height:100%;';
        img.className = el.className;
        el.replaceWith(img);
      });
      // Images: defer decode and let the browser pick the smallest
      // srcset candidate for the ~140px thumb. Same-URL clones reuse the
      // slide's decoded bitmap (URL-keyed cache), so the remaining cost
      // is paint/composite — lazy+async keeps that off the main thread.
      clone.querySelectorAll('img').forEach(el => {
        el.loading = 'lazy';
        el.decoding = 'async';
        if (el.srcset) el.sizes = (this._railPx || 188) + 'px';
      });
      // Custom elements inside the slide would have their
      // connectedCallback fire when the clone is appended. Replace them
      // with inert boxes so a component-heavy deck doesn't run N copies
      // of each component's mount logic in the rail. Children are
      // preserved so layout-wrapper elements (<my-column><h2>…</h2>)
      // still show their authored content; the querySelectorAll NodeList
      // is static, so nested custom elements in the moved subtree are
      // still visited on later iterations.
      const neuter = el => {
        const box = document.createElement('div');
        box.style.cssText = (el.getAttribute('style') || '') + ';background:rgba(0,0,0,0.06);border:1px dashed rgba(0,0,0,0.15);';
        box.className = el.className;
        // Preserve theming/i18n hooks so [data-*] / :lang() / [dir]
        // descendant selectors still match the neutered root.
        for (const a of el.attributes) {
          const n = a.name;
          if (n.startsWith('data-') || n.startsWith('aria-') || n === 'lang' || n === 'dir' || n === 'role' || n === 'title') {
            box.setAttribute(n, a.value);
          }
        }
        while (el.firstChild) box.appendChild(el.firstChild);
        return box;
      };
      // querySelectorAll('*') returns descendants only — a custom-element
      // slide root (<my-slide>…</my-slide>) would slip through and upgrade
      // on append. Swap the root first.
      if (clone.tagName.includes('-')) clone = neuter(clone);
      clone.querySelectorAll('*').forEach(el => {
        if (el.tagName.includes('-')) el.replaceWith(neuter(el));
      });
      clone.style.cssText += ';position:absolute;top:0;left:0;transform-origin:0 0;' + 'pointer-events:none;width:' + dw + 'px;height:' + dh + 'px;' + 'box-sizing:border-box;overflow:hidden;visibility:visible;opacity:1;';
      const host = document.createElement('div');
      host.style.cssText = 'position:absolute;inset:0;';
      this._syncThumbHostAttrs(host);
      const sr = host.attachShadow({
        mode: 'open'
      });
      if (this._adoptedSheet) sr.adoptedStyleSheets = [this._adoptedSheet];else {
        const st = document.createElement('style');
        st.textContent = this._authorCss || '';
        sr.appendChild(st);
      }
      sr.appendChild(clone);
      entry.frame.appendChild(host);
      entry.host = host;
      entry.clone = clone;
      if (this._thumbScale) clone.style.transform = 'scale(' + this._thumbScale + ')';
      // Once materialized the IO callback is a no-op early-return —
      // unobserve so scroll doesn't keep firing it.
      if (this._railObserver) this._railObserver.unobserve(entry.frame);
    }

    /** Re-clone a single thumb (live-update path). No-op if the thumb
     *  hasn't been materialized yet — it'll pick up current content when
     *  it scrolls into view. */
    _refreshThumb(slide) {
      const entry = (this._thumbs || []).find(t => t.slide === slide);
      if (!entry || !entry.host) return;
      entry.host.remove();
      entry.host = entry.clone = null;
      this._materialize(entry);
    }
    _scaleThumbs() {
      if (!this._thumbs || !this._thumbs.length) return;
      // Every frame is the same width; if it reads 0 the rail is
      // display:none (noscale / no-rail / presenting / print) — leave the
      // clones as-is and re-run when the rail is revealed.
      const fw = this._thumbs[0].frame.offsetWidth;
      if (!fw) return;
      this._thumbScale = fw / this.designWidth;
      this._thumbs.forEach(({
        clone
      }) => {
        if (clone) clone.style.transform = 'scale(' + this._thumbScale + ')';
      });
    }
    _setDrop(i, where) {
      // dragover fires at pointer-event rate; touch only the previous
      // and new target rather than sweeping all N thumbs.
      const t = this._thumbs && this._thumbs[i];
      if (this._dropOn && this._dropOn !== t) {
        this._dropOn.thumb.removeAttribute('data-drop');
      }
      if (t) t.thumb.setAttribute('data-drop', where);
      this._dropOn = t || null;
    }
    _clearDrop() {
      if (this._dropOn) this._dropOn.thumb.removeAttribute('data-drop');
      this._dropOn = null;
    }
    _syncRail(follow) {
      if (!this._thumbs) return;
      this._thumbs.forEach(({
        thumb
      }, i) => {
        if (i === this._index) {
          thumb.setAttribute('data-current', '');
          if (follow && typeof thumb.scrollIntoView === 'function') {
            thumb.scrollIntoView({
              block: 'nearest'
            });
          }
        } else {
          thumb.removeAttribute('data-current');
        }
      });
    }
    _openMenu(i, x, y) {
      if (!this._menu) return;
      this._menuIndex = i;
      const slide = this._slides[i];
      const skip = slide && slide.hasAttribute('data-deck-skip');
      this._menu.querySelector('[data-act="skip"]').textContent = skip ? 'Unskip slide' : 'Skip slide';
      this._menu.querySelector('[data-act="up"]').disabled = i <= 0;
      this._menu.querySelector('[data-act="down"]').disabled = i >= this._slides.length - 1;
      this._menu.querySelector('[data-act="delete"]').disabled = this._slides.length <= 1;
      // Place, then clamp to viewport after it's measurable.
      this._menu.style.left = x + 'px';
      this._menu.style.top = y + 'px';
      this._menu.setAttribute('data-open', '');
      const r = this._menu.getBoundingClientRect();
      const nx = Math.min(x, window.innerWidth - r.width - 4);
      const ny = Math.min(y, window.innerHeight - r.height - 4);
      this._menu.style.left = Math.max(4, nx) + 'px';
      this._menu.style.top = Math.max(4, ny) + 'px';
    }
    _closeMenu() {
      if (this._menu) this._menu.removeAttribute('data-open');
      this._menuIndex = -1;
    }
    _openConfirm(i) {
      if (!this._confirm) return;
      this._confirmIndex = i;
      this._confirm.querySelector('.title').textContent = 'Delete slide ' + (i + 1) + '?';
      this._confirm.setAttribute('data-open', '');
      const btn = this._confirm.querySelector('.danger');
      if (btn && btn.focus) btn.focus();
    }
    _closeConfirm() {
      if (this._confirm) this._confirm.removeAttribute('data-open');
      this._confirmIndex = -1;
    }

    /** Rail mutations. When a dc-runtime is present (`window.__dcUpdate`)
     *  the host owns the light DOM — handlers emit a dc-op only and the
     *  host applies it (to the editor's model or to the source file) and
     *  re-renders via dc-runtime; slotchange catches the rail up.
     *  Structural ops lock rail input until the host acks so a rapid second
     *  click can't address a stale index; setAttr/removeAttr respect the
     *  lock but don't set it (indices unchanged; the host serializes).
     *  `newIndex` is written to location.hash so slotchange's
     *  _restoreIndex lands on the right slide.
     *
     *  With NO dc-runtime (a raw .html deck), there's no re-render path,
     *  so handlers self-mutate locally for an instant update and emit
     *  `emitOnly: false`; the host persists to disk without
     *  re-rendering over the already-mutated DOM.
     *
     *  See docs/dc-ops.md for the contract. */
    _emitDcOp(op, slide, lock, newIndex) {
      // Slide index (template/script/style filtered — same as
      // _collectSlides). deck-stage is a filtered-index dc-op emitter;
      // the host resolves against findDeckStage().slideTids. Callers
      // already pass `to` as a slide index.
      op.at = this._slides.indexOf(slide);
      op.witness = {
        childCount: this._slides.length
      };
      // dc-runtime wraps an <x-import>-mounted component in a
      // <div class="sc-host-x" data-dc-tpl="N"> host — the stamp is on the
      // WRAPPER, not this element. closest() finds it (or this element's
      // own stamp when directly templated).
      const host = this.closest('[data-dc-tpl]');
      const tid = host && host.getAttribute('data-dc-tpl');
      op.mount = {
        tid: tid !== null ? parseInt(tid, 10) : null,
        tag: 'deck-stage'
      };
      op.emitOnly = !!window.__dcUpdate;
      if (op.emitOnly) {
        if (lock) this._railLock = true;
        if (newIndex != null && newIndex !== this._index) {
          this._indexBeforeEmit = this._index;
          this._index = newIndex;
          try {
            history.replaceState(null, '', '#' + (newIndex + 1));
          } catch (e) {}
        }
      }
      this.dispatchEvent(new CustomEvent('dc-op', {
        detail: op,
        bubbles: true,
        composed: true
      }));
      return op.emitOnly;
    }
    _deleteSlide(i) {
      if (this._railLock) return;
      const slide = this._slides[i];
      if (!slide || this._slides.length <= 1) return;
      const cur = this._index;
      const ni = i < cur || i === cur && i === this._slides.length - 1 ? cur - 1 : cur;
      if (this._emitDcOp({
        op: 'remove'
      }, slide, true, ni)) return;
      this._index = ni;
      this._squelchSlotChange = true;
      slide.remove();
      this._collectSlides();
      this._applyIndex({
        showOverlay: true,
        broadcast: true,
        reason: 'mutation'
      });
    }
    _duplicateSlide(i) {
      if (this._railLock) return;
      const slide = this._slides[i];
      if (!slide) return;
      if (this._emitDcOp({
        op: 'duplicate'
      }, slide, true, i + 1)) return;
      const copy = slide.cloneNode(true);
      copy.removeAttribute('id');
      copy.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
      this._index = i + 1;
      this._squelchSlotChange = true;
      this.insertBefore(copy, slide.nextSibling);
      this._collectSlides();
      this._applyIndex({
        showOverlay: true,
        broadcast: true,
        reason: 'mutation'
      });
    }
    _toggleSkip(i) {
      if (this._railLock) return;
      const slide = this._slides[i];
      if (!slide) return;
      const on = !slide.hasAttribute('data-deck-skip');
      if (this._emitDcOp(on ? {
        op: 'setAttr',
        attr: 'data-deck-skip',
        value: ''
      } : {
        op: 'removeAttr',
        attr: 'data-deck-skip'
      }, slide, false)) return;
      if (on) slide.setAttribute('data-deck-skip', '');else slide.removeAttribute('data-deck-skip');
    }
    _skippedIndices() {
      const out = [];
      for (let i = 0; i < this._slides.length; i++) {
        if (this._slides[i].hasAttribute('data-deck-skip')) out.push(i);
      }
      return out;
    }
    _moveSlide(i, j) {
      if (this._railLock || j < 0 || j >= this._slides.length || j === i) return;
      const cur = this._index;
      const ni = cur === i ? j : i < cur && j >= cur ? cur - 1 : i > cur && j <= cur ? cur + 1 : cur;
      const slide = this._slides[i];
      if (this._emitDcOp({
        op: 'move',
        to: j
      }, slide, true, ni)) return;
      const ref = j < i ? this._slides[j] : this._slides[j].nextSibling;
      this._index = ni;
      this._squelchSlotChange = true;
      this.insertBefore(slide, ref);
      this._collectSlides();
      this._applyIndex({
        showOverlay: false,
        broadcast: true,
        reason: 'mutation'
      });
    }

    // Public API ------------------------------------------------------------

    /** Current slide index (0-based). */
    get index() {
      return this._index;
    }
    /** Total slide count. */
    get length() {
      return this._slides.length;
    }
    /** Programmatically navigate. */
    goTo(i) {
      this._go(i, 'api');
    }
    next() {
      this._advance(1, 'api');
    }
    prev() {
      this._advance(-1, 'api');
    }
    reset() {
      this._go(0, 'api');
    }
  }
  if (!customElements.get('deck-stage')) {
    customElements.define('deck-stage', DeckStage);
  }
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "deck/deck-stage.js", error: String((e && e.message) || e) }); }

// ui_kits/buyer/app.js
try { (() => {
/* AUTO-GENERATED from ui_kits/buyer/src/*.js (numeric order). Do not edit directly. */
// ===== Shared UI helpers (concat order: first) =====
const {
  Button,
  Badge,
  Card,
  ProductCard,
  OrderStatusBadge,
  Modal,
  EmptyState,
  Input,
  Field,
  Select,
  Checkbox
} = window.MyCityDesignSystem_105480;
const fmt = n => new Intl.NumberFormat('it-IT', {
  style: 'currency',
  currency: 'EUR'
}).format(n);
const imgUrl = (kw, lock) => `https://loremflickr.com/640/640/${kw}?lock=${lock}`;
const finalPrice = p => p.discountPercent > 0 ? p.price * (1 - p.discountPercent / 100) : p.price;
const storeBy = name => window.MC_STORES.find(s => s.name === name);
const initials = name => (name || '').trim().split(/\s+/).map(w => w[0] || '').slice(0, 2).join('').toUpperCase();
function Lucide({
  name,
  size = 20,
  stroke = 2,
  color,
  style
}) {
  return /*#__PURE__*/React.createElement("i", {
    "data-lucide": name,
    ref: el => {
      if (el && window.lucide) try {
        window.lucide.createIcons({
          attrs: {
            width: size,
            height: size,
            'stroke-width': stroke
          }
        });
      } catch (e) {}
    },
    style: {
      width: size,
      height: size,
      display: 'inline-flex',
      color,
      flexShrink: 0,
      ...style
    }
  });
}

// Star rating row (read-only).
function Stars({
  value = 5,
  size = 14
}) {
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      gap: '1px'
    },
    "aria-label": `${value} su 5`
  }, [1, 2, 3, 4, 5].map(i => /*#__PURE__*/React.createElement("svg", {
    key: i,
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: i <= Math.round(value) ? 'var(--accent-500)' : 'var(--cream-300)',
    stroke: "none"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M12 2l2.9 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l7.1-1.01L12 2z"
  }))));
}

// Store avatar chip (initials on terracotta gradient).
function StoreChip({
  name,
  size = 20,
  onClick
}) {
  return /*#__PURE__*/React.createElement("span", {
    onClick: onClick,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      cursor: onClick ? 'pointer' : 'default'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: size,
      height: size,
      flexShrink: 0,
      borderRadius: 'var(--radius-full)',
      background: 'linear-gradient(135deg, var(--primary-500), var(--primary-700))',
      color: '#fff',
      fontSize: size * 0.42,
      fontWeight: 700,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'var(--font-sans)'
    }
  }, initials(name)), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: '13px',
      fontWeight: 600,
      color: 'var(--primary-700)',
      whiteSpace: 'nowrap'
    }
  }, name));
}

// Lightweight toast (non-intrusive add-to-cart confirmation).
function Toast({
  toast,
  onUndo
}) {
  if (!toast) return null;
  return ReactDOM.createPortal(/*#__PURE__*/React.createElement("div", {
    style: {
      position: 'fixed',
      left: '50%',
      bottom: '28px',
      transform: 'translateX(-50%)',
      zIndex: 'var(--z-toast)',
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      background: 'var(--ink-900)',
      color: '#fff',
      padding: '12px 16px',
      borderRadius: 'var(--radius-full)',
      boxShadow: 'var(--shadow-warm-xl)',
      animation: 'mc-pop-in var(--dur-medium) var(--ease-out-quint)',
      maxWidth: '90vw'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '26px',
      height: '26px',
      borderRadius: '50%',
      background: 'var(--olive-600)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "check",
    size: 16,
    stroke: 3,
    color: "#fff"
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '14px',
      fontWeight: 500
    }
  }, toast.text), onUndo && /*#__PURE__*/React.createElement("button", {
    onClick: onUndo,
    style: {
      border: 0,
      background: 'transparent',
      color: 'var(--accent-400)',
      fontWeight: 700,
      fontSize: '14px',
      cursor: 'pointer',
      fontFamily: 'var(--font-sans)'
    }
  }, "Annulla")), document.body);
}

// "Aperto / Chiuso" pill based on store.closeAt (demo: always open until close).
function OpenPill({
  store,
  dark
}) {
  const open = true;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '5px',
      background: dark ? 'rgba(28,26,24,.78)' : 'var(--olive-50)',
      color: dark ? '#fff' : 'var(--olive-700)',
      fontSize: '12px',
      fontWeight: 600,
      padding: '4px 10px',
      borderRadius: 'var(--radius-full)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '7px',
      height: '7px',
      borderRadius: '50%',
      background: 'var(--olive-400)'
    }
  }), open ? `Aperto · chiude alle ${store.closeAt}` : 'Chiuso');
}

// ===== Navbar (promo ticker + terracotta bar + category bar) =====
function PromoTicker() {
  const items = [{
    icon: 'bike',
    t: 'Consegna in 24–48h dai negozi di Piacenza'
  }, {
    icon: 'banknote',
    t: 'Paghi alla consegna — nessuna carta'
  }, {
    icon: 'gift',
    t: '€5 di sconto al primo ordine'
  }, {
    icon: 'badge-check',
    t: 'Solo commercianti locali verificati'
  }];
  const run = [...items, ...items];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--ink-900)',
      color: 'var(--cream-100)',
      fontSize: '12.5px',
      fontWeight: 500,
      overflow: 'hidden',
      whiteSpace: 'nowrap'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'inline-flex',
      gap: '40px',
      padding: '7px 0',
      animation: 'mc-marquee 32s linear infinite',
      willChange: 'transform'
    }
  }, run.map((it, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    style: {
      display: 'inline-flex',
      gap: '7px',
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: it.icon,
    size: 14,
    color: "var(--accent-300)"
  }), " ", it.t))));
}
function NavIcon({
  name,
  badge,
  onClick,
  title
}) {
  return /*#__PURE__*/React.createElement("button", {
    onClick: onClick,
    title: title,
    "aria-label": title,
    style: {
      position: 'relative',
      border: 0,
      background: 'transparent',
      color: '#fff',
      cursor: 'pointer',
      padding: '8px',
      borderRadius: 'var(--radius-full)',
      display: 'inline-flex'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: name,
    size: 20
  }), badge > 0 && /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      top: '-2px',
      right: '-2px',
      minWidth: '18px',
      height: '18px',
      padding: '0 4px',
      borderRadius: 'var(--radius-full)',
      background: 'var(--accent-500)',
      color: 'var(--ink-900)',
      fontSize: '10px',
      fontWeight: 700,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'var(--font-sans)'
    }
  }, badge));
}
function Navbar({
  cartCount,
  onCart,
  onHome,
  activeCat,
  onCat,
  query,
  onQuery,
  onSubmitSearch,
  onAccount,
  onFav,
  onNotif,
  notifCount = 2
}) {
  return /*#__PURE__*/React.createElement("header", {
    style: {
      position: 'sticky',
      top: 0,
      zIndex: 'var(--z-sticky)',
      boxShadow: 'var(--shadow-warm-sm)'
    }
  }, /*#__PURE__*/React.createElement(PromoTicker, null), /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--primary-700)',
      color: '#fff'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 'var(--container-max)',
      margin: '0 auto',
      padding: '12px 20px',
      display: 'flex',
      alignItems: 'center',
      gap: '14px'
    }
  }, /*#__PURE__*/React.createElement("a", {
    onClick: onHome,
    style: {
      cursor: 'pointer',
      fontFamily: 'var(--font-serif)',
      fontSize: '24px',
      fontWeight: 800,
      letterSpacing: '-0.01em',
      whiteSpace: 'nowrap',
      lineHeight: 1
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--accent-300)'
    }
  }, "My"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: '#fff'
    }
  }, "City")), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      background: 'rgba(255,255,255,.12)',
      padding: '7px 12px',
      borderRadius: 'var(--radius-full)',
      fontSize: '13px',
      fontWeight: 500,
      whiteSpace: 'nowrap'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "map-pin",
    size: 15
  }), " Piacenza \xB7 29121"), /*#__PURE__*/React.createElement("form", {
    onSubmit: e => {
      e.preventDefault();
      onSubmitSearch && onSubmitSearch();
    },
    style: {
      flex: 1,
      maxWidth: '560px',
      position: 'relative'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      left: '14px',
      top: '50%',
      transform: 'translateY(-50%)',
      display: 'inline-flex',
      pointerEvents: 'none'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "search",
    size: 18,
    color: "var(--ink-400)"
  })), /*#__PURE__*/React.createElement("input", {
    value: query,
    onChange: e => onQuery(e.target.value),
    placeholder: "Cerca prodotti, negozi a Piacenza\u2026",
    style: {
      width: '100%',
      boxSizing: 'border-box',
      border: 0,
      borderRadius: 'var(--radius-full)',
      padding: '11px 16px 11px 42px',
      fontSize: '15px',
      fontFamily: 'var(--font-sans)',
      background: '#fff',
      color: 'var(--ink-900)',
      outline: 'none'
    }
  })), /*#__PURE__*/React.createElement("nav", {
    style: {
      marginLeft: 'auto',
      display: 'flex',
      alignItems: 'center',
      gap: '2px'
    }
  }, /*#__PURE__*/React.createElement(NavIcon, {
    name: "heart",
    title: "Preferiti",
    badge: 3,
    onClick: onFav
  }), /*#__PURE__*/React.createElement(NavIcon, {
    name: "bell",
    title: "Notifiche",
    badge: notifCount,
    onClick: onNotif
  }), /*#__PURE__*/React.createElement("button", {
    onClick: onCart,
    style: {
      marginLeft: '6px',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px',
      background: 'var(--accent-500)',
      color: 'var(--ink-900)',
      border: 0,
      padding: '9px 16px',
      borderRadius: 'var(--radius-full)',
      fontWeight: 700,
      fontSize: '14px',
      fontFamily: 'var(--font-sans)',
      cursor: 'pointer',
      whiteSpace: 'nowrap'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "shopping-cart",
    size: 17,
    stroke: 2.4
  }), " Carrello", cartCount > 0 && /*#__PURE__*/React.createElement("span", {
    style: {
      background: 'var(--ink-900)',
      color: 'var(--accent-400)',
      fontSize: '11px',
      fontWeight: 700,
      borderRadius: 'var(--radius-full)',
      minWidth: '18px',
      height: '18px',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '0 4px'
    }
  }, cartCount)), /*#__PURE__*/React.createElement("button", {
    onClick: onAccount,
    title: "Account",
    "aria-label": "Account",
    style: {
      marginLeft: '8px',
      width: '36px',
      height: '36px',
      borderRadius: 'var(--radius-full)',
      background: 'var(--cream-200)',
      color: 'var(--primary-700)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontWeight: 700,
      flexShrink: 0,
      border: 0,
      cursor: 'pointer',
      fontFamily: 'var(--font-sans)'
    }
  }, window.MC_USER ? window.MC_USER.initials : 'L'))), /*#__PURE__*/React.createElement("div", {
    style: {
      borderTop: '1px solid rgba(255,255,255,.14)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "mc-catbar",
    style: {
      maxWidth: 'var(--container-max)',
      margin: '0 auto',
      padding: '0 20px',
      display: 'flex',
      gap: '2px',
      overflowX: 'auto'
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => onCat(null),
    style: catBtn(!activeCat)
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "layout-grid",
    size: 16,
    stroke: 2.2,
    color: !activeCat ? 'var(--accent-300)' : 'rgba(255,255,255,.88)'
  }), " Tutto"), window.MC_CATEGORIES.map(c => {
    const on = activeCat === c.slug;
    return /*#__PURE__*/React.createElement("button", {
      key: c.slug,
      onClick: () => onCat(on ? null : c.slug),
      style: catBtn(on)
    }, /*#__PURE__*/React.createElement(Lucide, {
      name: c.icon,
      size: 16,
      stroke: 2.2,
      color: on ? 'var(--accent-300)' : 'rgba(255,255,255,.88)'
    }), " ", c.label);
  })))));
}
function catBtn(on) {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '7px',
    whiteSpace: 'nowrap',
    border: 0,
    background: 'transparent',
    color: on ? 'var(--accent-300)' : 'rgba(255,255,255,.88)',
    padding: '12px 14px',
    fontSize: '13.5px',
    fontWeight: on ? 700 : 500,
    fontFamily: 'var(--font-sans)',
    cursor: 'pointer',
    borderBottom: `2px solid ${on ? 'var(--accent-400)' : 'transparent'}`
  };
}

// ===== Home =====
function pImg(p, i = 0) {
  return imgUrl(p.kw, p.galleryLocks[i % p.galleryLocks.length]);
}
function ProductGridCard({
  p,
  onOpen,
  onAdd,
  onStore
}) {
  return /*#__PURE__*/React.createElement("div", {
    onClick: () => onOpen(p),
    style: {
      cursor: 'pointer',
      height: '100%'
    }
  }, /*#__PURE__*/React.createElement(ProductCard, {
    name: p.name,
    price: p.price,
    discountPercent: p.discountPercent,
    storeName: p.store,
    image: pImg(p),
    isNew: p.isNew,
    freeShipping: p.freeShipping,
    stock: p.stock,
    onAdd: () => onAdd(p)
  }));
}
function Hero({
  onExplore,
  onStore
}) {
  const featured = storeBy('Salumeria Verdi');
  return /*#__PURE__*/React.createElement("section", {
    style: {
      position: 'relative',
      overflow: 'hidden',
      background: 'linear-gradient(180deg, var(--surface-0), var(--surface-100))'
    }
  }, /*#__PURE__*/React.createElement("div", {
    "aria-hidden": true,
    style: {
      position: 'absolute',
      top: '-80px',
      right: '-80px',
      width: '500px',
      height: '500px',
      borderRadius: '50%',
      background: 'rgba(245,197,182,.4)',
      filter: 'blur(80px)'
    }
  }), /*#__PURE__*/React.createElement("div", {
    "aria-hidden": true,
    style: {
      position: 'absolute',
      bottom: '-120px',
      left: '-80px',
      width: '420px',
      height: '420px',
      borderRadius: '50%',
      background: 'rgba(251,216,145,.4)',
      filter: 'blur(80px)'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      maxWidth: 'var(--container-max)',
      margin: '0 auto',
      padding: '44px 20px',
      display: 'grid',
      gridTemplateColumns: '1.2fr 1fr',
      gap: '40px',
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '22px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      alignSelf: 'flex-start',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      background: 'var(--primary-100)',
      color: 'var(--primary-800)',
      padding: '5px 12px',
      borderRadius: 'var(--radius-full)',
      fontSize: '12px',
      fontWeight: 600,
      boxShadow: 'inset 0 0 0 1px var(--primary-200)'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "sparkles",
    size: 14,
    color: "var(--primary-800)"
  }), " Il marketplace dei negozi di Piacenza"), /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-serif)',
      fontSize: '54px',
      fontWeight: 800,
      lineHeight: 1.05,
      letterSpacing: '-0.01em',
      color: 'var(--ink-900)'
    }
  }, "I negozi ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--primary-700)',
      fontStyle: 'italic'
    }
  }, "veri"), " di Piacenza,", /*#__PURE__*/React.createElement("br", null), "ora a casa tua."), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '18px',
      lineHeight: 1.6,
      color: 'var(--ink-600)',
      maxWidth: '34em'
    }
  }, "Alimentari, gastronomia, vini, casa: ordini dai commercianti della tua via in pochi tap e ", /*#__PURE__*/React.createElement("strong", {
    style: {
      color: 'var(--ink-900)'
    }
  }, "paghi alla consegna"), ". A casa in 24\u201348h."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: '12px'
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    size: "lg",
    shape: "pill",
    iconRight: "arrow-right",
    onClick: onExplore
  }, "Inizia a esplorare"), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "lg",
    shape: "pill",
    icon: "store",
    onClick: () => onStore(featured)
  }, "Esplora i negozi")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: '8px 24px',
      fontSize: '14px',
      color: 'var(--ink-600)'
    }
  }, ['Paghi alla consegna', 'Oggi se disponibile · 24–48h', 'Account solo per confermare'].map(t => /*#__PURE__*/React.createElement("span", {
    key: t,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "check",
    size: 16,
    stroke: 2.4,
    color: "var(--olive-600)"
  }), " ", t)))), /*#__PURE__*/React.createElement("div", {
    onClick: () => onStore(featured),
    style: {
      cursor: 'pointer',
      background: '#fff',
      border: '1px solid var(--cream-300)',
      borderRadius: 'var(--radius-2xl)',
      boxShadow: 'var(--shadow-warm-lg)',
      overflow: 'hidden'
    },
    className: "mc-card-hover"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      height: '180px'
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: featured.cover,
    alt: featured.name,
    style: {
      width: '100%',
      height: '100%',
      objectFit: 'cover'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      top: '12px',
      left: '12px'
    }
  }, /*#__PURE__*/React.createElement(OpenPill, {
    store: featured,
    dark: true
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '16px 18px',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px'
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-serif)',
      fontSize: '19px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, featured.name), /*#__PURE__*/React.createElement(Lucide, {
    name: "badge-check",
    size: 18,
    color: "var(--primary-600)"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      fontSize: '13px',
      color: 'var(--ink-500)'
    }
  }, /*#__PURE__*/React.createElement(Stars, {
    value: featured.rating
  }), " ", /*#__PURE__*/React.createElement("strong", {
    style: {
      color: 'var(--ink-800)'
    }
  }, String(featured.rating).replace('.', ',')), " \xB7 ", featured.reviews, " recensioni \xB7 ", featured.area), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: '8px',
      marginTop: '2px'
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    variant: "local"
  }, "Negozio locale"), /*#__PURE__*/React.createElement(Badge, {
    variant: "free",
    icon: "truck"
  }, "Consegna oggi"))))));
}
function HowItWorks() {
  const steps = [{
    n: 1,
    icon: 'store',
    tone: 'primary',
    t: 'Scegli',
    d: 'Sfoglia i negozi e i prodotti di Piacenza, dai commercianti della tua via.'
  }, {
    n: 2,
    icon: 'shopping-bag',
    tone: 'accent',
    t: 'Ordina',
    d: 'Aggiungi al carrello e inserisci l’indirizzo. L’account serve solo per confermare.'
  }, {
    n: 3,
    icon: 'banknote',
    tone: 'olive',
    t: 'Ricevi e paghi alla consegna',
    d: 'Te lo portiamo a casa in 24–48h. Paghi al rider quando arriva: zero rischi.'
  }];
  const TONE = {
    primary: ['var(--primary-100)', 'var(--primary-700)'],
    accent: ['var(--accent-100)', 'var(--accent-700)'],
    olive: ['var(--olive-100)', 'var(--olive-700)']
  };
  return /*#__PURE__*/React.createElement("section", {
    style: {
      maxWidth: 'var(--container-max)',
      margin: '0 auto',
      padding: '28px 20px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'center',
      marginBottom: '22px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '12px',
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '0.04em',
      color: 'var(--primary-700)'
    }
  }, "Semplice e senza pensieri"), /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: '4px 0 0',
      fontFamily: 'var(--font-serif)',
      fontSize: '30px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, "Come funziona, in 3 passi")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: '20px'
    }
  }, steps.map(s => /*#__PURE__*/React.createElement(Card, {
    key: s.n,
    variant: "elevated",
    padding: "lg",
    as: "article"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      marginBottom: '14px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'relative',
      width: '48px',
      height: '48px',
      borderRadius: 'var(--radius-full)',
      background: TONE[s.tone][0],
      color: TONE[s.tone][1],
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: s.icon,
    size: 22,
    stroke: 2.2,
    color: TONE[s.tone][1]
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      top: '-6px',
      right: '-6px',
      width: '24px',
      height: '24px',
      borderRadius: '50%',
      background: 'var(--ink-900)',
      color: '#fff',
      fontSize: '12px',
      fontWeight: 700,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: '0 0 0 2px #fff',
      fontFamily: 'var(--font-sans)'
    }
  }, s.n)), /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-serif)',
      fontSize: '18px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, s.t)), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '14px',
      lineHeight: 1.6,
      color: 'var(--ink-600)'
    }
  }, s.d)))));
}
function ProductRail({
  products,
  onOpen,
  onAdd,
  onStore,
  title,
  eyebrow,
  onSeeAll
}) {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      background: '#fff',
      borderTop: '1px solid var(--cream-300)',
      borderBottom: '1px solid var(--cream-300)',
      padding: '28px 0'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 'var(--container-max)',
      margin: '0 auto',
      padding: '0 20px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
      marginBottom: '18px',
      flexWrap: 'wrap',
      gap: '12px'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      color: 'var(--primary-700)',
      fontSize: '12px',
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '0.05em'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "heart",
    size: 14,
    color: "var(--primary-700)"
  }), " ", eyebrow), /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: '4px 0 0',
      fontFamily: 'var(--font-serif)',
      fontSize: '28px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, title)), /*#__PURE__*/React.createElement("a", {
    onClick: onSeeAll,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px',
      color: 'var(--primary-700)',
      fontWeight: 600,
      fontSize: '14px',
      cursor: 'pointer'
    }
  }, "Vedi tutto ", /*#__PURE__*/React.createElement(Lucide, {
    name: "arrow-right",
    size: 16,
    color: "var(--primary-700)"
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: '16px'
    }
  }, products.map(p => /*#__PURE__*/React.createElement(ProductGridCard, {
    key: p.id,
    p: p,
    onOpen: onOpen,
    onAdd: onAdd,
    onStore: onStore
  })))));
}
function StoresRail({
  stores,
  onStore
}) {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      maxWidth: 'var(--container-max)',
      margin: '0 auto',
      padding: '32px 20px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
      marginBottom: '18px'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      color: 'var(--primary-700)',
      fontSize: '12px',
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '0.05em'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "store",
    size: 14,
    color: "var(--primary-700)"
  }), " Vicino a te"), /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: '4px 0 0',
      fontFamily: 'var(--font-serif)',
      fontSize: '28px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, "Negozi in evidenza"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: '16px'
    }
  }, stores.map(s => /*#__PURE__*/React.createElement("div", {
    key: s.id,
    onClick: () => onStore(s),
    className: "mc-card-hover",
    style: {
      cursor: 'pointer',
      background: '#fff',
      border: '1px solid var(--cream-300)',
      borderRadius: 'var(--radius-2xl)',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      height: '120px'
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: s.cover,
    alt: s.name,
    style: {
      width: '100%',
      height: '100%',
      objectFit: 'cover'
    }
  }), s.deliveryToday && /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      bottom: '8px',
      left: '8px'
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    variant: "free",
    icon: "truck"
  }, "Consegna oggi"))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '12px 14px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '6px'
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-serif)',
      fontSize: '16px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, s.name), s.verified && /*#__PURE__*/React.createElement(Lucide, {
    name: "badge-check",
    size: 15,
    color: "var(--primary-600)"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '5px',
      fontSize: '12px',
      color: 'var(--ink-500)',
      marginTop: '5px'
    }
  }, /*#__PURE__*/React.createElement(Stars, {
    value: s.rating,
    size: 13
  }), " ", /*#__PURE__*/React.createElement("strong", {
    style: {
      color: 'var(--ink-800)'
    }
  }, String(s.rating).replace('.', ',')), " \xB7 ", s.cat, " \xB7 ", s.area))))));
}
function TrustRow() {
  const items = [{
    icon: 'banknote',
    tone: ['var(--olive-100)', 'var(--olive-700)'],
    t: 'Paghi alla consegna',
    d: 'Niente carta: l’account serve solo per confermare.'
  }, {
    icon: 'home',
    tone: ['var(--primary-100)', 'var(--primary-700)'],
    t: '100% commercianti locali',
    d: 'Solo negozi verificati di Piacenza.'
  }, {
    icon: 'truck',
    tone: ['var(--accent-100)', 'var(--accent-700)'],
    t: 'Consegna in 24–48h',
    d: 'Rider del territorio, percorsi brevi.'
  }, {
    icon: 'rotate-ccw',
    tone: ['var(--secondary-100)', 'var(--secondary-600)'],
    t: 'Reso entro 14 giorni',
    d: 'Cambi idea? Ti rimborsiamo senza domande.'
  }];
  return /*#__PURE__*/React.createElement("section", {
    style: {
      background: 'var(--cream-50)',
      borderTop: '1px solid var(--cream-300)',
      borderBottom: '1px solid var(--cream-300)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 'var(--container-max)',
      margin: '0 auto',
      padding: '28px 20px',
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: '16px'
    }
  }, items.map(v => /*#__PURE__*/React.createElement("div", {
    key: v.t,
    style: {
      display: 'flex',
      gap: '12px',
      alignItems: 'flex-start'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      flexShrink: 0,
      width: '44px',
      height: '44px',
      borderRadius: 'var(--radius-full)',
      background: v.tone[0],
      color: v.tone[1],
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: v.icon,
    size: 20,
    stroke: 2.2,
    color: v.tone[1]
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontWeight: 700,
      fontSize: '15px',
      color: 'var(--ink-900)'
    }
  }, v.t), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 0',
      fontSize: '13px',
      color: 'var(--ink-600)',
      lineHeight: 1.45
    }
  }, v.d))))));
}
function SellerCta() {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      background: 'var(--ink-900)',
      color: '#fff'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 'var(--container-max)',
      margin: '0 auto',
      padding: '22px 20px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '16px',
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      flexShrink: 0,
      width: '40px',
      height: '40px',
      borderRadius: 'var(--radius-full)',
      background: 'rgba(255,255,255,.1)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "shield-check",
    size: 18,
    stroke: 2.4,
    color: "var(--accent-400)"
  })), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '17px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-serif)',
      fontWeight: 700
    }
  }, "Hai un negozio a Piacenza?"), " ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--ink-300)'
    }
  }, "Vendi online con zero commissioni."))), /*#__PURE__*/React.createElement(Button, {
    variant: "accent",
    shape: "pill",
    icon: "store"
  }, "Diventa venditore")));
}
function Footer({
  onAuth
}) {
  const cols = [['MyCity', ['Chi siamo', 'Come funziona', 'Lavora con noi', 'Contatti']], ['Acquista', ['Categorie', 'Negozi', 'Offerte', 'Novità']], ['Vendi', ['Diventa venditore', 'Zero commissioni', 'Centro venditori', 'Diventa rider']], ['Aiuto', ['FAQ', 'Resi e rimborsi', 'Privacy', 'Cookie']]];
  return /*#__PURE__*/React.createElement("footer", {
    style: {
      background: 'var(--cream-200)',
      borderTop: '1px solid var(--cream-300)',
      color: 'var(--ink-700)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 'var(--container-max)',
      margin: '0 auto',
      padding: '36px 20px',
      display: 'grid',
      gridTemplateColumns: '1.4fr repeat(4, 1fr)',
      gap: '28px'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-serif)',
      fontSize: '24px',
      fontWeight: 800
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--accent-500)'
    }
  }, "My"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--ink-900)'
    }
  }, "City")), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '10px 0 0',
      fontSize: '13px',
      lineHeight: 1.6,
      maxWidth: '24em',
      color: 'var(--ink-500)'
    }
  }, "Il marketplace dei negozi locali di Piacenza. Consegna a domicilio, pagamento alla consegna.")), cols.map(([h, links]) => /*#__PURE__*/React.createElement("div", {
    key: h
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '0 0 10px',
      fontSize: '13px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, h), /*#__PURE__*/React.createElement("ul", {
    style: {
      listStyle: 'none',
      margin: 0,
      padding: 0,
      display: 'flex',
      flexDirection: 'column',
      gap: '7px'
    }
  }, links.map(l => /*#__PURE__*/React.createElement("li", {
    key: l
  }, /*#__PURE__*/React.createElement("a", {
    style: {
      fontSize: '13px',
      color: 'var(--ink-600)',
      cursor: 'pointer'
    }
  }, l))))))), /*#__PURE__*/React.createElement("div", {
    style: {
      borderTop: '1px solid var(--cream-300)',
      padding: '14px 20px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '16px',
      flexWrap: 'wrap',
      fontSize: '12px',
      color: 'var(--ink-500)'
    }
  }, /*#__PURE__*/React.createElement("span", null, "\xA9 2026 MyCity Piacenza \xB7 P.IVA 0000000000 \xB7 Tutti i diritti riservati"), onAuth && /*#__PURE__*/React.createElement("a", {
    onClick: onAuth,
    style: {
      cursor: 'pointer',
      fontWeight: 700,
      color: 'var(--primary-700)'
    }
  }, "Accedi / Registrati")));
}
function Home({
  products,
  stores,
  onOpen,
  onAdd,
  onStore,
  onExplore
}) {
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Hero, {
    onExplore: onExplore,
    onStore: onStore
  }), /*#__PURE__*/React.createElement(HowItWorks, null), /*#__PURE__*/React.createElement(ProductRail, {
    products: products.slice(0, 4),
    onOpen: onOpen,
    onAdd: onAdd,
    onStore: onStore,
    eyebrow: "I pi\xF9 amati",
    title: "Prodotti che vanno forte",
    onSeeAll: onExplore
  }), /*#__PURE__*/React.createElement(StoresRail, {
    stores: stores.slice(0, 4),
    onStore: onStore
  }), /*#__PURE__*/React.createElement(TrustRow, null), /*#__PURE__*/React.createElement(ProductRail, {
    products: products.slice(4, 8),
    onOpen: onOpen,
    onAdd: onAdd,
    onStore: onStore,
    eyebrow: "Novit\xE0",
    title: "Appena arrivati dai negozi",
    onSeeAll: onExplore
  }), /*#__PURE__*/React.createElement(SellerCta, null));
}

// ===== Auth (login / registrazione) =====
function AuthPage({
  mode = 'login',
  onAuth,
  onBack,
  onSwitch
}) {
  const isLogin = mode === 'login';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      minHeight: '70vh',
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      maxWidth: 'var(--container-max)',
      margin: '0 auto'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      padding: '48px 56px'
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: onBack,
    style: {
      ...backLink,
      alignSelf: 'flex-start',
      marginBottom: '12px'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "arrow-left",
    size: 17
  }), " Indietro"), /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: '0 0 6px',
      fontFamily: 'var(--font-serif)',
      fontSize: '34px',
      fontWeight: 800,
      color: 'var(--ink-900)'
    }
  }, isLogin ? 'Bentornata su MyCity' : 'Crea il tuo account'), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '0 0 24px',
      fontSize: '15px',
      color: 'var(--ink-600)',
      lineHeight: 1.55
    }
  }, isLogin ? 'Accedi per seguire i tuoi ordini e i negozi preferiti.' : 'Ti serve solo per confermare l’ordine — paghi sempre alla consegna.'), /*#__PURE__*/React.createElement("form", {
    onSubmit: e => {
      e.preventDefault();
      onAuth();
    },
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '14px',
      maxWidth: '380px'
    }
  }, !isLogin && /*#__PURE__*/React.createElement(Input, {
    label: "Nome e cognome",
    placeholder: "Lucia Bianchi",
    leading: /*#__PURE__*/React.createElement(Lucide, {
      name: "user",
      size: 18,
      color: "var(--ink-400)"
    })
  }), /*#__PURE__*/React.createElement(Input, {
    label: "Email",
    type: "email",
    placeholder: "nome@email.it",
    leading: /*#__PURE__*/React.createElement(Lucide, {
      name: "mail",
      size: 18,
      color: "var(--ink-400)"
    })
  }), /*#__PURE__*/React.createElement(Input, {
    label: "Password",
    type: "password",
    placeholder: "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022",
    leading: /*#__PURE__*/React.createElement(Lucide, {
      name: "lock",
      size: 18,
      color: "var(--ink-400)"
    }),
    labelAction: isLogin ? /*#__PURE__*/React.createElement("a", {
      style: {
        cursor: 'pointer'
      }
    }, "Password dimenticata?") : null
  }), !isLogin && /*#__PURE__*/React.createElement(Checkbox, {
    label: /*#__PURE__*/React.createElement(React.Fragment, null, "Accetto i ", /*#__PURE__*/React.createElement("a", {
      style: {
        cursor: 'pointer'
      }
    }, "termini"), " e la ", /*#__PURE__*/React.createElement("a", {
      style: {
        cursor: 'pointer'
      }
    }, "privacy"), "."),
    defaultChecked: true
  }), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    size: "lg",
    type: "submit",
    fullWidth: true,
    iconRight: "arrow-right"
  }, isLogin ? 'Accedi' : 'Crea account')), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      margin: '20px 0',
      maxWidth: '380px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      height: '1px',
      background: 'var(--cream-300)'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '12px',
      color: 'var(--ink-400)'
    }
  }, "oppure"), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      height: '1px',
      background: 'var(--cream-300)'
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: '10px',
      maxWidth: '380px'
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    fullWidth: true,
    icon: "smartphone"
  }, "SPID"), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    fullWidth: true,
    onClick: onAuth
  }, "Continua con Google")), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '22px 0 0',
      fontSize: '14px',
      color: 'var(--ink-600)'
    }
  }, isLogin ? 'Non hai un account? ' : 'Hai già un account? ', /*#__PURE__*/React.createElement("a", {
    onClick: () => onSwitch(isLogin ? 'register' : 'login'),
    style: {
      cursor: 'pointer',
      fontWeight: 700
    }
  }, isLogin ? 'Registrati' : 'Accedi'))), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      background: 'var(--primary-700)',
      color: '#fff',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      padding: '48px 56px',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    "aria-hidden": true,
    style: {
      position: 'absolute',
      top: '-100px',
      right: '-100px',
      width: '380px',
      height: '380px',
      borderRadius: '50%',
      background: 'rgba(244,188,83,.25)',
      filter: 'blur(60px)'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      fontFamily: 'var(--font-serif)',
      fontSize: '30px',
      fontWeight: 800,
      lineHeight: 1.15,
      marginBottom: '24px'
    }
  }, "I negozi ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--accent-300)',
      fontStyle: 'italic'
    }
  }, "veri"), " di Piacenza, ora a casa tua."), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
      gap: '14px'
    }
  }, [['banknote', 'Paghi alla consegna, nessuna carta'], ['truck', 'Consegna in 24–48h dai negozi della tua via'], ['badge-check', '100% commercianti locali verificati'], ['rotate-ccw', 'Reso gratuito entro 14 giorni']].map(([ic, t]) => /*#__PURE__*/React.createElement("span", {
    key: t,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '12px',
      fontSize: '15px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '36px',
      height: '36px',
      borderRadius: '50%',
      background: 'rgba(255,255,255,.12)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: ic,
    size: 18,
    color: "var(--accent-300)"
  })), " ", t)))));
}

// ===== Store page (vetrina + catalogo + info + recensioni) =====
function StorePage({
  store,
  products,
  onBack,
  onOpen,
  onAdd
}) {
  const [tab, setTab] = React.useState('prodotti');
  const items = products.filter(p => p.store === store.name);
  const storeReviews = items.flatMap(p => (window.MC_REVIEWS[p.id] || []).map(r => ({
    ...r,
    product: p.name
  }))).slice(0, 6);
  const avg = items.length ? items.reduce((s, p) => s + p.rating, 0) / items.length : store.rating;
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      height: '240px',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: store.cover,
    alt: store.name,
    style: {
      width: '100%',
      height: '100%',
      objectFit: 'cover'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      inset: 0,
      background: 'linear-gradient(180deg, rgba(28,26,24,.15), rgba(28,26,24,.78))'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      top: '16px',
      left: '50%',
      transform: 'translateX(-50%)',
      width: '100%',
      maxWidth: 'var(--container-max)',
      padding: '0 20px',
      boxSizing: 'border-box'
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: onBack,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      border: 0,
      background: 'rgba(255,255,255,.92)',
      color: 'var(--ink-800)',
      fontSize: '13px',
      fontWeight: 600,
      cursor: 'pointer',
      padding: '8px 14px',
      borderRadius: 'var(--radius-full)',
      fontFamily: 'var(--font-sans)'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "arrow-left",
    size: 16
  }), " Indietro")), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      bottom: '18px',
      left: '50%',
      transform: 'translateX(-50%)',
      width: '100%',
      maxWidth: 'var(--container-max)',
      padding: '0 20px',
      boxSizing: 'border-box',
      color: '#fff'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-end',
      gap: '16px',
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: '72px',
      height: '72px',
      borderRadius: 'var(--radius-xl)',
      background: 'linear-gradient(135deg, var(--primary-500), var(--primary-700))',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'var(--font-serif)',
      fontSize: '28px',
      fontWeight: 800,
      boxShadow: 'var(--shadow-warm-lg)',
      flexShrink: 0
    }
  }, initials(store.name)), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: '200px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px'
    }
  }, /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-serif)',
      fontSize: '34px',
      fontWeight: 800,
      color: '#fff',
      lineHeight: 1.1
    }
  }, store.name), store.verified && /*#__PURE__*/React.createElement(Lucide, {
    name: "badge-check",
    size: 22,
    color: "var(--accent-400)"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      marginTop: '6px',
      fontSize: '14px',
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '5px'
    }
  }, /*#__PURE__*/React.createElement(Stars, {
    value: avg,
    size: 15
  }), " ", /*#__PURE__*/React.createElement("strong", null, avg.toFixed(1).replace('.', ',')), " ", /*#__PURE__*/React.createElement("span", {
    style: {
      opacity: .8
    }
  }, "\xB7 ", store.reviews, " recensioni")), /*#__PURE__*/React.createElement("span", {
    style: {
      opacity: .85
    }
  }, "\xB7 ", store.cat, " \xB7 ", store.area), /*#__PURE__*/React.createElement("span", {
    style: {
      opacity: .85
    }
  }, "\xB7 dal ", store.since))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: '8px'
    }
  }, /*#__PURE__*/React.createElement(OpenPill, {
    store: store,
    dark: true
  }), store.deliveryToday && /*#__PURE__*/React.createElement(Badge, {
    variant: "free",
    icon: "truck"
  }, "Consegna oggi"))))), /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 'var(--container-max)',
      margin: '0 auto',
      padding: '20px'
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '0 0 18px',
      fontSize: '16px',
      lineHeight: 1.6,
      color: 'var(--ink-700)',
      maxWidth: '60ch'
    }
  }, store.blurb), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: '4px',
      borderBottom: '1px solid var(--cream-300)',
      marginBottom: '22px'
    }
  }, [['prodotti', `Prodotti · ${items.length}`], ['info', 'Info & orari'], ['recensioni', `Recensioni · ${store.reviews}`]].map(([id, label]) => /*#__PURE__*/React.createElement("button", {
    key: id,
    onClick: () => setTab(id),
    style: {
      border: 0,
      background: 'transparent',
      padding: '10px 16px',
      fontSize: '14px',
      fontWeight: tab === id ? 700 : 500,
      color: tab === id ? 'var(--primary-700)' : 'var(--ink-500)',
      cursor: 'pointer',
      borderBottom: `2px solid ${tab === id ? 'var(--primary-600)' : 'transparent'}`,
      fontFamily: 'var(--font-sans)',
      marginBottom: '-1px'
    }
  }, label))), tab === 'prodotti' && (items.length === 0 ? /*#__PURE__*/React.createElement(EmptyState, {
    icon: "package-open",
    title: "Nessun prodotto",
    description: "Questo negozio non ha ancora prodotti a catalogo."
  }) : /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: '16px'
    }
  }, items.map(p => /*#__PURE__*/React.createElement(ProductGridCard, {
    key: p.id,
    p: p,
    onOpen: onOpen,
    onAdd: onAdd
  })))), tab === 'info' && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1.2fr 1fr',
      gap: '24px'
    }
  }, /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "lg"
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: '0 0 12px',
      fontFamily: 'var(--font-serif)',
      fontSize: '18px',
      color: 'var(--ink-900)'
    }
  }, "Orari di apertura"), [['Lun – Ven', `8:00 – ${store.closeAt}`], ['Sabato', `8:00 – ${store.closeAt}`], ['Domenica', 'Chiuso']].map(([d, h]) => /*#__PURE__*/React.createElement("div", {
    key: d,
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      padding: '8px 0',
      borderBottom: '1px solid var(--cream-200)',
      fontSize: '14px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--ink-600)'
    }
  }, d), /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 600,
      color: h === 'Chiuso' ? 'var(--secondary-600)' : 'var(--ink-900)'
    }
  }, h)))), /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "lg"
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: '0 0 12px',
      fontFamily: 'var(--font-serif)',
      fontSize: '18px',
      color: 'var(--ink-900)'
    }
  }, "Dove siamo"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      fontSize: '14px',
      color: 'var(--ink-700)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "map-pin",
    size: 16,
    color: "var(--primary-600)"
  }), " ", store.area, ", Piacenza (PC)"), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "truck",
    size: 16,
    color: "var(--olive-600)"
  }), " Consegna ", store.deliveryToday ? 'in giornata o' : '', " in 24\u201348h"), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "banknote",
    size: 16,
    color: "var(--olive-600)"
  }), " Pagamento alla consegna"), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "award",
    size: 16,
    color: "var(--accent-600)"
  }), " Attivit\xE0 storica dal ", store.since)))), tab === 'recensioni' && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr',
      gap: '12px',
      maxWidth: '760px'
    }
  }, storeReviews.length === 0 ? /*#__PURE__*/React.createElement(EmptyState, {
    icon: "message-circle",
    title: "Ancora nessuna recensione",
    description: "Sii il primo a recensire questo negozio."
  }) : storeReviews.map((r, i) => /*#__PURE__*/React.createElement(ReviewItem, {
    key: i,
    r: r
  })))));
}
function ReviewItem({
  r
}) {
  return /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "md"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      marginBottom: '6px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '34px',
      height: '34px',
      borderRadius: '50%',
      background: 'var(--cream-200)',
      color: 'var(--primary-700)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontWeight: 700,
      fontSize: '13px'
    }
  }, initials(r.who)), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px'
    }
  }, /*#__PURE__*/React.createElement("strong", {
    style: {
      fontSize: '14px',
      color: 'var(--ink-900)'
    }
  }, r.who), /*#__PURE__*/React.createElement(Stars, {
    value: r.rating,
    size: 13
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '12px',
      color: 'var(--ink-400)'
    }
  }, r.when, r.product ? ` · ${r.product}` : ''))), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '14px',
      lineHeight: 1.55,
      color: 'var(--ink-700)'
    }
  }, r.text));
}

// ===== Checkout (indirizzo → consegna → pagamento → conferma) =====
function CheckoutPage({
  items,
  onBack,
  onPlace
}) {
  const [addr, setAddr] = React.useState(window.MC_ADDRESSES.find(a => a.def).id);
  const [slot, setSlot] = React.useState(window.MC_SLOTS.find(s => s.fee === 0).id);
  const [pay, setPay] = React.useState('cod');
  const [note, setNote] = React.useState('');
  const subtotal = items.reduce((s, it) => s + it.finalPrice * it.qty, 0);
  const chosenSlot = window.MC_SLOTS.find(s => s.id === slot) || {};
  const shipping = subtotal >= 25 ? 0 : chosenSlot.fee || 0;
  const total = subtotal + shipping;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 'var(--container-max)',
      margin: '0 auto',
      padding: '24px 20px'
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: onBack,
    style: backLink
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "arrow-left",
    size: 17
  }), " Torna al carrello"), /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: '6px 0 20px',
      fontFamily: 'var(--font-serif)',
      fontSize: '32px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, "Conferma il tuo ordine"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 380px',
      gap: '28px',
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '16px'
    }
  }, /*#__PURE__*/React.createElement(StepCard, {
    n: 1,
    icon: "map-pin",
    title: "Indirizzo di consegna"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '12px'
    }
  }, window.MC_ADDRESSES.map(a => /*#__PURE__*/React.createElement(SelectTile, {
    key: a.id,
    active: addr === a.id,
    onClick: () => setAddr(a.id)
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      marginBottom: '4px'
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    variant: "local"
  }, a.label), a.def && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '11px',
      color: 'var(--ink-400)'
    }
  }, "Predefinito")), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '14px',
      fontWeight: 600,
      color: 'var(--ink-900)'
    }
  }, a.name), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 0',
      fontSize: '13px',
      color: 'var(--ink-600)'
    }
  }, a.street, ", ", a.city)))), /*#__PURE__*/React.createElement("button", {
    style: ghostAdd
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "plus",
    size: 15
  }), " Aggiungi nuovo indirizzo")), /*#__PURE__*/React.createElement(StepCard, {
    n: 2,
    icon: "truck",
    title: "Quando vuoi riceverlo"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: '12px'
    }
  }, window.MC_SLOTS.map(s => /*#__PURE__*/React.createElement(SelectTile, {
    key: s.id,
    active: slot === s.id,
    onClick: () => setSlot(s.id)
  }, s.label && /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      top: '-9px',
      left: '12px'
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    variant: s.fee === 0 ? 'new' : 'urgency'
  }, s.label)), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '14px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, s.day), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 6px',
      fontSize: '13px',
      color: 'var(--ink-600)'
    }
  }, s.time), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '13px',
      fontWeight: 700,
      color: s.fee === 0 ? 'var(--olive-700)' : 'var(--ink-700)'
    }
  }, s.fee === 0 ? 'Gratis' : fmt(s.fee)))))), /*#__PURE__*/React.createElement(StepCard, {
    n: 3,
    icon: "banknote",
    title: "Come paghi"
  }, /*#__PURE__*/React.createElement(SelectTile, {
    active: pay === 'cod',
    onClick: () => setPay('cod'),
    row: true
  }, /*#__PURE__*/React.createElement("span", {
    style: payIcon('var(--olive-100)', 'var(--olive-700)')
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "banknote",
    size: 20,
    color: "var(--olive-700)"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '14px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, "Paga alla consegna \xB7 contanti"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 0',
      fontSize: '13px',
      color: 'var(--ink-600)'
    }
  }, "Paghi al rider quando arriva. Tieni pronti ", fmt(total), ".")), /*#__PURE__*/React.createElement(Badge, {
    variant: "new"
  }, "Consigliato")), /*#__PURE__*/React.createElement(SelectTile, {
    active: pay === 'card',
    onClick: () => setPay('card'),
    row: true,
    style: {
      marginTop: '10px',
      opacity: .7
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: payIcon('var(--surface-200)', 'var(--ink-500)')
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "credit-card",
    size: 20,
    color: "var(--ink-500)"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '14px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, "Carta di credito"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 0',
      fontSize: '13px',
      color: 'var(--ink-500)'
    }
  }, "Presto disponibile"))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: '14px'
    }
  }, /*#__PURE__*/React.createElement(Input, {
    label: "Note per il rider (facoltativo)",
    placeholder: "Es. citofono Bianchi, 2\xB0 piano",
    value: note,
    onChange: e => setNote(e.target.value)
  })))), /*#__PURE__*/React.createElement("aside", {
    style: {
      position: 'sticky',
      top: '128px'
    }
  }, /*#__PURE__*/React.createElement(Card, {
    variant: "elevated",
    padding: "lg"
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: '0 0 14px',
      fontFamily: 'var(--font-serif)',
      fontSize: '18px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, "Riepilogo"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      maxHeight: '220px',
      overflowY: 'auto',
      marginBottom: '12px'
    }
  }, items.map(it => /*#__PURE__*/React.createElement("div", {
    key: it.id,
    style: {
      display: 'flex',
      gap: '10px',
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative'
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: it.img,
    alt: it.name,
    style: {
      width: '46px',
      height: '46px',
      borderRadius: 'var(--radius-md)',
      objectFit: 'cover'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      top: '-6px',
      right: '-6px',
      minWidth: '18px',
      height: '18px',
      padding: '0 4px',
      borderRadius: '50%',
      background: 'var(--ink-900)',
      color: '#fff',
      fontSize: '11px',
      fontWeight: 700,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, it.qty)), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      fontSize: '13px',
      color: 'var(--ink-700)',
      lineHeight: 1.3
    }
  }, it.name), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '13px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, fmt(it.finalPrice * it.qty))))), /*#__PURE__*/React.createElement(Divider, null), /*#__PURE__*/React.createElement(Row, {
    label: "Subtotale",
    val: fmt(subtotal)
  }), /*#__PURE__*/React.createElement(Row, {
    label: `Consegna · ${chosenSlot.day} ${chosenSlot.time}`,
    val: shipping === 0 ? 'Gratis' : fmt(shipping),
    olive: shipping === 0
  }), /*#__PURE__*/React.createElement(Divider, null), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      fontSize: '20px',
      fontWeight: 800,
      color: 'var(--ink-900)',
      margin: '6px 0 14px'
    }
  }, /*#__PURE__*/React.createElement("span", null, "Totale"), /*#__PURE__*/React.createElement("span", null, fmt(total))), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    size: "lg",
    fullWidth: true,
    iconRight: "arrow-right",
    onClick: () => onPlace({
      items,
      total,
      slot: chosenSlot,
      address: window.MC_ADDRESSES.find(a => a.id === addr)
    })
  }, "Conferma e ordina"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '10px 0 0',
      fontSize: '12px',
      color: 'var(--ink-500)',
      textAlign: 'center'
    }
  }, "Confermando accetti i termini. Paghi solo alla consegna.")))));
}
const backLink = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  border: 0,
  background: 'transparent',
  color: 'var(--ink-600)',
  fontSize: '14px',
  fontWeight: 500,
  cursor: 'pointer',
  padding: '8px 0',
  fontFamily: 'var(--font-sans)'
};
const ghostAdd = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  marginTop: '12px',
  border: '1px dashed var(--cream-400)',
  background: 'transparent',
  color: 'var(--primary-700)',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer',
  padding: '10px 14px',
  borderRadius: 'var(--radius-md)',
  fontFamily: 'var(--font-sans)',
  width: '100%',
  justifyContent: 'center'
};
const payIcon = (bg, fg) => ({
  width: '40px',
  height: '40px',
  borderRadius: 'var(--radius-md)',
  background: bg,
  color: fg,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0
});
function StepCard({
  n,
  icon,
  title,
  children
}) {
  return /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "lg"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      marginBottom: '14px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '28px',
      height: '28px',
      borderRadius: '50%',
      background: 'var(--primary-700)',
      color: '#fff',
      fontSize: '14px',
      fontWeight: 700,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'var(--font-sans)'
    }
  }, n), /*#__PURE__*/React.createElement(Lucide, {
    name: icon,
    size: 18,
    color: "var(--primary-700)"
  }), /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-serif)',
      fontSize: '18px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, title)), children);
}
function SelectTile({
  active,
  onClick,
  children,
  row,
  style
}) {
  return /*#__PURE__*/React.createElement("button", {
    onClick: onClick,
    style: {
      position: 'relative',
      textAlign: 'left',
      cursor: 'pointer',
      display: row ? 'flex' : 'block',
      alignItems: 'center',
      gap: '12px',
      width: '100%',
      background: active ? 'var(--primary-50)' : 'var(--surface-0)',
      border: `1.5px solid ${active ? 'var(--primary-500)' : 'var(--cream-300)'}`,
      borderRadius: 'var(--radius-lg)',
      padding: '14px',
      fontFamily: 'var(--font-sans)',
      boxShadow: active ? '0 0 0 3px rgba(228,122,90,.15)' : 'none',
      transition: 'border-color var(--dur-base), background var(--dur-base)',
      ...style
    }
  }, children);
}
function Row({
  label,
  val,
  olive
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      fontSize: '14px',
      color: 'var(--ink-600)',
      padding: '3px 0'
    }
  }, /*#__PURE__*/React.createElement("span", null, label), /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 600,
      color: olive ? 'var(--olive-700)' : 'var(--ink-800)'
    }
  }, val));
}
function Divider() {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      height: '1px',
      background: 'var(--cream-300)',
      margin: '10px 0'
    }
  });
}

// ===== Search results page (SRP) — faceted filters + sort =====
const MC_SORTS = [['rilevanza', 'Rilevanza'], ['prezzo-asc', 'Prezzo crescente'], ['prezzo-desc', 'Prezzo decrescente'], ['sconto', 'Sconto maggiore'], ['novita', 'Novità']];
function SearchResults({
  allProducts,
  query,
  cat,
  onOpen,
  onAdd,
  onStore,
  onClearNav
}) {
  const [priceMax, setPriceMax] = React.useState(40);
  const [stores, setStores] = React.useState(() => new Set());
  const [deliveryToday, setDeliveryToday] = React.useState(false);
  const [onlyDiscount, setOnlyDiscount] = React.useState(false);
  const [inStock, setInStock] = React.useState(false);
  const [sort, setSort] = React.useState('rilevanza');
  const storeNames = [...new Set(allProducts.map(p => p.store))];
  let list = allProducts.filter(p => {
    if (cat && p.cat !== cat) return false;
    if (query) {
      const q = query.toLowerCase();
      if (!p.name.toLowerCase().includes(q) && !p.store.toLowerCase().includes(q) && !(p.tags || []).join(' ').toLowerCase().includes(q)) return false;
    }
    if (finalPrice(p) > priceMax) return false;
    if (stores.size && !stores.has(p.store)) return false;
    if (deliveryToday && !(storeBy(p.store) || {}).deliveryToday) return false;
    if (onlyDiscount && !(p.discountPercent > 0)) return false;
    if (inStock && p.stock === 0) return false;
    return true;
  });
  list = [...list].sort((a, b) => {
    if (sort === 'prezzo-asc') return finalPrice(a) - finalPrice(b);
    if (sort === 'prezzo-desc') return finalPrice(b) - finalPrice(a);
    if (sort === 'sconto') return (b.discountPercent || 0) - (a.discountPercent || 0);
    if (sort === 'novita') return (b.isNew ? 1 : 0) - (a.isNew ? 1 : 0);
    return 0;
  });
  const catLabel = cat ? (window.MC_CATEGORIES.find(c => c.slug === cat) || {}).label : null;
  const heading = query ? `Risultati per “${query}”` : catLabel || 'Tutti i prodotti';
  const activeFilters = (stores.size > 0) + deliveryToday + onlyDiscount + inStock + (priceMax < 40);
  function toggleStore(name) {
    setStores(prev => {
      const n = new Set(prev);
      n.has(name) ? n.delete(name) : n.add(name);
      return n;
    });
  }
  function reset() {
    setPriceMax(40);
    setStores(new Set());
    setDeliveryToday(false);
    setOnlyDiscount(false);
    setInStock(false);
  }
  return /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 'var(--container-max)',
      margin: '0 auto',
      padding: '24px 20px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: '13px',
      color: 'var(--ink-500)',
      marginBottom: '6px',
      display: 'flex',
      alignItems: 'center',
      gap: '6px'
    }
  }, /*#__PURE__*/React.createElement("a", {
    onClick: onClearNav,
    style: {
      cursor: 'pointer',
      color: 'var(--ink-500)'
    }
  }, "Home"), " ", /*#__PURE__*/React.createElement(Lucide, {
    name: "chevron-right",
    size: 13,
    color: "var(--ink-400)"
  }), " ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--ink-700)'
    }
  }, heading)), /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: '0 0 4px',
      fontFamily: 'var(--font-serif)',
      fontSize: '30px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, heading), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '248px 1fr',
      gap: '28px',
      marginTop: '18px',
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement("aside", {
    style: {
      position: 'sticky',
      top: '128px',
      display: 'flex',
      flexDirection: 'column',
      gap: '20px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-serif)',
      fontSize: '18px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, "Filtri"), activeFilters > 0 && /*#__PURE__*/React.createElement("button", {
    onClick: reset,
    style: {
      border: 0,
      background: 'transparent',
      color: 'var(--primary-700)',
      fontSize: '13px',
      fontWeight: 600,
      cursor: 'pointer',
      fontFamily: 'var(--font-sans)'
    }
  }, "Azzera")), /*#__PURE__*/React.createElement(FilterGroup, {
    title: "Prezzo massimo"
  }, /*#__PURE__*/React.createElement("input", {
    type: "range",
    min: "3",
    max: "40",
    step: "1",
    value: priceMax,
    onChange: e => setPriceMax(+e.target.value),
    style: {
      width: '100%',
      accentColor: 'var(--primary-600)'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      fontSize: '12px',
      color: 'var(--ink-500)'
    }
  }, /*#__PURE__*/React.createElement("span", null, "\u20AC3"), /*#__PURE__*/React.createElement("strong", {
    style: {
      color: 'var(--ink-900)'
    }
  }, "fino a ", fmt(priceMax)))), /*#__PURE__*/React.createElement(FilterGroup, {
    title: "Disponibilit\xE0"
  }, /*#__PURE__*/React.createElement(Checkbox, {
    label: "Consegna oggi",
    checked: deliveryToday,
    onChange: e => setDeliveryToday(e.target.checked)
  }), /*#__PURE__*/React.createElement(Checkbox, {
    label: "Solo in offerta",
    checked: onlyDiscount,
    onChange: e => setOnlyDiscount(e.target.checked)
  }), /*#__PURE__*/React.createElement(Checkbox, {
    label: "Solo disponibili",
    checked: inStock,
    onChange: e => setInStock(e.target.checked)
  })), /*#__PURE__*/React.createElement(FilterGroup, {
    title: "Negozio"
  }, storeNames.map(s => /*#__PURE__*/React.createElement(Checkbox, {
    key: s,
    label: s,
    checked: stores.has(s),
    onChange: () => toggleStore(s)
  })))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: '16px',
      flexWrap: 'wrap',
      gap: '10px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '14px',
      color: 'var(--ink-500)'
    }
  }, /*#__PURE__*/React.createElement("strong", {
    style: {
      color: 'var(--ink-900)'
    }
  }, list.length), " prodotti dai negozi di Piacenza"), /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px',
      fontSize: '13px',
      color: 'var(--ink-500)'
    }
  }, "Ordina per", /*#__PURE__*/React.createElement("select", {
    value: sort,
    onChange: e => setSort(e.target.value),
    style: {
      appearance: 'none',
      border: '1px solid var(--cream-300)',
      background: 'var(--surface-0)',
      borderRadius: 'var(--radius-md)',
      padding: '8px 30px 8px 12px',
      fontSize: '13px',
      fontWeight: 600,
      color: 'var(--ink-900)',
      fontFamily: 'var(--font-sans)',
      cursor: 'pointer',
      backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'14\' height=\'14\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%2378716c\' stroke-width=\'2.4\'%3E%3Cpolyline points=\'6 9 12 15 18 9\'/%3E%3C/svg%3E")',
      backgroundRepeat: 'no-repeat',
      backgroundPosition: 'right 10px center'
    }
  }, MC_SORTS.map(([v, l]) => /*#__PURE__*/React.createElement("option", {
    key: v,
    value: v
  }, l))))), list.length === 0 ? /*#__PURE__*/React.createElement(Card, {
    variant: "flat",
    padding: "lg"
  }, /*#__PURE__*/React.createElement(EmptyState, {
    icon: "search-x",
    title: "Nessun risultato",
    description: "Prova ad allargare i filtri o cambiare termine di ricerca.",
    action: /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      onClick: reset
    }, "Azzera i filtri")
  })) : /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: '16px'
    }
  }, list.map(p => /*#__PURE__*/React.createElement(ProductGridCard, {
    key: p.id,
    p: p,
    onOpen: onOpen,
    onAdd: onAdd,
    onStore: onStore
  }))))));
}
function FilterGroup({
  title,
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      borderTop: '1px solid var(--cream-300)',
      paddingTop: '14px',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '13px',
      fontWeight: 700,
      color: 'var(--ink-800)',
      textTransform: 'uppercase',
      letterSpacing: '0.03em'
    }
  }, title), children);
}

// ===== Account hub (profilo, ordini, preferiti, notifiche, messaggi, indirizzi) =====
const MC_ACCOUNT_NAV = [{
  id: 'ordini',
  icon: 'package',
  label: 'I miei ordini'
}, {
  id: 'preferiti',
  icon: 'heart',
  label: 'Preferiti'
}, {
  id: 'messaggi',
  icon: 'message-circle',
  label: 'Messaggi'
}, {
  id: 'notifiche',
  icon: 'bell',
  label: 'Notifiche'
}, {
  id: 'indirizzi',
  icon: 'map-pin',
  label: 'Indirizzi'
}, {
  id: 'profilo',
  icon: 'user',
  label: 'Profilo'
}];
function AccountPage({
  section = 'ordini',
  onSection,
  products,
  onOpen,
  onAdd,
  onStore,
  onOpenOrder
}) {
  const u = window.MC_USER;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 'var(--container-max)',
      margin: '0 auto',
      padding: '24px 20px',
      display: 'grid',
      gridTemplateColumns: '260px 1fr',
      gap: '28px',
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement("aside", {
    style: {
      position: 'sticky',
      top: '128px'
    }
  }, /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "md",
    style: {
      marginBottom: '14px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '46px',
      height: '46px',
      borderRadius: '50%',
      background: 'linear-gradient(135deg, var(--primary-500), var(--primary-700))',
      color: '#fff',
      fontWeight: 700,
      fontSize: '17px',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, u.initials), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontWeight: 700,
      color: 'var(--ink-900)',
      fontSize: '15px'
    }
  }, u.name), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '12px',
      color: 'var(--ink-500)',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, u.email)))), /*#__PURE__*/React.createElement("nav", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '2px'
    }
  }, MC_ACCOUNT_NAV.map(n => {
    const on = section === n.id;
    return /*#__PURE__*/React.createElement("button", {
      key: n.id,
      onClick: () => onSection(n.id),
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        border: 0,
        background: on ? 'var(--primary-50)' : 'transparent',
        color: on ? 'var(--primary-800)' : 'var(--ink-700)',
        fontWeight: on ? 700 : 500,
        fontSize: '14px',
        padding: '10px 12px',
        borderRadius: 'var(--radius-md)',
        cursor: 'pointer',
        fontFamily: 'var(--font-sans)',
        textAlign: 'left'
      }
    }, /*#__PURE__*/React.createElement(Lucide, {
      name: n.icon,
      size: 18,
      color: on ? 'var(--primary-700)' : 'var(--ink-500)'
    }), " ", n.label, n.id === 'notifiche' && /*#__PURE__*/React.createElement("span", {
      style: {
        marginLeft: 'auto',
        background: 'var(--secondary-600)',
        color: '#fff',
        fontSize: '11px',
        fontWeight: 700,
        borderRadius: '999px',
        padding: '1px 7px'
      }
    }, "2"));
  }), /*#__PURE__*/React.createElement("button", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      border: 0,
      background: 'transparent',
      color: 'var(--ink-500)',
      fontSize: '14px',
      padding: '10px 12px',
      borderRadius: 'var(--radius-md)',
      cursor: 'pointer',
      fontFamily: 'var(--font-sans)',
      marginTop: '8px'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "log-out",
    size: 18,
    color: "var(--ink-400)"
  }), " Esci"))), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, section === 'ordini' && /*#__PURE__*/React.createElement(OrdersList, {
    onOpenOrder: onOpenOrder,
    onReorder: onAdd
  }), section === 'preferiti' && /*#__PURE__*/React.createElement(FavoritesView, {
    products: products,
    onOpen: onOpen,
    onAdd: onAdd,
    onStore: onStore
  }), section === 'messaggi' && /*#__PURE__*/React.createElement(MessagesView, null), section === 'notifiche' && /*#__PURE__*/React.createElement(NotificationsView, null), section === 'indirizzi' && /*#__PURE__*/React.createElement(AddressesView, null), section === 'profilo' && /*#__PURE__*/React.createElement(ProfileView, null)));
}
function PageHead({
  title,
  sub
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: '18px'
    }
  }, /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-serif)',
      fontSize: '28px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, title), sub && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '4px 0 0',
      fontSize: '14px',
      color: 'var(--ink-500)'
    }
  }, sub));
}
function OrdersList({
  onOpenOrder,
  onReorder
}) {
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(PageHead, {
    title: "I miei ordini",
    sub: `${window.MC_ORDERS.length} ordini`
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '12px'
    }
  }, window.MC_ORDERS.map(o => {
    const lines = o.lines.map(l => ({
      p: window.MC_PRODUCTS.find(x => x.id === l.id),
      q: l.q
    })).filter(x => x.p);
    return /*#__PURE__*/React.createElement(Card, {
      key: o.id,
      variant: "bordered",
      padding: "md"
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '10px',
        marginBottom: '12px'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '12px'
      }
    }, /*#__PURE__*/React.createElement("strong", {
      style: {
        fontSize: '15px',
        color: 'var(--ink-900)'
      }
    }, o.id), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: '13px',
        color: 'var(--ink-500)'
      }
    }, o.date, " \xB7 ", o.store)), /*#__PURE__*/React.createElement(OrderStatusBadge, {
      status: o.status,
      size: "sm"
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: '6px',
        flex: 1
      }
    }, lines.map(({
      p,
      q
    }) => /*#__PURE__*/React.createElement("div", {
      key: p.id,
      style: {
        position: 'relative'
      },
      title: `${p.name} ×${q}`
    }, /*#__PURE__*/React.createElement("img", {
      src: imgUrl(p.kw, p.galleryLocks[0]),
      alt: p.name,
      style: {
        width: '48px',
        height: '48px',
        borderRadius: 'var(--radius-md)',
        objectFit: 'cover'
      }
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        position: 'absolute',
        top: '-6px',
        right: '-6px',
        minWidth: '17px',
        height: '17px',
        padding: '0 4px',
        borderRadius: '50%',
        background: 'var(--ink-900)',
        color: '#fff',
        fontSize: '10px',
        fontWeight: 700,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center'
      }
    }, q))), /*#__PURE__*/React.createElement("span", {
      style: {
        alignSelf: 'center',
        marginLeft: '6px',
        fontSize: '16px',
        fontWeight: 800,
        color: 'var(--ink-900)'
      }
    }, fmt(o.total))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: '8px'
      }
    }, (o.status === 'OUT_FOR_DELIVERY' || o.status === 'ASSIGNED' || o.status === 'NEW') && /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      size: "sm",
      icon: "map-pin",
      onClick: () => onOpenOrder(o)
    }, "Traccia"), /*#__PURE__*/React.createElement(Button, {
      variant: "ghost",
      size: "sm",
      icon: "rotate-ccw",
      onClick: () => {
        lines.forEach(({
          p,
          q
        }) => onReorder(p, q));
      }
    }, "Riordina"))));
  })));
}
function FavoritesView({
  products,
  onOpen,
  onAdd,
  onStore
}) {
  const favs = window.MC_FAVORITES.map(id => products.find(p => p.id === id)).filter(Boolean);
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(PageHead, {
    title: "Preferiti",
    sub: `${favs.length} prodotti salvati`
  }), favs.length === 0 ? /*#__PURE__*/React.createElement(EmptyState, {
    icon: "heart",
    title: "Nessun preferito",
    description: "Tocca il cuore su un prodotto per salvarlo qui."
  }) : /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: '16px'
    }
  }, favs.map(p => /*#__PURE__*/React.createElement(ProductGridCard, {
    key: p.id,
    p: p,
    onOpen: onOpen,
    onAdd: onAdd,
    onStore: onStore
  }))));
}
function NotificationsView() {
  const TONE = {
    primary: ['var(--primary-100)', 'var(--primary-700)'],
    secondary: ['var(--secondary-100)', 'var(--secondary-600)'],
    accent: ['var(--accent-100)', 'var(--accent-700)'],
    olive: ['var(--olive-100)', 'var(--olive-700)']
  };
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(PageHead, {
    title: "Notifiche"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '8px'
    }
  }, window.MC_NOTIFICATIONS.map(n => /*#__PURE__*/React.createElement(Card, {
    key: n.id,
    variant: n.unread ? 'elevated' : 'bordered',
    padding: "md",
    style: n.unread ? {
      borderColor: 'var(--primary-200)'
    } : {}
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: '12px',
      alignItems: 'flex-start'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '40px',
      height: '40px',
      borderRadius: '50%',
      background: TONE[n.tone][0],
      color: TONE[n.tone][1],
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: n.icon,
    size: 19,
    color: TONE[n.tone][1]
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '14px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, n.title), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 0',
      fontSize: '13px',
      color: 'var(--ink-600)'
    }
  }, n.body)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '12px',
      color: 'var(--ink-400)'
    }
  }, n.when), n.unread && /*#__PURE__*/React.createElement("span", {
    style: {
      width: '8px',
      height: '8px',
      borderRadius: '50%',
      background: 'var(--primary-600)'
    }
  })))))));
}
function MessagesView() {
  const [active, setActive] = React.useState(window.MC_THREADS[0].id);
  const thread = window.MC_THREADS.find(t => t.id === active);
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(PageHead, {
    title: "Messaggi",
    sub: "Scrivi direttamente ai negozi"
  }), /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "none"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '240px 1fr',
      height: '440px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      borderRight: '1px solid var(--cream-200)',
      overflowY: 'auto'
    }
  }, window.MC_THREADS.map(t => /*#__PURE__*/React.createElement("button", {
    key: t.id,
    onClick: () => setActive(t.id),
    style: {
      display: 'flex',
      gap: '10px',
      width: '100%',
      textAlign: 'left',
      border: 0,
      borderBottom: '1px solid var(--cream-100)',
      background: active === t.id ? 'var(--primary-50)' : 'transparent',
      padding: '12px 14px',
      cursor: 'pointer',
      fontFamily: 'var(--font-sans)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '36px',
      height: '36px',
      borderRadius: '50%',
      background: 'linear-gradient(135deg, var(--primary-500), var(--primary-700))',
      color: '#fff',
      fontWeight: 700,
      fontSize: '13px',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0
    }
  }, initials(t.store)), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      gap: '6px'
    }
  }, /*#__PURE__*/React.createElement("strong", {
    style: {
      fontSize: '13px',
      color: 'var(--ink-900)'
    }
  }, t.store), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '11px',
      color: 'var(--ink-400)'
    }
  }, t.when)), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 0',
      fontSize: '12px',
      color: 'var(--ink-500)',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, t.last)), t.unread > 0 && /*#__PURE__*/React.createElement("span", {
    style: {
      alignSelf: 'center',
      background: 'var(--secondary-600)',
      color: '#fff',
      fontSize: '11px',
      fontWeight: 700,
      borderRadius: '999px',
      minWidth: '18px',
      height: '18px',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, t.unread)))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '12px 16px',
      borderBottom: '1px solid var(--cream-200)',
      display: 'flex',
      alignItems: 'center',
      gap: '8px'
    }
  }, /*#__PURE__*/React.createElement(StoreChip, {
    name: thread.store,
    size: 26
  }), " ", /*#__PURE__*/React.createElement(Lucide, {
    name: "badge-check",
    size: 15,
    color: "var(--primary-600)"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflowY: 'auto',
      padding: '16px',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      background: 'var(--cream-50)'
    }
  }, thread.msgs.map((m, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      alignSelf: m.me ? 'flex-end' : 'flex-start',
      maxWidth: '72%'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: m.me ? 'var(--primary-700)' : '#fff',
      color: m.me ? '#fff' : 'var(--ink-800)',
      border: m.me ? 'none' : '1px solid var(--cream-300)',
      borderRadius: m.me ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
      padding: '9px 13px',
      fontSize: '14px',
      lineHeight: 1.4
    }
  }, m.text), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'block',
      fontSize: '10px',
      color: 'var(--ink-400)',
      marginTop: '3px',
      textAlign: m.me ? 'right' : 'left'
    }
  }, m.when)))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '12px 16px',
      borderTop: '1px solid var(--cream-200)',
      display: 'flex',
      gap: '8px'
    }
  }, /*#__PURE__*/React.createElement("input", {
    placeholder: "Scrivi un messaggio\u2026",
    style: {
      flex: 1,
      border: '1px solid var(--cream-300)',
      borderRadius: 'var(--radius-full)',
      padding: '10px 14px',
      fontSize: '14px',
      fontFamily: 'var(--font-sans)',
      outline: 'none'
    }
  }), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    icon: "send"
  }, "Invia"))))));
}
function AddressesView() {
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(PageHead, {
    title: "Indirizzi",
    sub: "Dove consegniamo i tuoi ordini"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(2, 1fr)',
      gap: '14px'
    }
  }, window.MC_ADDRESSES.map(a => /*#__PURE__*/React.createElement(Card, {
    key: a.id,
    variant: "bordered",
    padding: "lg"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      marginBottom: '8px'
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    variant: "local"
  }, a.label), a.def && /*#__PURE__*/React.createElement(Badge, {
    variant: "new"
  }, "Predefinito")), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, a.name), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '4px 0 0',
      fontSize: '14px',
      color: 'var(--ink-600)'
    }
  }, a.street), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 0',
      fontSize: '14px',
      color: 'var(--ink-600)'
    }
  }, a.city), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '8px 0 14px',
      fontSize: '13px',
      color: 'var(--ink-500)'
    }
  }, a.phone), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: '8px'
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "sm",
    icon: "pencil"
  }, "Modifica"), /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    size: "sm",
    icon: "trash-2"
  }, "Elimina")))), /*#__PURE__*/React.createElement("button", {
    style: {
      border: '1.5px dashed var(--cream-400)',
      borderRadius: 'var(--radius-lg)',
      background: 'transparent',
      color: 'var(--primary-700)',
      cursor: 'pointer',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '8px',
      minHeight: '160px',
      fontFamily: 'var(--font-sans)',
      fontWeight: 600
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "plus",
    size: 24
  }), " Aggiungi indirizzo")));
}
function ProfileView() {
  const u = window.MC_USER;
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(PageHead, {
    title: "Profilo"
  }), /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "lg",
    style: {
      maxWidth: '520px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '16px',
      marginBottom: '20px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '64px',
      height: '64px',
      borderRadius: '50%',
      background: 'linear-gradient(135deg, var(--primary-500), var(--primary-700))',
      color: '#fff',
      fontWeight: 700,
      fontSize: '24px',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, u.initials), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-serif)',
      fontSize: '20px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, u.name), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 0',
      fontSize: '13px',
      color: 'var(--ink-500)'
    }
  }, "Cliente dal ", u.since))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '14px'
    }
  }, /*#__PURE__*/React.createElement(Input, {
    label: "Nome e cognome",
    defaultValue: u.name
  }), /*#__PURE__*/React.createElement(Input, {
    label: "Email",
    defaultValue: u.email,
    type: "email"
  }), /*#__PURE__*/React.createElement(Input, {
    label: "Telefono",
    defaultValue: u.phone
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: '10px',
      marginTop: '4px'
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "primary"
  }, "Salva modifiche"), /*#__PURE__*/React.createElement(Button, {
    variant: "ghost"
  }, "Annulla")))));
}

// ===== Product detail page (PDP) — gallery, buy box, ETA, reviews, cross-sell =====
function ProductPage({
  product: p,
  onBack,
  onAdd,
  onOpen,
  onStore
}) {
  const [qty, setQty] = React.useState(1);
  const [activeImg, setActiveImg] = React.useState(0);
  const store = storeBy(p.store) || {};
  const fp = finalPrice(p);
  const hasDisc = p.discountPercent > 0;
  const out = p.stock === 0;
  const low = p.stock > 0 && p.stock <= 3;
  const gallery = p.galleryLocks.map(l => imgUrl(p.kw, l));
  const pairings = (window.MC_PAIRINGS[p.id] || []).map(id => window.MC_PRODUCTS.find(x => x.id === id)).filter(Boolean);
  const sameStore = window.MC_PRODUCTS.filter(x => x.store === p.store && x.id !== p.id).slice(0, 4);
  const reviews = window.MC_REVIEWS[p.id] || [];
  React.useEffect(() => {
    setQty(1);
    setActiveImg(0);
  }, [p.id]);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 'var(--container-max)',
      margin: '0 auto',
      padding: '20px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: '13px',
      color: 'var(--ink-500)',
      marginBottom: '10px',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("a", {
    onClick: onBack,
    style: {
      cursor: 'pointer',
      color: 'var(--ink-500)'
    }
  }, "Home"), /*#__PURE__*/React.createElement(Lucide, {
    name: "chevron-right",
    size: 13,
    color: "var(--ink-400)"
  }), /*#__PURE__*/React.createElement("a", {
    onClick: () => onStore(store),
    style: {
      cursor: 'pointer',
      color: 'var(--ink-500)'
    }
  }, p.store), /*#__PURE__*/React.createElement(Lucide, {
    name: "chevron-right",
    size: 13,
    color: "var(--ink-400)"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--ink-700)'
    }
  }, p.name)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '36px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '12px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      borderRadius: 'var(--radius-2xl)',
      overflow: 'hidden',
      border: '1px solid var(--cream-300)',
      aspectRatio: '1/1',
      background: 'var(--surface-100)'
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: gallery[activeImg],
    alt: p.name,
    style: {
      width: '100%',
      height: '100%',
      objectFit: 'cover'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      top: '14px',
      left: '14px',
      display: 'flex',
      flexDirection: 'column',
      gap: '6px'
    }
  }, hasDisc && /*#__PURE__*/React.createElement(Badge, {
    variant: "discount",
    size: "md"
  }, "-", p.discountPercent, "%"), p.isNew && /*#__PURE__*/React.createElement(Badge, {
    variant: "new",
    size: "md"
  }, "Nuovo"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: '10px'
    }
  }, gallery.map((g, i) => /*#__PURE__*/React.createElement("button", {
    key: i,
    onClick: () => setActiveImg(i),
    style: {
      width: '72px',
      height: '72px',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
      border: `2px solid ${i === activeImg ? 'var(--primary-600)' : 'var(--cream-300)'}`,
      padding: 0,
      cursor: 'pointer',
      background: 'none'
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: g,
    alt: "",
    style: {
      width: '100%',
      height: '100%',
      objectFit: 'cover'
    }
  }))))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '16px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    onClick: () => onStore(store),
    style: {
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      alignSelf: 'flex-start'
    }
  }, /*#__PURE__*/React.createElement(StoreChip, {
    name: p.store,
    size: 24
  }), store.verified && /*#__PURE__*/React.createElement(Lucide, {
    name: "badge-check",
    size: 16,
    color: "var(--primary-600)"
  })), /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-serif)',
      fontSize: '34px',
      fontWeight: 700,
      lineHeight: 1.1,
      color: 'var(--ink-900)'
    }
  }, p.name), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      fontSize: '14px',
      color: 'var(--ink-500)'
    }
  }, /*#__PURE__*/React.createElement(Stars, {
    value: p.rating,
    size: 16
  }), " ", /*#__PURE__*/React.createElement("strong", {
    style: {
      color: 'var(--ink-800)'
    }
  }, String(p.rating).replace('.', ',')), " \xB7 ", p.reviews, " recensioni"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'baseline',
      gap: '10px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: '32px',
      fontWeight: 800,
      color: hasDisc ? 'var(--secondary-600)' : 'var(--ink-900)'
    }
  }, fmt(fp)), hasDisc && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '17px',
      color: 'var(--ink-400)',
      textDecoration: 'line-through'
    }
  }, fmt(p.price)), hasDisc && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '13px',
      fontWeight: 700,
      color: 'var(--secondary-600)'
    }
  }, "Risparmi ", fmt(p.price - fp))), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '16px',
      lineHeight: 1.65,
      color: 'var(--ink-700)'
    }
  }, p.desc), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: '8px'
    }
  }, (p.tags || []).map(t => /*#__PURE__*/React.createElement(Badge, {
    key: t,
    variant: "local"
  }, t)), /*#__PURE__*/React.createElement(Badge, {
    variant: "cod",
    icon: "banknote"
  }, "Paga alla consegna"), p.freeShipping && /*#__PURE__*/React.createElement(Badge, {
    variant: "free",
    icon: "truck"
  }, "Spedizione gratis"), low && /*#__PURE__*/React.createElement(Badge, {
    variant: "lowstock",
    icon: "flame"
  }, "Ultimi ", p.stock)), /*#__PURE__*/React.createElement("div", {
    style: {
      height: '1px',
      background: 'var(--cream-300)',
      margin: '4px 0'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: '14px',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      color: out ? 'var(--secondary-600)' : 'var(--olive-700)',
      fontWeight: 600
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: out ? 'x-circle' : 'check-circle-2',
    size: 16,
    color: out ? 'var(--secondary-600)' : 'var(--olive-600)'
  }), out ? 'Momentaneamente esaurito' : `Disponibile · ${p.stock} pezzi in negozio`), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      border: '1px solid var(--cream-300)',
      borderRadius: 'var(--radius-full)',
      overflow: 'hidden',
      opacity: out ? .5 : 1
    }
  }, /*#__PURE__*/React.createElement("button", {
    disabled: out,
    onClick: () => setQty(q => Math.max(1, q - 1)),
    style: qtyBtn
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "minus",
    size: 16
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      minWidth: '36px',
      textAlign: 'center',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, qty), /*#__PURE__*/React.createElement("button", {
    disabled: out || qty >= p.stock,
    onClick: () => setQty(q => Math.min(p.stock, q + 1)),
    style: {
      ...qtyBtn,
      opacity: qty >= p.stock ? .4 : 1
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "plus",
    size: 16
  }))), /*#__PURE__*/React.createElement(Button, {
    variant: "accent",
    size: "lg",
    icon: "shopping-cart",
    disabled: out,
    fullWidth: true,
    onClick: () => onAdd(p, qty)
  }, out ? 'Esaurito' : `Aggiungi · ${fmt(fp * qty)}`)), qty >= p.stock && !out && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '12px',
      color: 'var(--ink-500)'
    }
  }, "Hai raggiunto le scorte disponibili."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      background: 'var(--olive-50)',
      borderRadius: 'var(--radius-lg)',
      padding: '14px 16px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px',
      fontSize: '14px',
      fontWeight: 600,
      color: 'var(--olive-800)'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "truck",
    size: 17,
    color: "var(--olive-700)"
  }), " ", store.deliveryToday ? 'Ordina entro le 18:00 → a casa domani' : 'Consegna in 24–48h'), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px',
      fontSize: '13px',
      color: 'var(--olive-800)'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "banknote",
    size: 16,
    color: "var(--olive-700)"
  }), " Paghi al rider alla consegna \xB7 contanti"), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px',
      fontSize: '13px',
      color: 'var(--olive-800)'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "rotate-ccw",
    size: 16,
    color: "var(--olive-700)"
  }), " Reso gratuito entro 14 giorni")))), pairings.length > 0 && /*#__PURE__*/React.createElement(Section, {
    title: "Spesso comprati insieme"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: '16px'
    }
  }, pairings.map(x => /*#__PURE__*/React.createElement(ProductGridCard, {
    key: x.id,
    p: x,
    onOpen: onOpen,
    onAdd: pp => onAdd(pp, 1),
    onStore: onStore
  })))), /*#__PURE__*/React.createElement(Section, {
    title: `Recensioni · ${p.reviews}`
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '220px 1fr',
      gap: '28px',
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement(Card, {
    variant: "flat",
    padding: "lg"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'center'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-serif)',
      fontSize: '44px',
      fontWeight: 800,
      color: 'var(--ink-900)',
      lineHeight: 1
    }
  }, String(p.rating).replace('.', ',')), /*#__PURE__*/React.createElement("div", {
    style: {
      margin: '8px 0 4px'
    }
  }, /*#__PURE__*/React.createElement(Stars, {
    value: p.rating,
    size: 18
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: '13px',
      color: 'var(--ink-500)'
    }
  }, p.reviews, " recensioni")), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: '16px',
      display: 'flex',
      flexDirection: 'column',
      gap: '6px'
    }
  }, [5, 4, 3, 2, 1].map(star => {
    const pct = star === 5 ? 78 : star === 4 ? 16 : star === 3 ? 4 : star === 2 ? 1 : 1;
    return /*#__PURE__*/React.createElement("div", {
      key: star,
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        fontSize: '12px',
        color: 'var(--ink-500)'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: '10px',
        textAlign: 'right'
      }
    }, star), /*#__PURE__*/React.createElement(Lucide, {
      name: "star",
      size: 11,
      color: "var(--accent-500)"
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        flex: 1,
        height: '6px',
        background: 'var(--cream-200)',
        borderRadius: '3px',
        overflow: 'hidden'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        display: 'block',
        width: `${pct}%`,
        height: '100%',
        background: 'var(--accent-500)'
      }
    })));
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '12px'
    }
  }, reviews.length === 0 ? /*#__PURE__*/React.createElement(EmptyState, {
    icon: "message-circle",
    title: "Ancora nessuna recensione",
    description: "Sii il primo a recensire questo prodotto dopo l\u2019acquisto."
  }) : reviews.map((r, i) => /*#__PURE__*/React.createElement(ReviewItem, {
    key: i,
    r: r
  }))))), sameStore.length > 0 && /*#__PURE__*/React.createElement(Section, {
    title: `Altro da ${p.store}`,
    action: /*#__PURE__*/React.createElement("a", {
      onClick: () => onStore(store),
      style: {
        cursor: 'pointer',
        color: 'var(--primary-700)',
        fontWeight: 600,
        fontSize: '14px',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px'
      }
    }, "Vai al negozio ", /*#__PURE__*/React.createElement(Lucide, {
      name: "arrow-right",
      size: 15,
      color: "var(--primary-700)"
    }))
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: '16px'
    }
  }, sameStore.map(x => /*#__PURE__*/React.createElement(ProductGridCard, {
    key: x.id,
    p: x,
    onOpen: onOpen,
    onAdd: pp => onAdd(pp, 1),
    onStore: onStore
  })))));
}
const qtyBtn = {
  width: '38px',
  height: '40px',
  border: 0,
  background: 'transparent',
  color: 'var(--ink-700)',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center'
};
function Section({
  title,
  action,
  children
}) {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      marginTop: '44px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      marginBottom: '16px'
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-serif)',
      fontSize: '24px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, title), action), children);
}

// ===== Cart drawer =====
function CartDrawer({
  open,
  items,
  onClose,
  onQty,
  onRemove,
  onCheckout,
  onContinue
}) {
  const subtotal = items.reduce((s, it) => s + it.finalPrice * it.qty, 0);
  const FREE = 25;
  const shipping = subtotal >= FREE || subtotal === 0 ? 0 : 3.5;
  const total = subtotal + shipping;
  const toFree = Math.max(0, FREE - subtotal);
  if (!open) return null;
  return ReactDOM.createPortal(/*#__PURE__*/React.createElement("div", {
    onClick: onClose,
    style: {
      position: 'fixed',
      inset: 0,
      zIndex: 'var(--z-modal)',
      background: 'rgba(0,0,0,.4)',
      backdropFilter: 'blur(2px)',
      display: 'flex',
      justifyContent: 'flex-end',
      animation: 'mc-fade-in var(--dur-fast) ease-out'
    }
  }, /*#__PURE__*/React.createElement("div", {
    onClick: e => e.stopPropagation(),
    role: "dialog",
    "aria-modal": "true",
    "aria-label": "Carrello",
    style: {
      width: '420px',
      maxWidth: '92vw',
      height: '100%',
      background: 'var(--surface-0)',
      display: 'flex',
      flexDirection: 'column',
      boxShadow: 'var(--shadow-warm-xl)',
      animation: 'mc-slide-right var(--dur-medium) var(--ease-out-quint)'
    }
  }, /*#__PURE__*/React.createElement("header", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '18px 20px',
      borderBottom: '1px solid var(--cream-200)'
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-serif)',
      fontSize: '20px',
      fontWeight: 700,
      color: 'var(--ink-900)',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "shopping-cart",
    size: 20
  }), " Carrello ", /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '14px',
      color: 'var(--ink-400)',
      fontFamily: 'var(--font-sans)'
    }
  }, "\xB7 ", items.reduce((s, it) => s + it.qty, 0))), /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    "aria-label": "Chiudi",
    style: {
      border: 0,
      background: 'transparent',
      cursor: 'pointer',
      color: 'var(--ink-500)',
      display: 'inline-flex'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "x",
    size: 22
  }))), items.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '12px 20px',
      background: toFree > 0 ? 'var(--accent-100)' : 'var(--olive-50)',
      borderBottom: '1px solid var(--cream-200)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: '13px',
      color: 'var(--ink-700)',
      marginBottom: '6px',
      display: 'flex',
      alignItems: 'center',
      gap: '6px'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "truck",
    size: 15,
    color: toFree > 0 ? 'var(--accent-700)' : 'var(--olive-700)'
  }), toFree > 0 ? /*#__PURE__*/React.createElement("span", null, "Aggiungi ", /*#__PURE__*/React.createElement("strong", null, fmt(toFree)), " per la ", /*#__PURE__*/React.createElement("strong", null, "spedizione gratis")) : /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("strong", null, "Spedizione gratis"), " sbloccata!")), /*#__PURE__*/React.createElement("div", {
    style: {
      height: '6px',
      background: 'rgba(255,255,255,.6)',
      borderRadius: '3px',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'block',
      height: '100%',
      width: `${Math.min(100, subtotal / FREE * 100)}%`,
      background: toFree > 0 ? 'var(--accent-500)' : 'var(--olive-500)',
      transition: 'width var(--dur-medium) var(--ease-out-quint)'
    }
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflowY: 'auto',
      padding: '8px 20px'
    }
  }, items.length === 0 ? /*#__PURE__*/React.createElement(EmptyState, {
    icon: "shopping-cart",
    title: "Il carrello \xE8 vuoto",
    description: "Aggiungi prodotti dai negozi di Piacenza per iniziare.",
    action: /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      onClick: onContinue
    }, "Esplora i negozi")
  }) : items.map(it => /*#__PURE__*/React.createElement("div", {
    key: it.id,
    style: {
      display: 'flex',
      gap: '12px',
      padding: '14px 0',
      borderBottom: '1px solid var(--cream-200)'
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: it.img,
    alt: it.name,
    style: {
      width: '64px',
      height: '64px',
      borderRadius: 'var(--radius-md)',
      objectFit: 'cover',
      flexShrink: 0
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '14px',
      fontWeight: 600,
      color: 'var(--ink-900)',
      lineHeight: 1.3
    }
  }, it.name), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 8px',
      fontSize: '12px',
      color: 'var(--ink-500)'
    }
  }, it.store), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      border: '1px solid var(--cream-300)',
      borderRadius: 'var(--radius-full)'
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => onQty(it.id, -1),
    style: miniBtn
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "minus",
    size: 13
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      minWidth: '24px',
      textAlign: 'center',
      fontSize: '13px',
      fontWeight: 700
    }
  }, it.qty), /*#__PURE__*/React.createElement("button", {
    onClick: () => onQty(it.id, 1),
    style: miniBtn
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "plus",
    size: 13
  }))), /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 800,
      fontSize: '15px',
      color: 'var(--ink-900)'
    }
  }, fmt(it.finalPrice * it.qty)))), /*#__PURE__*/React.createElement("button", {
    onClick: () => onRemove(it.id),
    "aria-label": "Rimuovi",
    style: {
      border: 0,
      background: 'transparent',
      color: 'var(--ink-400)',
      cursor: 'pointer',
      alignSelf: 'flex-start',
      display: 'inline-flex'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "trash-2",
    size: 16
  }))))), items.length > 0 && /*#__PURE__*/React.createElement("footer", {
    style: {
      borderTop: '1px solid var(--cream-200)',
      padding: '16px 20px',
      background: 'var(--cream-50)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      fontSize: '14px',
      color: 'var(--ink-600)',
      marginBottom: '6px'
    }
  }, /*#__PURE__*/React.createElement("span", null, "Subtotale"), /*#__PURE__*/React.createElement("span", null, fmt(subtotal))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      fontSize: '14px',
      color: 'var(--ink-600)',
      marginBottom: '10px'
    }
  }, /*#__PURE__*/React.createElement("span", null, "Consegna"), /*#__PURE__*/React.createElement("span", null, shipping === 0 ? /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--olive-700)',
      fontWeight: 600
    }
  }, "Gratis") : fmt(shipping))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      fontSize: '18px',
      fontWeight: 800,
      color: 'var(--ink-900)',
      marginBottom: '14px'
    }
  }, /*#__PURE__*/React.createElement("span", null, "Totale"), /*#__PURE__*/React.createElement("span", null, fmt(total))), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    size: "lg",
    fullWidth: true,
    iconRight: "arrow-right",
    onClick: onCheckout
  }, "Vai alla conferma"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '10px 0 0',
      fontSize: '12px',
      color: 'var(--ink-500)',
      textAlign: 'center',
      display: 'inline-flex',
      width: '100%',
      justifyContent: 'center',
      gap: '5px'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "banknote",
    size: 14,
    color: "var(--olive-600)"
  }), " Paghi alla consegna \xB7 contanti al rider")))), document.body);
}
const miniBtn = {
  width: '28px',
  height: '28px',
  border: 0,
  background: 'transparent',
  color: 'var(--ink-700)',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center'
};

// ===== Order tracking (post-checkout) — 8-state timeline =====
const MC_FLOW = [{
  status: 'NEW',
  label: 'Ordine ricevuto',
  icon: 'clock',
  sub: 'Il negozio sta confermando'
}, {
  status: 'ACCEPTED',
  label: 'In preparazione',
  icon: 'chef-hat',
  sub: 'Il negozio prepara il tuo ordine'
}, {
  status: 'READY',
  label: 'Pronto per il ritiro',
  icon: 'package',
  sub: 'Pronto in negozio'
}, {
  status: 'ASSIGNED',
  label: 'Rider assegnato',
  icon: 'bike',
  sub: 'Un rider sta arrivando in negozio'
}, {
  status: 'PICKED_UP',
  label: 'Ritirato',
  icon: 'hand',
  sub: 'Il rider ha ritirato l’ordine'
}, {
  status: 'OUT_FOR_DELIVERY',
  label: 'In consegna',
  icon: 'truck',
  sub: 'Il rider è in viaggio verso di te'
}, {
  status: 'DELIVERED',
  label: 'Consegnato',
  icon: 'check-circle-2',
  sub: 'Consegnato — grazie!'
}];
function OrderTracking({
  order,
  onContinue,
  onHome
}) {
  const [step, setStep] = React.useState(0);
  React.useEffect(() => {
    if (step >= MC_FLOW.length - 1) return;
    const t = setTimeout(() => setStep(s => Math.min(MC_FLOW.length - 1, s + 1)), step === 0 ? 2600 : 3400);
    return () => clearTimeout(t);
  }, [step]);
  const store = storeBy(order.items[0].store) || {};
  const current = MC_FLOW[step];
  const delivered = current.status === 'DELIVERED';
  const eta = delivered ? 'Consegnato' : store.deliveryToday ? 'Oggi, entro le 19:30' : 'Domani, 24–48h';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: '880px',
      margin: '0 auto',
      padding: '28px 20px'
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: onHome,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      border: 0,
      background: 'transparent',
      color: 'var(--ink-600)',
      fontSize: '14px',
      fontWeight: 500,
      cursor: 'pointer',
      padding: '8px 0',
      fontFamily: 'var(--font-sans)'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "arrow-left",
    size: 17
  }), " Torna al marketplace"), /*#__PURE__*/React.createElement(Card, {
    variant: "elevated",
    padding: "lg",
    style: {
      marginTop: '8px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '16px',
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '60px',
      height: '60px',
      borderRadius: 'var(--radius-full)',
      background: delivered ? 'var(--olive-100)' : 'var(--primary-100)',
      color: delivered ? 'var(--olive-700)' : 'var(--primary-700)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: current.icon,
    size: 28,
    stroke: 2.2,
    color: delivered ? 'var(--olive-700)' : 'var(--primary-700)'
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: '200px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-serif)',
      fontSize: '26px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, delivered ? 'Ordine consegnato!' : 'Ordine confermato!'), /*#__PURE__*/React.createElement(OrderStatusBadge, {
    status: current.status
  })), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '4px 0 0',
      fontSize: '14px',
      color: 'var(--ink-600)'
    }
  }, "Ordine ", /*#__PURE__*/React.createElement("strong", null, order.id), " \xB7 ", current.sub)), /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'right'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: '12px',
      color: 'var(--ink-500)',
      textTransform: 'uppercase',
      letterSpacing: '0.04em',
      fontWeight: 700
    }
  }, "Consegna stimata"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: '18px',
      fontWeight: 800,
      color: 'var(--ink-900)'
    }
  }, eta)))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1.3fr 1fr',
      gap: '24px',
      marginTop: '24px',
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "lg"
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: '0 0 18px',
      fontFamily: 'var(--font-serif)',
      fontSize: '18px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, "Stato dell\u2019ordine"), /*#__PURE__*/React.createElement("div", null, MC_FLOW.map((s, i) => {
    const done = i < step,
      active = i === step;
    const color = done ? 'var(--olive-600)' : active ? 'var(--primary-600)' : 'var(--cream-400)';
    return /*#__PURE__*/React.createElement("div", {
      key: s.status,
      style: {
        display: 'flex',
        gap: '14px'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: '34px',
        height: '34px',
        borderRadius: '50%',
        background: done || active ? color : 'var(--cream-100)',
        color: done || active ? '#fff' : 'var(--ink-300)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        border: active ? '3px solid var(--primary-200)' : 'none',
        transition: 'background var(--dur-medium)'
      }
    }, /*#__PURE__*/React.createElement(Lucide, {
      name: done ? 'check' : s.icon,
      size: 16,
      stroke: 2.4,
      color: done || active ? '#fff' : 'var(--ink-300)'
    })), i < MC_FLOW.length - 1 && /*#__PURE__*/React.createElement("span", {
      style: {
        width: '2px',
        flex: 1,
        minHeight: '26px',
        background: done ? 'var(--olive-400)' : 'var(--cream-300)'
      }
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        paddingBottom: '18px'
      }
    }, /*#__PURE__*/React.createElement("p", {
      style: {
        margin: 0,
        fontSize: '15px',
        fontWeight: active ? 700 : 600,
        color: done || active ? 'var(--ink-900)' : 'var(--ink-400)'
      }
    }, s.label), /*#__PURE__*/React.createElement("p", {
      style: {
        margin: '2px 0 0',
        fontSize: '13px',
        color: 'var(--ink-500)'
      }
    }, active ? s.sub : done ? 'Completato' : 'In attesa')));
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '16px'
    }
  }, /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "lg"
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: '0 0 12px',
      fontFamily: 'var(--font-serif)',
      fontSize: '18px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, "Riepilogo"), order.items.map(it => /*#__PURE__*/React.createElement("div", {
    key: it.id,
    style: {
      display: 'flex',
      gap: '10px',
      alignItems: 'center',
      padding: '8px 0',
      borderBottom: '1px solid var(--cream-200)'
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: it.img,
    alt: it.name,
    style: {
      width: '44px',
      height: '44px',
      borderRadius: 'var(--radius-md)',
      objectFit: 'cover'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '13px',
      fontWeight: 600,
      color: 'var(--ink-900)',
      lineHeight: 1.3
    }
  }, it.name), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '12px',
      color: 'var(--ink-500)'
    }
  }, "\xD7 ", it.qty)), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '13px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, fmt(it.finalPrice * it.qty)))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      marginTop: '12px',
      fontSize: '17px',
      fontWeight: 800,
      color: 'var(--ink-900)'
    }
  }, /*#__PURE__*/React.createElement("span", null, "Totale"), /*#__PURE__*/React.createElement("span", null, fmt(order.total))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      marginTop: '12px',
      padding: '10px 12px',
      background: 'var(--olive-50)',
      borderRadius: 'var(--radius-md)',
      fontSize: '13px',
      color: 'var(--olive-800)',
      fontWeight: 600
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "banknote",
    size: 16,
    color: "var(--olive-700)"
  }), " Paghi ", fmt(order.total), " in contanti al rider")), /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "md"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px'
    }
  }, /*#__PURE__*/React.createElement(StoreChip, {
    name: order.items[0].store,
    size: 28
  }), store.verified && /*#__PURE__*/React.createElement(Lucide, {
    name: "badge-check",
    size: 15,
    color: "var(--primary-600)"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      marginTop: '10px',
      fontSize: '13px',
      color: 'var(--ink-600)'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "map-pin",
    size: 15,
    color: "var(--primary-600)"
  }), " Consegna in ", order.address ? `${order.address.street}, ${order.address.city}` : 'Via Roma 12, Piacenza')), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    fullWidth: true,
    onClick: onContinue
  }, "Continua lo shopping"))));
}

// ===== App shell — view state machine, cart, toast =====
function App() {
  const [view, setView] = React.useState('home'); // home|srp|store|product|checkout|tracking|account|auth
  const [current, setCurrent] = React.useState(null);
  const [store, setStore] = React.useState(null);
  const [cart, setCart] = React.useState([]);
  const [drawer, setDrawer] = React.useState(false);
  const [order, setOrder] = React.useState(null);
  const [toast, setToast] = React.useState(null);
  const [query, setQuery] = React.useState('');
  const [committedQuery, setCommittedQuery] = React.useState('');
  const [cat, setCat] = React.useState(null);
  const [acctSection, setAcctSection] = React.useState('ordini');
  const [authMode, setAuthMode] = React.useState('login');
  const toastTimer = React.useRef(null);
  const all = window.MC_PRODUCTS;
  const stores = window.MC_STORES;
  const cartCount = cart.reduce((s, it) => s + it.qty, 0);
  function showToast(text) {
    setToast({
      text
    });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }
  function top() {
    window.scrollTo({
      top: 0,
      behavior: 'auto'
    });
  }
  function addToCart(p, qty = 1) {
    setCart(c => {
      const ex = c.find(it => it.id === p.id);
      if (ex) return c.map(it => it.id === p.id ? {
        ...it,
        qty: it.qty + qty
      } : it);
      return [...c, {
        id: p.id,
        name: p.name,
        store: p.store,
        img: imgUrl(p.kw, p.galleryLocks[0]),
        finalPrice: finalPrice(p),
        qty
      }];
    });
    showToast(`${p.name.length > 28 ? p.name.slice(0, 28) + '…' : p.name} aggiunto`);
  }
  function changeQty(id, d) {
    setCart(c => c.map(it => it.id === id ? {
      ...it,
      qty: Math.max(1, it.qty + d)
    } : it));
  }
  function removeItem(id) {
    setCart(c => c.filter(it => it.id !== id));
  }
  function openProduct(p) {
    setCurrent(p);
    setView('product');
    top();
  }
  function openStore(s) {
    if (!s) return;
    setStore(s);
    setView('store');
    top();
  }
  function goHome() {
    setView('home');
    setCat(null);
    setQuery('');
    setCommittedQuery('');
    top();
  }
  function goSrp(nextCat) {
    setCat(nextCat ?? null);
    setView('srp');
    top();
  }
  function submitSearch() {
    setCommittedQuery(query);
    setView('srp');
    top();
  }
  function goAccount(section) {
    setAcctSection(section || 'ordini');
    setView('account');
    top();
  }
  function goCheckout() {
    setDrawer(false);
    setView('checkout');
    top();
  }
  function openOrder(o) {
    const items = o.lines.map(l => {
      const p = window.MC_PRODUCTS.find(x => x.id === l.id);
      return p && {
        id: p.id,
        name: p.name,
        store: p.store,
        img: imgUrl(p.kw, p.galleryLocks[0]),
        finalPrice: finalPrice(p),
        qty: l.q
      };
    }).filter(Boolean);
    setOrder({
      id: o.id,
      items,
      total: o.total
    });
    setView('tracking');
    top();
  }
  function placeOrder(payload) {
    const id = 'PC-' + (2400 + Math.floor(Math.random() * 600));
    setOrder({
      id,
      items: payload.items,
      total: payload.total,
      address: payload.address,
      slot: payload.slot
    });
    setView('tracking');
    top();
  }
  function afterOrder() {
    setCart([]);
    setOrder(null);
    goHome();
  }
  const showFooter = view === 'home' || view === 'srp';
  const dark = view !== 'auth';
  return /*#__PURE__*/React.createElement(React.Fragment, null, dark && /*#__PURE__*/React.createElement(Navbar, {
    cartCount: cartCount,
    onCart: () => setDrawer(true),
    onHome: goHome,
    activeCat: cat,
    onCat: c => goSrp(c),
    query: query,
    onQuery: setQuery,
    onSubmitSearch: submitSearch,
    onAccount: () => goAccount('ordini'),
    onFav: () => goAccount('preferiti'),
    onNotif: () => goAccount('notifiche')
  }), /*#__PURE__*/React.createElement("main", {
    style: {
      minHeight: '70vh',
      background: 'var(--surface-50)'
    }
  }, view === 'home' && /*#__PURE__*/React.createElement(Home, {
    products: all,
    stores: stores,
    onOpen: openProduct,
    onAdd: addToCart,
    onStore: openStore,
    onExplore: () => goSrp(null)
  }), view === 'srp' && /*#__PURE__*/React.createElement(SearchResults, {
    allProducts: all,
    query: committedQuery,
    cat: cat,
    onOpen: openProduct,
    onAdd: addToCart,
    onStore: openStore,
    onClearNav: goHome
  }), view === 'store' && store && /*#__PURE__*/React.createElement(StorePage, {
    store: store,
    products: all,
    onBack: goHome,
    onOpen: openProduct,
    onAdd: addToCart
  }), view === 'product' && current && /*#__PURE__*/React.createElement(ProductPage, {
    product: current,
    onBack: goHome,
    onAdd: addToCart,
    onOpen: openProduct,
    onStore: openStore
  }), view === 'checkout' && /*#__PURE__*/React.createElement(CheckoutPage, {
    items: cart,
    onBack: () => setDrawer(true),
    onPlace: placeOrder
  }), view === 'tracking' && order && /*#__PURE__*/React.createElement(OrderTracking, {
    order: order,
    onContinue: afterOrder,
    onHome: afterOrder
  }), view === 'account' && /*#__PURE__*/React.createElement(AccountPage, {
    section: acctSection,
    onSection: setAcctSection,
    products: all,
    onOpen: openProduct,
    onAdd: addToCart,
    onStore: openStore,
    onOpenOrder: openOrder
  }), view === 'auth' && /*#__PURE__*/React.createElement(AuthPage, {
    mode: authMode,
    onAuth: goHome,
    onBack: goHome,
    onSwitch: setAuthMode
  }), showFooter && /*#__PURE__*/React.createElement(Footer, {
    onAuth: () => setView('auth')
  })), /*#__PURE__*/React.createElement(CartDrawer, {
    open: drawer,
    items: cart,
    onClose: () => setDrawer(false),
    onQty: changeQty,
    onRemove: removeItem,
    onCheckout: goCheckout,
    onContinue: () => {
      setDrawer(false);
      goSrp(null);
    }
  }), /*#__PURE__*/React.createElement(Toast, {
    toast: toast,
    onUndo: null
  }));
}

// ===== Bootstrap — mounts ONLY after index.html grants permission (window.__MC_ALLOW_MOUNT).
// _ds_bundle.js concatenates this file; its embedded copy runs during bundle-eval BEFORE the
// flag is set → bails. The real <script src="app.js"> runs AFTER the flag → mounts. Uses a
// fresh flag name so a stale bundle's old boot (pre-set & neutralized in index.html) can't interfere. =====
(function mcMount() {
  if (!window.__MC_ALLOW_MOUNT) return;
  if (window.__buyerReady) return;
  var ns = window.MyCityDesignSystem_105480;
  if (typeof App === 'undefined' || !ns || !ns.Button || !window.MC_PRODUCTS) return setTimeout(mcMount, 30);
  window.__buyerReady = true;
  var root = document.getElementById('root');
  if (root) root.style.display = 'none';
  var mount = document.getElementById('mc-app');
  if (!mount) {
    mount = document.createElement('div');
    mount.id = 'mc-app';
    document.body.appendChild(mount);
  }
  ReactDOM.createRoot(mount).render(React.createElement(App));
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/buyer/app.js", error: String((e && e.message) || e) }); }

// ui_kits/buyer/src/00-ui.js
try { (() => {
// ===== Shared UI helpers (concat order: first) =====
const {
  Button,
  Badge,
  Card,
  ProductCard,
  OrderStatusBadge,
  Modal,
  EmptyState,
  Input,
  Field,
  Select,
  Checkbox
} = window.MyCityDesignSystem_105480;
const fmt = n => new Intl.NumberFormat('it-IT', {
  style: 'currency',
  currency: 'EUR'
}).format(n);
const imgUrl = (kw, lock) => `https://loremflickr.com/640/640/${kw}?lock=${lock}`;
const finalPrice = p => p.discountPercent > 0 ? p.price * (1 - p.discountPercent / 100) : p.price;
const storeBy = name => window.MC_STORES.find(s => s.name === name);
const initials = name => (name || '').trim().split(/\s+/).map(w => w[0] || '').slice(0, 2).join('').toUpperCase();
function Lucide({
  name,
  size = 20,
  stroke = 2,
  color,
  style
}) {
  return /*#__PURE__*/React.createElement("i", {
    "data-lucide": name,
    ref: el => {
      if (el && window.lucide) try {
        window.lucide.createIcons({
          attrs: {
            width: size,
            height: size,
            'stroke-width': stroke
          }
        });
      } catch (e) {}
    },
    style: {
      width: size,
      height: size,
      display: 'inline-flex',
      color,
      flexShrink: 0,
      ...style
    }
  });
}

// Star rating row (read-only).
function Stars({
  value = 5,
  size = 14
}) {
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      gap: '1px'
    },
    "aria-label": `${value} su 5`
  }, [1, 2, 3, 4, 5].map(i => /*#__PURE__*/React.createElement("svg", {
    key: i,
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: i <= Math.round(value) ? 'var(--accent-500)' : 'var(--cream-300)',
    stroke: "none"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M12 2l2.9 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l7.1-1.01L12 2z"
  }))));
}

// Store avatar chip (initials on terracotta gradient).
function StoreChip({
  name,
  size = 20,
  onClick
}) {
  return /*#__PURE__*/React.createElement("span", {
    onClick: onClick,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      cursor: onClick ? 'pointer' : 'default'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: size,
      height: size,
      flexShrink: 0,
      borderRadius: 'var(--radius-full)',
      background: 'linear-gradient(135deg, var(--primary-500), var(--primary-700))',
      color: '#fff',
      fontSize: size * 0.42,
      fontWeight: 700,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'var(--font-sans)'
    }
  }, initials(name)), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: '13px',
      fontWeight: 600,
      color: 'var(--primary-700)',
      whiteSpace: 'nowrap'
    }
  }, name));
}

// Lightweight toast (non-intrusive add-to-cart confirmation).
function Toast({
  toast,
  onUndo
}) {
  if (!toast) return null;
  return ReactDOM.createPortal(/*#__PURE__*/React.createElement("div", {
    style: {
      position: 'fixed',
      left: '50%',
      bottom: '28px',
      transform: 'translateX(-50%)',
      zIndex: 'var(--z-toast)',
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      background: 'var(--ink-900)',
      color: '#fff',
      padding: '12px 16px',
      borderRadius: 'var(--radius-full)',
      boxShadow: 'var(--shadow-warm-xl)',
      animation: 'mc-pop-in var(--dur-medium) var(--ease-out-quint)',
      maxWidth: '90vw'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '26px',
      height: '26px',
      borderRadius: '50%',
      background: 'var(--olive-600)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "check",
    size: 16,
    stroke: 3,
    color: "#fff"
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '14px',
      fontWeight: 500
    }
  }, toast.text), onUndo && /*#__PURE__*/React.createElement("button", {
    onClick: onUndo,
    style: {
      border: 0,
      background: 'transparent',
      color: 'var(--accent-400)',
      fontWeight: 700,
      fontSize: '14px',
      cursor: 'pointer',
      fontFamily: 'var(--font-sans)'
    }
  }, "Annulla")), document.body);
}

// "Aperto / Chiuso" pill based on store.closeAt (demo: always open until close).
function OpenPill({
  store,
  dark
}) {
  const open = true;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '5px',
      background: dark ? 'rgba(28,26,24,.78)' : 'var(--olive-50)',
      color: dark ? '#fff' : 'var(--olive-700)',
      fontSize: '12px',
      fontWeight: 600,
      padding: '4px 10px',
      borderRadius: 'var(--radius-full)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '7px',
      height: '7px',
      borderRadius: '50%',
      background: 'var(--olive-400)'
    }
  }), open ? `Aperto · chiude alle ${store.closeAt}` : 'Chiuso');
}
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/buyer/src/00-ui.js", error: String((e && e.message) || e) }); }

// ui_kits/buyer/src/10-navbar.js
try { (() => {
// ===== Navbar (promo ticker + terracotta bar + category bar) =====
function PromoTicker() {
  const items = [{
    icon: 'bike',
    t: 'Consegna in 24–48h dai negozi di Piacenza'
  }, {
    icon: 'banknote',
    t: 'Paghi alla consegna — nessuna carta'
  }, {
    icon: 'gift',
    t: '€5 di sconto al primo ordine'
  }, {
    icon: 'badge-check',
    t: 'Solo commercianti locali verificati'
  }];
  const run = [...items, ...items];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--ink-900)',
      color: 'var(--cream-100)',
      fontSize: '12.5px',
      fontWeight: 500,
      overflow: 'hidden',
      whiteSpace: 'nowrap'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'inline-flex',
      gap: '40px',
      padding: '7px 0',
      animation: 'mc-marquee 32s linear infinite',
      willChange: 'transform'
    }
  }, run.map((it, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    style: {
      display: 'inline-flex',
      gap: '7px',
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: it.icon,
    size: 14,
    color: "var(--accent-300)"
  }), " ", it.t))));
}
function NavIcon({
  name,
  badge,
  onClick,
  title
}) {
  return /*#__PURE__*/React.createElement("button", {
    onClick: onClick,
    title: title,
    "aria-label": title,
    style: {
      position: 'relative',
      border: 0,
      background: 'transparent',
      color: '#fff',
      cursor: 'pointer',
      padding: '8px',
      borderRadius: 'var(--radius-full)',
      display: 'inline-flex'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: name,
    size: 20
  }), badge > 0 && /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      top: '-2px',
      right: '-2px',
      minWidth: '18px',
      height: '18px',
      padding: '0 4px',
      borderRadius: 'var(--radius-full)',
      background: 'var(--accent-500)',
      color: 'var(--ink-900)',
      fontSize: '10px',
      fontWeight: 700,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'var(--font-sans)'
    }
  }, badge));
}
function Navbar({
  cartCount,
  onCart,
  onHome,
  activeCat,
  onCat,
  query,
  onQuery,
  onSubmitSearch,
  onAccount,
  onFav,
  onNotif,
  notifCount = 2
}) {
  return /*#__PURE__*/React.createElement("header", {
    style: {
      position: 'sticky',
      top: 0,
      zIndex: 'var(--z-sticky)',
      boxShadow: 'var(--shadow-warm-sm)'
    }
  }, /*#__PURE__*/React.createElement(PromoTicker, null), /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--primary-700)',
      color: '#fff'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 'var(--container-max)',
      margin: '0 auto',
      padding: '12px 20px',
      display: 'flex',
      alignItems: 'center',
      gap: '14px'
    }
  }, /*#__PURE__*/React.createElement("a", {
    onClick: onHome,
    style: {
      cursor: 'pointer',
      fontFamily: 'var(--font-serif)',
      fontSize: '24px',
      fontWeight: 800,
      letterSpacing: '-0.01em',
      whiteSpace: 'nowrap',
      lineHeight: 1
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--accent-300)'
    }
  }, "My"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: '#fff'
    }
  }, "City")), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      background: 'rgba(255,255,255,.12)',
      padding: '7px 12px',
      borderRadius: 'var(--radius-full)',
      fontSize: '13px',
      fontWeight: 500,
      whiteSpace: 'nowrap'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "map-pin",
    size: 15
  }), " Piacenza \xB7 29121"), /*#__PURE__*/React.createElement("form", {
    onSubmit: e => {
      e.preventDefault();
      onSubmitSearch && onSubmitSearch();
    },
    style: {
      flex: 1,
      maxWidth: '560px',
      position: 'relative'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      left: '14px',
      top: '50%',
      transform: 'translateY(-50%)',
      display: 'inline-flex',
      pointerEvents: 'none'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "search",
    size: 18,
    color: "var(--ink-400)"
  })), /*#__PURE__*/React.createElement("input", {
    value: query,
    onChange: e => onQuery(e.target.value),
    placeholder: "Cerca prodotti, negozi a Piacenza\u2026",
    style: {
      width: '100%',
      boxSizing: 'border-box',
      border: 0,
      borderRadius: 'var(--radius-full)',
      padding: '11px 16px 11px 42px',
      fontSize: '15px',
      fontFamily: 'var(--font-sans)',
      background: '#fff',
      color: 'var(--ink-900)',
      outline: 'none'
    }
  })), /*#__PURE__*/React.createElement("nav", {
    style: {
      marginLeft: 'auto',
      display: 'flex',
      alignItems: 'center',
      gap: '2px'
    }
  }, /*#__PURE__*/React.createElement(NavIcon, {
    name: "heart",
    title: "Preferiti",
    badge: 3,
    onClick: onFav
  }), /*#__PURE__*/React.createElement(NavIcon, {
    name: "bell",
    title: "Notifiche",
    badge: notifCount,
    onClick: onNotif
  }), /*#__PURE__*/React.createElement("button", {
    onClick: onCart,
    style: {
      marginLeft: '6px',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px',
      background: 'var(--accent-500)',
      color: 'var(--ink-900)',
      border: 0,
      padding: '9px 16px',
      borderRadius: 'var(--radius-full)',
      fontWeight: 700,
      fontSize: '14px',
      fontFamily: 'var(--font-sans)',
      cursor: 'pointer',
      whiteSpace: 'nowrap'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "shopping-cart",
    size: 17,
    stroke: 2.4
  }), " Carrello", cartCount > 0 && /*#__PURE__*/React.createElement("span", {
    style: {
      background: 'var(--ink-900)',
      color: 'var(--accent-400)',
      fontSize: '11px',
      fontWeight: 700,
      borderRadius: 'var(--radius-full)',
      minWidth: '18px',
      height: '18px',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '0 4px'
    }
  }, cartCount)), /*#__PURE__*/React.createElement("button", {
    onClick: onAccount,
    title: "Account",
    "aria-label": "Account",
    style: {
      marginLeft: '8px',
      width: '36px',
      height: '36px',
      borderRadius: 'var(--radius-full)',
      background: 'var(--cream-200)',
      color: 'var(--primary-700)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontWeight: 700,
      flexShrink: 0,
      border: 0,
      cursor: 'pointer',
      fontFamily: 'var(--font-sans)'
    }
  }, window.MC_USER ? window.MC_USER.initials : 'L'))), /*#__PURE__*/React.createElement("div", {
    style: {
      borderTop: '1px solid rgba(255,255,255,.14)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "mc-catbar",
    style: {
      maxWidth: 'var(--container-max)',
      margin: '0 auto',
      padding: '0 20px',
      display: 'flex',
      gap: '2px',
      overflowX: 'auto'
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => onCat(null),
    style: catBtn(!activeCat)
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "layout-grid",
    size: 16,
    stroke: 2.2,
    color: !activeCat ? 'var(--accent-300)' : 'rgba(255,255,255,.88)'
  }), " Tutto"), window.MC_CATEGORIES.map(c => {
    const on = activeCat === c.slug;
    return /*#__PURE__*/React.createElement("button", {
      key: c.slug,
      onClick: () => onCat(on ? null : c.slug),
      style: catBtn(on)
    }, /*#__PURE__*/React.createElement(Lucide, {
      name: c.icon,
      size: 16,
      stroke: 2.2,
      color: on ? 'var(--accent-300)' : 'rgba(255,255,255,.88)'
    }), " ", c.label);
  })))));
}
function catBtn(on) {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '7px',
    whiteSpace: 'nowrap',
    border: 0,
    background: 'transparent',
    color: on ? 'var(--accent-300)' : 'rgba(255,255,255,.88)',
    padding: '12px 14px',
    fontSize: '13.5px',
    fontWeight: on ? 700 : 500,
    fontFamily: 'var(--font-sans)',
    cursor: 'pointer',
    borderBottom: `2px solid ${on ? 'var(--accent-400)' : 'transparent'}`
  };
}
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/buyer/src/10-navbar.js", error: String((e && e.message) || e) }); }

// ui_kits/buyer/src/20-home.js
try { (() => {
// ===== Home =====
function pImg(p, i = 0) {
  return imgUrl(p.kw, p.galleryLocks[i % p.galleryLocks.length]);
}
function ProductGridCard({
  p,
  onOpen,
  onAdd,
  onStore
}) {
  return /*#__PURE__*/React.createElement("div", {
    onClick: () => onOpen(p),
    style: {
      cursor: 'pointer',
      height: '100%'
    }
  }, /*#__PURE__*/React.createElement(ProductCard, {
    name: p.name,
    price: p.price,
    discountPercent: p.discountPercent,
    storeName: p.store,
    image: pImg(p),
    isNew: p.isNew,
    freeShipping: p.freeShipping,
    stock: p.stock,
    onAdd: () => onAdd(p)
  }));
}
function Hero({
  onExplore,
  onStore
}) {
  const featured = storeBy('Salumeria Verdi');
  return /*#__PURE__*/React.createElement("section", {
    style: {
      position: 'relative',
      overflow: 'hidden',
      background: 'linear-gradient(180deg, var(--surface-0), var(--surface-100))'
    }
  }, /*#__PURE__*/React.createElement("div", {
    "aria-hidden": true,
    style: {
      position: 'absolute',
      top: '-80px',
      right: '-80px',
      width: '500px',
      height: '500px',
      borderRadius: '50%',
      background: 'rgba(245,197,182,.4)',
      filter: 'blur(80px)'
    }
  }), /*#__PURE__*/React.createElement("div", {
    "aria-hidden": true,
    style: {
      position: 'absolute',
      bottom: '-120px',
      left: '-80px',
      width: '420px',
      height: '420px',
      borderRadius: '50%',
      background: 'rgba(251,216,145,.4)',
      filter: 'blur(80px)'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      maxWidth: 'var(--container-max)',
      margin: '0 auto',
      padding: '44px 20px',
      display: 'grid',
      gridTemplateColumns: '1.2fr 1fr',
      gap: '40px',
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '22px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      alignSelf: 'flex-start',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      background: 'var(--primary-100)',
      color: 'var(--primary-800)',
      padding: '5px 12px',
      borderRadius: 'var(--radius-full)',
      fontSize: '12px',
      fontWeight: 600,
      boxShadow: 'inset 0 0 0 1px var(--primary-200)'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "sparkles",
    size: 14,
    color: "var(--primary-800)"
  }), " Il marketplace dei negozi di Piacenza"), /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-serif)',
      fontSize: '54px',
      fontWeight: 800,
      lineHeight: 1.05,
      letterSpacing: '-0.01em',
      color: 'var(--ink-900)'
    }
  }, "I negozi ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--primary-700)',
      fontStyle: 'italic'
    }
  }, "veri"), " di Piacenza,", /*#__PURE__*/React.createElement("br", null), "ora a casa tua."), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '18px',
      lineHeight: 1.6,
      color: 'var(--ink-600)',
      maxWidth: '34em'
    }
  }, "Alimentari, gastronomia, vini, casa: ordini dai commercianti della tua via in pochi tap e ", /*#__PURE__*/React.createElement("strong", {
    style: {
      color: 'var(--ink-900)'
    }
  }, "paghi alla consegna"), ". A casa in 24\u201348h."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: '12px'
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    size: "lg",
    shape: "pill",
    iconRight: "arrow-right",
    onClick: onExplore
  }, "Inizia a esplorare"), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "lg",
    shape: "pill",
    icon: "store",
    onClick: () => onStore(featured)
  }, "Esplora i negozi")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: '8px 24px',
      fontSize: '14px',
      color: 'var(--ink-600)'
    }
  }, ['Paghi alla consegna', 'Oggi se disponibile · 24–48h', 'Account solo per confermare'].map(t => /*#__PURE__*/React.createElement("span", {
    key: t,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "check",
    size: 16,
    stroke: 2.4,
    color: "var(--olive-600)"
  }), " ", t)))), /*#__PURE__*/React.createElement("div", {
    onClick: () => onStore(featured),
    style: {
      cursor: 'pointer',
      background: '#fff',
      border: '1px solid var(--cream-300)',
      borderRadius: 'var(--radius-2xl)',
      boxShadow: 'var(--shadow-warm-lg)',
      overflow: 'hidden'
    },
    className: "mc-card-hover"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      height: '180px'
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: featured.cover,
    alt: featured.name,
    style: {
      width: '100%',
      height: '100%',
      objectFit: 'cover'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      top: '12px',
      left: '12px'
    }
  }, /*#__PURE__*/React.createElement(OpenPill, {
    store: featured,
    dark: true
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '16px 18px',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px'
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-serif)',
      fontSize: '19px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, featured.name), /*#__PURE__*/React.createElement(Lucide, {
    name: "badge-check",
    size: 18,
    color: "var(--primary-600)"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      fontSize: '13px',
      color: 'var(--ink-500)'
    }
  }, /*#__PURE__*/React.createElement(Stars, {
    value: featured.rating
  }), " ", /*#__PURE__*/React.createElement("strong", {
    style: {
      color: 'var(--ink-800)'
    }
  }, String(featured.rating).replace('.', ',')), " \xB7 ", featured.reviews, " recensioni \xB7 ", featured.area), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: '8px',
      marginTop: '2px'
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    variant: "local"
  }, "Negozio locale"), /*#__PURE__*/React.createElement(Badge, {
    variant: "free",
    icon: "truck"
  }, "Consegna oggi"))))));
}
function HowItWorks() {
  const steps = [{
    n: 1,
    icon: 'store',
    tone: 'primary',
    t: 'Scegli',
    d: 'Sfoglia i negozi e i prodotti di Piacenza, dai commercianti della tua via.'
  }, {
    n: 2,
    icon: 'shopping-bag',
    tone: 'accent',
    t: 'Ordina',
    d: 'Aggiungi al carrello e inserisci l’indirizzo. L’account serve solo per confermare.'
  }, {
    n: 3,
    icon: 'banknote',
    tone: 'olive',
    t: 'Ricevi e paghi alla consegna',
    d: 'Te lo portiamo a casa in 24–48h. Paghi al rider quando arriva: zero rischi.'
  }];
  const TONE = {
    primary: ['var(--primary-100)', 'var(--primary-700)'],
    accent: ['var(--accent-100)', 'var(--accent-700)'],
    olive: ['var(--olive-100)', 'var(--olive-700)']
  };
  return /*#__PURE__*/React.createElement("section", {
    style: {
      maxWidth: 'var(--container-max)',
      margin: '0 auto',
      padding: '28px 20px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'center',
      marginBottom: '22px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '12px',
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '0.04em',
      color: 'var(--primary-700)'
    }
  }, "Semplice e senza pensieri"), /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: '4px 0 0',
      fontFamily: 'var(--font-serif)',
      fontSize: '30px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, "Come funziona, in 3 passi")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: '20px'
    }
  }, steps.map(s => /*#__PURE__*/React.createElement(Card, {
    key: s.n,
    variant: "elevated",
    padding: "lg",
    as: "article"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      marginBottom: '14px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'relative',
      width: '48px',
      height: '48px',
      borderRadius: 'var(--radius-full)',
      background: TONE[s.tone][0],
      color: TONE[s.tone][1],
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: s.icon,
    size: 22,
    stroke: 2.2,
    color: TONE[s.tone][1]
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      top: '-6px',
      right: '-6px',
      width: '24px',
      height: '24px',
      borderRadius: '50%',
      background: 'var(--ink-900)',
      color: '#fff',
      fontSize: '12px',
      fontWeight: 700,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: '0 0 0 2px #fff',
      fontFamily: 'var(--font-sans)'
    }
  }, s.n)), /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-serif)',
      fontSize: '18px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, s.t)), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '14px',
      lineHeight: 1.6,
      color: 'var(--ink-600)'
    }
  }, s.d)))));
}
function ProductRail({
  products,
  onOpen,
  onAdd,
  onStore,
  title,
  eyebrow,
  onSeeAll
}) {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      background: '#fff',
      borderTop: '1px solid var(--cream-300)',
      borderBottom: '1px solid var(--cream-300)',
      padding: '28px 0'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 'var(--container-max)',
      margin: '0 auto',
      padding: '0 20px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
      marginBottom: '18px',
      flexWrap: 'wrap',
      gap: '12px'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      color: 'var(--primary-700)',
      fontSize: '12px',
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '0.05em'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "heart",
    size: 14,
    color: "var(--primary-700)"
  }), " ", eyebrow), /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: '4px 0 0',
      fontFamily: 'var(--font-serif)',
      fontSize: '28px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, title)), /*#__PURE__*/React.createElement("a", {
    onClick: onSeeAll,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px',
      color: 'var(--primary-700)',
      fontWeight: 600,
      fontSize: '14px',
      cursor: 'pointer'
    }
  }, "Vedi tutto ", /*#__PURE__*/React.createElement(Lucide, {
    name: "arrow-right",
    size: 16,
    color: "var(--primary-700)"
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: '16px'
    }
  }, products.map(p => /*#__PURE__*/React.createElement(ProductGridCard, {
    key: p.id,
    p: p,
    onOpen: onOpen,
    onAdd: onAdd,
    onStore: onStore
  })))));
}
function StoresRail({
  stores,
  onStore
}) {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      maxWidth: 'var(--container-max)',
      margin: '0 auto',
      padding: '32px 20px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
      marginBottom: '18px'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      color: 'var(--primary-700)',
      fontSize: '12px',
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '0.05em'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "store",
    size: 14,
    color: "var(--primary-700)"
  }), " Vicino a te"), /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: '4px 0 0',
      fontFamily: 'var(--font-serif)',
      fontSize: '28px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, "Negozi in evidenza"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: '16px'
    }
  }, stores.map(s => /*#__PURE__*/React.createElement("div", {
    key: s.id,
    onClick: () => onStore(s),
    className: "mc-card-hover",
    style: {
      cursor: 'pointer',
      background: '#fff',
      border: '1px solid var(--cream-300)',
      borderRadius: 'var(--radius-2xl)',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      height: '120px'
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: s.cover,
    alt: s.name,
    style: {
      width: '100%',
      height: '100%',
      objectFit: 'cover'
    }
  }), s.deliveryToday && /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      bottom: '8px',
      left: '8px'
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    variant: "free",
    icon: "truck"
  }, "Consegna oggi"))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '12px 14px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '6px'
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-serif)',
      fontSize: '16px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, s.name), s.verified && /*#__PURE__*/React.createElement(Lucide, {
    name: "badge-check",
    size: 15,
    color: "var(--primary-600)"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '5px',
      fontSize: '12px',
      color: 'var(--ink-500)',
      marginTop: '5px'
    }
  }, /*#__PURE__*/React.createElement(Stars, {
    value: s.rating,
    size: 13
  }), " ", /*#__PURE__*/React.createElement("strong", {
    style: {
      color: 'var(--ink-800)'
    }
  }, String(s.rating).replace('.', ',')), " \xB7 ", s.cat, " \xB7 ", s.area))))));
}
function TrustRow() {
  const items = [{
    icon: 'banknote',
    tone: ['var(--olive-100)', 'var(--olive-700)'],
    t: 'Paghi alla consegna',
    d: 'Niente carta: l’account serve solo per confermare.'
  }, {
    icon: 'home',
    tone: ['var(--primary-100)', 'var(--primary-700)'],
    t: '100% commercianti locali',
    d: 'Solo negozi verificati di Piacenza.'
  }, {
    icon: 'truck',
    tone: ['var(--accent-100)', 'var(--accent-700)'],
    t: 'Consegna in 24–48h',
    d: 'Rider del territorio, percorsi brevi.'
  }, {
    icon: 'rotate-ccw',
    tone: ['var(--secondary-100)', 'var(--secondary-600)'],
    t: 'Reso entro 14 giorni',
    d: 'Cambi idea? Ti rimborsiamo senza domande.'
  }];
  return /*#__PURE__*/React.createElement("section", {
    style: {
      background: 'var(--cream-50)',
      borderTop: '1px solid var(--cream-300)',
      borderBottom: '1px solid var(--cream-300)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 'var(--container-max)',
      margin: '0 auto',
      padding: '28px 20px',
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: '16px'
    }
  }, items.map(v => /*#__PURE__*/React.createElement("div", {
    key: v.t,
    style: {
      display: 'flex',
      gap: '12px',
      alignItems: 'flex-start'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      flexShrink: 0,
      width: '44px',
      height: '44px',
      borderRadius: 'var(--radius-full)',
      background: v.tone[0],
      color: v.tone[1],
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: v.icon,
    size: 20,
    stroke: 2.2,
    color: v.tone[1]
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontWeight: 700,
      fontSize: '15px',
      color: 'var(--ink-900)'
    }
  }, v.t), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 0',
      fontSize: '13px',
      color: 'var(--ink-600)',
      lineHeight: 1.45
    }
  }, v.d))))));
}
function SellerCta() {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      background: 'var(--ink-900)',
      color: '#fff'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 'var(--container-max)',
      margin: '0 auto',
      padding: '22px 20px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '16px',
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      flexShrink: 0,
      width: '40px',
      height: '40px',
      borderRadius: 'var(--radius-full)',
      background: 'rgba(255,255,255,.1)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "shield-check",
    size: 18,
    stroke: 2.4,
    color: "var(--accent-400)"
  })), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '17px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-serif)',
      fontWeight: 700
    }
  }, "Hai un negozio a Piacenza?"), " ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--ink-300)'
    }
  }, "Vendi online con zero commissioni."))), /*#__PURE__*/React.createElement(Button, {
    variant: "accent",
    shape: "pill",
    icon: "store"
  }, "Diventa venditore")));
}
function Footer({
  onAuth
}) {
  const cols = [['MyCity', ['Chi siamo', 'Come funziona', 'Lavora con noi', 'Contatti']], ['Acquista', ['Categorie', 'Negozi', 'Offerte', 'Novità']], ['Vendi', ['Diventa venditore', 'Zero commissioni', 'Centro venditori', 'Diventa rider']], ['Aiuto', ['FAQ', 'Resi e rimborsi', 'Privacy', 'Cookie']]];
  return /*#__PURE__*/React.createElement("footer", {
    style: {
      background: 'var(--cream-200)',
      borderTop: '1px solid var(--cream-300)',
      color: 'var(--ink-700)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 'var(--container-max)',
      margin: '0 auto',
      padding: '36px 20px',
      display: 'grid',
      gridTemplateColumns: '1.4fr repeat(4, 1fr)',
      gap: '28px'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-serif)',
      fontSize: '24px',
      fontWeight: 800
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--accent-500)'
    }
  }, "My"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--ink-900)'
    }
  }, "City")), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '10px 0 0',
      fontSize: '13px',
      lineHeight: 1.6,
      maxWidth: '24em',
      color: 'var(--ink-500)'
    }
  }, "Il marketplace dei negozi locali di Piacenza. Consegna a domicilio, pagamento alla consegna.")), cols.map(([h, links]) => /*#__PURE__*/React.createElement("div", {
    key: h
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '0 0 10px',
      fontSize: '13px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, h), /*#__PURE__*/React.createElement("ul", {
    style: {
      listStyle: 'none',
      margin: 0,
      padding: 0,
      display: 'flex',
      flexDirection: 'column',
      gap: '7px'
    }
  }, links.map(l => /*#__PURE__*/React.createElement("li", {
    key: l
  }, /*#__PURE__*/React.createElement("a", {
    style: {
      fontSize: '13px',
      color: 'var(--ink-600)',
      cursor: 'pointer'
    }
  }, l))))))), /*#__PURE__*/React.createElement("div", {
    style: {
      borderTop: '1px solid var(--cream-300)',
      padding: '14px 20px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '16px',
      flexWrap: 'wrap',
      fontSize: '12px',
      color: 'var(--ink-500)'
    }
  }, /*#__PURE__*/React.createElement("span", null, "\xA9 2026 MyCity Piacenza \xB7 P.IVA 0000000000 \xB7 Tutti i diritti riservati"), onAuth && /*#__PURE__*/React.createElement("a", {
    onClick: onAuth,
    style: {
      cursor: 'pointer',
      fontWeight: 700,
      color: 'var(--primary-700)'
    }
  }, "Accedi / Registrati")));
}
function Home({
  products,
  stores,
  onOpen,
  onAdd,
  onStore,
  onExplore
}) {
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Hero, {
    onExplore: onExplore,
    onStore: onStore
  }), /*#__PURE__*/React.createElement(HowItWorks, null), /*#__PURE__*/React.createElement(ProductRail, {
    products: products.slice(0, 4),
    onOpen: onOpen,
    onAdd: onAdd,
    onStore: onStore,
    eyebrow: "I pi\xF9 amati",
    title: "Prodotti che vanno forte",
    onSeeAll: onExplore
  }), /*#__PURE__*/React.createElement(StoresRail, {
    stores: stores.slice(0, 4),
    onStore: onStore
  }), /*#__PURE__*/React.createElement(TrustRow, null), /*#__PURE__*/React.createElement(ProductRail, {
    products: products.slice(4, 8),
    onOpen: onOpen,
    onAdd: onAdd,
    onStore: onStore,
    eyebrow: "Novit\xE0",
    title: "Appena arrivati dai negozi",
    onSeeAll: onExplore
  }), /*#__PURE__*/React.createElement(SellerCta, null));
}
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/buyer/src/20-home.js", error: String((e && e.message) || e) }); }

// ui_kits/buyer/src/25-auth.js
try { (() => {
// ===== Auth (login / registrazione) =====
function AuthPage({
  mode = 'login',
  onAuth,
  onBack,
  onSwitch
}) {
  const isLogin = mode === 'login';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      minHeight: '70vh',
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      maxWidth: 'var(--container-max)',
      margin: '0 auto'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      padding: '48px 56px'
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: onBack,
    style: {
      ...backLink,
      alignSelf: 'flex-start',
      marginBottom: '12px'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "arrow-left",
    size: 17
  }), " Indietro"), /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: '0 0 6px',
      fontFamily: 'var(--font-serif)',
      fontSize: '34px',
      fontWeight: 800,
      color: 'var(--ink-900)'
    }
  }, isLogin ? 'Bentornata su MyCity' : 'Crea il tuo account'), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '0 0 24px',
      fontSize: '15px',
      color: 'var(--ink-600)',
      lineHeight: 1.55
    }
  }, isLogin ? 'Accedi per seguire i tuoi ordini e i negozi preferiti.' : 'Ti serve solo per confermare l’ordine — paghi sempre alla consegna.'), /*#__PURE__*/React.createElement("form", {
    onSubmit: e => {
      e.preventDefault();
      onAuth();
    },
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '14px',
      maxWidth: '380px'
    }
  }, !isLogin && /*#__PURE__*/React.createElement(Input, {
    label: "Nome e cognome",
    placeholder: "Lucia Bianchi",
    leading: /*#__PURE__*/React.createElement(Lucide, {
      name: "user",
      size: 18,
      color: "var(--ink-400)"
    })
  }), /*#__PURE__*/React.createElement(Input, {
    label: "Email",
    type: "email",
    placeholder: "nome@email.it",
    leading: /*#__PURE__*/React.createElement(Lucide, {
      name: "mail",
      size: 18,
      color: "var(--ink-400)"
    })
  }), /*#__PURE__*/React.createElement(Input, {
    label: "Password",
    type: "password",
    placeholder: "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022",
    leading: /*#__PURE__*/React.createElement(Lucide, {
      name: "lock",
      size: 18,
      color: "var(--ink-400)"
    }),
    labelAction: isLogin ? /*#__PURE__*/React.createElement("a", {
      style: {
        cursor: 'pointer'
      }
    }, "Password dimenticata?") : null
  }), !isLogin && /*#__PURE__*/React.createElement(Checkbox, {
    label: /*#__PURE__*/React.createElement(React.Fragment, null, "Accetto i ", /*#__PURE__*/React.createElement("a", {
      style: {
        cursor: 'pointer'
      }
    }, "termini"), " e la ", /*#__PURE__*/React.createElement("a", {
      style: {
        cursor: 'pointer'
      }
    }, "privacy"), "."),
    defaultChecked: true
  }), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    size: "lg",
    type: "submit",
    fullWidth: true,
    iconRight: "arrow-right"
  }, isLogin ? 'Accedi' : 'Crea account')), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      margin: '20px 0',
      maxWidth: '380px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      height: '1px',
      background: 'var(--cream-300)'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '12px',
      color: 'var(--ink-400)'
    }
  }, "oppure"), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      height: '1px',
      background: 'var(--cream-300)'
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: '10px',
      maxWidth: '380px'
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    fullWidth: true,
    icon: "smartphone"
  }, "SPID"), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    fullWidth: true,
    onClick: onAuth
  }, "Continua con Google")), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '22px 0 0',
      fontSize: '14px',
      color: 'var(--ink-600)'
    }
  }, isLogin ? 'Non hai un account? ' : 'Hai già un account? ', /*#__PURE__*/React.createElement("a", {
    onClick: () => onSwitch(isLogin ? 'register' : 'login'),
    style: {
      cursor: 'pointer',
      fontWeight: 700
    }
  }, isLogin ? 'Registrati' : 'Accedi'))), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      background: 'var(--primary-700)',
      color: '#fff',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      padding: '48px 56px',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    "aria-hidden": true,
    style: {
      position: 'absolute',
      top: '-100px',
      right: '-100px',
      width: '380px',
      height: '380px',
      borderRadius: '50%',
      background: 'rgba(244,188,83,.25)',
      filter: 'blur(60px)'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      fontFamily: 'var(--font-serif)',
      fontSize: '30px',
      fontWeight: 800,
      lineHeight: 1.15,
      marginBottom: '24px'
    }
  }, "I negozi ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--accent-300)',
      fontStyle: 'italic'
    }
  }, "veri"), " di Piacenza, ora a casa tua."), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
      gap: '14px'
    }
  }, [['banknote', 'Paghi alla consegna, nessuna carta'], ['truck', 'Consegna in 24–48h dai negozi della tua via'], ['badge-check', '100% commercianti locali verificati'], ['rotate-ccw', 'Reso gratuito entro 14 giorni']].map(([ic, t]) => /*#__PURE__*/React.createElement("span", {
    key: t,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '12px',
      fontSize: '15px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '36px',
      height: '36px',
      borderRadius: '50%',
      background: 'rgba(255,255,255,.12)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: ic,
    size: 18,
    color: "var(--accent-300)"
  })), " ", t)))));
}
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/buyer/src/25-auth.js", error: String((e && e.message) || e) }); }

// ui_kits/buyer/src/30-store.js
try { (() => {
// ===== Store page (vetrina + catalogo + info + recensioni) =====
function StorePage({
  store,
  products,
  onBack,
  onOpen,
  onAdd
}) {
  const [tab, setTab] = React.useState('prodotti');
  const items = products.filter(p => p.store === store.name);
  const storeReviews = items.flatMap(p => (window.MC_REVIEWS[p.id] || []).map(r => ({
    ...r,
    product: p.name
  }))).slice(0, 6);
  const avg = items.length ? items.reduce((s, p) => s + p.rating, 0) / items.length : store.rating;
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      height: '240px',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: store.cover,
    alt: store.name,
    style: {
      width: '100%',
      height: '100%',
      objectFit: 'cover'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      inset: 0,
      background: 'linear-gradient(180deg, rgba(28,26,24,.15), rgba(28,26,24,.78))'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      top: '16px',
      left: '50%',
      transform: 'translateX(-50%)',
      width: '100%',
      maxWidth: 'var(--container-max)',
      padding: '0 20px',
      boxSizing: 'border-box'
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: onBack,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      border: 0,
      background: 'rgba(255,255,255,.92)',
      color: 'var(--ink-800)',
      fontSize: '13px',
      fontWeight: 600,
      cursor: 'pointer',
      padding: '8px 14px',
      borderRadius: 'var(--radius-full)',
      fontFamily: 'var(--font-sans)'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "arrow-left",
    size: 16
  }), " Indietro")), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      bottom: '18px',
      left: '50%',
      transform: 'translateX(-50%)',
      width: '100%',
      maxWidth: 'var(--container-max)',
      padding: '0 20px',
      boxSizing: 'border-box',
      color: '#fff'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-end',
      gap: '16px',
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: '72px',
      height: '72px',
      borderRadius: 'var(--radius-xl)',
      background: 'linear-gradient(135deg, var(--primary-500), var(--primary-700))',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'var(--font-serif)',
      fontSize: '28px',
      fontWeight: 800,
      boxShadow: 'var(--shadow-warm-lg)',
      flexShrink: 0
    }
  }, initials(store.name)), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: '200px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px'
    }
  }, /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-serif)',
      fontSize: '34px',
      fontWeight: 800,
      color: '#fff',
      lineHeight: 1.1
    }
  }, store.name), store.verified && /*#__PURE__*/React.createElement(Lucide, {
    name: "badge-check",
    size: 22,
    color: "var(--accent-400)"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      marginTop: '6px',
      fontSize: '14px',
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '5px'
    }
  }, /*#__PURE__*/React.createElement(Stars, {
    value: avg,
    size: 15
  }), " ", /*#__PURE__*/React.createElement("strong", null, avg.toFixed(1).replace('.', ',')), " ", /*#__PURE__*/React.createElement("span", {
    style: {
      opacity: .8
    }
  }, "\xB7 ", store.reviews, " recensioni")), /*#__PURE__*/React.createElement("span", {
    style: {
      opacity: .85
    }
  }, "\xB7 ", store.cat, " \xB7 ", store.area), /*#__PURE__*/React.createElement("span", {
    style: {
      opacity: .85
    }
  }, "\xB7 dal ", store.since))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: '8px'
    }
  }, /*#__PURE__*/React.createElement(OpenPill, {
    store: store,
    dark: true
  }), store.deliveryToday && /*#__PURE__*/React.createElement(Badge, {
    variant: "free",
    icon: "truck"
  }, "Consegna oggi"))))), /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 'var(--container-max)',
      margin: '0 auto',
      padding: '20px'
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '0 0 18px',
      fontSize: '16px',
      lineHeight: 1.6,
      color: 'var(--ink-700)',
      maxWidth: '60ch'
    }
  }, store.blurb), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: '4px',
      borderBottom: '1px solid var(--cream-300)',
      marginBottom: '22px'
    }
  }, [['prodotti', `Prodotti · ${items.length}`], ['info', 'Info & orari'], ['recensioni', `Recensioni · ${store.reviews}`]].map(([id, label]) => /*#__PURE__*/React.createElement("button", {
    key: id,
    onClick: () => setTab(id),
    style: {
      border: 0,
      background: 'transparent',
      padding: '10px 16px',
      fontSize: '14px',
      fontWeight: tab === id ? 700 : 500,
      color: tab === id ? 'var(--primary-700)' : 'var(--ink-500)',
      cursor: 'pointer',
      borderBottom: `2px solid ${tab === id ? 'var(--primary-600)' : 'transparent'}`,
      fontFamily: 'var(--font-sans)',
      marginBottom: '-1px'
    }
  }, label))), tab === 'prodotti' && (items.length === 0 ? /*#__PURE__*/React.createElement(EmptyState, {
    icon: "package-open",
    title: "Nessun prodotto",
    description: "Questo negozio non ha ancora prodotti a catalogo."
  }) : /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: '16px'
    }
  }, items.map(p => /*#__PURE__*/React.createElement(ProductGridCard, {
    key: p.id,
    p: p,
    onOpen: onOpen,
    onAdd: onAdd
  })))), tab === 'info' && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1.2fr 1fr',
      gap: '24px'
    }
  }, /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "lg"
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: '0 0 12px',
      fontFamily: 'var(--font-serif)',
      fontSize: '18px',
      color: 'var(--ink-900)'
    }
  }, "Orari di apertura"), [['Lun – Ven', `8:00 – ${store.closeAt}`], ['Sabato', `8:00 – ${store.closeAt}`], ['Domenica', 'Chiuso']].map(([d, h]) => /*#__PURE__*/React.createElement("div", {
    key: d,
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      padding: '8px 0',
      borderBottom: '1px solid var(--cream-200)',
      fontSize: '14px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--ink-600)'
    }
  }, d), /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 600,
      color: h === 'Chiuso' ? 'var(--secondary-600)' : 'var(--ink-900)'
    }
  }, h)))), /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "lg"
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: '0 0 12px',
      fontFamily: 'var(--font-serif)',
      fontSize: '18px',
      color: 'var(--ink-900)'
    }
  }, "Dove siamo"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      fontSize: '14px',
      color: 'var(--ink-700)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "map-pin",
    size: 16,
    color: "var(--primary-600)"
  }), " ", store.area, ", Piacenza (PC)"), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "truck",
    size: 16,
    color: "var(--olive-600)"
  }), " Consegna ", store.deliveryToday ? 'in giornata o' : '', " in 24\u201348h"), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "banknote",
    size: 16,
    color: "var(--olive-600)"
  }), " Pagamento alla consegna"), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "award",
    size: 16,
    color: "var(--accent-600)"
  }), " Attivit\xE0 storica dal ", store.since)))), tab === 'recensioni' && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr',
      gap: '12px',
      maxWidth: '760px'
    }
  }, storeReviews.length === 0 ? /*#__PURE__*/React.createElement(EmptyState, {
    icon: "message-circle",
    title: "Ancora nessuna recensione",
    description: "Sii il primo a recensire questo negozio."
  }) : storeReviews.map((r, i) => /*#__PURE__*/React.createElement(ReviewItem, {
    key: i,
    r: r
  })))));
}
function ReviewItem({
  r
}) {
  return /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "md"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      marginBottom: '6px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '34px',
      height: '34px',
      borderRadius: '50%',
      background: 'var(--cream-200)',
      color: 'var(--primary-700)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontWeight: 700,
      fontSize: '13px'
    }
  }, initials(r.who)), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px'
    }
  }, /*#__PURE__*/React.createElement("strong", {
    style: {
      fontSize: '14px',
      color: 'var(--ink-900)'
    }
  }, r.who), /*#__PURE__*/React.createElement(Stars, {
    value: r.rating,
    size: 13
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '12px',
      color: 'var(--ink-400)'
    }
  }, r.when, r.product ? ` · ${r.product}` : ''))), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '14px',
      lineHeight: 1.55,
      color: 'var(--ink-700)'
    }
  }, r.text));
}
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/buyer/src/30-store.js", error: String((e && e.message) || e) }); }

// ui_kits/buyer/src/35-checkout.js
try { (() => {
// ===== Checkout (indirizzo → consegna → pagamento → conferma) =====
function CheckoutPage({
  items,
  onBack,
  onPlace
}) {
  const [addr, setAddr] = React.useState(window.MC_ADDRESSES.find(a => a.def).id);
  const [slot, setSlot] = React.useState(window.MC_SLOTS.find(s => s.fee === 0).id);
  const [pay, setPay] = React.useState('cod');
  const [note, setNote] = React.useState('');
  const subtotal = items.reduce((s, it) => s + it.finalPrice * it.qty, 0);
  const chosenSlot = window.MC_SLOTS.find(s => s.id === slot) || {};
  const shipping = subtotal >= 25 ? 0 : chosenSlot.fee || 0;
  const total = subtotal + shipping;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 'var(--container-max)',
      margin: '0 auto',
      padding: '24px 20px'
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: onBack,
    style: backLink
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "arrow-left",
    size: 17
  }), " Torna al carrello"), /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: '6px 0 20px',
      fontFamily: 'var(--font-serif)',
      fontSize: '32px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, "Conferma il tuo ordine"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 380px',
      gap: '28px',
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '16px'
    }
  }, /*#__PURE__*/React.createElement(StepCard, {
    n: 1,
    icon: "map-pin",
    title: "Indirizzo di consegna"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '12px'
    }
  }, window.MC_ADDRESSES.map(a => /*#__PURE__*/React.createElement(SelectTile, {
    key: a.id,
    active: addr === a.id,
    onClick: () => setAddr(a.id)
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      marginBottom: '4px'
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    variant: "local"
  }, a.label), a.def && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '11px',
      color: 'var(--ink-400)'
    }
  }, "Predefinito")), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '14px',
      fontWeight: 600,
      color: 'var(--ink-900)'
    }
  }, a.name), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 0',
      fontSize: '13px',
      color: 'var(--ink-600)'
    }
  }, a.street, ", ", a.city)))), /*#__PURE__*/React.createElement("button", {
    style: ghostAdd
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "plus",
    size: 15
  }), " Aggiungi nuovo indirizzo")), /*#__PURE__*/React.createElement(StepCard, {
    n: 2,
    icon: "truck",
    title: "Quando vuoi riceverlo"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: '12px'
    }
  }, window.MC_SLOTS.map(s => /*#__PURE__*/React.createElement(SelectTile, {
    key: s.id,
    active: slot === s.id,
    onClick: () => setSlot(s.id)
  }, s.label && /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      top: '-9px',
      left: '12px'
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    variant: s.fee === 0 ? 'new' : 'urgency'
  }, s.label)), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '14px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, s.day), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 6px',
      fontSize: '13px',
      color: 'var(--ink-600)'
    }
  }, s.time), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '13px',
      fontWeight: 700,
      color: s.fee === 0 ? 'var(--olive-700)' : 'var(--ink-700)'
    }
  }, s.fee === 0 ? 'Gratis' : fmt(s.fee)))))), /*#__PURE__*/React.createElement(StepCard, {
    n: 3,
    icon: "banknote",
    title: "Come paghi"
  }, /*#__PURE__*/React.createElement(SelectTile, {
    active: pay === 'cod',
    onClick: () => setPay('cod'),
    row: true
  }, /*#__PURE__*/React.createElement("span", {
    style: payIcon('var(--olive-100)', 'var(--olive-700)')
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "banknote",
    size: 20,
    color: "var(--olive-700)"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '14px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, "Paga alla consegna \xB7 contanti"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 0',
      fontSize: '13px',
      color: 'var(--ink-600)'
    }
  }, "Paghi al rider quando arriva. Tieni pronti ", fmt(total), ".")), /*#__PURE__*/React.createElement(Badge, {
    variant: "new"
  }, "Consigliato")), /*#__PURE__*/React.createElement(SelectTile, {
    active: pay === 'card',
    onClick: () => setPay('card'),
    row: true,
    style: {
      marginTop: '10px',
      opacity: .7
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: payIcon('var(--surface-200)', 'var(--ink-500)')
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "credit-card",
    size: 20,
    color: "var(--ink-500)"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '14px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, "Carta di credito"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 0',
      fontSize: '13px',
      color: 'var(--ink-500)'
    }
  }, "Presto disponibile"))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: '14px'
    }
  }, /*#__PURE__*/React.createElement(Input, {
    label: "Note per il rider (facoltativo)",
    placeholder: "Es. citofono Bianchi, 2\xB0 piano",
    value: note,
    onChange: e => setNote(e.target.value)
  })))), /*#__PURE__*/React.createElement("aside", {
    style: {
      position: 'sticky',
      top: '128px'
    }
  }, /*#__PURE__*/React.createElement(Card, {
    variant: "elevated",
    padding: "lg"
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: '0 0 14px',
      fontFamily: 'var(--font-serif)',
      fontSize: '18px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, "Riepilogo"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      maxHeight: '220px',
      overflowY: 'auto',
      marginBottom: '12px'
    }
  }, items.map(it => /*#__PURE__*/React.createElement("div", {
    key: it.id,
    style: {
      display: 'flex',
      gap: '10px',
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative'
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: it.img,
    alt: it.name,
    style: {
      width: '46px',
      height: '46px',
      borderRadius: 'var(--radius-md)',
      objectFit: 'cover'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      top: '-6px',
      right: '-6px',
      minWidth: '18px',
      height: '18px',
      padding: '0 4px',
      borderRadius: '50%',
      background: 'var(--ink-900)',
      color: '#fff',
      fontSize: '11px',
      fontWeight: 700,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, it.qty)), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      fontSize: '13px',
      color: 'var(--ink-700)',
      lineHeight: 1.3
    }
  }, it.name), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '13px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, fmt(it.finalPrice * it.qty))))), /*#__PURE__*/React.createElement(Divider, null), /*#__PURE__*/React.createElement(Row, {
    label: "Subtotale",
    val: fmt(subtotal)
  }), /*#__PURE__*/React.createElement(Row, {
    label: `Consegna · ${chosenSlot.day} ${chosenSlot.time}`,
    val: shipping === 0 ? 'Gratis' : fmt(shipping),
    olive: shipping === 0
  }), /*#__PURE__*/React.createElement(Divider, null), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      fontSize: '20px',
      fontWeight: 800,
      color: 'var(--ink-900)',
      margin: '6px 0 14px'
    }
  }, /*#__PURE__*/React.createElement("span", null, "Totale"), /*#__PURE__*/React.createElement("span", null, fmt(total))), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    size: "lg",
    fullWidth: true,
    iconRight: "arrow-right",
    onClick: () => onPlace({
      items,
      total,
      slot: chosenSlot,
      address: window.MC_ADDRESSES.find(a => a.id === addr)
    })
  }, "Conferma e ordina"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '10px 0 0',
      fontSize: '12px',
      color: 'var(--ink-500)',
      textAlign: 'center'
    }
  }, "Confermando accetti i termini. Paghi solo alla consegna.")))));
}
const backLink = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  border: 0,
  background: 'transparent',
  color: 'var(--ink-600)',
  fontSize: '14px',
  fontWeight: 500,
  cursor: 'pointer',
  padding: '8px 0',
  fontFamily: 'var(--font-sans)'
};
const ghostAdd = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  marginTop: '12px',
  border: '1px dashed var(--cream-400)',
  background: 'transparent',
  color: 'var(--primary-700)',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer',
  padding: '10px 14px',
  borderRadius: 'var(--radius-md)',
  fontFamily: 'var(--font-sans)',
  width: '100%',
  justifyContent: 'center'
};
const payIcon = (bg, fg) => ({
  width: '40px',
  height: '40px',
  borderRadius: 'var(--radius-md)',
  background: bg,
  color: fg,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0
});
function StepCard({
  n,
  icon,
  title,
  children
}) {
  return /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "lg"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      marginBottom: '14px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '28px',
      height: '28px',
      borderRadius: '50%',
      background: 'var(--primary-700)',
      color: '#fff',
      fontSize: '14px',
      fontWeight: 700,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'var(--font-sans)'
    }
  }, n), /*#__PURE__*/React.createElement(Lucide, {
    name: icon,
    size: 18,
    color: "var(--primary-700)"
  }), /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-serif)',
      fontSize: '18px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, title)), children);
}
function SelectTile({
  active,
  onClick,
  children,
  row,
  style
}) {
  return /*#__PURE__*/React.createElement("button", {
    onClick: onClick,
    style: {
      position: 'relative',
      textAlign: 'left',
      cursor: 'pointer',
      display: row ? 'flex' : 'block',
      alignItems: 'center',
      gap: '12px',
      width: '100%',
      background: active ? 'var(--primary-50)' : 'var(--surface-0)',
      border: `1.5px solid ${active ? 'var(--primary-500)' : 'var(--cream-300)'}`,
      borderRadius: 'var(--radius-lg)',
      padding: '14px',
      fontFamily: 'var(--font-sans)',
      boxShadow: active ? '0 0 0 3px rgba(228,122,90,.15)' : 'none',
      transition: 'border-color var(--dur-base), background var(--dur-base)',
      ...style
    }
  }, children);
}
function Row({
  label,
  val,
  olive
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      fontSize: '14px',
      color: 'var(--ink-600)',
      padding: '3px 0'
    }
  }, /*#__PURE__*/React.createElement("span", null, label), /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 600,
      color: olive ? 'var(--olive-700)' : 'var(--ink-800)'
    }
  }, val));
}
function Divider() {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      height: '1px',
      background: 'var(--cream-300)',
      margin: '10px 0'
    }
  });
}
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/buyer/src/35-checkout.js", error: String((e && e.message) || e) }); }

// ui_kits/buyer/src/40-srp.js
try { (() => {
// ===== Search results page (SRP) — faceted filters + sort =====
const MC_SORTS = [['rilevanza', 'Rilevanza'], ['prezzo-asc', 'Prezzo crescente'], ['prezzo-desc', 'Prezzo decrescente'], ['sconto', 'Sconto maggiore'], ['novita', 'Novità']];
function SearchResults({
  allProducts,
  query,
  cat,
  onOpen,
  onAdd,
  onStore,
  onClearNav
}) {
  const [priceMax, setPriceMax] = React.useState(40);
  const [stores, setStores] = React.useState(() => new Set());
  const [deliveryToday, setDeliveryToday] = React.useState(false);
  const [onlyDiscount, setOnlyDiscount] = React.useState(false);
  const [inStock, setInStock] = React.useState(false);
  const [sort, setSort] = React.useState('rilevanza');
  const storeNames = [...new Set(allProducts.map(p => p.store))];
  let list = allProducts.filter(p => {
    if (cat && p.cat !== cat) return false;
    if (query) {
      const q = query.toLowerCase();
      if (!p.name.toLowerCase().includes(q) && !p.store.toLowerCase().includes(q) && !(p.tags || []).join(' ').toLowerCase().includes(q)) return false;
    }
    if (finalPrice(p) > priceMax) return false;
    if (stores.size && !stores.has(p.store)) return false;
    if (deliveryToday && !(storeBy(p.store) || {}).deliveryToday) return false;
    if (onlyDiscount && !(p.discountPercent > 0)) return false;
    if (inStock && p.stock === 0) return false;
    return true;
  });
  list = [...list].sort((a, b) => {
    if (sort === 'prezzo-asc') return finalPrice(a) - finalPrice(b);
    if (sort === 'prezzo-desc') return finalPrice(b) - finalPrice(a);
    if (sort === 'sconto') return (b.discountPercent || 0) - (a.discountPercent || 0);
    if (sort === 'novita') return (b.isNew ? 1 : 0) - (a.isNew ? 1 : 0);
    return 0;
  });
  const catLabel = cat ? (window.MC_CATEGORIES.find(c => c.slug === cat) || {}).label : null;
  const heading = query ? `Risultati per “${query}”` : catLabel || 'Tutti i prodotti';
  const activeFilters = (stores.size > 0) + deliveryToday + onlyDiscount + inStock + (priceMax < 40);
  function toggleStore(name) {
    setStores(prev => {
      const n = new Set(prev);
      n.has(name) ? n.delete(name) : n.add(name);
      return n;
    });
  }
  function reset() {
    setPriceMax(40);
    setStores(new Set());
    setDeliveryToday(false);
    setOnlyDiscount(false);
    setInStock(false);
  }
  return /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 'var(--container-max)',
      margin: '0 auto',
      padding: '24px 20px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: '13px',
      color: 'var(--ink-500)',
      marginBottom: '6px',
      display: 'flex',
      alignItems: 'center',
      gap: '6px'
    }
  }, /*#__PURE__*/React.createElement("a", {
    onClick: onClearNav,
    style: {
      cursor: 'pointer',
      color: 'var(--ink-500)'
    }
  }, "Home"), " ", /*#__PURE__*/React.createElement(Lucide, {
    name: "chevron-right",
    size: 13,
    color: "var(--ink-400)"
  }), " ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--ink-700)'
    }
  }, heading)), /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: '0 0 4px',
      fontFamily: 'var(--font-serif)',
      fontSize: '30px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, heading), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '248px 1fr',
      gap: '28px',
      marginTop: '18px',
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement("aside", {
    style: {
      position: 'sticky',
      top: '128px',
      display: 'flex',
      flexDirection: 'column',
      gap: '20px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-serif)',
      fontSize: '18px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, "Filtri"), activeFilters > 0 && /*#__PURE__*/React.createElement("button", {
    onClick: reset,
    style: {
      border: 0,
      background: 'transparent',
      color: 'var(--primary-700)',
      fontSize: '13px',
      fontWeight: 600,
      cursor: 'pointer',
      fontFamily: 'var(--font-sans)'
    }
  }, "Azzera")), /*#__PURE__*/React.createElement(FilterGroup, {
    title: "Prezzo massimo"
  }, /*#__PURE__*/React.createElement("input", {
    type: "range",
    min: "3",
    max: "40",
    step: "1",
    value: priceMax,
    onChange: e => setPriceMax(+e.target.value),
    style: {
      width: '100%',
      accentColor: 'var(--primary-600)'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      fontSize: '12px',
      color: 'var(--ink-500)'
    }
  }, /*#__PURE__*/React.createElement("span", null, "\u20AC3"), /*#__PURE__*/React.createElement("strong", {
    style: {
      color: 'var(--ink-900)'
    }
  }, "fino a ", fmt(priceMax)))), /*#__PURE__*/React.createElement(FilterGroup, {
    title: "Disponibilit\xE0"
  }, /*#__PURE__*/React.createElement(Checkbox, {
    label: "Consegna oggi",
    checked: deliveryToday,
    onChange: e => setDeliveryToday(e.target.checked)
  }), /*#__PURE__*/React.createElement(Checkbox, {
    label: "Solo in offerta",
    checked: onlyDiscount,
    onChange: e => setOnlyDiscount(e.target.checked)
  }), /*#__PURE__*/React.createElement(Checkbox, {
    label: "Solo disponibili",
    checked: inStock,
    onChange: e => setInStock(e.target.checked)
  })), /*#__PURE__*/React.createElement(FilterGroup, {
    title: "Negozio"
  }, storeNames.map(s => /*#__PURE__*/React.createElement(Checkbox, {
    key: s,
    label: s,
    checked: stores.has(s),
    onChange: () => toggleStore(s)
  })))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: '16px',
      flexWrap: 'wrap',
      gap: '10px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '14px',
      color: 'var(--ink-500)'
    }
  }, /*#__PURE__*/React.createElement("strong", {
    style: {
      color: 'var(--ink-900)'
    }
  }, list.length), " prodotti dai negozi di Piacenza"), /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px',
      fontSize: '13px',
      color: 'var(--ink-500)'
    }
  }, "Ordina per", /*#__PURE__*/React.createElement("select", {
    value: sort,
    onChange: e => setSort(e.target.value),
    style: {
      appearance: 'none',
      border: '1px solid var(--cream-300)',
      background: 'var(--surface-0)',
      borderRadius: 'var(--radius-md)',
      padding: '8px 30px 8px 12px',
      fontSize: '13px',
      fontWeight: 600,
      color: 'var(--ink-900)',
      fontFamily: 'var(--font-sans)',
      cursor: 'pointer',
      backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'14\' height=\'14\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%2378716c\' stroke-width=\'2.4\'%3E%3Cpolyline points=\'6 9 12 15 18 9\'/%3E%3C/svg%3E")',
      backgroundRepeat: 'no-repeat',
      backgroundPosition: 'right 10px center'
    }
  }, MC_SORTS.map(([v, l]) => /*#__PURE__*/React.createElement("option", {
    key: v,
    value: v
  }, l))))), list.length === 0 ? /*#__PURE__*/React.createElement(Card, {
    variant: "flat",
    padding: "lg"
  }, /*#__PURE__*/React.createElement(EmptyState, {
    icon: "search-x",
    title: "Nessun risultato",
    description: "Prova ad allargare i filtri o cambiare termine di ricerca.",
    action: /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      onClick: reset
    }, "Azzera i filtri")
  })) : /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: '16px'
    }
  }, list.map(p => /*#__PURE__*/React.createElement(ProductGridCard, {
    key: p.id,
    p: p,
    onOpen: onOpen,
    onAdd: onAdd,
    onStore: onStore
  }))))));
}
function FilterGroup({
  title,
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      borderTop: '1px solid var(--cream-300)',
      paddingTop: '14px',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '13px',
      fontWeight: 700,
      color: 'var(--ink-800)',
      textTransform: 'uppercase',
      letterSpacing: '0.03em'
    }
  }, title), children);
}
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/buyer/src/40-srp.js", error: String((e && e.message) || e) }); }

// ui_kits/buyer/src/45-account.js
try { (() => {
// ===== Account hub (profilo, ordini, preferiti, notifiche, messaggi, indirizzi) =====
const MC_ACCOUNT_NAV = [{
  id: 'ordini',
  icon: 'package',
  label: 'I miei ordini'
}, {
  id: 'preferiti',
  icon: 'heart',
  label: 'Preferiti'
}, {
  id: 'messaggi',
  icon: 'message-circle',
  label: 'Messaggi'
}, {
  id: 'notifiche',
  icon: 'bell',
  label: 'Notifiche'
}, {
  id: 'indirizzi',
  icon: 'map-pin',
  label: 'Indirizzi'
}, {
  id: 'profilo',
  icon: 'user',
  label: 'Profilo'
}];
function AccountPage({
  section = 'ordini',
  onSection,
  products,
  onOpen,
  onAdd,
  onStore,
  onOpenOrder
}) {
  const u = window.MC_USER;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 'var(--container-max)',
      margin: '0 auto',
      padding: '24px 20px',
      display: 'grid',
      gridTemplateColumns: '260px 1fr',
      gap: '28px',
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement("aside", {
    style: {
      position: 'sticky',
      top: '128px'
    }
  }, /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "md",
    style: {
      marginBottom: '14px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '46px',
      height: '46px',
      borderRadius: '50%',
      background: 'linear-gradient(135deg, var(--primary-500), var(--primary-700))',
      color: '#fff',
      fontWeight: 700,
      fontSize: '17px',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, u.initials), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontWeight: 700,
      color: 'var(--ink-900)',
      fontSize: '15px'
    }
  }, u.name), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '12px',
      color: 'var(--ink-500)',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, u.email)))), /*#__PURE__*/React.createElement("nav", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '2px'
    }
  }, MC_ACCOUNT_NAV.map(n => {
    const on = section === n.id;
    return /*#__PURE__*/React.createElement("button", {
      key: n.id,
      onClick: () => onSection(n.id),
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        border: 0,
        background: on ? 'var(--primary-50)' : 'transparent',
        color: on ? 'var(--primary-800)' : 'var(--ink-700)',
        fontWeight: on ? 700 : 500,
        fontSize: '14px',
        padding: '10px 12px',
        borderRadius: 'var(--radius-md)',
        cursor: 'pointer',
        fontFamily: 'var(--font-sans)',
        textAlign: 'left'
      }
    }, /*#__PURE__*/React.createElement(Lucide, {
      name: n.icon,
      size: 18,
      color: on ? 'var(--primary-700)' : 'var(--ink-500)'
    }), " ", n.label, n.id === 'notifiche' && /*#__PURE__*/React.createElement("span", {
      style: {
        marginLeft: 'auto',
        background: 'var(--secondary-600)',
        color: '#fff',
        fontSize: '11px',
        fontWeight: 700,
        borderRadius: '999px',
        padding: '1px 7px'
      }
    }, "2"));
  }), /*#__PURE__*/React.createElement("button", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      border: 0,
      background: 'transparent',
      color: 'var(--ink-500)',
      fontSize: '14px',
      padding: '10px 12px',
      borderRadius: 'var(--radius-md)',
      cursor: 'pointer',
      fontFamily: 'var(--font-sans)',
      marginTop: '8px'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "log-out",
    size: 18,
    color: "var(--ink-400)"
  }), " Esci"))), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, section === 'ordini' && /*#__PURE__*/React.createElement(OrdersList, {
    onOpenOrder: onOpenOrder,
    onReorder: onAdd
  }), section === 'preferiti' && /*#__PURE__*/React.createElement(FavoritesView, {
    products: products,
    onOpen: onOpen,
    onAdd: onAdd,
    onStore: onStore
  }), section === 'messaggi' && /*#__PURE__*/React.createElement(MessagesView, null), section === 'notifiche' && /*#__PURE__*/React.createElement(NotificationsView, null), section === 'indirizzi' && /*#__PURE__*/React.createElement(AddressesView, null), section === 'profilo' && /*#__PURE__*/React.createElement(ProfileView, null)));
}
function PageHead({
  title,
  sub
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: '18px'
    }
  }, /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-serif)',
      fontSize: '28px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, title), sub && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '4px 0 0',
      fontSize: '14px',
      color: 'var(--ink-500)'
    }
  }, sub));
}
function OrdersList({
  onOpenOrder,
  onReorder
}) {
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(PageHead, {
    title: "I miei ordini",
    sub: `${window.MC_ORDERS.length} ordini`
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '12px'
    }
  }, window.MC_ORDERS.map(o => {
    const lines = o.lines.map(l => ({
      p: window.MC_PRODUCTS.find(x => x.id === l.id),
      q: l.q
    })).filter(x => x.p);
    return /*#__PURE__*/React.createElement(Card, {
      key: o.id,
      variant: "bordered",
      padding: "md"
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '10px',
        marginBottom: '12px'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '12px'
      }
    }, /*#__PURE__*/React.createElement("strong", {
      style: {
        fontSize: '15px',
        color: 'var(--ink-900)'
      }
    }, o.id), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: '13px',
        color: 'var(--ink-500)'
      }
    }, o.date, " \xB7 ", o.store)), /*#__PURE__*/React.createElement(OrderStatusBadge, {
      status: o.status,
      size: "sm"
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: '6px',
        flex: 1
      }
    }, lines.map(({
      p,
      q
    }) => /*#__PURE__*/React.createElement("div", {
      key: p.id,
      style: {
        position: 'relative'
      },
      title: `${p.name} ×${q}`
    }, /*#__PURE__*/React.createElement("img", {
      src: imgUrl(p.kw, p.galleryLocks[0]),
      alt: p.name,
      style: {
        width: '48px',
        height: '48px',
        borderRadius: 'var(--radius-md)',
        objectFit: 'cover'
      }
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        position: 'absolute',
        top: '-6px',
        right: '-6px',
        minWidth: '17px',
        height: '17px',
        padding: '0 4px',
        borderRadius: '50%',
        background: 'var(--ink-900)',
        color: '#fff',
        fontSize: '10px',
        fontWeight: 700,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center'
      }
    }, q))), /*#__PURE__*/React.createElement("span", {
      style: {
        alignSelf: 'center',
        marginLeft: '6px',
        fontSize: '16px',
        fontWeight: 800,
        color: 'var(--ink-900)'
      }
    }, fmt(o.total))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: '8px'
      }
    }, (o.status === 'OUT_FOR_DELIVERY' || o.status === 'ASSIGNED' || o.status === 'NEW') && /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      size: "sm",
      icon: "map-pin",
      onClick: () => onOpenOrder(o)
    }, "Traccia"), /*#__PURE__*/React.createElement(Button, {
      variant: "ghost",
      size: "sm",
      icon: "rotate-ccw",
      onClick: () => {
        lines.forEach(({
          p,
          q
        }) => onReorder(p, q));
      }
    }, "Riordina"))));
  })));
}
function FavoritesView({
  products,
  onOpen,
  onAdd,
  onStore
}) {
  const favs = window.MC_FAVORITES.map(id => products.find(p => p.id === id)).filter(Boolean);
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(PageHead, {
    title: "Preferiti",
    sub: `${favs.length} prodotti salvati`
  }), favs.length === 0 ? /*#__PURE__*/React.createElement(EmptyState, {
    icon: "heart",
    title: "Nessun preferito",
    description: "Tocca il cuore su un prodotto per salvarlo qui."
  }) : /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: '16px'
    }
  }, favs.map(p => /*#__PURE__*/React.createElement(ProductGridCard, {
    key: p.id,
    p: p,
    onOpen: onOpen,
    onAdd: onAdd,
    onStore: onStore
  }))));
}
function NotificationsView() {
  const TONE = {
    primary: ['var(--primary-100)', 'var(--primary-700)'],
    secondary: ['var(--secondary-100)', 'var(--secondary-600)'],
    accent: ['var(--accent-100)', 'var(--accent-700)'],
    olive: ['var(--olive-100)', 'var(--olive-700)']
  };
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(PageHead, {
    title: "Notifiche"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '8px'
    }
  }, window.MC_NOTIFICATIONS.map(n => /*#__PURE__*/React.createElement(Card, {
    key: n.id,
    variant: n.unread ? 'elevated' : 'bordered',
    padding: "md",
    style: n.unread ? {
      borderColor: 'var(--primary-200)'
    } : {}
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: '12px',
      alignItems: 'flex-start'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '40px',
      height: '40px',
      borderRadius: '50%',
      background: TONE[n.tone][0],
      color: TONE[n.tone][1],
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: n.icon,
    size: 19,
    color: TONE[n.tone][1]
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '14px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, n.title), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 0',
      fontSize: '13px',
      color: 'var(--ink-600)'
    }
  }, n.body)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '12px',
      color: 'var(--ink-400)'
    }
  }, n.when), n.unread && /*#__PURE__*/React.createElement("span", {
    style: {
      width: '8px',
      height: '8px',
      borderRadius: '50%',
      background: 'var(--primary-600)'
    }
  })))))));
}
function MessagesView() {
  const [active, setActive] = React.useState(window.MC_THREADS[0].id);
  const thread = window.MC_THREADS.find(t => t.id === active);
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(PageHead, {
    title: "Messaggi",
    sub: "Scrivi direttamente ai negozi"
  }), /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "none"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '240px 1fr',
      height: '440px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      borderRight: '1px solid var(--cream-200)',
      overflowY: 'auto'
    }
  }, window.MC_THREADS.map(t => /*#__PURE__*/React.createElement("button", {
    key: t.id,
    onClick: () => setActive(t.id),
    style: {
      display: 'flex',
      gap: '10px',
      width: '100%',
      textAlign: 'left',
      border: 0,
      borderBottom: '1px solid var(--cream-100)',
      background: active === t.id ? 'var(--primary-50)' : 'transparent',
      padding: '12px 14px',
      cursor: 'pointer',
      fontFamily: 'var(--font-sans)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '36px',
      height: '36px',
      borderRadius: '50%',
      background: 'linear-gradient(135deg, var(--primary-500), var(--primary-700))',
      color: '#fff',
      fontWeight: 700,
      fontSize: '13px',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0
    }
  }, initials(t.store)), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      gap: '6px'
    }
  }, /*#__PURE__*/React.createElement("strong", {
    style: {
      fontSize: '13px',
      color: 'var(--ink-900)'
    }
  }, t.store), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '11px',
      color: 'var(--ink-400)'
    }
  }, t.when)), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 0',
      fontSize: '12px',
      color: 'var(--ink-500)',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, t.last)), t.unread > 0 && /*#__PURE__*/React.createElement("span", {
    style: {
      alignSelf: 'center',
      background: 'var(--secondary-600)',
      color: '#fff',
      fontSize: '11px',
      fontWeight: 700,
      borderRadius: '999px',
      minWidth: '18px',
      height: '18px',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, t.unread)))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '12px 16px',
      borderBottom: '1px solid var(--cream-200)',
      display: 'flex',
      alignItems: 'center',
      gap: '8px'
    }
  }, /*#__PURE__*/React.createElement(StoreChip, {
    name: thread.store,
    size: 26
  }), " ", /*#__PURE__*/React.createElement(Lucide, {
    name: "badge-check",
    size: 15,
    color: "var(--primary-600)"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflowY: 'auto',
      padding: '16px',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      background: 'var(--cream-50)'
    }
  }, thread.msgs.map((m, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      alignSelf: m.me ? 'flex-end' : 'flex-start',
      maxWidth: '72%'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: m.me ? 'var(--primary-700)' : '#fff',
      color: m.me ? '#fff' : 'var(--ink-800)',
      border: m.me ? 'none' : '1px solid var(--cream-300)',
      borderRadius: m.me ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
      padding: '9px 13px',
      fontSize: '14px',
      lineHeight: 1.4
    }
  }, m.text), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'block',
      fontSize: '10px',
      color: 'var(--ink-400)',
      marginTop: '3px',
      textAlign: m.me ? 'right' : 'left'
    }
  }, m.when)))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '12px 16px',
      borderTop: '1px solid var(--cream-200)',
      display: 'flex',
      gap: '8px'
    }
  }, /*#__PURE__*/React.createElement("input", {
    placeholder: "Scrivi un messaggio\u2026",
    style: {
      flex: 1,
      border: '1px solid var(--cream-300)',
      borderRadius: 'var(--radius-full)',
      padding: '10px 14px',
      fontSize: '14px',
      fontFamily: 'var(--font-sans)',
      outline: 'none'
    }
  }), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    icon: "send"
  }, "Invia"))))));
}
function AddressesView() {
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(PageHead, {
    title: "Indirizzi",
    sub: "Dove consegniamo i tuoi ordini"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(2, 1fr)',
      gap: '14px'
    }
  }, window.MC_ADDRESSES.map(a => /*#__PURE__*/React.createElement(Card, {
    key: a.id,
    variant: "bordered",
    padding: "lg"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      marginBottom: '8px'
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    variant: "local"
  }, a.label), a.def && /*#__PURE__*/React.createElement(Badge, {
    variant: "new"
  }, "Predefinito")), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, a.name), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '4px 0 0',
      fontSize: '14px',
      color: 'var(--ink-600)'
    }
  }, a.street), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 0',
      fontSize: '14px',
      color: 'var(--ink-600)'
    }
  }, a.city), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '8px 0 14px',
      fontSize: '13px',
      color: 'var(--ink-500)'
    }
  }, a.phone), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: '8px'
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "sm",
    icon: "pencil"
  }, "Modifica"), /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    size: "sm",
    icon: "trash-2"
  }, "Elimina")))), /*#__PURE__*/React.createElement("button", {
    style: {
      border: '1.5px dashed var(--cream-400)',
      borderRadius: 'var(--radius-lg)',
      background: 'transparent',
      color: 'var(--primary-700)',
      cursor: 'pointer',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '8px',
      minHeight: '160px',
      fontFamily: 'var(--font-sans)',
      fontWeight: 600
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "plus",
    size: 24
  }), " Aggiungi indirizzo")));
}
function ProfileView() {
  const u = window.MC_USER;
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(PageHead, {
    title: "Profilo"
  }), /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "lg",
    style: {
      maxWidth: '520px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '16px',
      marginBottom: '20px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '64px',
      height: '64px',
      borderRadius: '50%',
      background: 'linear-gradient(135deg, var(--primary-500), var(--primary-700))',
      color: '#fff',
      fontWeight: 700,
      fontSize: '24px',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, u.initials), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-serif)',
      fontSize: '20px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, u.name), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 0',
      fontSize: '13px',
      color: 'var(--ink-500)'
    }
  }, "Cliente dal ", u.since))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '14px'
    }
  }, /*#__PURE__*/React.createElement(Input, {
    label: "Nome e cognome",
    defaultValue: u.name
  }), /*#__PURE__*/React.createElement(Input, {
    label: "Email",
    defaultValue: u.email,
    type: "email"
  }), /*#__PURE__*/React.createElement(Input, {
    label: "Telefono",
    defaultValue: u.phone
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: '10px',
      marginTop: '4px'
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "primary"
  }, "Salva modifiche"), /*#__PURE__*/React.createElement(Button, {
    variant: "ghost"
  }, "Annulla")))));
}
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/buyer/src/45-account.js", error: String((e && e.message) || e) }); }

// ui_kits/buyer/src/50-product.js
try { (() => {
// ===== Product detail page (PDP) — gallery, buy box, ETA, reviews, cross-sell =====
function ProductPage({
  product: p,
  onBack,
  onAdd,
  onOpen,
  onStore
}) {
  const [qty, setQty] = React.useState(1);
  const [activeImg, setActiveImg] = React.useState(0);
  const store = storeBy(p.store) || {};
  const fp = finalPrice(p);
  const hasDisc = p.discountPercent > 0;
  const out = p.stock === 0;
  const low = p.stock > 0 && p.stock <= 3;
  const gallery = p.galleryLocks.map(l => imgUrl(p.kw, l));
  const pairings = (window.MC_PAIRINGS[p.id] || []).map(id => window.MC_PRODUCTS.find(x => x.id === id)).filter(Boolean);
  const sameStore = window.MC_PRODUCTS.filter(x => x.store === p.store && x.id !== p.id).slice(0, 4);
  const reviews = window.MC_REVIEWS[p.id] || [];
  React.useEffect(() => {
    setQty(1);
    setActiveImg(0);
  }, [p.id]);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 'var(--container-max)',
      margin: '0 auto',
      padding: '20px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: '13px',
      color: 'var(--ink-500)',
      marginBottom: '10px',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("a", {
    onClick: onBack,
    style: {
      cursor: 'pointer',
      color: 'var(--ink-500)'
    }
  }, "Home"), /*#__PURE__*/React.createElement(Lucide, {
    name: "chevron-right",
    size: 13,
    color: "var(--ink-400)"
  }), /*#__PURE__*/React.createElement("a", {
    onClick: () => onStore(store),
    style: {
      cursor: 'pointer',
      color: 'var(--ink-500)'
    }
  }, p.store), /*#__PURE__*/React.createElement(Lucide, {
    name: "chevron-right",
    size: 13,
    color: "var(--ink-400)"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--ink-700)'
    }
  }, p.name)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '36px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '12px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      borderRadius: 'var(--radius-2xl)',
      overflow: 'hidden',
      border: '1px solid var(--cream-300)',
      aspectRatio: '1/1',
      background: 'var(--surface-100)'
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: gallery[activeImg],
    alt: p.name,
    style: {
      width: '100%',
      height: '100%',
      objectFit: 'cover'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      top: '14px',
      left: '14px',
      display: 'flex',
      flexDirection: 'column',
      gap: '6px'
    }
  }, hasDisc && /*#__PURE__*/React.createElement(Badge, {
    variant: "discount",
    size: "md"
  }, "-", p.discountPercent, "%"), p.isNew && /*#__PURE__*/React.createElement(Badge, {
    variant: "new",
    size: "md"
  }, "Nuovo"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: '10px'
    }
  }, gallery.map((g, i) => /*#__PURE__*/React.createElement("button", {
    key: i,
    onClick: () => setActiveImg(i),
    style: {
      width: '72px',
      height: '72px',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
      border: `2px solid ${i === activeImg ? 'var(--primary-600)' : 'var(--cream-300)'}`,
      padding: 0,
      cursor: 'pointer',
      background: 'none'
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: g,
    alt: "",
    style: {
      width: '100%',
      height: '100%',
      objectFit: 'cover'
    }
  }))))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '16px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    onClick: () => onStore(store),
    style: {
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      alignSelf: 'flex-start'
    }
  }, /*#__PURE__*/React.createElement(StoreChip, {
    name: p.store,
    size: 24
  }), store.verified && /*#__PURE__*/React.createElement(Lucide, {
    name: "badge-check",
    size: 16,
    color: "var(--primary-600)"
  })), /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-serif)',
      fontSize: '34px',
      fontWeight: 700,
      lineHeight: 1.1,
      color: 'var(--ink-900)'
    }
  }, p.name), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      fontSize: '14px',
      color: 'var(--ink-500)'
    }
  }, /*#__PURE__*/React.createElement(Stars, {
    value: p.rating,
    size: 16
  }), " ", /*#__PURE__*/React.createElement("strong", {
    style: {
      color: 'var(--ink-800)'
    }
  }, String(p.rating).replace('.', ',')), " \xB7 ", p.reviews, " recensioni"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'baseline',
      gap: '10px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: '32px',
      fontWeight: 800,
      color: hasDisc ? 'var(--secondary-600)' : 'var(--ink-900)'
    }
  }, fmt(fp)), hasDisc && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '17px',
      color: 'var(--ink-400)',
      textDecoration: 'line-through'
    }
  }, fmt(p.price)), hasDisc && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '13px',
      fontWeight: 700,
      color: 'var(--secondary-600)'
    }
  }, "Risparmi ", fmt(p.price - fp))), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '16px',
      lineHeight: 1.65,
      color: 'var(--ink-700)'
    }
  }, p.desc), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: '8px'
    }
  }, (p.tags || []).map(t => /*#__PURE__*/React.createElement(Badge, {
    key: t,
    variant: "local"
  }, t)), /*#__PURE__*/React.createElement(Badge, {
    variant: "cod",
    icon: "banknote"
  }, "Paga alla consegna"), p.freeShipping && /*#__PURE__*/React.createElement(Badge, {
    variant: "free",
    icon: "truck"
  }, "Spedizione gratis"), low && /*#__PURE__*/React.createElement(Badge, {
    variant: "lowstock",
    icon: "flame"
  }, "Ultimi ", p.stock)), /*#__PURE__*/React.createElement("div", {
    style: {
      height: '1px',
      background: 'var(--cream-300)',
      margin: '4px 0'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: '14px',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      color: out ? 'var(--secondary-600)' : 'var(--olive-700)',
      fontWeight: 600
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: out ? 'x-circle' : 'check-circle-2',
    size: 16,
    color: out ? 'var(--secondary-600)' : 'var(--olive-600)'
  }), out ? 'Momentaneamente esaurito' : `Disponibile · ${p.stock} pezzi in negozio`), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      border: '1px solid var(--cream-300)',
      borderRadius: 'var(--radius-full)',
      overflow: 'hidden',
      opacity: out ? .5 : 1
    }
  }, /*#__PURE__*/React.createElement("button", {
    disabled: out,
    onClick: () => setQty(q => Math.max(1, q - 1)),
    style: qtyBtn
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "minus",
    size: 16
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      minWidth: '36px',
      textAlign: 'center',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, qty), /*#__PURE__*/React.createElement("button", {
    disabled: out || qty >= p.stock,
    onClick: () => setQty(q => Math.min(p.stock, q + 1)),
    style: {
      ...qtyBtn,
      opacity: qty >= p.stock ? .4 : 1
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "plus",
    size: 16
  }))), /*#__PURE__*/React.createElement(Button, {
    variant: "accent",
    size: "lg",
    icon: "shopping-cart",
    disabled: out,
    fullWidth: true,
    onClick: () => onAdd(p, qty)
  }, out ? 'Esaurito' : `Aggiungi · ${fmt(fp * qty)}`)), qty >= p.stock && !out && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '12px',
      color: 'var(--ink-500)'
    }
  }, "Hai raggiunto le scorte disponibili."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      background: 'var(--olive-50)',
      borderRadius: 'var(--radius-lg)',
      padding: '14px 16px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px',
      fontSize: '14px',
      fontWeight: 600,
      color: 'var(--olive-800)'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "truck",
    size: 17,
    color: "var(--olive-700)"
  }), " ", store.deliveryToday ? 'Ordina entro le 18:00 → a casa domani' : 'Consegna in 24–48h'), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px',
      fontSize: '13px',
      color: 'var(--olive-800)'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "banknote",
    size: 16,
    color: "var(--olive-700)"
  }), " Paghi al rider alla consegna \xB7 contanti"), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px',
      fontSize: '13px',
      color: 'var(--olive-800)'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "rotate-ccw",
    size: 16,
    color: "var(--olive-700)"
  }), " Reso gratuito entro 14 giorni")))), pairings.length > 0 && /*#__PURE__*/React.createElement(Section, {
    title: "Spesso comprati insieme"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: '16px'
    }
  }, pairings.map(x => /*#__PURE__*/React.createElement(ProductGridCard, {
    key: x.id,
    p: x,
    onOpen: onOpen,
    onAdd: pp => onAdd(pp, 1),
    onStore: onStore
  })))), /*#__PURE__*/React.createElement(Section, {
    title: `Recensioni · ${p.reviews}`
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '220px 1fr',
      gap: '28px',
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement(Card, {
    variant: "flat",
    padding: "lg"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'center'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-serif)',
      fontSize: '44px',
      fontWeight: 800,
      color: 'var(--ink-900)',
      lineHeight: 1
    }
  }, String(p.rating).replace('.', ',')), /*#__PURE__*/React.createElement("div", {
    style: {
      margin: '8px 0 4px'
    }
  }, /*#__PURE__*/React.createElement(Stars, {
    value: p.rating,
    size: 18
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: '13px',
      color: 'var(--ink-500)'
    }
  }, p.reviews, " recensioni")), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: '16px',
      display: 'flex',
      flexDirection: 'column',
      gap: '6px'
    }
  }, [5, 4, 3, 2, 1].map(star => {
    const pct = star === 5 ? 78 : star === 4 ? 16 : star === 3 ? 4 : star === 2 ? 1 : 1;
    return /*#__PURE__*/React.createElement("div", {
      key: star,
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        fontSize: '12px',
        color: 'var(--ink-500)'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: '10px',
        textAlign: 'right'
      }
    }, star), /*#__PURE__*/React.createElement(Lucide, {
      name: "star",
      size: 11,
      color: "var(--accent-500)"
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        flex: 1,
        height: '6px',
        background: 'var(--cream-200)',
        borderRadius: '3px',
        overflow: 'hidden'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        display: 'block',
        width: `${pct}%`,
        height: '100%',
        background: 'var(--accent-500)'
      }
    })));
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '12px'
    }
  }, reviews.length === 0 ? /*#__PURE__*/React.createElement(EmptyState, {
    icon: "message-circle",
    title: "Ancora nessuna recensione",
    description: "Sii il primo a recensire questo prodotto dopo l\u2019acquisto."
  }) : reviews.map((r, i) => /*#__PURE__*/React.createElement(ReviewItem, {
    key: i,
    r: r
  }))))), sameStore.length > 0 && /*#__PURE__*/React.createElement(Section, {
    title: `Altro da ${p.store}`,
    action: /*#__PURE__*/React.createElement("a", {
      onClick: () => onStore(store),
      style: {
        cursor: 'pointer',
        color: 'var(--primary-700)',
        fontWeight: 600,
        fontSize: '14px',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px'
      }
    }, "Vai al negozio ", /*#__PURE__*/React.createElement(Lucide, {
      name: "arrow-right",
      size: 15,
      color: "var(--primary-700)"
    }))
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: '16px'
    }
  }, sameStore.map(x => /*#__PURE__*/React.createElement(ProductGridCard, {
    key: x.id,
    p: x,
    onOpen: onOpen,
    onAdd: pp => onAdd(pp, 1),
    onStore: onStore
  })))));
}
const qtyBtn = {
  width: '38px',
  height: '40px',
  border: 0,
  background: 'transparent',
  color: 'var(--ink-700)',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center'
};
function Section({
  title,
  action,
  children
}) {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      marginTop: '44px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      marginBottom: '16px'
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-serif)',
      fontSize: '24px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, title), action), children);
}
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/buyer/src/50-product.js", error: String((e && e.message) || e) }); }

// ui_kits/buyer/src/60-cart.js
try { (() => {
// ===== Cart drawer =====
function CartDrawer({
  open,
  items,
  onClose,
  onQty,
  onRemove,
  onCheckout,
  onContinue
}) {
  const subtotal = items.reduce((s, it) => s + it.finalPrice * it.qty, 0);
  const FREE = 25;
  const shipping = subtotal >= FREE || subtotal === 0 ? 0 : 3.5;
  const total = subtotal + shipping;
  const toFree = Math.max(0, FREE - subtotal);
  if (!open) return null;
  return ReactDOM.createPortal(/*#__PURE__*/React.createElement("div", {
    onClick: onClose,
    style: {
      position: 'fixed',
      inset: 0,
      zIndex: 'var(--z-modal)',
      background: 'rgba(0,0,0,.4)',
      backdropFilter: 'blur(2px)',
      display: 'flex',
      justifyContent: 'flex-end',
      animation: 'mc-fade-in var(--dur-fast) ease-out'
    }
  }, /*#__PURE__*/React.createElement("div", {
    onClick: e => e.stopPropagation(),
    role: "dialog",
    "aria-modal": "true",
    "aria-label": "Carrello",
    style: {
      width: '420px',
      maxWidth: '92vw',
      height: '100%',
      background: 'var(--surface-0)',
      display: 'flex',
      flexDirection: 'column',
      boxShadow: 'var(--shadow-warm-xl)',
      animation: 'mc-slide-right var(--dur-medium) var(--ease-out-quint)'
    }
  }, /*#__PURE__*/React.createElement("header", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '18px 20px',
      borderBottom: '1px solid var(--cream-200)'
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-serif)',
      fontSize: '20px',
      fontWeight: 700,
      color: 'var(--ink-900)',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "shopping-cart",
    size: 20
  }), " Carrello ", /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '14px',
      color: 'var(--ink-400)',
      fontFamily: 'var(--font-sans)'
    }
  }, "\xB7 ", items.reduce((s, it) => s + it.qty, 0))), /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    "aria-label": "Chiudi",
    style: {
      border: 0,
      background: 'transparent',
      cursor: 'pointer',
      color: 'var(--ink-500)',
      display: 'inline-flex'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "x",
    size: 22
  }))), items.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '12px 20px',
      background: toFree > 0 ? 'var(--accent-100)' : 'var(--olive-50)',
      borderBottom: '1px solid var(--cream-200)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: '13px',
      color: 'var(--ink-700)',
      marginBottom: '6px',
      display: 'flex',
      alignItems: 'center',
      gap: '6px'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "truck",
    size: 15,
    color: toFree > 0 ? 'var(--accent-700)' : 'var(--olive-700)'
  }), toFree > 0 ? /*#__PURE__*/React.createElement("span", null, "Aggiungi ", /*#__PURE__*/React.createElement("strong", null, fmt(toFree)), " per la ", /*#__PURE__*/React.createElement("strong", null, "spedizione gratis")) : /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("strong", null, "Spedizione gratis"), " sbloccata!")), /*#__PURE__*/React.createElement("div", {
    style: {
      height: '6px',
      background: 'rgba(255,255,255,.6)',
      borderRadius: '3px',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'block',
      height: '100%',
      width: `${Math.min(100, subtotal / FREE * 100)}%`,
      background: toFree > 0 ? 'var(--accent-500)' : 'var(--olive-500)',
      transition: 'width var(--dur-medium) var(--ease-out-quint)'
    }
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflowY: 'auto',
      padding: '8px 20px'
    }
  }, items.length === 0 ? /*#__PURE__*/React.createElement(EmptyState, {
    icon: "shopping-cart",
    title: "Il carrello \xE8 vuoto",
    description: "Aggiungi prodotti dai negozi di Piacenza per iniziare.",
    action: /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      onClick: onContinue
    }, "Esplora i negozi")
  }) : items.map(it => /*#__PURE__*/React.createElement("div", {
    key: it.id,
    style: {
      display: 'flex',
      gap: '12px',
      padding: '14px 0',
      borderBottom: '1px solid var(--cream-200)'
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: it.img,
    alt: it.name,
    style: {
      width: '64px',
      height: '64px',
      borderRadius: 'var(--radius-md)',
      objectFit: 'cover',
      flexShrink: 0
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '14px',
      fontWeight: 600,
      color: 'var(--ink-900)',
      lineHeight: 1.3
    }
  }, it.name), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 8px',
      fontSize: '12px',
      color: 'var(--ink-500)'
    }
  }, it.store), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      border: '1px solid var(--cream-300)',
      borderRadius: 'var(--radius-full)'
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => onQty(it.id, -1),
    style: miniBtn
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "minus",
    size: 13
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      minWidth: '24px',
      textAlign: 'center',
      fontSize: '13px',
      fontWeight: 700
    }
  }, it.qty), /*#__PURE__*/React.createElement("button", {
    onClick: () => onQty(it.id, 1),
    style: miniBtn
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "plus",
    size: 13
  }))), /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 800,
      fontSize: '15px',
      color: 'var(--ink-900)'
    }
  }, fmt(it.finalPrice * it.qty)))), /*#__PURE__*/React.createElement("button", {
    onClick: () => onRemove(it.id),
    "aria-label": "Rimuovi",
    style: {
      border: 0,
      background: 'transparent',
      color: 'var(--ink-400)',
      cursor: 'pointer',
      alignSelf: 'flex-start',
      display: 'inline-flex'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "trash-2",
    size: 16
  }))))), items.length > 0 && /*#__PURE__*/React.createElement("footer", {
    style: {
      borderTop: '1px solid var(--cream-200)',
      padding: '16px 20px',
      background: 'var(--cream-50)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      fontSize: '14px',
      color: 'var(--ink-600)',
      marginBottom: '6px'
    }
  }, /*#__PURE__*/React.createElement("span", null, "Subtotale"), /*#__PURE__*/React.createElement("span", null, fmt(subtotal))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      fontSize: '14px',
      color: 'var(--ink-600)',
      marginBottom: '10px'
    }
  }, /*#__PURE__*/React.createElement("span", null, "Consegna"), /*#__PURE__*/React.createElement("span", null, shipping === 0 ? /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--olive-700)',
      fontWeight: 600
    }
  }, "Gratis") : fmt(shipping))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      fontSize: '18px',
      fontWeight: 800,
      color: 'var(--ink-900)',
      marginBottom: '14px'
    }
  }, /*#__PURE__*/React.createElement("span", null, "Totale"), /*#__PURE__*/React.createElement("span", null, fmt(total))), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    size: "lg",
    fullWidth: true,
    iconRight: "arrow-right",
    onClick: onCheckout
  }, "Vai alla conferma"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '10px 0 0',
      fontSize: '12px',
      color: 'var(--ink-500)',
      textAlign: 'center',
      display: 'inline-flex',
      width: '100%',
      justifyContent: 'center',
      gap: '5px'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "banknote",
    size: 14,
    color: "var(--olive-600)"
  }), " Paghi alla consegna \xB7 contanti al rider")))), document.body);
}
const miniBtn = {
  width: '28px',
  height: '28px',
  border: 0,
  background: 'transparent',
  color: 'var(--ink-700)',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center'
};
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/buyer/src/60-cart.js", error: String((e && e.message) || e) }); }

// ui_kits/buyer/src/70-tracking.js
try { (() => {
// ===== Order tracking (post-checkout) — 8-state timeline =====
const MC_FLOW = [{
  status: 'NEW',
  label: 'Ordine ricevuto',
  icon: 'clock',
  sub: 'Il negozio sta confermando'
}, {
  status: 'ACCEPTED',
  label: 'In preparazione',
  icon: 'chef-hat',
  sub: 'Il negozio prepara il tuo ordine'
}, {
  status: 'READY',
  label: 'Pronto per il ritiro',
  icon: 'package',
  sub: 'Pronto in negozio'
}, {
  status: 'ASSIGNED',
  label: 'Rider assegnato',
  icon: 'bike',
  sub: 'Un rider sta arrivando in negozio'
}, {
  status: 'PICKED_UP',
  label: 'Ritirato',
  icon: 'hand',
  sub: 'Il rider ha ritirato l’ordine'
}, {
  status: 'OUT_FOR_DELIVERY',
  label: 'In consegna',
  icon: 'truck',
  sub: 'Il rider è in viaggio verso di te'
}, {
  status: 'DELIVERED',
  label: 'Consegnato',
  icon: 'check-circle-2',
  sub: 'Consegnato — grazie!'
}];
function OrderTracking({
  order,
  onContinue,
  onHome
}) {
  const [step, setStep] = React.useState(0);
  React.useEffect(() => {
    if (step >= MC_FLOW.length - 1) return;
    const t = setTimeout(() => setStep(s => Math.min(MC_FLOW.length - 1, s + 1)), step === 0 ? 2600 : 3400);
    return () => clearTimeout(t);
  }, [step]);
  const store = storeBy(order.items[0].store) || {};
  const current = MC_FLOW[step];
  const delivered = current.status === 'DELIVERED';
  const eta = delivered ? 'Consegnato' : store.deliveryToday ? 'Oggi, entro le 19:30' : 'Domani, 24–48h';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: '880px',
      margin: '0 auto',
      padding: '28px 20px'
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: onHome,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      border: 0,
      background: 'transparent',
      color: 'var(--ink-600)',
      fontSize: '14px',
      fontWeight: 500,
      cursor: 'pointer',
      padding: '8px 0',
      fontFamily: 'var(--font-sans)'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "arrow-left",
    size: 17
  }), " Torna al marketplace"), /*#__PURE__*/React.createElement(Card, {
    variant: "elevated",
    padding: "lg",
    style: {
      marginTop: '8px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '16px',
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '60px',
      height: '60px',
      borderRadius: 'var(--radius-full)',
      background: delivered ? 'var(--olive-100)' : 'var(--primary-100)',
      color: delivered ? 'var(--olive-700)' : 'var(--primary-700)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: current.icon,
    size: 28,
    stroke: 2.2,
    color: delivered ? 'var(--olive-700)' : 'var(--primary-700)'
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: '200px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-serif)',
      fontSize: '26px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, delivered ? 'Ordine consegnato!' : 'Ordine confermato!'), /*#__PURE__*/React.createElement(OrderStatusBadge, {
    status: current.status
  })), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '4px 0 0',
      fontSize: '14px',
      color: 'var(--ink-600)'
    }
  }, "Ordine ", /*#__PURE__*/React.createElement("strong", null, order.id), " \xB7 ", current.sub)), /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'right'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: '12px',
      color: 'var(--ink-500)',
      textTransform: 'uppercase',
      letterSpacing: '0.04em',
      fontWeight: 700
    }
  }, "Consegna stimata"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: '18px',
      fontWeight: 800,
      color: 'var(--ink-900)'
    }
  }, eta)))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1.3fr 1fr',
      gap: '24px',
      marginTop: '24px',
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "lg"
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: '0 0 18px',
      fontFamily: 'var(--font-serif)',
      fontSize: '18px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, "Stato dell\u2019ordine"), /*#__PURE__*/React.createElement("div", null, MC_FLOW.map((s, i) => {
    const done = i < step,
      active = i === step;
    const color = done ? 'var(--olive-600)' : active ? 'var(--primary-600)' : 'var(--cream-400)';
    return /*#__PURE__*/React.createElement("div", {
      key: s.status,
      style: {
        display: 'flex',
        gap: '14px'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: '34px',
        height: '34px',
        borderRadius: '50%',
        background: done || active ? color : 'var(--cream-100)',
        color: done || active ? '#fff' : 'var(--ink-300)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        border: active ? '3px solid var(--primary-200)' : 'none',
        transition: 'background var(--dur-medium)'
      }
    }, /*#__PURE__*/React.createElement(Lucide, {
      name: done ? 'check' : s.icon,
      size: 16,
      stroke: 2.4,
      color: done || active ? '#fff' : 'var(--ink-300)'
    })), i < MC_FLOW.length - 1 && /*#__PURE__*/React.createElement("span", {
      style: {
        width: '2px',
        flex: 1,
        minHeight: '26px',
        background: done ? 'var(--olive-400)' : 'var(--cream-300)'
      }
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        paddingBottom: '18px'
      }
    }, /*#__PURE__*/React.createElement("p", {
      style: {
        margin: 0,
        fontSize: '15px',
        fontWeight: active ? 700 : 600,
        color: done || active ? 'var(--ink-900)' : 'var(--ink-400)'
      }
    }, s.label), /*#__PURE__*/React.createElement("p", {
      style: {
        margin: '2px 0 0',
        fontSize: '13px',
        color: 'var(--ink-500)'
      }
    }, active ? s.sub : done ? 'Completato' : 'In attesa')));
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '16px'
    }
  }, /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "lg"
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: '0 0 12px',
      fontFamily: 'var(--font-serif)',
      fontSize: '18px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, "Riepilogo"), order.items.map(it => /*#__PURE__*/React.createElement("div", {
    key: it.id,
    style: {
      display: 'flex',
      gap: '10px',
      alignItems: 'center',
      padding: '8px 0',
      borderBottom: '1px solid var(--cream-200)'
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: it.img,
    alt: it.name,
    style: {
      width: '44px',
      height: '44px',
      borderRadius: 'var(--radius-md)',
      objectFit: 'cover'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '13px',
      fontWeight: 600,
      color: 'var(--ink-900)',
      lineHeight: 1.3
    }
  }, it.name), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '12px',
      color: 'var(--ink-500)'
    }
  }, "\xD7 ", it.qty)), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '13px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, fmt(it.finalPrice * it.qty)))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      marginTop: '12px',
      fontSize: '17px',
      fontWeight: 800,
      color: 'var(--ink-900)'
    }
  }, /*#__PURE__*/React.createElement("span", null, "Totale"), /*#__PURE__*/React.createElement("span", null, fmt(order.total))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      marginTop: '12px',
      padding: '10px 12px',
      background: 'var(--olive-50)',
      borderRadius: 'var(--radius-md)',
      fontSize: '13px',
      color: 'var(--olive-800)',
      fontWeight: 600
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "banknote",
    size: 16,
    color: "var(--olive-700)"
  }), " Paghi ", fmt(order.total), " in contanti al rider")), /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "md"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px'
    }
  }, /*#__PURE__*/React.createElement(StoreChip, {
    name: order.items[0].store,
    size: 28
  }), store.verified && /*#__PURE__*/React.createElement(Lucide, {
    name: "badge-check",
    size: 15,
    color: "var(--primary-600)"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      marginTop: '10px',
      fontSize: '13px',
      color: 'var(--ink-600)'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "map-pin",
    size: 15,
    color: "var(--primary-600)"
  }), " Consegna in ", order.address ? `${order.address.street}, ${order.address.city}` : 'Via Roma 12, Piacenza')), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    fullWidth: true,
    onClick: onContinue
  }, "Continua lo shopping"))));
}
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/buyer/src/70-tracking.js", error: String((e && e.message) || e) }); }

// ui_kits/buyer/src/90-app.js
try { (() => {
// ===== App shell — view state machine, cart, toast =====
function App() {
  const [view, setView] = React.useState('home'); // home|srp|store|product|checkout|tracking|account|auth
  const [current, setCurrent] = React.useState(null);
  const [store, setStore] = React.useState(null);
  const [cart, setCart] = React.useState([]);
  const [drawer, setDrawer] = React.useState(false);
  const [order, setOrder] = React.useState(null);
  const [toast, setToast] = React.useState(null);
  const [query, setQuery] = React.useState('');
  const [committedQuery, setCommittedQuery] = React.useState('');
  const [cat, setCat] = React.useState(null);
  const [acctSection, setAcctSection] = React.useState('ordini');
  const [authMode, setAuthMode] = React.useState('login');
  const toastTimer = React.useRef(null);
  const all = window.MC_PRODUCTS;
  const stores = window.MC_STORES;
  const cartCount = cart.reduce((s, it) => s + it.qty, 0);
  function showToast(text) {
    setToast({
      text
    });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }
  function top() {
    window.scrollTo({
      top: 0,
      behavior: 'auto'
    });
  }
  function addToCart(p, qty = 1) {
    setCart(c => {
      const ex = c.find(it => it.id === p.id);
      if (ex) return c.map(it => it.id === p.id ? {
        ...it,
        qty: it.qty + qty
      } : it);
      return [...c, {
        id: p.id,
        name: p.name,
        store: p.store,
        img: imgUrl(p.kw, p.galleryLocks[0]),
        finalPrice: finalPrice(p),
        qty
      }];
    });
    showToast(`${p.name.length > 28 ? p.name.slice(0, 28) + '…' : p.name} aggiunto`);
  }
  function changeQty(id, d) {
    setCart(c => c.map(it => it.id === id ? {
      ...it,
      qty: Math.max(1, it.qty + d)
    } : it));
  }
  function removeItem(id) {
    setCart(c => c.filter(it => it.id !== id));
  }
  function openProduct(p) {
    setCurrent(p);
    setView('product');
    top();
  }
  function openStore(s) {
    if (!s) return;
    setStore(s);
    setView('store');
    top();
  }
  function goHome() {
    setView('home');
    setCat(null);
    setQuery('');
    setCommittedQuery('');
    top();
  }
  function goSrp(nextCat) {
    setCat(nextCat ?? null);
    setView('srp');
    top();
  }
  function submitSearch() {
    setCommittedQuery(query);
    setView('srp');
    top();
  }
  function goAccount(section) {
    setAcctSection(section || 'ordini');
    setView('account');
    top();
  }
  function goCheckout() {
    setDrawer(false);
    setView('checkout');
    top();
  }
  function openOrder(o) {
    const items = o.lines.map(l => {
      const p = window.MC_PRODUCTS.find(x => x.id === l.id);
      return p && {
        id: p.id,
        name: p.name,
        store: p.store,
        img: imgUrl(p.kw, p.galleryLocks[0]),
        finalPrice: finalPrice(p),
        qty: l.q
      };
    }).filter(Boolean);
    setOrder({
      id: o.id,
      items,
      total: o.total
    });
    setView('tracking');
    top();
  }
  function placeOrder(payload) {
    const id = 'PC-' + (2400 + Math.floor(Math.random() * 600));
    setOrder({
      id,
      items: payload.items,
      total: payload.total,
      address: payload.address,
      slot: payload.slot
    });
    setView('tracking');
    top();
  }
  function afterOrder() {
    setCart([]);
    setOrder(null);
    goHome();
  }
  const showFooter = view === 'home' || view === 'srp';
  const dark = view !== 'auth';
  return /*#__PURE__*/React.createElement(React.Fragment, null, dark && /*#__PURE__*/React.createElement(Navbar, {
    cartCount: cartCount,
    onCart: () => setDrawer(true),
    onHome: goHome,
    activeCat: cat,
    onCat: c => goSrp(c),
    query: query,
    onQuery: setQuery,
    onSubmitSearch: submitSearch,
    onAccount: () => goAccount('ordini'),
    onFav: () => goAccount('preferiti'),
    onNotif: () => goAccount('notifiche')
  }), /*#__PURE__*/React.createElement("main", {
    style: {
      minHeight: '70vh',
      background: 'var(--surface-50)'
    }
  }, view === 'home' && /*#__PURE__*/React.createElement(Home, {
    products: all,
    stores: stores,
    onOpen: openProduct,
    onAdd: addToCart,
    onStore: openStore,
    onExplore: () => goSrp(null)
  }), view === 'srp' && /*#__PURE__*/React.createElement(SearchResults, {
    allProducts: all,
    query: committedQuery,
    cat: cat,
    onOpen: openProduct,
    onAdd: addToCart,
    onStore: openStore,
    onClearNav: goHome
  }), view === 'store' && store && /*#__PURE__*/React.createElement(StorePage, {
    store: store,
    products: all,
    onBack: goHome,
    onOpen: openProduct,
    onAdd: addToCart
  }), view === 'product' && current && /*#__PURE__*/React.createElement(ProductPage, {
    product: current,
    onBack: goHome,
    onAdd: addToCart,
    onOpen: openProduct,
    onStore: openStore
  }), view === 'checkout' && /*#__PURE__*/React.createElement(CheckoutPage, {
    items: cart,
    onBack: () => setDrawer(true),
    onPlace: placeOrder
  }), view === 'tracking' && order && /*#__PURE__*/React.createElement(OrderTracking, {
    order: order,
    onContinue: afterOrder,
    onHome: afterOrder
  }), view === 'account' && /*#__PURE__*/React.createElement(AccountPage, {
    section: acctSection,
    onSection: setAcctSection,
    products: all,
    onOpen: openProduct,
    onAdd: addToCart,
    onStore: openStore,
    onOpenOrder: openOrder
  }), view === 'auth' && /*#__PURE__*/React.createElement(AuthPage, {
    mode: authMode,
    onAuth: goHome,
    onBack: goHome,
    onSwitch: setAuthMode
  }), showFooter && /*#__PURE__*/React.createElement(Footer, {
    onAuth: () => setView('auth')
  })), /*#__PURE__*/React.createElement(CartDrawer, {
    open: drawer,
    items: cart,
    onClose: () => setDrawer(false),
    onQty: changeQty,
    onRemove: removeItem,
    onCheckout: goCheckout,
    onContinue: () => {
      setDrawer(false);
      goSrp(null);
    }
  }), /*#__PURE__*/React.createElement(Toast, {
    toast: toast,
    onUndo: null
  }));
}
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/buyer/src/90-app.js", error: String((e && e.message) || e) }); }

// ui_kits/buyer/src/data.js
try { (() => {
// MyCity marketplace — catalogue (plain globals, loaded before app.jsx).
// Images: LoremFlickr, keyword-matched + locked seed → coherent & stable.
const LF = (k, lock) => `https://loremflickr.com/640/640/${k}?lock=${lock}`;
window.MC_CATEGORIES = [{
  slug: 'alimentari',
  label: 'Alimentari',
  icon: 'apple'
}, {
  slug: 'gastronomia',
  label: 'Gastronomia',
  icon: 'utensils'
}, {
  slug: 'cantina',
  label: 'Vini & Cantina',
  icon: 'wine'
}, {
  slug: 'casa',
  label: 'Casa & Cucina',
  icon: 'lamp'
}, {
  slug: 'abbigliamento',
  label: 'Abbigliamento',
  icon: 'shirt'
}];

// Stores — first-class entities (vetrina, orari, recensioni).
window.MC_STORES = [{
  id: 's1',
  name: 'Salumeria Verdi',
  cat: 'Gastronomia',
  area: 'Centro storico',
  rating: 4.9,
  reviews: 214,
  verified: true,
  cover: LF('salami', 7),
  closeAt: '19:30',
  deliveryToday: true,
  since: 1962,
  blurb: 'Salumi e formaggi piacentini selezionati, tagliati a mano ogni giorno nel cuore del centro storico.'
}, {
  id: 's2',
  name: 'Cantina Pace',
  cat: 'Vini & Cantina',
  area: 'Colli Piacentini',
  rating: 4.8,
  reviews: 98,
  verified: true,
  cover: LF('wine', 7),
  closeAt: '20:00',
  deliveryToday: true,
  since: 1978,
  blurb: 'I vini dei Colli Piacentini, dal Gutturnio all’Ortrugo. Produzione propria e piccoli vignaioli del territorio.'
}, {
  id: 's3',
  name: 'Pasta Fresca Anita',
  cat: 'Gastronomia',
  area: 'Borgo',
  rating: 5.0,
  reviews: 176,
  verified: true,
  cover: LF('pasta', 15),
  closeAt: '14:30',
  deliveryToday: true,
  since: 1995,
  blurb: 'Pasta fresca fatta a mano ogni mattina: pisarei, tortelli, anolini. La tradizione piacentina come una volta.'
}, {
  id: 's4',
  name: 'Bottega Emilia',
  cat: 'Gastronomia',
  area: 'Centro',
  rating: 4.7,
  reviews: 132,
  verified: true,
  cover: LF('ravioli', 3),
  closeAt: '19:00',
  deliveryToday: false,
  since: 2008,
  blurb: 'Gastronomia con piatti pronti, pasta ripiena e specialità emiliane da asporto.'
}, {
  id: 's5',
  name: 'Ceramiche del Po',
  cat: 'Casa & Cucina',
  area: 'Lungo Po',
  rating: 4.7,
  reviews: 64,
  verified: true,
  cover: LF('pottery', 3),
  closeAt: '18:30',
  deliveryToday: false,
  since: 1989,
  blurb: 'Ceramiche tornite e smaltate a mano nel laboratorio sul lungo Po. Ogni pezzo è unico.'
}, {
  id: 's6',
  name: 'Filo & Trama',
  cat: 'Abbigliamento',
  area: 'Centro',
  rating: 4.6,
  reviews: 41,
  verified: false,
  cover: LF('scarf', 7),
  closeAt: '19:30',
  deliveryToday: true,
  since: 2015,
  blurb: 'Maglieria e tessuti naturali tessuti su telaio tradizionale. Lana merino, lino, tinte naturali.'
}, {
  id: 's7',
  name: 'Forno Borgo',
  cat: 'Alimentari',
  area: 'Borgo',
  rating: 4.8,
  reviews: 156,
  verified: true,
  cover: LF('bread', 3),
  closeAt: '13:30',
  deliveryToday: true,
  since: 1971,
  blurb: 'Pane a lievito madre, focacce e dolci da forno cotti nel forno a legna.'
}];
const S = Object.fromEntries(window.MC_STORES.map(s => [s.name, s.id]));
window.MC_PRODUCTS = [{
  id: 'p1',
  name: 'Coppa Piacentina DOP 200g',
  price: 8.9,
  discountPercent: 20,
  store: 'Salumeria Verdi',
  cat: 'gastronomia',
  freeShipping: true,
  stock: 12,
  rating: 4.8,
  reviews: 56,
  tags: ['DOP', 'Taglio a mano'],
  kw: 'salami',
  galleryLocks: [7, 15, 3],
  desc: 'Stagionata 90 giorni nei nostri scaffali in centro storico. Taglio a mano, sottovuoto fresco di giornata. Dolce, profumata, da gustare con un calice di Gutturnio.'
}, {
  id: 'p2',
  name: 'Gutturnio dei Colli DOC 2021',
  price: 12.5,
  store: 'Cantina Pace',
  cat: 'cantina',
  stock: 2,
  rating: 4.7,
  reviews: 38,
  tags: ['DOC', 'Colli Piacentini'],
  kw: 'wine',
  galleryLocks: [7, 3, 15],
  desc: 'Il rosso dei colli piacentini, vivace e schietto. Perfetto con i salumi e i pisarei. Servire a 16–18°C.'
}, {
  id: 'p3',
  name: 'Pisarei e fasò freschi 500g',
  price: 6.4,
  store: 'Pasta Fresca Anita',
  cat: 'gastronomia',
  isNew: true,
  stock: 20,
  rating: 5.0,
  reviews: 91,
  tags: ['Fresco', 'Fatto a mano'],
  kw: 'pasta',
  galleryLocks: [15, 7, 3],
  desc: 'Fatti a mano ogni mattina come vuole la tradizione: pasta e pangrattato, con il ragù di fagioli borlotti. Pronti in 8 minuti.'
}, {
  id: 'p4',
  name: 'Tortelli con la coda 500g',
  price: 9.0,
  store: 'Bottega Emilia',
  cat: 'gastronomia',
  stock: 0,
  rating: 4.6,
  reviews: 44,
  tags: ['Fresco'],
  kw: 'ravioli',
  galleryLocks: [3, 7, 15],
  desc: 'Ripieno di ricotta e spinaci, chiusi a treccia con la caratteristica “coda”. La domenica piacentina, burro e salvia.'
}, {
  id: 'p5',
  name: 'Grana Padano DOP 18 mesi 1kg',
  price: 18.9,
  discountPercent: 10,
  store: 'Salumeria Verdi',
  cat: 'alimentari',
  freeShipping: true,
  stock: 8,
  rating: 4.9,
  reviews: 73,
  tags: ['DOP', '18 mesi'],
  kw: 'cheese',
  galleryLocks: [3, 15, 7],
  desc: 'Petalo o pezzo intero, tagliato al momento. Latte dei caseifici della bassa, stagionatura 18 mesi: granuloso, saporito.'
}, {
  id: 'p6',
  name: 'Mostarda di frutta artigianale 250g',
  price: 7.2,
  store: 'Bottega Emilia',
  cat: 'alimentari',
  isNew: true,
  stock: 15,
  rating: 4.5,
  reviews: 22,
  tags: ['Artigianale'],
  kw: 'marmalade',
  galleryLocks: [7, 3, 15],
  desc: 'Senape e frutta candita, ricetta di famiglia. Da provare con i bolliti e i formaggi stagionati.'
}, {
  id: 'p7',
  name: 'Set 2 tazze in ceramica fatta a mano',
  price: 24.0,
  store: 'Ceramiche del Po',
  cat: 'casa',
  freeShipping: true,
  stock: 5,
  rating: 4.8,
  reviews: 31,
  tags: ['Fatto a mano', 'Pezzo unico'],
  kw: 'pottery',
  galleryLocks: [3, 7, 15],
  desc: 'Tornite e smaltate a mano nel laboratorio sul lungo Po. Smalto reattivo: ogni tazza ha sfumature uniche.'
}, {
  id: 'p8',
  name: 'Sciarpa in lana merino',
  price: 32.0,
  discountPercent: 15,
  store: 'Filo & Trama',
  cat: 'abbigliamento',
  stock: 3,
  rating: 4.7,
  reviews: 18,
  tags: ['Lana merino'],
  kw: 'scarf',
  galleryLocks: [7, 3, 15],
  desc: 'Tessuta su telaio tradizionale. Lana merino morbidissima, tinta naturale. Calda e leggera.'
}, {
  id: 'p9',
  name: 'Pane a lievito madre 750g',
  price: 4.5,
  store: 'Forno Borgo',
  cat: 'alimentari',
  isNew: true,
  stock: 18,
  rating: 4.8,
  reviews: 64,
  tags: ['Lievito madre'],
  kw: 'bread',
  galleryLocks: [3, 7, 15],
  desc: 'Lievito madre, farine macinate a pietra, 24h di lievitazione. Crosta croccante, mollica alveolata.'
}, {
  id: 'p10',
  name: 'Salame nostrano stagionato 300g',
  price: 11.5,
  store: 'Salumeria Verdi',
  cat: 'gastronomia',
  stock: 6,
  rating: 4.9,
  reviews: 47,
  tags: ['Stagionato'],
  kw: 'prosciutto',
  galleryLocks: [3, 7, 15],
  desc: 'Carne suina dei nostri allevamenti, concia tradizionale, stagionatura naturale in cantina. Insaccato a mano.'
}];

// Recensioni — pool condiviso, indicizzato per prodotto.
window.MC_REVIEWS = {
  p1: [{
    who: 'Marco B.',
    rating: 5,
    when: '2 settimane fa',
    text: 'La vera coppa piacentina, come quella di mio nonno. Taglio perfetto, arrivata freschissima.'
  }, {
    who: 'Giulia R.',
    rating: 5,
    when: '1 mese fa',
    text: 'Profumatissima. La pago volentieri, si sente che è artigianale.'
  }, {
    who: 'Anna T.',
    rating: 4,
    when: '1 mese fa',
    text: 'Ottima, magari un filo più di stagionatura. Consegna puntuale, pagato al rider.'
  }],
  p3: [{
    who: 'Davide P.',
    rating: 5,
    when: '1 settimana fa',
    text: 'Pisarei come al ristorante. Anita è una garanzia, il ragù di fasò è spettacolare.'
  }, {
    who: 'Sara M.',
    rating: 5,
    when: '3 settimane fa',
    text: 'Freschi, pronti in 8 minuti come scritto. Comodissimo pagare alla consegna.'
  }],
  p5: [{
    who: 'Luca F.',
    rating: 5,
    when: '5 giorni fa',
    text: 'Grana stagionato il giusto, granuloso e saporito. Tagliato al momento, ottimo.'
  }, {
    who: 'Elena V.',
    rating: 4,
    when: '2 mesi fa',
    text: 'Buono, confezione sottovuoto perfetta. Lo ricomprerò.'
  }]
};

// "Spesso comprati insieme" — abbinamenti curati.
window.MC_PAIRINGS = {
  p1: ['p2', 'p5', 'p9'],
  p2: ['p1', 'p10', 'p5'],
  p3: ['p2', 'p5'],
  p5: ['p2', 'p9'],
  p9: ['p1', 'p10'],
  p10: ['p2', 'p9']
};

// ---- Account / sessione utente (demo) -------------------------------------
window.MC_USER = {
  name: 'Lucia Bianchi',
  email: 'lucia.bianchi@email.it',
  phone: '+39 333 12 45 678',
  initials: 'LB',
  since: 2024
};
window.MC_ADDRESSES = [{
  id: 'a1',
  label: 'Casa',
  name: 'Lucia Bianchi',
  street: 'Via Roma 12',
  city: '29121 Piacenza (PC)',
  phone: '+39 333 12 45 678',
  def: true
}, {
  id: 'a2',
  label: 'Ufficio',
  name: 'Lucia Bianchi',
  street: 'Via Cavour 48',
  city: '29121 Piacenza (PC)',
  phone: '+39 333 12 45 678',
  def: false
}];

// Slot di consegna (oggi/domani × fasce).
window.MC_SLOTS = [{
  id: 'today-pm',
  day: 'Oggi',
  time: '18:00 – 19:30',
  fee: 3.5,
  label: 'In giornata'
}, {
  id: 'tom-am',
  day: 'Domani',
  time: '9:00 – 12:00',
  fee: 0,
  label: null
}, {
  id: 'tom-pm',
  day: 'Domani',
  time: '15:00 – 18:30',
  fee: 0,
  label: 'Consigliato'
}];

// Ordini passati (per /orders). status usa gli 8 stati di OrderStatusBadge.
window.MC_ORDERS = [{
  id: 'PC-2461',
  date: '14 giu 2026',
  status: 'OUT_FOR_DELIVERY',
  total: 27.4,
  store: 'Salumeria Verdi',
  lines: [{
    id: 'p1',
    q: 2
  }, {
    id: 'p5',
    q: 1
  }]
}, {
  id: 'PC-2390',
  date: '2 giu 2026',
  status: 'DELIVERED',
  total: 18.9,
  store: 'Pasta Fresca Anita',
  lines: [{
    id: 'p3',
    q: 2
  }, {
    id: 'p2',
    q: 1
  }]
}, {
  id: 'PC-2274',
  date: '21 mag 2026',
  status: 'DELIVERED',
  total: 32.0,
  store: 'Filo & Trama',
  lines: [{
    id: 'p8',
    q: 1
  }]
}, {
  id: 'PC-2188',
  date: '8 mag 2026',
  status: 'CANCELED',
  total: 9.0,
  store: 'Bottega Emilia',
  lines: [{
    id: 'p4',
    q: 1
  }]
}];
window.MC_FAVORITES = ['p2', 'p7', 'p8', 'p9'];
window.MC_NOTIFICATIONS = [{
  id: 'n1',
  icon: 'truck',
  tone: 'primary',
  title: 'Il tuo ordine è in consegna',
  body: 'PC-2461 · il rider arriva tra ~20 min',
  when: '5 min fa',
  unread: true
}, {
  id: 'n2',
  icon: 'tag',
  tone: 'secondary',
  title: '-20% sulla Coppa Piacentina',
  body: 'Salumeria Verdi · solo per oggi',
  when: '2 ore fa',
  unread: true
}, {
  id: 'n3',
  icon: 'sparkles',
  tone: 'accent',
  title: 'Nuovi arrivi da Forno Borgo',
  body: 'Pane a lievito madre appena sfornato',
  when: 'Ieri',
  unread: false
}, {
  id: 'n4',
  icon: 'check-circle-2',
  tone: 'olive',
  title: 'Ordine consegnato',
  body: 'PC-2390 · com’è andata? Lascia una recensione',
  when: '2 giorni fa',
  unread: false
}];
window.MC_THREADS = [{
  id: 't1',
  store: 'Salumeria Verdi',
  last: 'Certo! Le taglio la coppa più sottile, nessun problema.',
  when: '10:24',
  unread: 1,
  msgs: [{
    me: true,
    text: 'Buongiorno, è possibile avere la coppa tagliata più sottile?',
    when: '10:21'
  }, {
    me: false,
    text: 'Buongiorno Lucia! Certo, gliela preparo io.',
    when: '10:23'
  }, {
    me: false,
    text: 'Certo! Le taglio la coppa più sottile, nessun problema.',
    when: '10:24'
  }]
}, {
  id: 't2',
  store: 'Pasta Fresca Anita',
  last: 'I pisarei sono pronti per la consegna di domani 👍',
  when: 'Ieri',
  unread: 0,
  msgs: [{
    me: true,
    text: 'A che ora sono pronti i pisarei per domani?',
    when: 'Ieri'
  }, {
    me: false,
    text: 'I pisarei sono pronti per la consegna di domani',
    when: 'Ieri'
  }]
}];
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/buyer/src/data.js", error: String((e && e.message) || e) }); }

// ui_kits/rider/app.js
try { (() => {
/* AUTO-GENERATED from ui_kits/rider/src/*.js (numeric order). Do not edit directly. */
// ===== Shared + phone shell =====
const {
  Button,
  Badge,
  Card,
  OrderStatusBadge,
  Modal,
  EmptyState
} = window.MyCityDesignSystem_105480;
const fmt = n => new Intl.NumberFormat('it-IT', {
  style: 'currency',
  currency: 'EUR'
}).format(n);
const initials = name => (name || '').trim().split(/\s+/).map(w => w[0] || '').slice(0, 2).join('').toUpperCase();
function Lucide({
  name,
  size = 20,
  stroke = 2,
  color,
  style
}) {
  return /*#__PURE__*/React.createElement("i", {
    "data-lucide": name,
    ref: el => {
      if (el && window.lucide) try {
        window.lucide.createIcons({
          attrs: {
            width: size,
            height: size,
            'stroke-width': stroke
          }
        });
      } catch (e) {}
    },
    style: {
      width: size,
      height: size,
      display: 'inline-flex',
      color,
      flexShrink: 0,
      ...style
    }
  });
}
const RD_TABS = [{
  id: 'home',
  icon: 'bike',
  label: 'Consegne'
}, {
  id: 'earnings',
  icon: 'wallet',
  label: 'Guadagni'
}, {
  id: 'availability',
  icon: 'calendar-clock',
  label: 'Turni'
}, {
  id: 'profile',
  icon: 'user',
  label: 'Profilo'
}];

// Phone frame: centers a 390×every-tall device on a warm backdrop.
function Phone({
  children,
  tab,
  onTab
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      minHeight: '100vh',
      background: 'linear-gradient(160deg, var(--cream-200), var(--cream-100))',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: '390px',
      height: '844px',
      maxHeight: '92vh',
      background: 'var(--surface-50)',
      borderRadius: '44px',
      boxShadow: '0 0 0 12px var(--ink-900), 0 30px 60px -15px rgba(28,26,24,.5)',
      overflow: 'hidden',
      position: 'relative',
      display: 'flex',
      flexDirection: 'column'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: '44px',
      flexShrink: 0,
      background: 'var(--surface-0)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 24px',
      position: 'relative',
      zIndex: 5
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '13px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, "9:41"), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      left: '50%',
      top: '8px',
      transform: 'translateX(-50%)',
      width: '110px',
      height: '26px',
      background: 'var(--ink-900)',
      borderRadius: '999px'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      gap: '5px',
      alignItems: 'center',
      color: 'var(--ink-900)'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "signal",
    size: 15,
    color: "var(--ink-900)"
  }), /*#__PURE__*/React.createElement(Lucide, {
    name: "wifi",
    size: 15,
    color: "var(--ink-900)"
  }), /*#__PURE__*/React.createElement(Lucide, {
    name: "battery-full",
    size: 17,
    color: "var(--ink-900)"
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflowY: 'auto',
      overflowX: 'hidden'
    }
  }, children), /*#__PURE__*/React.createElement("nav", {
    style: {
      flexShrink: 0,
      background: 'var(--surface-0)',
      borderTop: '1px solid var(--cream-300)',
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      padding: '8px 4px 22px'
    }
  }, RD_TABS.map(t => {
    const on = tab === t.id;
    return /*#__PURE__*/React.createElement("button", {
      key: t.id,
      onClick: () => onTab(t.id),
      style: {
        border: 0,
        background: 'transparent',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '3px',
        padding: '4px',
        color: on ? 'var(--primary-700)' : 'var(--ink-400)',
        fontFamily: 'var(--font-sans)'
      }
    }, /*#__PURE__*/React.createElement(Lucide, {
      name: t.icon,
      size: 22,
      stroke: on ? 2.4 : 2,
      color: on ? 'var(--primary-700)' : 'var(--ink-400)'
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: '10px',
        fontWeight: on ? 700 : 500
      }
    }, t.label));
  }))));
}
function ScreenHead({
  title,
  sub,
  right
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '16px 20px 8px',
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: '12px'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-serif)',
      fontSize: '26px',
      fontWeight: 800,
      color: 'var(--ink-900)'
    }
  }, title), sub && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 0',
      fontSize: '13px',
      color: 'var(--ink-500)'
    }
  }, sub)), right);
}

// ===== Home (online toggle + active + available + prep) =====
function Home({
  online,
  onToggle,
  active,
  onOpenActive,
  onClaim
}) {
  const r = window.RD_RIDER,
    k = window.RD_KPI;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      paddingBottom: '20px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '8px 20px 14px',
      display: 'flex',
      alignItems: 'center',
      gap: '12px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '44px',
      height: '44px',
      borderRadius: '50%',
      background: 'linear-gradient(135deg, var(--primary-500), var(--primary-700))',
      color: '#fff',
      fontWeight: 700,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, r.initials), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontWeight: 700,
      color: 'var(--ink-900)',
      fontSize: '15px'
    }
  }, "Ciao, ", r.name.split(' ')[0]), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '12px',
      color: 'var(--ink-500)',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "star",
    size: 12,
    color: "var(--accent-500)"
  }), " ", String(r.rating).replace('.', ','), " \xB7 ", r.deliveries, " consegne"))), /*#__PURE__*/React.createElement("div", {
    style: {
      margin: '0 16px 16px',
      borderRadius: 'var(--radius-2xl)',
      padding: '18px 20px',
      background: online ? 'linear-gradient(135deg, var(--olive-600), var(--olive-700))' : 'var(--surface-0)',
      border: online ? 'none' : '1px solid var(--cream-300)',
      color: online ? '#fff' : 'var(--ink-900)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      boxShadow: online ? 'var(--shadow-warm)' : 'none'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontWeight: 800,
      fontSize: '18px',
      fontFamily: 'var(--font-serif)'
    }
  }, online ? 'Sei online' : 'Sei offline'), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 0',
      fontSize: '12px',
      opacity: online ? 0.85 : 0.6,
      color: online ? '#fff' : 'var(--ink-500)'
    }
  }, online ? 'Ricevi le consegne disponibili' : 'Vai online per iniziare')), /*#__PURE__*/React.createElement("button", {
    onClick: onToggle,
    "aria-label": "Toggle online",
    style: {
      border: 0,
      cursor: 'pointer',
      width: '58px',
      height: '32px',
      borderRadius: '999px',
      background: online ? 'rgba(255,255,255,.3)' : 'var(--cream-300)',
      position: 'relative',
      transition: 'background var(--dur-base)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      top: '3px',
      left: online ? '29px' : '3px',
      width: '26px',
      height: '26px',
      borderRadius: '50%',
      background: '#fff',
      transition: 'left var(--dur-base)',
      boxShadow: 'var(--shadow-sm)'
    }
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr 1fr',
      gap: '8px',
      margin: '0 16px 18px'
    }
  }, [['Oggi', fmt(k.todayEarned)], ['Consegne', k.todayDeliveries], ['Online', `${k.onlineHours}h`]].map(([l, v]) => /*#__PURE__*/React.createElement("div", {
    key: l,
    style: {
      background: 'var(--surface-0)',
      border: '1px solid var(--cream-300)',
      borderRadius: 'var(--radius-lg)',
      padding: '10px 12px',
      textAlign: 'center'
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '17px',
      fontWeight: 800,
      color: 'var(--ink-900)'
    }
  }, v), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '10px',
      color: 'var(--ink-400)',
      textTransform: 'uppercase',
      letterSpacing: '0.03em',
      fontWeight: 700
    }
  }, l)))), active && /*#__PURE__*/React.createElement("div", {
    style: {
      margin: '0 16px 18px'
    }
  }, /*#__PURE__*/React.createElement(SectionLabel, null, "La tua consegna"), /*#__PURE__*/React.createElement("button", {
    onClick: onOpenActive,
    style: {
      width: '100%',
      textAlign: 'left',
      border: '2px solid var(--accent-400)',
      background: 'var(--surface-0)',
      borderRadius: 'var(--radius-xl)',
      padding: '16px',
      cursor: 'pointer',
      fontFamily: 'var(--font-sans)',
      boxShadow: 'var(--shadow-warm)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: '10px'
    }
  }, /*#__PURE__*/React.createElement(OrderStatusBadge, {
    status: active.status,
    size: "sm"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: '11px',
      color: 'var(--ink-400)'
    }
  }, "#", active.id)), /*#__PURE__*/React.createElement(DeliveryRoute, {
    store: active.store,
    cust: active.custAddr
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: '12px',
      paddingTop: '12px',
      borderTop: '1px solid var(--cream-200)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '13px',
      color: 'var(--ink-500)'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "navigation",
    size: 13,
    color: "var(--ink-400)",
    style: {
      verticalAlign: 'middle',
      marginRight: '4px'
    }
  }), active.distance, " \xB7 ", active.eta), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      color: 'var(--primary-700)',
      fontWeight: 700,
      fontSize: '14px'
    }
  }, "Continua ", /*#__PURE__*/React.createElement(Lucide, {
    name: "arrow-right",
    size: 16,
    color: "var(--primary-700)"
  }))))), online ? /*#__PURE__*/React.createElement("div", {
    style: {
      margin: '0 16px'
    }
  }, /*#__PURE__*/React.createElement(SectionLabel, null, "Ordini disponibili (", window.RD_AVAILABLE.length, ")"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '10px'
    }
  }, window.RD_AVAILABLE.map(o => /*#__PURE__*/React.createElement("div", {
    key: o.id,
    style: {
      background: 'var(--surface-0)',
      border: '1px solid var(--cream-300)',
      borderRadius: 'var(--radius-xl)',
      padding: '14px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: '8px'
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    variant: "new",
    icon: "package"
  }, "Pronto"), o.pay === 'cod' && /*#__PURE__*/React.createElement(Badge, {
    variant: "cod",
    icon: "banknote"
  }, "Contanti")), /*#__PURE__*/React.createElement(DeliveryRoute, {
    store: o.store,
    cust: o.custAddr,
    small: true
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: '12px'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '11px',
      color: 'var(--ink-400)'
    }
  }, "Compenso \xB7 ", o.distance), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontWeight: 800,
      color: 'var(--olive-700)',
      fontSize: '18px'
    }
  }, fmt(o.fee))), /*#__PURE__*/React.createElement(Button, {
    variant: "accent",
    onClick: () => onClaim(o)
  }, "Accetta"))))), window.RD_PREP.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: '18px'
    }
  }, /*#__PURE__*/React.createElement(SectionLabel, null, "In preparazione \xB7 attendi"), window.RD_PREP.map(o => /*#__PURE__*/React.createElement("div", {
    key: o.id,
    style: {
      background: 'var(--surface-0)',
      border: '1px solid var(--cream-300)',
      borderRadius: 'var(--radius-xl)',
      padding: '14px',
      opacity: 0.75,
      marginBottom: '10px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: '8px'
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    variant: "local",
    icon: "chef-hat"
  }, "In preparazione"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 700,
      color: 'var(--olive-700)'
    }
  }, fmt(o.fee))), /*#__PURE__*/React.createElement(DeliveryRoute, {
    store: o.store,
    cust: o.custAddr,
    small: true
  }))))) : /*#__PURE__*/React.createElement("div", {
    style: {
      margin: '0 16px',
      padding: '32px 20px',
      textAlign: 'center',
      background: 'var(--surface-0)',
      border: '1px solid var(--cream-300)',
      borderRadius: 'var(--radius-xl)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '56px',
      height: '56px',
      borderRadius: '50%',
      background: 'var(--olive-50)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: '12px'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "power",
    size: 26,
    color: "var(--olive-600)"
  })), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, "Sei offline"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '4px 0 0',
      fontSize: '13px',
      color: 'var(--ink-500)'
    }
  }, "Vai online per vedere gli ordini disponibili nella tua zona.")));
}
function SectionLabel({
  children
}) {
  return /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '0 0 10px',
      fontSize: '13px',
      fontWeight: 700,
      color: 'var(--ink-700)',
      textTransform: 'uppercase',
      letterSpacing: '0.03em'
    }
  }, children);
}
function DeliveryRoute({
  store,
  cust,
  small
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: small ? '6px' : '8px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '24px',
      height: '24px',
      borderRadius: '50%',
      background: 'var(--primary-100)',
      color: 'var(--primary-700)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "store",
    size: 13,
    color: "var(--primary-700)"
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '14px',
      fontWeight: 600,
      color: 'var(--ink-900)'
    }
  }, store)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '24px',
      height: '24px',
      borderRadius: '50%',
      background: 'var(--olive-100)',
      color: 'var(--olive-700)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "map-pin",
    size: 13,
    color: "var(--olive-700)"
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '13px',
      color: 'var(--ink-600)'
    }
  }, cust)));
}

// ===== Live delivery (full-screen flow over the phone content) =====
const RD_FLOW = ['ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED'];
const RD_ACTION = {
  ASSIGNED: {
    label: 'Sono al negozio · ritira',
    icon: 'package',
    sub: 'Vai al negozio a ritirare l’ordine'
  },
  PICKED_UP: {
    label: 'Inizia la consegna',
    icon: 'bike',
    sub: 'Ordine ritirato, vai dal cliente'
  },
  OUT_FOR_DELIVERY: {
    label: 'Consegnato',
    icon: 'check',
    sub: 'Sei arrivato dal cliente'
  }
};
function LiveDelivery({
  order,
  onAdvance,
  onClose
}) {
  const o = order;
  const stepIdx = RD_FLOW.indexOf(o.status);
  const action = RD_ACTION[o.status];
  const done = o.status === 'DELIVERED';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      inset: 0,
      top: '44px',
      background: 'var(--surface-50)',
      zIndex: 20,
      display: 'flex',
      flexDirection: 'column',
      animation: 'mc-slide-up var(--dur-medium) var(--ease-out-quint)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      height: '220px',
      flexShrink: 0,
      background: 'linear-gradient(135deg, var(--olive-100), var(--cream-200))',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    "aria-hidden": true,
    style: {
      position: 'absolute',
      inset: 0,
      backgroundImage: 'repeating-linear-gradient(0deg, rgba(28,26,24,.05) 0 1px, transparent 1px 28px), repeating-linear-gradient(90deg, rgba(28,26,24,.05) 0 1px, transparent 1px 28px)'
    }
  }), /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 390 220",
    style: {
      position: 'absolute',
      inset: 0,
      width: '100%',
      height: '100%'
    }
  }, /*#__PURE__*/React.createElement("path", {
    d: "M70 180 Q 140 120 200 130 T 320 60",
    fill: "none",
    stroke: "var(--primary-600)",
    strokeWidth: "4",
    strokeLinecap: "round",
    strokeDasharray: "2 10"
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      left: '60px',
      top: '168px',
      width: '28px',
      height: '28px',
      borderRadius: '50%',
      background: 'var(--primary-700)',
      border: '3px solid #fff',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: 'var(--shadow-warm)'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "store",
    size: 14,
    color: "#fff"
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      left: '306px',
      top: '46px',
      width: '28px',
      height: '28px',
      borderRadius: '50%',
      background: 'var(--olive-600)',
      border: '3px solid #fff',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: 'var(--shadow-warm)'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "map-pin",
    size: 14,
    color: "#fff"
  })), /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    "aria-label": "Chiudi",
    style: {
      position: 'absolute',
      top: '12px',
      left: '12px',
      width: '36px',
      height: '36px',
      borderRadius: '50%',
      border: 0,
      background: 'rgba(255,255,255,.95)',
      boxShadow: 'var(--shadow-sm)',
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "chevron-down",
    size: 20,
    color: "var(--ink-700)"
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      top: '14px',
      right: '14px',
      background: 'rgba(28,26,24,.82)',
      color: '#fff',
      fontSize: '12px',
      fontWeight: 600,
      padding: '6px 12px',
      borderRadius: '999px'
    }
  }, o.distance, " \xB7 ", o.eta)), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflowY: 'auto',
      padding: '18px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: '14px'
    }
  }, /*#__PURE__*/React.createElement(OrderStatusBadge, {
    status: o.status
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: '12px',
      color: 'var(--ink-400)'
    }
  }, "#", o.id)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
      marginBottom: '18px'
    }
  }, RD_FLOW.map((s, i) => /*#__PURE__*/React.createElement("div", {
    key: s,
    style: {
      flex: 1,
      height: '5px',
      borderRadius: '999px',
      background: i <= stepIdx ? 'var(--olive-500)' : 'var(--cream-300)'
    }
  }))), !done && /*#__PURE__*/React.createElement(Card, {
    variant: "elevated",
    padding: "lg",
    style: {
      marginBottom: '14px'
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '0 0 4px',
      fontSize: '12px',
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '0.03em',
      color: 'var(--ink-400)'
    }
  }, stepIdx === 0 ? 'Ritira al negozio' : 'Consegna al cliente'), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-serif)',
      fontSize: '20px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, stepIdx === 0 ? o.store : o.cust), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 12px',
      fontSize: '14px',
      color: 'var(--ink-600)'
    }
  }, stepIdx === 0 ? o.storeAddr : o.custAddr), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: '8px'
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "sm",
    icon: "navigation",
    fullWidth: true
  }, "Naviga"), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "sm",
    icon: "phone",
    fullWidth: true
  }, "Chiama"))), /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "md",
    style: {
      marginBottom: '14px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      fontSize: '14px',
      marginBottom: '6px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--ink-500)'
    }
  }, "Articoli"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 600,
      color: 'var(--ink-900)'
    }
  }, o.items, " prodotti")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      fontSize: '14px',
      marginBottom: '6px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--ink-500)'
    }
  }, "Il tuo compenso"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 700,
      color: 'var(--olive-700)'
    }
  }, fmt(o.fee))), o.pay === 'cod' && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      marginTop: '10px',
      padding: '10px 12px',
      background: 'var(--accent-100)',
      borderRadius: 'var(--radius-md)'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "banknote",
    size: 18,
    color: "var(--accent-800)"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '13px',
      color: 'var(--accent-900)'
    }
  }, "Incassa ", /*#__PURE__*/React.createElement("strong", null, fmt(o.total)), " in contanti dal cliente."))), done && /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'center',
      padding: '20px 0'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '64px',
      height: '64px',
      borderRadius: '50%',
      background: 'var(--olive-100)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: '12px'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "check",
    size: 32,
    stroke: 3,
    color: "var(--olive-700)"
  })), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-serif)',
      fontSize: '22px',
      fontWeight: 800,
      color: 'var(--ink-900)'
    }
  }, "Consegna completata!"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '4px 0 0',
      fontSize: '14px',
      color: 'var(--ink-500)'
    }
  }, "Hai guadagnato ", fmt(o.fee), o.pay === 'cod' ? ` + ${fmt(o.total)} contanti incassati` : '', "."))), /*#__PURE__*/React.createElement("div", {
    style: {
      flexShrink: 0,
      padding: '14px 18px 24px',
      borderTop: '1px solid var(--cream-200)',
      background: 'var(--surface-0)'
    }
  }, done ? /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    size: "lg",
    fullWidth: true,
    onClick: onClose
  }, "Torna alle consegne") : /*#__PURE__*/React.createElement(Button, {
    variant: o.status === 'OUT_FOR_DELIVERY' ? 'success' : 'primary',
    size: "lg",
    fullWidth: true,
    icon: action.icon,
    onClick: () => onAdvance(o)
  }, action.label)));
}

// ===== Earnings · Availability · Profile =====
function Earnings() {
  const [period, setPeriod] = React.useState('7d');
  const periods = [['today', 'Oggi'], ['7d', '7 giorni'], ['30d', '30 giorni'], ['all', 'Tutto']];
  const k = window.RD_KPI,
    e7 = window.RD_EARN_7D,
    max = Math.max(...e7);
  const days = ['L', 'M', 'M', 'G', 'V', 'S', 'D'];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      paddingBottom: '20px'
    }
  }, /*#__PURE__*/React.createElement(ScreenHead, {
    title: "Guadagni",
    sub: "Tutto quello che hai incassato"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: '6px',
      padding: '0 16px 14px',
      overflowX: 'auto'
    }
  }, periods.map(([id, l]) => /*#__PURE__*/React.createElement("button", {
    key: id,
    onClick: () => setPeriod(id),
    style: {
      flexShrink: 0,
      border: 0,
      background: period === id ? 'var(--accent-500)' : 'var(--surface-0)',
      color: period === id ? 'var(--ink-900)' : 'var(--ink-600)',
      fontWeight: 600,
      fontSize: '13px',
      padding: '7px 14px',
      borderRadius: '999px',
      cursor: 'pointer',
      fontFamily: 'var(--font-sans)',
      boxShadow: period === id ? 'none' : 'inset 0 0 0 1px var(--cream-300)'
    }
  }, l))), /*#__PURE__*/React.createElement("div", {
    style: {
      margin: '0 16px 16px',
      borderRadius: 'var(--radius-2xl)',
      padding: '22px',
      background: 'linear-gradient(135deg, var(--accent-100), var(--cream-200))',
      border: '1px solid var(--accent-200)'
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '11px',
      fontWeight: 800,
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      color: 'var(--accent-800)'
    }
  }, "Hai guadagnato"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '4px 0 0',
      fontSize: '46px',
      fontWeight: 800,
      color: 'var(--ink-900)',
      lineHeight: 1
    }
  }, fmt(k.weekEarned)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '10px',
      marginTop: '16px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'rgba(255,255,255,.6)',
      borderRadius: 'var(--radius-md)',
      padding: '10px 12px'
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '10px',
      textTransform: 'uppercase',
      color: 'var(--ink-500)',
      fontWeight: 700
    }
  }, "Consegne"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '20px',
      fontWeight: 800,
      color: 'var(--ink-900)'
    }
  }, k.weekDeliveries)), /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'rgba(255,255,255,.6)',
      borderRadius: 'var(--radius-md)',
      padding: '10px 12px'
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '10px',
      textTransform: 'uppercase',
      color: 'var(--ink-500)',
      fontWeight: 700
    }
  }, "Media/consegna"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '20px',
      fontWeight: 800,
      color: 'var(--ink-900)'
    }
  }, fmt(k.avgPerDelivery))))), /*#__PURE__*/React.createElement("div", {
    style: {
      margin: '0 16px 16px'
    }
  }, /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "md"
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '0 0 14px',
      fontWeight: 700,
      color: 'var(--ink-900)',
      fontSize: '14px'
    }
  }, "Ultimi 7 giorni"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-end',
      gap: '8px',
      height: '110px'
    }
  }, e7.map((v, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '6px',
      height: '100%'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      width: '100%',
      display: 'flex',
      alignItems: 'flex-end'
    }
  }, /*#__PURE__*/React.createElement("div", {
    title: fmt(v),
    style: {
      width: '100%',
      height: `${v / max * 100}%`,
      minHeight: '5px',
      background: 'linear-gradient(180deg, var(--accent-400), var(--accent-600))',
      borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0'
    }
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '10px',
      color: 'var(--ink-400)'
    }
  }, days[i])))))), /*#__PURE__*/React.createElement("div", {
    style: {
      margin: '0 16px'
    }
  }, /*#__PURE__*/React.createElement(Card, {
    variant: "flat",
    padding: "md",
    style: {
      background: 'var(--olive-50)',
      border: '1px solid var(--olive-200)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: '10px',
      alignItems: 'flex-start'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "landmark",
    size: 18,
    color: "var(--olive-700)"
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '13px',
      fontWeight: 700,
      color: 'var(--olive-900)'
    }
  }, "Compensi sul tuo IBAN"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 0',
      fontSize: '12px',
      color: 'var(--olive-800)',
      lineHeight: 1.5
    }
  }, "Le consegne con carta vengono versate ~24h dopo. I contanti li incassi direttamente alla consegna."))))), /*#__PURE__*/React.createElement("div", {
    style: {
      margin: '16px 16px 0'
    }
  }, /*#__PURE__*/React.createElement(SectionLabel, null, "Storico consegne"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '8px'
    }
  }, window.RD_HISTORY.map(h => /*#__PURE__*/React.createElement("div", {
    key: h.id,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      background: 'var(--surface-0)',
      border: '1px solid var(--cream-300)',
      borderRadius: 'var(--radius-lg)',
      padding: '12px 14px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '36px',
      height: '36px',
      borderRadius: '50%',
      background: 'var(--olive-50)',
      color: 'var(--olive-700)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "check",
    size: 17,
    stroke: 2.4,
    color: "var(--olive-700)"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '13px',
      fontWeight: 600,
      color: 'var(--ink-900)'
    }
  }, h.store, " \u2192 ", h.cust), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '11px',
      color: 'var(--ink-400)'
    }
  }, h.when, " \xB7 ", h.pay === 'cod' ? 'Contanti' : 'Carta')), /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 700,
      color: 'var(--olive-700)'
    }
  }, fmt(h.fee)))))));
}
function Availability({
  online,
  onToggle
}) {
  const [zones, setZones] = React.useState(window.RD_ZONES);
  const toggleZone = i => setZones(z => z.map((x, j) => j === i ? {
    ...x,
    on: !x.on
  } : x));
  return /*#__PURE__*/React.createElement("div", {
    style: {
      paddingBottom: '20px'
    }
  }, /*#__PURE__*/React.createElement(ScreenHead, {
    title: "Turni & zone",
    sub: "Quando e dove vuoi consegnare"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      margin: '0 16px 16px'
    }
  }, /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "md"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, "Stato"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '13px',
      color: 'var(--ink-500)'
    }
  }, online ? 'Online · ricevi consegne' : 'Offline')), /*#__PURE__*/React.createElement("button", {
    onClick: onToggle,
    style: {
      border: 0,
      cursor: 'pointer',
      width: '52px',
      height: '30px',
      borderRadius: '999px',
      background: online ? 'var(--olive-500)' : 'var(--cream-300)',
      position: 'relative'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      top: '3px',
      left: online ? '25px' : '3px',
      width: '24px',
      height: '24px',
      borderRadius: '50%',
      background: '#fff',
      transition: 'left var(--dur-base)',
      boxShadow: 'var(--shadow-sm)'
    }
  }))))), /*#__PURE__*/React.createElement("div", {
    style: {
      margin: '0 16px 16px'
    }
  }, /*#__PURE__*/React.createElement(SectionLabel, null, "Zone preferite"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '-4px 0 12px',
      fontSize: '12px',
      color: 'var(--ink-500)'
    }
  }, "Ricevi prima le consegne in queste zone."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '8px'
    }
  }, zones.map((z, i) => /*#__PURE__*/React.createElement("button", {
    key: z.name,
    onClick: () => toggleZone(i),
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      background: 'var(--surface-0)',
      border: `1.5px solid ${z.on ? 'var(--primary-400)' : 'var(--cream-300)'}`,
      borderRadius: 'var(--radius-lg)',
      padding: '12px 14px',
      cursor: 'pointer',
      fontFamily: 'var(--font-sans)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px',
      fontSize: '14px',
      fontWeight: 600,
      color: 'var(--ink-900)'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "map-pin",
    size: 15,
    color: z.on ? 'var(--primary-600)' : 'var(--ink-400)'
  }), " ", z.name), /*#__PURE__*/React.createElement(Lucide, {
    name: z.on ? 'check-circle-2' : 'circle',
    size: 20,
    color: z.on ? 'var(--primary-600)' : 'var(--ink-300)'
  }))))), /*#__PURE__*/React.createElement("div", {
    style: {
      margin: '0 16px'
    }
  }, /*#__PURE__*/React.createElement(SectionLabel, null, "Orari di punta"), /*#__PURE__*/React.createElement(Card, {
    variant: "flat",
    padding: "md",
    style: {
      background: 'var(--primary-50)',
      border: '1px solid var(--primary-100)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: '10px',
      alignItems: 'flex-start'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "trending-up",
    size: 18,
    color: "var(--primary-700)"
  }), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '13px',
      color: 'var(--primary-900)',
      lineHeight: 1.5
    }
  }, "Pi\xF9 consegne tra le ", /*#__PURE__*/React.createElement("strong", null, "12\u201314"), " e le ", /*#__PURE__*/React.createElement("strong", null, "19\u201321"), ". Tieni la disponibilit\xE0 ON nei picchi per guadagnare di pi\xF9.")))));
}
function Profile() {
  const r = window.RD_RIDER;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      paddingBottom: '20px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '24px 20px',
      textAlign: 'center',
      background: 'linear-gradient(135deg, var(--primary-700), var(--secondary-700))',
      color: '#fff'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '72px',
      height: '72px',
      borderRadius: '50%',
      background: 'rgba(255,255,255,.18)',
      border: '3px solid rgba(255,255,255,.3)',
      color: '#fff',
      fontWeight: 800,
      fontSize: '26px',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, r.initials), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '12px 0 0',
      fontFamily: 'var(--font-serif)',
      fontSize: '22px',
      fontWeight: 800
    }
  }, r.name), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 0',
      fontSize: '13px',
      opacity: 0.85,
      display: 'inline-flex',
      alignItems: 'center',
      gap: '5px'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "star",
    size: 14,
    color: "var(--accent-300)"
  }), " ", String(r.rating).replace('.', ','), " \xB7 ", r.deliveries, " consegne")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '10px',
      padding: '16px'
    }
  }, /*#__PURE__*/React.createElement(InfoTile, {
    icon: "bike",
    label: "Veicolo",
    value: r.vehicle
  }), /*#__PURE__*/React.createElement(InfoTile, {
    icon: "map-pin",
    label: "Zona base",
    value: r.zone
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '0 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: '2px'
    }
  }, [['user', 'Dati personali'], ['landmark', 'IBAN e compensi'], ['bell', 'Notifiche'], ['shield-check', 'Documenti'], ['life-buoy', 'Assistenza'], ['log-out', 'Esci']].map(([ic, l]) => /*#__PURE__*/React.createElement("button", {
    key: l,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      border: 0,
      borderBottom: '1px solid var(--cream-200)',
      background: 'transparent',
      padding: '14px 4px',
      cursor: 'pointer',
      fontFamily: 'var(--font-sans)',
      fontSize: '15px',
      color: l === 'Esci' ? 'var(--secondary-600)' : 'var(--ink-800)',
      textAlign: 'left',
      width: '100%'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: ic,
    size: 19,
    color: l === 'Esci' ? 'var(--secondary-600)' : 'var(--ink-500)'
  }), " ", /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }, l), l !== 'Esci' && /*#__PURE__*/React.createElement(Lucide, {
    name: "chevron-right",
    size: 17,
    color: "var(--ink-300)"
  })))));
}
function InfoTile({
  icon,
  label,
  value
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--surface-0)',
      border: '1px solid var(--cream-300)',
      borderRadius: 'var(--radius-lg)',
      padding: '14px'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: icon,
    size: 18,
    color: "var(--primary-600)"
  }), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '8px 0 0',
      fontSize: '11px',
      color: 'var(--ink-400)',
      textTransform: 'uppercase',
      fontWeight: 700
    }
  }, label), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 0',
      fontSize: '14px',
      fontWeight: 600,
      color: 'var(--ink-900)'
    }
  }, value));
}

// ===== Rider app shell =====
function App() {
  const [tab, setTab] = React.useState('home');
  const [online, setOnline] = React.useState(true);
  const [active, setActive] = React.useState(window.RD_ACTIVE);
  const [live, setLive] = React.useState(false);
  function advance(o) {
    const i = RD_FLOW.indexOf(o.status);
    const next = RD_FLOW[i + 1];
    if (!next) {
      setLive(false);
      setActive(null);
      setTab('home');
      return;
    }
    setActive({
      ...o,
      status: next
    });
  }
  function claim(o) {
    setActive({
      ...window.RD_ACTIVE,
      id: o.id,
      store: o.store,
      storeAddr: o.storeAddr,
      cust: o.cust,
      custAddr: o.custAddr,
      fee: o.fee,
      pay: o.pay,
      items: o.items,
      distance: o.distance,
      status: 'ASSIGNED'
    });
    setLive(true);
  }
  return /*#__PURE__*/React.createElement(Phone, {
    tab: tab,
    onTab: t => {
      setTab(t);
    }
  }, tab === 'home' && /*#__PURE__*/React.createElement(Home, {
    online: online,
    onToggle: () => setOnline(v => !v),
    active: active,
    onOpenActive: () => setLive(true),
    onClaim: claim
  }), tab === 'earnings' && /*#__PURE__*/React.createElement(Earnings, null), tab === 'availability' && /*#__PURE__*/React.createElement(Availability, {
    online: online,
    onToggle: () => setOnline(v => !v)
  }), tab === 'profile' && /*#__PURE__*/React.createElement(Profile, null), live && active && /*#__PURE__*/React.createElement(LiveDelivery, {
    order: active,
    onAdvance: advance,
    onClose: () => setLive(false)
  }));
}

// ===== Bootstrap — mounts ONLY after index.html grants permission (window.__MC_ALLOW_MOUNT).
// _ds_bundle.js concatenates this file; its embedded copy runs during bundle-eval BEFORE the
// flag is set → bails. The real <script src="app.js"> runs AFTER the flag → mounts. Uses a
// fresh flag name so a stale bundle's old boot (pre-set & neutralized in index.html) can't interfere. =====
(function mcMount() {
  if (!window.__MC_ALLOW_MOUNT) return;
  if (window.__riderReady) return;
  var ns = window.MyCityDesignSystem_105480;
  if (typeof App === 'undefined' || !ns || !ns.Button || !window.RD_ACTIVE) return setTimeout(mcMount, 30);
  window.__riderReady = true;
  var root = document.getElementById('root');
  if (root) root.style.display = 'none';
  var mount = document.getElementById('mc-app');
  if (!mount) {
    mount = document.createElement('div');
    mount.id = 'mc-app';
    document.body.appendChild(mount);
  }
  ReactDOM.createRoot(mount).render(React.createElement(App));
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/rider/app.js", error: String((e && e.message) || e) }); }

// ui_kits/rider/src/00-shell.js
try { (() => {
// ===== Shared + phone shell =====
const {
  Button,
  Badge,
  Card,
  OrderStatusBadge,
  Modal,
  EmptyState
} = window.MyCityDesignSystem_105480;
const fmt = n => new Intl.NumberFormat('it-IT', {
  style: 'currency',
  currency: 'EUR'
}).format(n);
const initials = name => (name || '').trim().split(/\s+/).map(w => w[0] || '').slice(0, 2).join('').toUpperCase();
function Lucide({
  name,
  size = 20,
  stroke = 2,
  color,
  style
}) {
  return /*#__PURE__*/React.createElement("i", {
    "data-lucide": name,
    ref: el => {
      if (el && window.lucide) try {
        window.lucide.createIcons({
          attrs: {
            width: size,
            height: size,
            'stroke-width': stroke
          }
        });
      } catch (e) {}
    },
    style: {
      width: size,
      height: size,
      display: 'inline-flex',
      color,
      flexShrink: 0,
      ...style
    }
  });
}
const RD_TABS = [{
  id: 'home',
  icon: 'bike',
  label: 'Consegne'
}, {
  id: 'earnings',
  icon: 'wallet',
  label: 'Guadagni'
}, {
  id: 'availability',
  icon: 'calendar-clock',
  label: 'Turni'
}, {
  id: 'profile',
  icon: 'user',
  label: 'Profilo'
}];

// Phone frame: centers a 390×every-tall device on a warm backdrop.
function Phone({
  children,
  tab,
  onTab
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      minHeight: '100vh',
      background: 'linear-gradient(160deg, var(--cream-200), var(--cream-100))',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: '390px',
      height: '844px',
      maxHeight: '92vh',
      background: 'var(--surface-50)',
      borderRadius: '44px',
      boxShadow: '0 0 0 12px var(--ink-900), 0 30px 60px -15px rgba(28,26,24,.5)',
      overflow: 'hidden',
      position: 'relative',
      display: 'flex',
      flexDirection: 'column'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: '44px',
      flexShrink: 0,
      background: 'var(--surface-0)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 24px',
      position: 'relative',
      zIndex: 5
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '13px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, "9:41"), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      left: '50%',
      top: '8px',
      transform: 'translateX(-50%)',
      width: '110px',
      height: '26px',
      background: 'var(--ink-900)',
      borderRadius: '999px'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      gap: '5px',
      alignItems: 'center',
      color: 'var(--ink-900)'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "signal",
    size: 15,
    color: "var(--ink-900)"
  }), /*#__PURE__*/React.createElement(Lucide, {
    name: "wifi",
    size: 15,
    color: "var(--ink-900)"
  }), /*#__PURE__*/React.createElement(Lucide, {
    name: "battery-full",
    size: 17,
    color: "var(--ink-900)"
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflowY: 'auto',
      overflowX: 'hidden'
    }
  }, children), /*#__PURE__*/React.createElement("nav", {
    style: {
      flexShrink: 0,
      background: 'var(--surface-0)',
      borderTop: '1px solid var(--cream-300)',
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      padding: '8px 4px 22px'
    }
  }, RD_TABS.map(t => {
    const on = tab === t.id;
    return /*#__PURE__*/React.createElement("button", {
      key: t.id,
      onClick: () => onTab(t.id),
      style: {
        border: 0,
        background: 'transparent',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '3px',
        padding: '4px',
        color: on ? 'var(--primary-700)' : 'var(--ink-400)',
        fontFamily: 'var(--font-sans)'
      }
    }, /*#__PURE__*/React.createElement(Lucide, {
      name: t.icon,
      size: 22,
      stroke: on ? 2.4 : 2,
      color: on ? 'var(--primary-700)' : 'var(--ink-400)'
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: '10px',
        fontWeight: on ? 700 : 500
      }
    }, t.label));
  }))));
}
function ScreenHead({
  title,
  sub,
  right
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '16px 20px 8px',
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: '12px'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-serif)',
      fontSize: '26px',
      fontWeight: 800,
      color: 'var(--ink-900)'
    }
  }, title), sub && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 0',
      fontSize: '13px',
      color: 'var(--ink-500)'
    }
  }, sub)), right);
}
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/rider/src/00-shell.js", error: String((e && e.message) || e) }); }

// ui_kits/rider/src/00-ui.jsx
try { (() => {
// ===== Rider shared UI (DS wrappers + mobile chrome) =====
const __ds = n => function DSComp(props) {
  const C = (window.MyCityDesignSystem_105480 || {})[n];
  return C ? React.createElement(C, props) : null;
};
const Button = __ds('Button');
const Badge = __ds('Badge');
const Card = __ds('Card');
const OrderStatusBadge = __ds('OrderStatusBadge');
const fmt = n => new Intl.NumberFormat('it-IT', {
  style: 'currency',
  currency: 'EUR'
}).format(n);
const initials = s => (s || '').trim().split(/\s+/).map(w => w[0] || '').slice(0, 2).join('').toUpperCase();
function Icon({
  name,
  size = 22,
  stroke = 2,
  color,
  style
}) {
  return /*#__PURE__*/React.createElement("i", {
    "data-lucide": name,
    ref: el => {
      if (el && window.lucide) try {
        window.lucide.createIcons({
          attrs: {
            width: size,
            height: size,
            'stroke-width': stroke
          }
        });
      } catch (e) {}
    },
    style: {
      width: size,
      height: size,
      display: 'inline-flex',
      color,
      flexShrink: 0,
      ...style
    }
  });
}

// Phone frame — 390×844, scaled to fit the card.
function PhoneFrame({
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'radial-gradient(circle at 50% 0%, #2c2a28, #1c1a18)',
      padding: '24px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: '390px',
      height: '844px',
      background: 'var(--surface-50)',
      borderRadius: '44px',
      boxShadow: '0 40px 80px -20px rgba(0,0,0,.6), inset 0 0 0 11px #0b0a0a, inset 0 0 0 13px #2a2a2a',
      overflow: 'hidden',
      position: 'relative'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      top: '0',
      left: '50%',
      transform: 'translateX(-50%)',
      width: '150px',
      height: '30px',
      background: '#0b0a0a',
      borderRadius: '0 0 18px 18px',
      zIndex: 60
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      inset: '0',
      borderRadius: '33px',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column'
    }
  }, children)));
}
function StatusBar({
  dark
}) {
  const c = dark ? '#fff' : 'var(--ink-900)';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      height: '44px',
      flexShrink: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 26px 0 30px',
      fontFamily: 'var(--font-sans)',
      fontSize: '14px',
      fontWeight: 700,
      color: c,
      zIndex: 50
    }
  }, /*#__PURE__*/React.createElement("span", null, "9:41"), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      gap: '6px',
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "signal",
    size: 16,
    color: c
  }), /*#__PURE__*/React.createElement(Icon, {
    name: "wifi",
    size: 16,
    color: c
  }), /*#__PURE__*/React.createElement(Icon, {
    name: "battery-full",
    size: 18,
    color: c
  })));
}
function BottomTab({
  active,
  onNav
}) {
  const items = [['home', 'home', 'Consegne'], ['guadagni', 'wallet', 'Guadagni'], ['storico', 'history', 'Storico'], ['profilo', 'user', 'Profilo']];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      flexShrink: 0,
      height: '76px',
      background: 'var(--surface-0)',
      borderTop: '1px solid var(--cream-300)',
      display: 'flex',
      paddingBottom: '14px'
    }
  }, items.map(([id, icon, label]) => {
    const on = active === id;
    return /*#__PURE__*/React.createElement("button", {
      key: id,
      onClick: () => onNav(id),
      style: {
        flex: 1,
        border: 0,
        background: 'transparent',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '3px',
        cursor: 'pointer',
        color: on ? 'var(--primary-700)' : 'var(--ink-400)',
        fontFamily: 'var(--font-sans)',
        paddingTop: '8px'
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: icon,
      size: 22,
      stroke: on ? 2.4 : 2,
      color: on ? 'var(--primary-700)' : 'var(--ink-400)'
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: '11px',
        fontWeight: on ? 700 : 500
      }
    }, label));
  }));
}

// Faux map with a route line + two pins.
function MapStub({
  height = 220
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      height,
      background: 'linear-gradient(135deg, #eef1ea, #e3e8dc)',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 390 220",
    width: "100%",
    height: "100%",
    style: {
      position: 'absolute',
      inset: 0
    }
  }, [40, 90, 140, 190].map(y => /*#__PURE__*/React.createElement("line", {
    key: 'h' + y,
    x1: "0",
    y1: y,
    x2: "390",
    y2: y,
    stroke: "#d2d8c8",
    strokeWidth: "1"
  })), [60, 130, 200, 270, 340].map(x => /*#__PURE__*/React.createElement("line", {
    key: 'v' + x,
    x1: x,
    y1: "0",
    x2: x,
    y2: "220",
    stroke: "#d2d8c8",
    strokeWidth: "1"
  })), /*#__PURE__*/React.createElement("path", {
    d: "M70 170 Q120 150 150 120 T280 60",
    fill: "none",
    stroke: "var(--primary-600)",
    strokeWidth: "4",
    strokeLinecap: "round",
    strokeDasharray: "2 9"
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      left: '58px',
      top: '152px'
    }
  }, /*#__PURE__*/React.createElement(Pin, {
    color: "var(--ink-800)",
    icon: "store"
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      left: '262px',
      top: '40px'
    }
  }, /*#__PURE__*/React.createElement(Pin, {
    color: "var(--primary-600)",
    icon: "map-pin"
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      left: '50%',
      top: '50%',
      transform: 'translate(-50%,-50%)',
      width: '18px',
      height: '18px',
      borderRadius: '50%',
      background: 'var(--info)',
      border: '3px solid #fff',
      boxShadow: '0 2px 6px rgba(0,0,0,.3)'
    }
  }));
}
function Pin({
  color,
  icon
}) {
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      flexDirection: 'column',
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '30px',
      height: '30px',
      borderRadius: '50% 50% 50% 0',
      background: color,
      transform: 'rotate(-45deg)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: '0 3px 8px rgba(0,0,0,.3)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      transform: 'rotate(45deg)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: icon,
    size: 15,
    color: "#fff"
  }))));
}
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/rider/src/00-ui.jsx", error: String((e && e.message) || e) }); }

// ui_kits/rider/src/10-screens.jsx
try { (() => {
// ===== Rider screens =====
function ScreenHead({
  title,
  sub,
  dark
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '6px 20px 14px'
    }
  }, /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-serif)',
      fontSize: '26px',
      fontWeight: 800,
      color: dark ? '#fff' : 'var(--ink-900)'
    }
  }, title), sub && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 0',
      fontSize: '13px',
      color: dark ? 'rgba(255,255,255,.7)' : 'var(--ink-500)'
    }
  }, sub));
}
function HomeScreen({
  online,
  onToggle,
  onStart,
  onOpenActive,
  active
}) {
  const t = window.RD_TODAY;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflowY: 'auto',
      background: 'var(--surface-50)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: online ? 'var(--olive-600)' : 'var(--ink-700)',
      color: '#fff',
      padding: '16px 20px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '40px',
      height: '40px',
      borderRadius: '50%',
      background: 'rgba(255,255,255,.18)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "bike",
    size: 22,
    color: "#fff"
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontWeight: 700,
      fontSize: '15px'
    }
  }, online ? 'Sei online' : 'Sei offline'), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '12px',
      opacity: .85
    }
  }, online ? `${t.hours} · zona ${window.RD_RIDER.zone}` : 'Vai online per ricevere consegne'))), /*#__PURE__*/React.createElement("button", {
    onClick: onToggle,
    "aria-label": "Toggle online",
    style: {
      width: '52px',
      height: '30px',
      borderRadius: '999px',
      border: 0,
      background: online ? 'rgba(255,255,255,.35)' : 'rgba(255,255,255,.2)',
      position: 'relative',
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      top: '3px',
      left: online ? '25px' : '3px',
      width: '24px',
      height: '24px',
      borderRadius: '50%',
      background: '#fff',
      transition: 'left var(--dur-base) var(--ease-out-quint)'
    }
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: '10px',
      padding: '16px 20px'
    }
  }, [['Consegne', t.deliveries, 'package'], ['Guadagno', fmt(t.earnings), 'banknote'], ['Km', t.km, 'route']].map(([l, v, ic]) => /*#__PURE__*/React.createElement("div", {
    key: l,
    style: {
      background: 'var(--surface-0)',
      border: '1px solid var(--cream-300)',
      borderRadius: 'var(--radius-lg)',
      padding: '12px',
      textAlign: 'center'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: ic,
    size: 18,
    color: "var(--primary-600)"
  }), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '4px 0 0',
      fontFamily: 'var(--font-serif)',
      fontSize: '18px',
      fontWeight: 800,
      color: 'var(--ink-900)'
    }
  }, v), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '11px',
      color: 'var(--ink-500)'
    }
  }, l)))), active && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '0 20px 12px'
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '0 0 8px',
      fontSize: '12px',
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '0.04em',
      color: 'var(--primary-700)'
    }
  }, "Consegna in corso"), /*#__PURE__*/React.createElement("div", {
    onClick: onOpenActive,
    style: {
      cursor: 'pointer',
      background: 'var(--surface-0)',
      border: '1.5px solid var(--primary-300)',
      borderRadius: 'var(--radius-xl)',
      overflow: 'hidden',
      boxShadow: 'var(--shadow-warm)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '14px 16px',
      display: 'flex',
      alignItems: 'center',
      gap: '12px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '44px',
      height: '44px',
      borderRadius: 'var(--radius-md)',
      background: 'var(--primary-100)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "navigation",
    size: 22,
    color: "var(--primary-700)"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, active.id, " \xB7 ", active.store), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '13px',
      color: 'var(--ink-500)'
    }
  }, "\u2192 ", active.customer, " \xB7 ", active.custArea)), /*#__PURE__*/React.createElement(Icon, {
    name: "chevron-right",
    size: 20,
    color: "var(--ink-400)"
  })))), online && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '4px 20px 20px'
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '0 0 8px',
      fontSize: '12px',
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '0.04em',
      color: 'var(--ink-500)'
    }
  }, "Consegne disponibili"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '12px'
    }
  }, window.RD_QUEUE.map(o => /*#__PURE__*/React.createElement(OfferCard, {
    key: o.id,
    o: o,
    onAccept: () => onStart(o),
    disabled: !!active
  })))));
}
function OfferCard({
  o,
  onAccept,
  disabled
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--surface-0)',
      border: '1px solid var(--cream-300)',
      borderRadius: 'var(--radius-xl)',
      padding: '14px 16px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: '10px'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '12px',
      color: 'var(--ink-400)'
    }
  }, o.id), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 0',
      fontFamily: 'var(--font-serif)',
      fontSize: '22px',
      fontWeight: 800,
      color: 'var(--olive-700)'
    }
  }, "+", fmt(o.payout))), /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'right'
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    variant: "cod",
    icon: "banknote"
  }, "Incassa ", fmt(o.cod)), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '6px 0 0',
      fontSize: '12px',
      color: 'var(--ink-500)'
    }
  }, o.dist, " km \xB7 ~", o.eta, " min"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      marginBottom: '12px'
    }
  }, /*#__PURE__*/React.createElement(Hop, {
    icon: "store",
    color: "var(--ink-700)",
    label: o.store,
    sub: o.storeArea
  }), /*#__PURE__*/React.createElement(Hop, {
    icon: "map-pin",
    color: "var(--primary-600)",
    label: o.customer,
    sub: o.custArea
  })), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    size: "md",
    fullWidth: true,
    icon: "check",
    disabled: disabled,
    onClick: onAccept
  }, disabled ? 'Completa la consegna in corso' : 'Accetta consegna'));
}
function Hop({
  icon,
  color,
  label,
  sub
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '26px',
      height: '26px',
      borderRadius: '50%',
      background: 'var(--cream-100)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: icon,
    size: 14,
    color: color
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '14px',
      fontWeight: 600,
      color: 'var(--ink-900)'
    }
  }, label), " ", /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '12px',
      color: 'var(--ink-500)'
    }
  }, "\xB7 ", sub)));
}
function DeliveryScreen({
  delivery,
  step,
  onAdvance,
  onBack
}) {
  const steps = window.RD_STEPS;
  const done = step >= steps.length;
  const cur = steps[Math.min(step, steps.length - 1)];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--surface-50)',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative'
    }
  }, /*#__PURE__*/React.createElement(MapStub, {
    height: 240
  }), /*#__PURE__*/React.createElement("button", {
    onClick: onBack,
    style: {
      position: 'absolute',
      top: '12px',
      left: '14px',
      width: '38px',
      height: '38px',
      borderRadius: '50%',
      border: 0,
      background: 'rgba(255,255,255,.95)',
      boxShadow: 'var(--shadow-sm)',
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "arrow-left",
    size: 20,
    color: "var(--ink-800)"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      top: '12px',
      right: '14px',
      background: 'rgba(28,26,24,.85)',
      color: '#fff',
      borderRadius: 'var(--radius-full)',
      padding: '6px 12px',
      fontSize: '13px',
      fontWeight: 700
    }
  }, delivery.dist, " km \xB7 ~", delivery.eta, " min")), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflowY: 'auto',
      padding: '18px 20px',
      marginTop: '-20px',
      background: 'var(--surface-50)',
      borderRadius: '20px 20px 0 0',
      position: 'relative'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: '14px'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontWeight: 800,
      fontFamily: 'var(--font-serif)',
      fontSize: '20px',
      color: 'var(--ink-900)'
    }
  }, delivery.id), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '13px',
      color: 'var(--ink-500)'
    }
  }, "Compenso ", fmt(delivery.payout))), /*#__PURE__*/React.createElement(Badge, {
    variant: "cod",
    icon: "banknote"
  }, "Incassa ", fmt(delivery.cod))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: '16px'
    }
  }, steps.map((s, i) => {
    const isDone = i < step,
      isCur = i === step;
    return /*#__PURE__*/React.createElement("div", {
      key: s.key,
      style: {
        display: 'flex',
        gap: '12px'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: '32px',
        height: '32px',
        borderRadius: '50%',
        background: isDone ? 'var(--olive-600)' : isCur ? 'var(--primary-600)' : 'var(--cream-200)',
        color: isDone || isCur ? '#fff' : 'var(--ink-400)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        border: isCur ? '3px solid var(--primary-200)' : 'none'
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: isDone ? 'check' : s.icon,
      size: 15,
      stroke: 2.4,
      color: isDone || isCur ? '#fff' : 'var(--ink-400)'
    })), i < steps.length - 1 && /*#__PURE__*/React.createElement("span", {
      style: {
        width: '2px',
        flex: 1,
        minHeight: '22px',
        background: isDone ? 'var(--olive-400)' : 'var(--cream-300)'
      }
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        paddingBottom: '14px'
      }
    }, /*#__PURE__*/React.createElement("p", {
      style: {
        margin: 0,
        fontSize: '15px',
        fontWeight: isCur ? 700 : 600,
        color: isDone || isCur ? 'var(--ink-900)' : 'var(--ink-400)'
      }
    }, s.label), /*#__PURE__*/React.createElement("p", {
      style: {
        margin: '2px 0 0',
        fontSize: '12px',
        color: 'var(--ink-500)'
      }
    }, s.sub)));
  })), done ? /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'center',
      padding: '12px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '60px',
      height: '60px',
      borderRadius: '50%',
      background: 'var(--olive-100)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: '10px'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "check",
    size: 30,
    stroke: 3,
    color: "var(--olive-700)"
  })), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-serif)',
      fontSize: '20px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, "Consegna completata!"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '4px 0 14px',
      fontSize: '14px',
      color: 'var(--ink-600)'
    }
  }, "+", fmt(delivery.payout), " \xB7 ", fmt(delivery.cod), " contanti raccolti"), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    fullWidth: true,
    onClick: onBack
  }, "Torna alle consegne")) : /*#__PURE__*/React.createElement(Button, {
    variant: step === steps.length - 1 ? 'success' : 'primary',
    size: "lg",
    fullWidth: true,
    icon: cur.icon,
    onClick: onAdvance
  }, cur.cta)));
}
function EarningsScreen() {
  const w = window.RD_EARN_WEEK;
  const total = w.reduce((a, b) => a + b, 0);
  const max = Math.max(...w);
  const days = ['L', 'M', 'M', 'G', 'V', 'S', 'D'];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflowY: 'auto',
      background: 'var(--surface-50)'
    }
  }, /*#__PURE__*/React.createElement(ScreenHead, {
    title: "Guadagni",
    sub: "Questa settimana"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '0 20px'
    }
  }, /*#__PURE__*/React.createElement(Card, {
    variant: "elevated",
    padding: "lg"
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '13px',
      color: 'var(--ink-500)'
    }
  }, "Totale settimana"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '4px 0 16px',
      fontFamily: 'var(--font-serif)',
      fontSize: '34px',
      fontWeight: 800,
      color: 'var(--ink-900)'
    }
  }, fmt(total)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-end',
      gap: '8px',
      height: '110px'
    }
  }, w.map((v, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '6px',
      height: '100%',
      justifyContent: 'flex-end'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: '100%',
      height: `${v / max * 100}%`,
      minHeight: '4px',
      background: i === w.length - 1 ? 'var(--primary-600)' : 'var(--accent-400)',
      borderRadius: '5px 5px 0 0'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '11px',
      color: 'var(--ink-400)',
      fontWeight: 600
    }
  }, days[i]))))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: '16px',
      background: 'var(--secondary-50)',
      border: '1px solid var(--secondary-200)',
      borderRadius: 'var(--radius-xl)',
      padding: '16px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '13px',
      color: 'var(--secondary-700)',
      fontWeight: 600
    }
  }, "Contanti da consegnare"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '4px 0 0',
      fontFamily: 'var(--font-serif)',
      fontSize: '26px',
      fontWeight: 800,
      color: 'var(--ink-900)'
    }
  }, fmt(window.RD_CASH_TO_REMIT))), /*#__PURE__*/React.createElement(Icon, {
    name: "wallet",
    size: 28,
    color: "var(--secondary-600)"
  })), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '8px 0 12px',
      fontSize: '12px',
      color: 'var(--ink-600)'
    }
  }, "Consegna i contanti raccolti dai clienti al punto MyCity entro fine turno."), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "md",
    fullWidth: true,
    icon: "map-pin"
  }, "Trova punto di consegna")), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '20px 0 8px',
      fontSize: '12px',
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '0.04em',
      color: 'var(--ink-500)'
    }
  }, "Dettaglio di oggi"), /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "md",
    style: {
      marginBottom: '20px'
    }
  }, [['Compensi consegne', '+' + fmt(34.8)], ['Bonus zona', '+' + fmt(3.7)], ['Mance', '+' + fmt(0)]].map(([l, v], i) => /*#__PURE__*/React.createElement("div", {
    key: l,
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      padding: '8px 0',
      borderBottom: i < 2 ? '1px solid var(--cream-200)' : 'none',
      fontSize: '14px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--ink-600)'
    }
  }, l), /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 700,
      color: 'var(--olive-700)'
    }
  }, v))))));
}
function HistoryScreen() {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflowY: 'auto',
      background: 'var(--surface-50)'
    }
  }, /*#__PURE__*/React.createElement(ScreenHead, {
    title: "Storico",
    sub: `${window.RD_HISTORY.length} consegne oggi`
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '0 20px 20px',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px'
    }
  }, window.RD_HISTORY.map(h => /*#__PURE__*/React.createElement("div", {
    key: h.id,
    style: {
      background: 'var(--surface-0)',
      border: '1px solid var(--cream-300)',
      borderRadius: 'var(--radius-lg)',
      padding: '14px 16px',
      display: 'flex',
      alignItems: 'center',
      gap: '12px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '40px',
      height: '40px',
      borderRadius: 'var(--radius-md)',
      background: 'var(--olive-50)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "check",
    size: 20,
    color: "var(--olive-700)"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontWeight: 700,
      color: 'var(--ink-900)',
      fontSize: '14px'
    }
  }, h.id), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '12px',
      color: 'var(--ink-500)'
    }
  }, h.when, " \xB7 ", h.from, " \u2192 ", h.to)), /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'right'
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontWeight: 800,
      color: 'var(--olive-700)'
    }
  }, "+", fmt(h.payout)), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '11px',
      color: 'var(--ink-400)'
    }
  }, "contanti ", fmt(h.cod)))))));
}
function ProfileScreen() {
  const r = window.RD_RIDER;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflowY: 'auto',
      background: 'var(--surface-50)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--primary-700)',
      color: '#fff',
      padding: '24px 20px 28px',
      textAlign: 'center'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '76px',
      height: '76px',
      borderRadius: '50%',
      background: 'rgba(255,255,255,.16)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'var(--font-serif)',
      fontSize: '28px',
      fontWeight: 800,
      margin: '0 auto 10px'
    }
  }, r.initials), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-serif)',
      fontSize: '22px',
      fontWeight: 800
    }
  }, r.name), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '4px 0 0',
      fontSize: '13px',
      opacity: .85,
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "star",
    size: 15,
    color: "var(--accent-300)"
  }), " ", String(r.rating).replace('.', ','), " \xB7 ", r.deliveries, " consegne")), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '20px',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px'
    }
  }, [['bike', 'Mezzo', r.vehicle], ['map', 'Zona', r.zone], ['shield-check', 'Stato', 'Verificato']].map(([ic, l, v]) => /*#__PURE__*/React.createElement("div", {
    key: l,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      background: 'var(--surface-0)',
      border: '1px solid var(--cream-300)',
      borderRadius: 'var(--radius-lg)',
      padding: '14px 16px'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: ic,
    size: 20,
    color: "var(--primary-600)"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      fontSize: '13px',
      color: 'var(--ink-500)'
    }
  }, l), /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 700,
      color: 'var(--ink-900)',
      fontSize: '14px'
    }
  }, v))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: '8px'
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    fullWidth: true,
    icon: "settings"
  }, "Impostazioni")), /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    fullWidth: true,
    icon: "log-out"
  }, "Esci")));
}
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/rider/src/10-screens.jsx", error: String((e && e.message) || e) }); }

// ui_kits/rider/src/20-home.js
try { (() => {
// ===== Home (online toggle + active + available + prep) =====
function Home({
  online,
  onToggle,
  active,
  onOpenActive,
  onClaim
}) {
  const r = window.RD_RIDER,
    k = window.RD_KPI;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      paddingBottom: '20px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '8px 20px 14px',
      display: 'flex',
      alignItems: 'center',
      gap: '12px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '44px',
      height: '44px',
      borderRadius: '50%',
      background: 'linear-gradient(135deg, var(--primary-500), var(--primary-700))',
      color: '#fff',
      fontWeight: 700,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, r.initials), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontWeight: 700,
      color: 'var(--ink-900)',
      fontSize: '15px'
    }
  }, "Ciao, ", r.name.split(' ')[0]), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '12px',
      color: 'var(--ink-500)',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "star",
    size: 12,
    color: "var(--accent-500)"
  }), " ", String(r.rating).replace('.', ','), " \xB7 ", r.deliveries, " consegne"))), /*#__PURE__*/React.createElement("div", {
    style: {
      margin: '0 16px 16px',
      borderRadius: 'var(--radius-2xl)',
      padding: '18px 20px',
      background: online ? 'linear-gradient(135deg, var(--olive-600), var(--olive-700))' : 'var(--surface-0)',
      border: online ? 'none' : '1px solid var(--cream-300)',
      color: online ? '#fff' : 'var(--ink-900)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      boxShadow: online ? 'var(--shadow-warm)' : 'none'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontWeight: 800,
      fontSize: '18px',
      fontFamily: 'var(--font-serif)'
    }
  }, online ? 'Sei online' : 'Sei offline'), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 0',
      fontSize: '12px',
      opacity: online ? 0.85 : 0.6,
      color: online ? '#fff' : 'var(--ink-500)'
    }
  }, online ? 'Ricevi le consegne disponibili' : 'Vai online per iniziare')), /*#__PURE__*/React.createElement("button", {
    onClick: onToggle,
    "aria-label": "Toggle online",
    style: {
      border: 0,
      cursor: 'pointer',
      width: '58px',
      height: '32px',
      borderRadius: '999px',
      background: online ? 'rgba(255,255,255,.3)' : 'var(--cream-300)',
      position: 'relative',
      transition: 'background var(--dur-base)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      top: '3px',
      left: online ? '29px' : '3px',
      width: '26px',
      height: '26px',
      borderRadius: '50%',
      background: '#fff',
      transition: 'left var(--dur-base)',
      boxShadow: 'var(--shadow-sm)'
    }
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr 1fr',
      gap: '8px',
      margin: '0 16px 18px'
    }
  }, [['Oggi', fmt(k.todayEarned)], ['Consegne', k.todayDeliveries], ['Online', `${k.onlineHours}h`]].map(([l, v]) => /*#__PURE__*/React.createElement("div", {
    key: l,
    style: {
      background: 'var(--surface-0)',
      border: '1px solid var(--cream-300)',
      borderRadius: 'var(--radius-lg)',
      padding: '10px 12px',
      textAlign: 'center'
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '17px',
      fontWeight: 800,
      color: 'var(--ink-900)'
    }
  }, v), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '10px',
      color: 'var(--ink-400)',
      textTransform: 'uppercase',
      letterSpacing: '0.03em',
      fontWeight: 700
    }
  }, l)))), active && /*#__PURE__*/React.createElement("div", {
    style: {
      margin: '0 16px 18px'
    }
  }, /*#__PURE__*/React.createElement(SectionLabel, null, "La tua consegna"), /*#__PURE__*/React.createElement("button", {
    onClick: onOpenActive,
    style: {
      width: '100%',
      textAlign: 'left',
      border: '2px solid var(--accent-400)',
      background: 'var(--surface-0)',
      borderRadius: 'var(--radius-xl)',
      padding: '16px',
      cursor: 'pointer',
      fontFamily: 'var(--font-sans)',
      boxShadow: 'var(--shadow-warm)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: '10px'
    }
  }, /*#__PURE__*/React.createElement(OrderStatusBadge, {
    status: active.status,
    size: "sm"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: '11px',
      color: 'var(--ink-400)'
    }
  }, "#", active.id)), /*#__PURE__*/React.createElement(DeliveryRoute, {
    store: active.store,
    cust: active.custAddr
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: '12px',
      paddingTop: '12px',
      borderTop: '1px solid var(--cream-200)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '13px',
      color: 'var(--ink-500)'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "navigation",
    size: 13,
    color: "var(--ink-400)",
    style: {
      verticalAlign: 'middle',
      marginRight: '4px'
    }
  }), active.distance, " \xB7 ", active.eta), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      color: 'var(--primary-700)',
      fontWeight: 700,
      fontSize: '14px'
    }
  }, "Continua ", /*#__PURE__*/React.createElement(Lucide, {
    name: "arrow-right",
    size: 16,
    color: "var(--primary-700)"
  }))))), online ? /*#__PURE__*/React.createElement("div", {
    style: {
      margin: '0 16px'
    }
  }, /*#__PURE__*/React.createElement(SectionLabel, null, "Ordini disponibili (", window.RD_AVAILABLE.length, ")"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '10px'
    }
  }, window.RD_AVAILABLE.map(o => /*#__PURE__*/React.createElement("div", {
    key: o.id,
    style: {
      background: 'var(--surface-0)',
      border: '1px solid var(--cream-300)',
      borderRadius: 'var(--radius-xl)',
      padding: '14px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: '8px'
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    variant: "new",
    icon: "package"
  }, "Pronto"), o.pay === 'cod' && /*#__PURE__*/React.createElement(Badge, {
    variant: "cod",
    icon: "banknote"
  }, "Contanti")), /*#__PURE__*/React.createElement(DeliveryRoute, {
    store: o.store,
    cust: o.custAddr,
    small: true
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: '12px'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '11px',
      color: 'var(--ink-400)'
    }
  }, "Compenso \xB7 ", o.distance), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontWeight: 800,
      color: 'var(--olive-700)',
      fontSize: '18px'
    }
  }, fmt(o.fee))), /*#__PURE__*/React.createElement(Button, {
    variant: "accent",
    onClick: () => onClaim(o)
  }, "Accetta"))))), window.RD_PREP.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: '18px'
    }
  }, /*#__PURE__*/React.createElement(SectionLabel, null, "In preparazione \xB7 attendi"), window.RD_PREP.map(o => /*#__PURE__*/React.createElement("div", {
    key: o.id,
    style: {
      background: 'var(--surface-0)',
      border: '1px solid var(--cream-300)',
      borderRadius: 'var(--radius-xl)',
      padding: '14px',
      opacity: 0.75,
      marginBottom: '10px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: '8px'
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    variant: "local",
    icon: "chef-hat"
  }, "In preparazione"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 700,
      color: 'var(--olive-700)'
    }
  }, fmt(o.fee))), /*#__PURE__*/React.createElement(DeliveryRoute, {
    store: o.store,
    cust: o.custAddr,
    small: true
  }))))) : /*#__PURE__*/React.createElement("div", {
    style: {
      margin: '0 16px',
      padding: '32px 20px',
      textAlign: 'center',
      background: 'var(--surface-0)',
      border: '1px solid var(--cream-300)',
      borderRadius: 'var(--radius-xl)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '56px',
      height: '56px',
      borderRadius: '50%',
      background: 'var(--olive-50)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: '12px'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "power",
    size: 26,
    color: "var(--olive-600)"
  })), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, "Sei offline"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '4px 0 0',
      fontSize: '13px',
      color: 'var(--ink-500)'
    }
  }, "Vai online per vedere gli ordini disponibili nella tua zona.")));
}
function SectionLabel({
  children
}) {
  return /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '0 0 10px',
      fontSize: '13px',
      fontWeight: 700,
      color: 'var(--ink-700)',
      textTransform: 'uppercase',
      letterSpacing: '0.03em'
    }
  }, children);
}
function DeliveryRoute({
  store,
  cust,
  small
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: small ? '6px' : '8px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '24px',
      height: '24px',
      borderRadius: '50%',
      background: 'var(--primary-100)',
      color: 'var(--primary-700)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "store",
    size: 13,
    color: "var(--primary-700)"
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '14px',
      fontWeight: 600,
      color: 'var(--ink-900)'
    }
  }, store)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '24px',
      height: '24px',
      borderRadius: '50%',
      background: 'var(--olive-100)',
      color: 'var(--olive-700)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "map-pin",
    size: 13,
    color: "var(--olive-700)"
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '13px',
      color: 'var(--ink-600)'
    }
  }, cust)));
}
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/rider/src/20-home.js", error: String((e && e.message) || e) }); }

// ui_kits/rider/src/30-delivery.js
try { (() => {
// ===== Live delivery (full-screen flow over the phone content) =====
const RD_FLOW = ['ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED'];
const RD_ACTION = {
  ASSIGNED: {
    label: 'Sono al negozio · ritira',
    icon: 'package',
    sub: 'Vai al negozio a ritirare l’ordine'
  },
  PICKED_UP: {
    label: 'Inizia la consegna',
    icon: 'bike',
    sub: 'Ordine ritirato, vai dal cliente'
  },
  OUT_FOR_DELIVERY: {
    label: 'Consegnato',
    icon: 'check',
    sub: 'Sei arrivato dal cliente'
  }
};
function LiveDelivery({
  order,
  onAdvance,
  onClose
}) {
  const o = order;
  const stepIdx = RD_FLOW.indexOf(o.status);
  const action = RD_ACTION[o.status];
  const done = o.status === 'DELIVERED';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      inset: 0,
      top: '44px',
      background: 'var(--surface-50)',
      zIndex: 20,
      display: 'flex',
      flexDirection: 'column',
      animation: 'mc-slide-up var(--dur-medium) var(--ease-out-quint)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      height: '220px',
      flexShrink: 0,
      background: 'linear-gradient(135deg, var(--olive-100), var(--cream-200))',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    "aria-hidden": true,
    style: {
      position: 'absolute',
      inset: 0,
      backgroundImage: 'repeating-linear-gradient(0deg, rgba(28,26,24,.05) 0 1px, transparent 1px 28px), repeating-linear-gradient(90deg, rgba(28,26,24,.05) 0 1px, transparent 1px 28px)'
    }
  }), /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 390 220",
    style: {
      position: 'absolute',
      inset: 0,
      width: '100%',
      height: '100%'
    }
  }, /*#__PURE__*/React.createElement("path", {
    d: "M70 180 Q 140 120 200 130 T 320 60",
    fill: "none",
    stroke: "var(--primary-600)",
    strokeWidth: "4",
    strokeLinecap: "round",
    strokeDasharray: "2 10"
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      left: '60px',
      top: '168px',
      width: '28px',
      height: '28px',
      borderRadius: '50%',
      background: 'var(--primary-700)',
      border: '3px solid #fff',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: 'var(--shadow-warm)'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "store",
    size: 14,
    color: "#fff"
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      left: '306px',
      top: '46px',
      width: '28px',
      height: '28px',
      borderRadius: '50%',
      background: 'var(--olive-600)',
      border: '3px solid #fff',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: 'var(--shadow-warm)'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "map-pin",
    size: 14,
    color: "#fff"
  })), /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    "aria-label": "Chiudi",
    style: {
      position: 'absolute',
      top: '12px',
      left: '12px',
      width: '36px',
      height: '36px',
      borderRadius: '50%',
      border: 0,
      background: 'rgba(255,255,255,.95)',
      boxShadow: 'var(--shadow-sm)',
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "chevron-down",
    size: 20,
    color: "var(--ink-700)"
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      top: '14px',
      right: '14px',
      background: 'rgba(28,26,24,.82)',
      color: '#fff',
      fontSize: '12px',
      fontWeight: 600,
      padding: '6px 12px',
      borderRadius: '999px'
    }
  }, o.distance, " \xB7 ", o.eta)), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflowY: 'auto',
      padding: '18px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: '14px'
    }
  }, /*#__PURE__*/React.createElement(OrderStatusBadge, {
    status: o.status
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: '12px',
      color: 'var(--ink-400)'
    }
  }, "#", o.id)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
      marginBottom: '18px'
    }
  }, RD_FLOW.map((s, i) => /*#__PURE__*/React.createElement("div", {
    key: s,
    style: {
      flex: 1,
      height: '5px',
      borderRadius: '999px',
      background: i <= stepIdx ? 'var(--olive-500)' : 'var(--cream-300)'
    }
  }))), !done && /*#__PURE__*/React.createElement(Card, {
    variant: "elevated",
    padding: "lg",
    style: {
      marginBottom: '14px'
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '0 0 4px',
      fontSize: '12px',
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '0.03em',
      color: 'var(--ink-400)'
    }
  }, stepIdx === 0 ? 'Ritira al negozio' : 'Consegna al cliente'), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-serif)',
      fontSize: '20px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, stepIdx === 0 ? o.store : o.cust), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 12px',
      fontSize: '14px',
      color: 'var(--ink-600)'
    }
  }, stepIdx === 0 ? o.storeAddr : o.custAddr), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: '8px'
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "sm",
    icon: "navigation",
    fullWidth: true
  }, "Naviga"), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "sm",
    icon: "phone",
    fullWidth: true
  }, "Chiama"))), /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "md",
    style: {
      marginBottom: '14px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      fontSize: '14px',
      marginBottom: '6px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--ink-500)'
    }
  }, "Articoli"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 600,
      color: 'var(--ink-900)'
    }
  }, o.items, " prodotti")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      fontSize: '14px',
      marginBottom: '6px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--ink-500)'
    }
  }, "Il tuo compenso"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 700,
      color: 'var(--olive-700)'
    }
  }, fmt(o.fee))), o.pay === 'cod' && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      marginTop: '10px',
      padding: '10px 12px',
      background: 'var(--accent-100)',
      borderRadius: 'var(--radius-md)'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "banknote",
    size: 18,
    color: "var(--accent-800)"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '13px',
      color: 'var(--accent-900)'
    }
  }, "Incassa ", /*#__PURE__*/React.createElement("strong", null, fmt(o.total)), " in contanti dal cliente."))), done && /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'center',
      padding: '20px 0'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '64px',
      height: '64px',
      borderRadius: '50%',
      background: 'var(--olive-100)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: '12px'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "check",
    size: 32,
    stroke: 3,
    color: "var(--olive-700)"
  })), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-serif)',
      fontSize: '22px',
      fontWeight: 800,
      color: 'var(--ink-900)'
    }
  }, "Consegna completata!"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '4px 0 0',
      fontSize: '14px',
      color: 'var(--ink-500)'
    }
  }, "Hai guadagnato ", fmt(o.fee), o.pay === 'cod' ? ` + ${fmt(o.total)} contanti incassati` : '', "."))), /*#__PURE__*/React.createElement("div", {
    style: {
      flexShrink: 0,
      padding: '14px 18px 24px',
      borderTop: '1px solid var(--cream-200)',
      background: 'var(--surface-0)'
    }
  }, done ? /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    size: "lg",
    fullWidth: true,
    onClick: onClose
  }, "Torna alle consegne") : /*#__PURE__*/React.createElement(Button, {
    variant: o.status === 'OUT_FOR_DELIVERY' ? 'success' : 'primary',
    size: "lg",
    fullWidth: true,
    icon: action.icon,
    onClick: () => onAdvance(o)
  }, action.label)));
}
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/rider/src/30-delivery.js", error: String((e && e.message) || e) }); }

// ui_kits/rider/src/40-screens.js
try { (() => {
// ===== Earnings · Availability · Profile =====
function Earnings() {
  const [period, setPeriod] = React.useState('7d');
  const periods = [['today', 'Oggi'], ['7d', '7 giorni'], ['30d', '30 giorni'], ['all', 'Tutto']];
  const k = window.RD_KPI,
    e7 = window.RD_EARN_7D,
    max = Math.max(...e7);
  const days = ['L', 'M', 'M', 'G', 'V', 'S', 'D'];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      paddingBottom: '20px'
    }
  }, /*#__PURE__*/React.createElement(ScreenHead, {
    title: "Guadagni",
    sub: "Tutto quello che hai incassato"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: '6px',
      padding: '0 16px 14px',
      overflowX: 'auto'
    }
  }, periods.map(([id, l]) => /*#__PURE__*/React.createElement("button", {
    key: id,
    onClick: () => setPeriod(id),
    style: {
      flexShrink: 0,
      border: 0,
      background: period === id ? 'var(--accent-500)' : 'var(--surface-0)',
      color: period === id ? 'var(--ink-900)' : 'var(--ink-600)',
      fontWeight: 600,
      fontSize: '13px',
      padding: '7px 14px',
      borderRadius: '999px',
      cursor: 'pointer',
      fontFamily: 'var(--font-sans)',
      boxShadow: period === id ? 'none' : 'inset 0 0 0 1px var(--cream-300)'
    }
  }, l))), /*#__PURE__*/React.createElement("div", {
    style: {
      margin: '0 16px 16px',
      borderRadius: 'var(--radius-2xl)',
      padding: '22px',
      background: 'linear-gradient(135deg, var(--accent-100), var(--cream-200))',
      border: '1px solid var(--accent-200)'
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '11px',
      fontWeight: 800,
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      color: 'var(--accent-800)'
    }
  }, "Hai guadagnato"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '4px 0 0',
      fontSize: '46px',
      fontWeight: 800,
      color: 'var(--ink-900)',
      lineHeight: 1
    }
  }, fmt(k.weekEarned)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '10px',
      marginTop: '16px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'rgba(255,255,255,.6)',
      borderRadius: 'var(--radius-md)',
      padding: '10px 12px'
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '10px',
      textTransform: 'uppercase',
      color: 'var(--ink-500)',
      fontWeight: 700
    }
  }, "Consegne"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '20px',
      fontWeight: 800,
      color: 'var(--ink-900)'
    }
  }, k.weekDeliveries)), /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'rgba(255,255,255,.6)',
      borderRadius: 'var(--radius-md)',
      padding: '10px 12px'
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '10px',
      textTransform: 'uppercase',
      color: 'var(--ink-500)',
      fontWeight: 700
    }
  }, "Media/consegna"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '20px',
      fontWeight: 800,
      color: 'var(--ink-900)'
    }
  }, fmt(k.avgPerDelivery))))), /*#__PURE__*/React.createElement("div", {
    style: {
      margin: '0 16px 16px'
    }
  }, /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "md"
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '0 0 14px',
      fontWeight: 700,
      color: 'var(--ink-900)',
      fontSize: '14px'
    }
  }, "Ultimi 7 giorni"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-end',
      gap: '8px',
      height: '110px'
    }
  }, e7.map((v, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '6px',
      height: '100%'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      width: '100%',
      display: 'flex',
      alignItems: 'flex-end'
    }
  }, /*#__PURE__*/React.createElement("div", {
    title: fmt(v),
    style: {
      width: '100%',
      height: `${v / max * 100}%`,
      minHeight: '5px',
      background: 'linear-gradient(180deg, var(--accent-400), var(--accent-600))',
      borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0'
    }
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '10px',
      color: 'var(--ink-400)'
    }
  }, days[i])))))), /*#__PURE__*/React.createElement("div", {
    style: {
      margin: '0 16px'
    }
  }, /*#__PURE__*/React.createElement(Card, {
    variant: "flat",
    padding: "md",
    style: {
      background: 'var(--olive-50)',
      border: '1px solid var(--olive-200)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: '10px',
      alignItems: 'flex-start'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "landmark",
    size: 18,
    color: "var(--olive-700)"
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '13px',
      fontWeight: 700,
      color: 'var(--olive-900)'
    }
  }, "Compensi sul tuo IBAN"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 0',
      fontSize: '12px',
      color: 'var(--olive-800)',
      lineHeight: 1.5
    }
  }, "Le consegne con carta vengono versate ~24h dopo. I contanti li incassi direttamente alla consegna."))))), /*#__PURE__*/React.createElement("div", {
    style: {
      margin: '16px 16px 0'
    }
  }, /*#__PURE__*/React.createElement(SectionLabel, null, "Storico consegne"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '8px'
    }
  }, window.RD_HISTORY.map(h => /*#__PURE__*/React.createElement("div", {
    key: h.id,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      background: 'var(--surface-0)',
      border: '1px solid var(--cream-300)',
      borderRadius: 'var(--radius-lg)',
      padding: '12px 14px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '36px',
      height: '36px',
      borderRadius: '50%',
      background: 'var(--olive-50)',
      color: 'var(--olive-700)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "check",
    size: 17,
    stroke: 2.4,
    color: "var(--olive-700)"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '13px',
      fontWeight: 600,
      color: 'var(--ink-900)'
    }
  }, h.store, " \u2192 ", h.cust), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '11px',
      color: 'var(--ink-400)'
    }
  }, h.when, " \xB7 ", h.pay === 'cod' ? 'Contanti' : 'Carta')), /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 700,
      color: 'var(--olive-700)'
    }
  }, fmt(h.fee)))))));
}
function Availability({
  online,
  onToggle
}) {
  const [zones, setZones] = React.useState(window.RD_ZONES);
  const toggleZone = i => setZones(z => z.map((x, j) => j === i ? {
    ...x,
    on: !x.on
  } : x));
  return /*#__PURE__*/React.createElement("div", {
    style: {
      paddingBottom: '20px'
    }
  }, /*#__PURE__*/React.createElement(ScreenHead, {
    title: "Turni & zone",
    sub: "Quando e dove vuoi consegnare"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      margin: '0 16px 16px'
    }
  }, /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "md"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, "Stato"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '13px',
      color: 'var(--ink-500)'
    }
  }, online ? 'Online · ricevi consegne' : 'Offline')), /*#__PURE__*/React.createElement("button", {
    onClick: onToggle,
    style: {
      border: 0,
      cursor: 'pointer',
      width: '52px',
      height: '30px',
      borderRadius: '999px',
      background: online ? 'var(--olive-500)' : 'var(--cream-300)',
      position: 'relative'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      top: '3px',
      left: online ? '25px' : '3px',
      width: '24px',
      height: '24px',
      borderRadius: '50%',
      background: '#fff',
      transition: 'left var(--dur-base)',
      boxShadow: 'var(--shadow-sm)'
    }
  }))))), /*#__PURE__*/React.createElement("div", {
    style: {
      margin: '0 16px 16px'
    }
  }, /*#__PURE__*/React.createElement(SectionLabel, null, "Zone preferite"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '-4px 0 12px',
      fontSize: '12px',
      color: 'var(--ink-500)'
    }
  }, "Ricevi prima le consegne in queste zone."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '8px'
    }
  }, zones.map((z, i) => /*#__PURE__*/React.createElement("button", {
    key: z.name,
    onClick: () => toggleZone(i),
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      background: 'var(--surface-0)',
      border: `1.5px solid ${z.on ? 'var(--primary-400)' : 'var(--cream-300)'}`,
      borderRadius: 'var(--radius-lg)',
      padding: '12px 14px',
      cursor: 'pointer',
      fontFamily: 'var(--font-sans)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px',
      fontSize: '14px',
      fontWeight: 600,
      color: 'var(--ink-900)'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "map-pin",
    size: 15,
    color: z.on ? 'var(--primary-600)' : 'var(--ink-400)'
  }), " ", z.name), /*#__PURE__*/React.createElement(Lucide, {
    name: z.on ? 'check-circle-2' : 'circle',
    size: 20,
    color: z.on ? 'var(--primary-600)' : 'var(--ink-300)'
  }))))), /*#__PURE__*/React.createElement("div", {
    style: {
      margin: '0 16px'
    }
  }, /*#__PURE__*/React.createElement(SectionLabel, null, "Orari di punta"), /*#__PURE__*/React.createElement(Card, {
    variant: "flat",
    padding: "md",
    style: {
      background: 'var(--primary-50)',
      border: '1px solid var(--primary-100)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: '10px',
      alignItems: 'flex-start'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "trending-up",
    size: 18,
    color: "var(--primary-700)"
  }), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '13px',
      color: 'var(--primary-900)',
      lineHeight: 1.5
    }
  }, "Pi\xF9 consegne tra le ", /*#__PURE__*/React.createElement("strong", null, "12\u201314"), " e le ", /*#__PURE__*/React.createElement("strong", null, "19\u201321"), ". Tieni la disponibilit\xE0 ON nei picchi per guadagnare di pi\xF9.")))));
}
function Profile() {
  const r = window.RD_RIDER;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      paddingBottom: '20px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '24px 20px',
      textAlign: 'center',
      background: 'linear-gradient(135deg, var(--primary-700), var(--secondary-700))',
      color: '#fff'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '72px',
      height: '72px',
      borderRadius: '50%',
      background: 'rgba(255,255,255,.18)',
      border: '3px solid rgba(255,255,255,.3)',
      color: '#fff',
      fontWeight: 800,
      fontSize: '26px',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, r.initials), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '12px 0 0',
      fontFamily: 'var(--font-serif)',
      fontSize: '22px',
      fontWeight: 800
    }
  }, r.name), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 0',
      fontSize: '13px',
      opacity: 0.85,
      display: 'inline-flex',
      alignItems: 'center',
      gap: '5px'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "star",
    size: 14,
    color: "var(--accent-300)"
  }), " ", String(r.rating).replace('.', ','), " \xB7 ", r.deliveries, " consegne")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '10px',
      padding: '16px'
    }
  }, /*#__PURE__*/React.createElement(InfoTile, {
    icon: "bike",
    label: "Veicolo",
    value: r.vehicle
  }), /*#__PURE__*/React.createElement(InfoTile, {
    icon: "map-pin",
    label: "Zona base",
    value: r.zone
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '0 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: '2px'
    }
  }, [['user', 'Dati personali'], ['landmark', 'IBAN e compensi'], ['bell', 'Notifiche'], ['shield-check', 'Documenti'], ['life-buoy', 'Assistenza'], ['log-out', 'Esci']].map(([ic, l]) => /*#__PURE__*/React.createElement("button", {
    key: l,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      border: 0,
      borderBottom: '1px solid var(--cream-200)',
      background: 'transparent',
      padding: '14px 4px',
      cursor: 'pointer',
      fontFamily: 'var(--font-sans)',
      fontSize: '15px',
      color: l === 'Esci' ? 'var(--secondary-600)' : 'var(--ink-800)',
      textAlign: 'left',
      width: '100%'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: ic,
    size: 19,
    color: l === 'Esci' ? 'var(--secondary-600)' : 'var(--ink-500)'
  }), " ", /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }, l), l !== 'Esci' && /*#__PURE__*/React.createElement(Lucide, {
    name: "chevron-right",
    size: 17,
    color: "var(--ink-300)"
  })))));
}
function InfoTile({
  icon,
  label,
  value
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--surface-0)',
      border: '1px solid var(--cream-300)',
      borderRadius: 'var(--radius-lg)',
      padding: '14px'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: icon,
    size: 18,
    color: "var(--primary-600)"
  }), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '8px 0 0',
      fontSize: '11px',
      color: 'var(--ink-400)',
      textTransform: 'uppercase',
      fontWeight: 700
    }
  }, label), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 0',
      fontSize: '14px',
      fontWeight: 600,
      color: 'var(--ink-900)'
    }
  }, value));
}
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/rider/src/40-screens.js", error: String((e && e.message) || e) }); }

// ui_kits/rider/src/90-app.js
try { (() => {
// ===== Rider app shell =====
function App() {
  const [tab, setTab] = React.useState('home');
  const [online, setOnline] = React.useState(true);
  const [active, setActive] = React.useState(window.RD_ACTIVE);
  const [live, setLive] = React.useState(false);
  function advance(o) {
    const i = RD_FLOW.indexOf(o.status);
    const next = RD_FLOW[i + 1];
    if (!next) {
      setLive(false);
      setActive(null);
      setTab('home');
      return;
    }
    setActive({
      ...o,
      status: next
    });
  }
  function claim(o) {
    setActive({
      ...window.RD_ACTIVE,
      id: o.id,
      store: o.store,
      storeAddr: o.storeAddr,
      cust: o.cust,
      custAddr: o.custAddr,
      fee: o.fee,
      pay: o.pay,
      items: o.items,
      distance: o.distance,
      status: 'ASSIGNED'
    });
    setLive(true);
  }
  return /*#__PURE__*/React.createElement(Phone, {
    tab: tab,
    onTab: t => {
      setTab(t);
    }
  }, tab === 'home' && /*#__PURE__*/React.createElement(Home, {
    online: online,
    onToggle: () => setOnline(v => !v),
    active: active,
    onOpenActive: () => setLive(true),
    onClaim: claim
  }), tab === 'earnings' && /*#__PURE__*/React.createElement(Earnings, null), tab === 'availability' && /*#__PURE__*/React.createElement(Availability, {
    online: online,
    onToggle: () => setOnline(v => !v)
  }), tab === 'profile' && /*#__PURE__*/React.createElement(Profile, null), live && active && /*#__PURE__*/React.createElement(LiveDelivery, {
    order: active,
    onAdvance: advance,
    onClose: () => setLive(false)
  }));
}
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/rider/src/90-app.js", error: String((e && e.message) || e) }); }

// ui_kits/rider/src/90-app.jsx
try { (() => {
// ===== Rider app shell =====
function App() {
  const [tab, setTab] = React.useState('home');
  const [online, setOnline] = React.useState(window.RD_TODAY.online);
  const [active, setActive] = React.useState(null); // active delivery object
  const [step, setStep] = React.useState(0);
  const [inDelivery, setInDelivery] = React.useState(false);
  function startDelivery(o) {
    setActive(o);
    setStep(0);
    setInDelivery(true);
  }
  function openActive() {
    if (active) setInDelivery(true);
  }
  function advance() {
    setStep(s => {
      const next = s + 1;
      if (next > window.RD_STEPS.length - 1) return next; // shows done state
      return next;
    });
  }
  function finishDelivery() {
    setInDelivery(false);
    setActive(null);
    setStep(0);
    setTab('home');
  }
  const dark = tab === 'profilo';
  return /*#__PURE__*/React.createElement(PhoneFrame, null, /*#__PURE__*/React.createElement("div", {
    style: {
      background: dark ? 'var(--primary-700)' : 'var(--surface-50)',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement(StatusBar, {
    dark: dark || inDelivery
  })), inDelivery && active ? /*#__PURE__*/React.createElement(DeliveryScreen, {
    delivery: active,
    step: step,
    onAdvance: advance,
    onBack: step > window.RD_STEPS.length - 1 ? finishDelivery : () => setInDelivery(false)
  }) : /*#__PURE__*/React.createElement(React.Fragment, null, tab === 'home' && /*#__PURE__*/React.createElement(HomeScreen, {
    online: online,
    onToggle: () => setOnline(v => !v),
    onStart: startDelivery,
    onOpenActive: openActive,
    active: active
  }), tab === 'guadagni' && /*#__PURE__*/React.createElement(EarningsScreen, null), tab === 'storico' && /*#__PURE__*/React.createElement(HistoryScreen, null), tab === 'profilo' && /*#__PURE__*/React.createElement(ProfileScreen, null), /*#__PURE__*/React.createElement(BottomTab, {
    active: tab,
    onNav: setTab
  })));
}
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/rider/src/90-app.jsx", error: String((e && e.message) || e) }); }

// ui_kits/rider/src/data.js
try { (() => {
// MyCity Rider — demo data (plain globals; loaded before app.js).
window.RD_RIDER = {
  name: 'Giulia Ferrari',
  initials: 'GF',
  rating: 4.8,
  deliveries: 312,
  vehicle: 'Bici elettrica',
  zone: 'Centro storico'
};
window.RD_KPI = {
  todayEarned: 24.5,
  todayDeliveries: 5,
  weekEarned: 184.3,
  weekDeliveries: 38,
  avgPerDelivery: 4.85,
  onlineHours: 6.5
};

// Consegne. status: il flusso rider ASSIGNED→PICKED_UP→OUT_FOR_DELIVERY→DELIVERED
window.RD_ACTIVE = {
  id: 'PCD4P8',
  store: 'Salumeria Verdi',
  storeAddr: 'Via Roma 18, Centro',
  storeInitials: 'SV',
  cust: 'Davide Neri',
  custAddr: 'Stradone Farnese 22',
  custPhone: '+39 333 98 76 543',
  status: 'ASSIGNED',
  fee: 4.9,
  pay: 'cod',
  total: 35.6,
  items: 4,
  distance: '1,2 km',
  eta: '8 min'
};
window.RD_AVAILABLE = [{
  id: 'PCC7M2',
  store: 'Salumeria Verdi',
  storeAddr: 'Via Roma 18',
  cust: 'Anna Conti',
  custAddr: 'Via Borghetto 5, Centro',
  fee: 4.9,
  status: 'READY',
  distance: '0,8 km',
  items: 1,
  pay: 'card'
}, {
  id: 'PCJ5N3',
  store: 'Pasta Fresca Anita',
  storeAddr: 'Via Borgo 9',
  cust: 'Marco Galli',
  custAddr: 'Via Taverna 14, Centro',
  fee: 5.4,
  status: 'READY',
  distance: '1,5 km',
  items: 3,
  pay: 'cod'
}, {
  id: 'PCK8M1',
  store: 'Forno Borgo',
  storeAddr: 'Via Borgo 2',
  cust: 'Elena Vitali',
  custAddr: 'Via Alberoni 17',
  fee: 4.5,
  status: 'READY',
  distance: '2,1 km',
  items: 2,
  pay: 'cod'
}];
window.RD_PREP = [{
  id: 'PCB2K9',
  store: 'Salumeria Verdi',
  cust: 'Marco Rossi',
  custAddr: 'Via Cavour 48',
  fee: 4.9,
  status: 'ACCEPTED',
  distance: '1,0 km',
  items: 2
}];
window.RD_HISTORY = [{
  id: 'PCF3T6',
  store: 'Salumeria Verdi',
  cust: 'Paolo Ferri',
  when: 'Oggi 13:20',
  fee: 4.9,
  pay: 'cod'
}, {
  id: 'PCG8W4',
  store: 'Pasta Fresca Anita',
  cust: 'Sara Galli',
  when: 'Oggi 12:05',
  fee: 5.4,
  pay: 'card'
}, {
  id: 'PCH2A1',
  store: 'Forno Borgo',
  cust: 'Luca Moretti',
  when: 'Oggi 11:10',
  fee: 4.5,
  pay: 'cod'
}, {
  id: 'PCK19B',
  store: 'Salumeria Verdi',
  cust: 'Anna Conti',
  when: 'Ieri 19:40',
  fee: 4.9,
  pay: 'card'
}, {
  id: 'PCK08C',
  store: 'Cantina Pace',
  cust: 'Davide Neri',
  when: 'Ieri 18:15',
  fee: 5.8,
  pay: 'cod'
}];
window.RD_EARN_7D = [18.5, 24.0, 12.5, 28.4, 22.0, 31.5, 24.5];
window.RD_ZONES = [{
  name: 'Centro storico',
  on: true
}, {
  name: 'Borgo',
  on: true
}, {
  name: 'Farnesiana',
  on: false
}, {
  name: 'Besurica',
  on: false
}];
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/rider/src/data.js", error: String((e && e.message) || e) }); }

// ui_kits/seller/app.js
try { (() => {
/* AUTO-GENERATED from ui_kits/seller/src/*.js (numeric order). Do not edit directly. */
// ===== Shared (concat first) =====
const {
  Button,
  Badge,
  Card,
  OrderStatusBadge,
  Modal,
  EmptyState,
  Input,
  Select,
  Checkbox
} = window.MyCityDesignSystem_105480;
const fmt = n => new Intl.NumberFormat('it-IT', {
  style: 'currency',
  currency: 'EUR'
}).format(n);
const img = (kw, lock) => `https://loremflickr.com/640/640/${kw}?lock=${lock}`;
const initials = name => (name || '').trim().split(/\s+/).map(w => w[0] || '').slice(0, 2).join('').toUpperCase();
function Lucide({
  name,
  size = 20,
  stroke = 2,
  color,
  style
}) {
  return /*#__PURE__*/React.createElement("i", {
    "data-lucide": name,
    ref: el => {
      if (el && window.lucide) try {
        window.lucide.createIcons({
          attrs: {
            width: size,
            height: size,
            'stroke-width': stroke
          }
        });
      } catch (e) {}
    },
    style: {
      width: size,
      height: size,
      display: 'inline-flex',
      color,
      flexShrink: 0,
      ...style
    }
  });
}
function Stars({
  value = 5,
  size = 14
}) {
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      gap: '1px'
    }
  }, [1, 2, 3, 4, 5].map(i => /*#__PURE__*/React.createElement("svg", {
    key: i,
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: i <= Math.round(value) ? 'var(--accent-500)' : 'var(--cream-300)'
  }, /*#__PURE__*/React.createElement("path", {
    d: "M12 2l2.9 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l7.1-1.01L12 2z"
  }))));
}
const TINT = {
  primary: ['var(--primary-100)', 'var(--primary-700)'],
  olive: ['var(--olive-100)', 'var(--olive-700)'],
  accent: ['var(--accent-100)', 'var(--accent-700)'],
  secondary: ['var(--secondary-100)', 'var(--secondary-600)']
};
function PageTitle({
  title,
  sub,
  action
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      gap: '16px',
      flexWrap: 'wrap',
      marginBottom: '20px'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-serif)',
      fontSize: '30px',
      fontWeight: 800,
      color: 'var(--ink-900)'
    }
  }, title), sub && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '4px 0 0',
      fontSize: '14px',
      color: 'var(--ink-500)'
    }
  }, sub)), action);
}

// ===== Seller shell (sidebar + topbar) =====
const SC_NAV = [{
  id: 'dashboard',
  icon: 'layout-dashboard',
  label: 'Dashboard'
}, {
  id: 'orders',
  icon: 'receipt',
  label: 'Ordini',
  badge: 'todo'
}, {
  id: 'products',
  icon: 'package',
  label: 'Prodotti'
}, {
  id: 'promotions',
  icon: 'tag',
  label: 'Promozioni'
}, {
  id: 'analytics',
  icon: 'bar-chart-3',
  label: 'Analisi'
}, {
  id: 'customers',
  icon: 'users',
  label: 'Clienti'
}, {
  id: 'reviews',
  icon: 'star',
  label: 'Recensioni'
}, {
  id: 'earnings',
  icon: 'wallet',
  label: 'Guadagni'
}];
function SellerShell({
  view,
  onNav,
  onNewProduct,
  children
}) {
  const store = window.SC_STORE;
  const todo = window.SC_ORDERS.filter(o => ['NEW', 'ACCEPTED', 'READY'].includes(o.status)).length;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '248px 1fr',
      minHeight: '100vh',
      background: 'var(--cream-100)'
    }
  }, /*#__PURE__*/React.createElement("aside", {
    style: {
      background: 'var(--ink-900)',
      color: '#fff',
      display: 'flex',
      flexDirection: 'column',
      position: 'sticky',
      top: 0,
      height: '100vh'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '20px 20px 14px',
      borderBottom: '1px solid rgba(255,255,255,.1)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-serif)',
      fontSize: '22px',
      fontWeight: 800,
      letterSpacing: '-0.01em'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--accent-300)'
    }
  }, "My"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: '#fff'
    }
  }, "City"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: '11px',
      fontWeight: 700,
      color: 'var(--ink-300)',
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      marginLeft: '6px'
    }
  }, "Seller"))), /*#__PURE__*/React.createElement("nav", {
    style: {
      flex: 1,
      padding: '12px 12px',
      display: 'flex',
      flexDirection: 'column',
      gap: '2px',
      overflowY: 'auto'
    }
  }, SC_NAV.map(n => {
    const on = view === n.id;
    return /*#__PURE__*/React.createElement("button", {
      key: n.id,
      onClick: () => onNav(n.id),
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '11px',
        border: 0,
        background: on ? 'var(--primary-700)' : 'transparent',
        color: on ? '#fff' : 'rgba(255,255,255,.78)',
        fontWeight: on ? 700 : 500,
        fontSize: '14px',
        padding: '10px 12px',
        borderRadius: 'var(--radius-md)',
        cursor: 'pointer',
        fontFamily: 'var(--font-sans)',
        textAlign: 'left',
        width: '100%'
      }
    }, /*#__PURE__*/React.createElement(Lucide, {
      name: n.icon,
      size: 18,
      stroke: 2.2,
      color: on ? '#fff' : 'rgba(255,255,255,.7)'
    }), " ", n.label, n.badge === 'todo' && todo > 0 && /*#__PURE__*/React.createElement("span", {
      style: {
        marginLeft: 'auto',
        background: 'var(--accent-500)',
        color: 'var(--ink-900)',
        fontSize: '11px',
        fontWeight: 700,
        borderRadius: '999px',
        minWidth: '20px',
        height: '20px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 5px'
      }
    }, todo));
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '12px',
      borderTop: '1px solid rgba(255,255,255,.1)'
    }
  }, /*#__PURE__*/React.createElement("a", {
    href: "../buyer/index.html",
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      color: 'rgba(255,255,255,.7)',
      fontSize: '13px',
      padding: '8px 12px',
      textDecoration: 'none'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "external-link",
    size: 16,
    color: "rgba(255,255,255,.6)"
  }), " Vai al marketplace"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("header", {
    style: {
      position: 'sticky',
      top: 0,
      zIndex: 'var(--z-sticky)',
      background: 'var(--surface-0)',
      borderBottom: '1px solid var(--cream-300)',
      padding: '12px 28px',
      display: 'flex',
      alignItems: 'center',
      gap: '16px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      flex: 1,
      maxWidth: '420px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      left: '12px',
      top: '50%',
      transform: 'translateY(-50%)',
      pointerEvents: 'none'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "search",
    size: 17,
    color: "var(--ink-400)"
  })), /*#__PURE__*/React.createElement("input", {
    placeholder: "Cerca ordini, prodotti, clienti\u2026",
    style: {
      width: '100%',
      boxSizing: 'border-box',
      border: '1px solid var(--cream-300)',
      borderRadius: 'var(--radius-full)',
      padding: '9px 14px 9px 38px',
      fontSize: '14px',
      fontFamily: 'var(--font-sans)',
      outline: 'none',
      background: 'var(--cream-50)'
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginLeft: 'auto',
      display: 'flex',
      alignItems: 'center',
      gap: '12px'
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    size: "sm",
    icon: "plus",
    onClick: onNewProduct
  }, "Pubblica prodotto"), /*#__PURE__*/React.createElement("button", {
    style: {
      position: 'relative',
      border: 0,
      background: 'transparent',
      cursor: 'pointer',
      display: 'inline-flex',
      padding: '6px'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "bell",
    size: 20,
    color: "var(--ink-600)"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      top: '2px',
      right: '2px',
      width: '8px',
      height: '8px',
      borderRadius: '50%',
      background: 'var(--secondary-600)'
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '34px',
      height: '34px',
      borderRadius: '50%',
      background: 'linear-gradient(135deg, var(--primary-500), var(--primary-700))',
      color: '#fff',
      fontWeight: 700,
      fontSize: '13px',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, store.initials), /*#__PURE__*/React.createElement("div", {
    style: {
      lineHeight: 1.1
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '13px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, store.name), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '11px',
      color: 'var(--ink-400)'
    }
  }, store.area))))), /*#__PURE__*/React.createElement("main", {
    style: {
      flex: 1,
      padding: '28px',
      maxWidth: '1100px',
      width: '100%',
      boxSizing: 'border-box'
    }
  }, children)));
}

// ===== Dashboard =====
function Dashboard({
  onNav,
  onNewProduct
}) {
  const k = window.SC_KPI,
    store = window.SC_STORE;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '24px'
    }
  }, /*#__PURE__*/React.createElement("section", {
    style: {
      position: 'relative',
      overflow: 'hidden',
      borderRadius: 'var(--radius-2xl)',
      background: 'linear-gradient(135deg, var(--primary-700), var(--primary-600) 55%, var(--secondary-700))',
      color: '#fff',
      boxShadow: 'var(--shadow-warm-lg)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    "aria-hidden": true,
    style: {
      position: 'absolute',
      top: '-60px',
      right: '-40px',
      width: '260px',
      height: '260px',
      borderRadius: '50%',
      background: 'rgba(255,255,255,.1)',
      filter: 'blur(40px)'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      padding: '28px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '16px',
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '60px',
      height: '60px',
      borderRadius: 'var(--radius-xl)',
      background: 'rgba(255,255,255,.18)',
      border: '3px solid rgba(255,255,255,.25)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'var(--font-serif)',
      fontSize: '24px',
      fontWeight: 800
    }
  }, store.initials), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: '180px'
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '13px',
      color: 'rgba(255,255,255,.75)'
    }
  }, "Bentornato"), /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: '2px 0 0',
      fontFamily: 'var(--font-serif)',
      fontSize: '30px',
      fontWeight: 800,
      color: '#fff'
    }
  }, store.name), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      marginTop: '6px',
      fontSize: '12px',
      fontWeight: 600,
      background: 'rgba(90,124,66,.9)',
      color: '#fff',
      borderRadius: '999px',
      padding: '3px 10px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '6px',
      height: '6px',
      borderRadius: '50%',
      background: '#fff'
    }
  }), " Negozio attivo")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: '8px',
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    icon: "plus",
    onClick: onNewProduct
  }, "Pubblica prodotto"), /*#__PURE__*/React.createElement("button", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px',
      background: 'rgba(255,255,255,.15)',
      border: '1px solid rgba(255,255,255,.25)',
      color: '#fff',
      fontWeight: 600,
      padding: '10px 16px',
      borderRadius: 'var(--radius-md)',
      cursor: 'pointer',
      fontFamily: 'var(--font-sans)',
      fontSize: '14px'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "external-link",
    size: 16
  }), " Vetrina"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: '12px',
      marginTop: '22px'
    }
  }, [['Oggi', k.revenueToday, `${k.ordersToday} articoli`], ['7 giorni', k.revenue7, `${k.orders7} articoli`], ['30 giorni', k.revenue30, `${k.orders30} articoli`]].map(([l, v, s]) => /*#__PURE__*/React.createElement("div", {
    key: l,
    style: {
      borderRadius: 'var(--radius-xl)',
      background: 'rgba(255,255,255,.1)',
      border: '1px solid rgba(255,255,255,.15)',
      padding: '14px 16px'
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '11px',
      textTransform: 'uppercase',
      letterSpacing: '0.04em',
      color: 'rgba(255,255,255,.7)',
      fontWeight: 700
    }
  }, l), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '4px 0 0',
      fontSize: '24px',
      fontWeight: 800,
      lineHeight: 1
    }
  }, fmt(v)), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 0',
      fontSize: '11px',
      color: 'rgba(255,255,255,.6)'
    }
  }, s)))))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: '14px'
    }
  }, /*#__PURE__*/React.createElement(KpiCard, {
    icon: "trending-up",
    tone: "olive",
    value: fmt(k.revenueTotal),
    label: "Fatturato totale",
    hint: `${k.itemsSold} articoli venduti`
  }), /*#__PURE__*/React.createElement(KpiCard, {
    icon: "package",
    tone: "primary",
    value: k.productsAvailable,
    label: "Prodotti in vendita",
    hint: `su ${k.productsTotal} totali`
  }), /*#__PURE__*/React.createElement(KpiCard, {
    icon: "star",
    tone: "accent",
    value: `${k.avgRating.toFixed(1).replace('.', ',')} ★`,
    label: "Valutazione media",
    hint: `${k.reviewCount} recensioni`
  }), /*#__PURE__*/React.createElement(KpiCard, {
    icon: "receipt",
    tone: "secondary",
    value: k.itemsSold,
    label: "Articoli venduti",
    hint: "Dall'inizio"
  })), /*#__PURE__*/React.createElement(NavGroup, {
    title: "Vendite",
    hint: "Catalogo, ordini, marketing"
  }, /*#__PURE__*/React.createElement(NavTile, {
    icon: "package",
    title: "Prodotti",
    desc: "Catalogo e disponibilit\xE0",
    meta: `${window.SC_KPI.productsAvailable} in vendita`,
    onClick: () => onNav('products')
  }), /*#__PURE__*/React.createElement(NavTile, {
    icon: "receipt",
    title: "Ordini",
    desc: "Prepara e gestisci",
    onClick: () => onNav('orders')
  }), /*#__PURE__*/React.createElement(NavTile, {
    icon: "tag",
    title: "Promozioni",
    desc: "Sconti e offerte",
    onClick: () => onNav('promotions')
  }), /*#__PURE__*/React.createElement(NavTile, {
    icon: "bar-chart-3",
    title: "Analisi",
    desc: "Andamento e insight",
    onClick: () => onNav('analytics')
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '20px',
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "lg"
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: '0 0 6px',
      fontFamily: 'var(--font-serif)',
      fontSize: '18px',
      fontWeight: 700,
      color: 'var(--ink-900)',
      display: 'flex',
      alignItems: 'center',
      gap: '8px'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "activity",
    size: 19,
    color: "var(--olive-600)"
  }), " Salute del negozio"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '0 0 14px',
      fontSize: '13px',
      color: 'var(--ink-500)'
    }
  }, "Pi\xF9 \xE8 alto, pi\xF9 sei visibile nel marketplace."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '16px'
    }
  }, /*#__PURE__*/React.createElement(Ring, {
    value: store.healthScore
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      gap: '8px'
    }
  }, [['Catalogo completo', true], ['Risposte alle recensioni', true], ['Promo attiva', true], ['Foto di qualità', false]].map(([t, ok]) => /*#__PURE__*/React.createElement("span", {
    key: t,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px',
      fontSize: '13px',
      color: ok ? 'var(--ink-700)' : 'var(--ink-400)'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: ok ? 'check-circle-2' : 'circle',
    size: 15,
    color: ok ? 'var(--olive-600)' : 'var(--ink-300)'
  }), " ", t))))), /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "lg"
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: '0 0 6px',
      fontFamily: 'var(--font-serif)',
      fontSize: '18px',
      fontWeight: 700,
      color: 'var(--ink-900)',
      display: 'flex',
      alignItems: 'center',
      gap: '8px'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "megaphone",
    size: 19,
    color: "var(--accent-600)"
  }), " Fai crescere le vendite"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '0 0 14px',
      fontSize: '13px',
      color: 'var(--ink-500)'
    }
  }, "Tre mosse semplici per pi\xF9 clienti."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '4px'
    }
  }, /*#__PURE__*/React.createElement(TipRow, {
    icon: "tag",
    title: "Lancia una promo",
    desc: "Uno sconto a tempo crea urgenza.",
    onClick: () => onNav('promotions')
  }), /*#__PURE__*/React.createElement(TipRow, {
    icon: "camera",
    title: "Pubblica una storia",
    desc: "Le storie (24h) portano clienti.",
    onClick: () => onNav('products')
  }), /*#__PURE__*/React.createElement(TipRow, {
    icon: "share-2",
    title: "Condividi la vetrina",
    desc: "Manda il link a clienti e amici.",
    onClick: () => onNav('dashboard')
  })))));
}
function KpiCard({
  icon,
  tone,
  value,
  label,
  hint
}) {
  const [bg, fg] = TINT[tone];
  return /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "md"
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '40px',
      height: '40px',
      borderRadius: 'var(--radius-md)',
      background: bg,
      color: fg,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: icon,
    size: 20,
    stroke: 2.2,
    color: fg
  })), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '12px 0 0',
      fontSize: '24px',
      fontWeight: 800,
      color: 'var(--ink-900)',
      lineHeight: 1
    }
  }, value), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '6px 0 0',
      fontSize: '14px',
      color: 'var(--ink-600)'
    }
  }, label), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 0',
      fontSize: '12px',
      color: 'var(--ink-400)'
    }
  }, hint));
}
function NavGroup({
  title,
  hint,
  children
}) {
  return /*#__PURE__*/React.createElement("section", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      marginBottom: '12px'
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-serif)',
      fontSize: '20px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, title), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '13px',
      color: 'var(--ink-400)'
    }
  }, hint)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: '12px'
    }
  }, children));
}
function NavTile({
  icon,
  title,
  desc,
  meta,
  onClick
}) {
  const [h, setH] = React.useState(false);
  return /*#__PURE__*/React.createElement("button", {
    onClick: onClick,
    onMouseEnter: () => setH(true),
    onMouseLeave: () => setH(false),
    style: {
      textAlign: 'left',
      display: 'flex',
      gap: '12px',
      background: 'var(--surface-0)',
      border: `1px solid ${h ? 'var(--primary-200)' : 'var(--cream-300)'}`,
      borderRadius: 'var(--radius-xl)',
      padding: '14px',
      cursor: 'pointer',
      boxShadow: h ? 'var(--shadow-warm)' : 'none',
      transition: 'box-shadow var(--dur-base), border-color var(--dur-base)',
      fontFamily: 'var(--font-sans)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '44px',
      height: '44px',
      borderRadius: 'var(--radius-md)',
      background: 'var(--primary-100)',
      color: 'var(--primary-700)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: icon,
    size: 21,
    stroke: 2.2,
    color: "var(--primary-700)"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0,
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '6px'
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontWeight: 700,
      color: 'var(--ink-900)',
      fontSize: '15px'
    }
  }, title), /*#__PURE__*/React.createElement(Lucide, {
    name: "arrow-right",
    size: 16,
    color: h ? 'var(--primary-600)' : 'var(--ink-300)'
  })), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 0',
      fontSize: '13px',
      color: 'var(--ink-500)',
      lineHeight: 1.35
    }
  }, desc), meta && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '6px 0 0',
      fontSize: '12px',
      fontWeight: 600,
      color: 'var(--ink-400)'
    }
  }, meta)));
}
function TipRow({
  icon,
  title,
  desc,
  onClick
}) {
  return /*#__PURE__*/React.createElement("button", {
    onClick: onClick,
    style: {
      textAlign: 'left',
      display: 'flex',
      gap: '12px',
      alignItems: 'center',
      background: 'transparent',
      border: 0,
      borderRadius: 'var(--radius-md)',
      padding: '8px',
      cursor: 'pointer',
      fontFamily: 'var(--font-sans)',
      width: '100%'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '36px',
      height: '36px',
      borderRadius: 'var(--radius-md)',
      background: 'var(--accent-100)',
      color: 'var(--accent-700)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: icon,
    size: 18,
    stroke: 2.2,
    color: "var(--accent-700)"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '14px',
      fontWeight: 600,
      color: 'var(--ink-900)'
    }
  }, title), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '12px',
      color: 'var(--ink-500)'
    }
  }, desc)), /*#__PURE__*/React.createElement(Lucide, {
    name: "arrow-right",
    size: 15,
    color: "var(--ink-300)"
  }));
}
function Ring({
  value
}) {
  const r = 34,
    c = 2 * Math.PI * r,
    off = c - value / 100 * c;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      width: '88px',
      height: '88px',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "88",
    height: "88",
    viewBox: "0 0 88 88"
  }, /*#__PURE__*/React.createElement("circle", {
    cx: "44",
    cy: "44",
    r: r,
    fill: "none",
    stroke: "var(--cream-200)",
    strokeWidth: "8"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "44",
    cy: "44",
    r: r,
    fill: "none",
    stroke: "var(--olive-500)",
    strokeWidth: "8",
    strokeLinecap: "round",
    strokeDasharray: c,
    strokeDashoffset: off,
    transform: "rotate(-90 44 44)"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      inset: 0,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '22px',
      fontWeight: 800,
      color: 'var(--ink-900)'
    }
  }, value), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '10px',
      color: 'var(--ink-400)'
    }
  }, "/ 100")));
}

// ===== Orders (grouped + detail drawer with status advancement) =====
const SC_NEXT = {
  NEW: 'ACCEPTED',
  ACCEPTED: 'READY',
  READY: 'ASSIGNED'
};
const SC_NEXT_LABEL = {
  NEW: 'Accetta ordine',
  ACCEPTED: 'Segna come pronto',
  READY: 'Assegna al rider'
};
const SC_GROUPS = [{
  label: 'Da fare',
  statuses: ['NEW', 'ACCEPTED', 'READY']
}, {
  label: 'In consegna',
  statuses: ['ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY']
}, {
  label: 'Completati',
  statuses: ['DELIVERED', 'CANCELED']
}];
function Orders({
  orders,
  onAdvance
}) {
  const [sel, setSel] = React.useState(null);
  const groups = SC_GROUPS.map(g => ({
    ...g,
    items: orders.filter(o => g.statuses.includes(o.status))
  }));
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(PageTitle, {
    title: "Ordini ricevuti",
    sub: "Prepara, conferma e affida gli ordini ai rider",
    action: /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: '8px'
      }
    }, groups.map(g => /*#__PURE__*/React.createElement("span", {
      key: g.label,
      style: {
        fontSize: '12px',
        background: 'var(--cream-100)',
        color: 'var(--ink-600)',
        borderRadius: '999px',
        padding: '5px 12px'
      }
    }, g.label, ": ", /*#__PURE__*/React.createElement("strong", {
      style: {
        color: 'var(--ink-900)'
      }
    }, g.items.length))))
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '22px'
    }
  }, groups.map(g => g.items.length === 0 ? null : /*#__PURE__*/React.createElement("section", {
    key: g.label
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: '0 0 10px',
      fontSize: '14px',
      fontWeight: 700,
      color: 'var(--ink-700)',
      textTransform: 'uppercase',
      letterSpacing: '0.03em'
    }
  }, g.label), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '8px'
    }
  }, g.items.map(o => {
    const count = o.items.reduce((s, i) => s + i.q, 0);
    return /*#__PURE__*/React.createElement("button", {
      key: o.id,
      onClick: () => setSel(o),
      style: {
        textAlign: 'left',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        flexWrap: 'wrap',
        background: 'var(--surface-0)',
        border: '1px solid var(--cream-300)',
        borderRadius: 'var(--radius-lg)',
        padding: '14px 18px',
        cursor: 'pointer',
        fontFamily: 'var(--font-sans)'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: 'var(--font-mono)',
        fontSize: '12px',
        color: 'var(--ink-400)'
      }
    }, "#", o.id), /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--ink-300)'
      }
    }, "\xB7"), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: '12px',
        color: 'var(--ink-500)'
      }
    }, o.when), o.pay === 'cod' && /*#__PURE__*/React.createElement(Badge, {
      variant: "cod",
      icon: "banknote"
    }, "Contanti")), /*#__PURE__*/React.createElement("p", {
      style: {
        margin: '3px 0 0',
        fontWeight: 700,
        color: 'var(--ink-900)'
      }
    }, o.cust), /*#__PURE__*/React.createElement("p", {
      style: {
        margin: 0,
        fontSize: '13px',
        color: 'var(--ink-500)'
      }
    }, count, " ", count === 1 ? 'articolo' : 'articoli', " \xB7 ", o.addr)), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '14px'
      }
    }, /*#__PURE__*/React.createElement(OrderStatusBadge, {
      status: o.status,
      size: "sm"
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        fontWeight: 800,
        color: 'var(--ink-900)',
        fontSize: '16px'
      }
    }, fmt(o.total)), /*#__PURE__*/React.createElement(Lucide, {
      name: "chevron-right",
      size: 18,
      color: "var(--ink-300)"
    })));
  }))))), /*#__PURE__*/React.createElement(OrderDrawer, {
    order: sel,
    onClose: () => setSel(null),
    onAdvance: o => {
      onAdvance(o);
      setSel(null);
    }
  }));
}
function OrderDrawer({
  order,
  onClose,
  onAdvance
}) {
  if (!order) return null;
  const o = order;
  const next = SC_NEXT[o.status];
  return ReactDOM.createPortal(/*#__PURE__*/React.createElement("div", {
    onClick: onClose,
    style: {
      position: 'fixed',
      inset: 0,
      zIndex: 'var(--z-modal)',
      background: 'rgba(0,0,0,.4)',
      backdropFilter: 'blur(2px)',
      display: 'flex',
      justifyContent: 'flex-end',
      animation: 'mc-fade-in var(--dur-fast) ease-out'
    }
  }, /*#__PURE__*/React.createElement("div", {
    onClick: e => e.stopPropagation(),
    style: {
      width: '440px',
      maxWidth: '92vw',
      height: '100%',
      background: 'var(--surface-0)',
      display: 'flex',
      flexDirection: 'column',
      boxShadow: 'var(--shadow-warm-xl)',
      animation: 'mc-slide-right var(--dur-medium) var(--ease-out-quint)'
    }
  }, /*#__PURE__*/React.createElement("header", {
    style: {
      padding: '18px 20px',
      borderBottom: '1px solid var(--cream-200)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-mono)',
      fontSize: '12px',
      color: 'var(--ink-400)'
    }
  }, "#", o.id), /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: '2px 0 0',
      fontFamily: 'var(--font-serif)',
      fontSize: '20px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, o.cust)), /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    "aria-label": "Chiudi",
    style: {
      border: 0,
      background: 'transparent',
      cursor: 'pointer',
      color: 'var(--ink-500)'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "x",
    size: 22
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflowY: 'auto',
      padding: '20px',
      display: 'flex',
      flexDirection: 'column',
      gap: '18px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between'
    }
  }, /*#__PURE__*/React.createElement(OrderStatusBadge, {
    status: o.status
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '13px',
      color: 'var(--ink-500)'
    }
  }, o.when)), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '0 0 8px',
      fontSize: '12px',
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '0.03em',
      color: 'var(--ink-500)'
    }
  }, "Articoli"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '10px'
    }
  }, o.items.map((it, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: 'flex',
      gap: '10px',
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: img(it.kw, it.lock),
    alt: it.name,
    style: {
      width: '48px',
      height: '48px',
      borderRadius: 'var(--radius-md)',
      objectFit: 'cover'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '14px',
      fontWeight: 600,
      color: 'var(--ink-900)'
    }
  }, it.name), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '12px',
      color: 'var(--ink-500)'
    }
  }, fmt(it.price), " \xD7 ", it.q)), /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, fmt(it.price * it.q)))))), /*#__PURE__*/React.createElement("div", {
    style: {
      borderTop: '1px solid var(--cream-200)',
      paddingTop: '14px',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px'
    }
  }, /*#__PURE__*/React.createElement(Row, {
    label: "Consegna",
    val: o.addr
  }), /*#__PURE__*/React.createElement(Row, {
    label: "Pagamento",
    val: o.pay === 'cod' ? 'Contanti alla consegna' : 'Carta (online)'
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      fontSize: '18px',
      fontWeight: 800,
      color: 'var(--ink-900)',
      marginTop: '4px'
    }
  }, /*#__PURE__*/React.createElement("span", null, "Totale"), /*#__PURE__*/React.createElement("span", null, fmt(o.total)))), o.pay === 'cod' && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      background: 'var(--olive-50)',
      borderRadius: 'var(--radius-md)',
      padding: '10px 12px',
      fontSize: '13px',
      color: 'var(--olive-800)'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "banknote",
    size: 16,
    color: "var(--olive-700)"
  }), " Il rider incassa ", /*#__PURE__*/React.createElement("strong", null, fmt(o.total)), " in contanti.")), /*#__PURE__*/React.createElement("footer", {
    style: {
      padding: '16px 20px',
      borderTop: '1px solid var(--cream-200)',
      display: 'flex',
      gap: '8px'
    }
  }, next ? /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    size: "lg",
    fullWidth: true,
    iconRight: "arrow-right",
    onClick: () => onAdvance(o)
  }, SC_NEXT_LABEL[o.status]) : /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      textAlign: 'center',
      fontSize: '14px',
      color: 'var(--ink-500)',
      padding: '10px'
    }
  }, o.status === 'DELIVERED' ? 'Ordine consegnato ✓' : o.status === 'CANCELED' ? 'Ordine annullato' : 'In gestione al rider'), o.status === 'NEW' && /*#__PURE__*/React.createElement(Button, {
    variant: "danger",
    size: "lg",
    icon: "x"
  }, "Rifiuta")))), document.body);
}
function Row({
  label,
  val
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      gap: '12px',
      fontSize: '14px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--ink-500)'
    }
  }, label), /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 600,
      color: 'var(--ink-800)',
      textAlign: 'right'
    }
  }, val));
}

// ===== Products (catalogue table + new-product modal) =====
function Products({
  products,
  onNewProduct,
  onToggle
}) {
  const [filter, setFilter] = React.useState('all');
  const tabs = [['all', 'Tutti'], ['available', 'In vendita'], ['soldout', 'Esauriti'], ['draft', 'Bozze']];
  const list = products.filter(p => filter === 'all' || p.status === filter);
  const STATUS = {
    available: ['var(--olive-50)', 'var(--olive-700)', 'In vendita'],
    soldout: ['var(--secondary-50)', 'var(--secondary-600)', 'Esaurito'],
    draft: ['var(--surface-100)', 'var(--ink-500)', 'Bozza']
  };
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(PageTitle, {
    title: "Prodotti",
    sub: `${products.length} prodotti a catalogo`,
    action: /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: '8px'
      }
    }, /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      icon: "upload"
    }, "Importa CSV"), /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      icon: "plus",
      onClick: onNewProduct
    }, "Nuovo prodotto"))
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: '4px',
      marginBottom: '16px'
    }
  }, tabs.map(([id, label]) => /*#__PURE__*/React.createElement("button", {
    key: id,
    onClick: () => setFilter(id),
    style: {
      border: 0,
      background: filter === id ? 'var(--primary-700)' : 'var(--surface-0)',
      color: filter === id ? '#fff' : 'var(--ink-600)',
      fontWeight: 600,
      fontSize: '13px',
      padding: '8px 14px',
      borderRadius: 'var(--radius-full)',
      cursor: 'pointer',
      fontFamily: 'var(--font-sans)',
      boxShadow: filter === id ? 'none' : 'inset 0 0 0 1px var(--cream-300)'
    }
  }, label))), /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "none"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      overflowX: 'auto'
    }
  }, /*#__PURE__*/React.createElement("table", {
    style: {
      width: '100%',
      borderCollapse: 'collapse',
      fontFamily: 'var(--font-sans)'
    }
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
    style: {
      background: 'var(--cream-50)',
      borderBottom: '1px solid var(--cream-300)'
    }
  }, ['Prodotto', 'Prezzo', 'Stock', 'Venduti', 'Stato', ''].map((h, i) => /*#__PURE__*/React.createElement("th", {
    key: i,
    style: {
      textAlign: i > 0 && i < 5 ? 'right' : 'left',
      padding: '12px 16px',
      fontSize: '11px',
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '0.03em',
      color: 'var(--ink-500)'
    }
  }, h)))), /*#__PURE__*/React.createElement("tbody", null, list.map(p => {
    const [bg, fg, lbl] = STATUS[p.status];
    const fp = p.discount > 0 ? p.price * (1 - p.discount / 100) : p.price;
    return /*#__PURE__*/React.createElement("tr", {
      key: p.id,
      style: {
        borderBottom: '1px solid var(--cream-200)'
      }
    }, /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '12px 16px'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '12px'
      }
    }, /*#__PURE__*/React.createElement("img", {
      src: img(p.kw, p.lock),
      alt: p.name,
      style: {
        width: '44px',
        height: '44px',
        borderRadius: 'var(--radius-md)',
        objectFit: 'cover'
      }
    }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
      style: {
        margin: 0,
        fontSize: '14px',
        fontWeight: 600,
        color: 'var(--ink-900)'
      }
    }, p.name), /*#__PURE__*/React.createElement("p", {
      style: {
        margin: 0,
        fontSize: '12px',
        color: 'var(--ink-400)'
      }
    }, p.cat)))), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '12px 16px',
        textAlign: 'right'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontWeight: 700,
        color: 'var(--ink-900)'
      }
    }, fmt(fp)), p.discount > 0 && /*#__PURE__*/React.createElement("span", {
      style: {
        display: 'block',
        fontSize: '11px',
        color: 'var(--secondary-600)',
        fontWeight: 600
      }
    }, "-", p.discount, "%")), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '12px 16px',
        textAlign: 'right',
        fontWeight: 600,
        color: p.stock === 0 ? 'var(--secondary-600)' : p.stock <= 3 ? 'var(--accent-700)' : 'var(--ink-700)'
      }
    }, p.stock), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '12px 16px',
        textAlign: 'right',
        color: 'var(--ink-600)'
      }
    }, p.sold), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '12px 16px',
        textAlign: 'right'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: '12px',
        fontWeight: 600,
        background: bg,
        color: fg,
        padding: '3px 10px',
        borderRadius: '999px'
      }
    }, lbl)), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '12px 16px',
        textAlign: 'right',
        whiteSpace: 'nowrap'
      }
    }, /*#__PURE__*/React.createElement("button", {
      title: "Modifica",
      style: iconBtn
    }, /*#__PURE__*/React.createElement(Lucide, {
      name: "pencil",
      size: 16,
      color: "var(--ink-500)"
    })), /*#__PURE__*/React.createElement("button", {
      title: "Altro",
      style: iconBtn
    }, /*#__PURE__*/React.createElement(Lucide, {
      name: "more-horizontal",
      size: 16,
      color: "var(--ink-500)"
    }))));
  }))))));
}
const iconBtn = {
  border: 0,
  background: 'transparent',
  cursor: 'pointer',
  padding: '6px',
  borderRadius: 'var(--radius-md)',
  display: 'inline-flex'
};
function NewProductModal({
  open,
  onClose,
  onSave
}) {
  return /*#__PURE__*/React.createElement(Modal, {
    open: open,
    onClose: onClose,
    title: "Nuovo prodotto",
    description: "Pubblica un articolo nella tua vetrina",
    size: "lg",
    footer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      onClick: onClose
    }, "Annulla"), /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      icon: "check",
      onClick: onSave
    }, "Pubblica prodotto"))
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '16px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: '14px',
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: '88px',
      height: '88px',
      borderRadius: 'var(--radius-lg)',
      border: '1.5px dashed var(--cream-400)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'var(--ink-400)',
      flexShrink: 0,
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "camera",
    size: 22,
    color: "var(--ink-400)"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '10px',
      marginTop: '4px'
    }
  }, "Foto")), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement(Input, {
    label: "Nome prodotto",
    placeholder: "Es. Coppa Piacentina DOP 200g"
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '14px'
    }
  }, /*#__PURE__*/React.createElement(Input, {
    label: "Prezzo (\u20AC)",
    type: "number",
    placeholder: "8,90"
  }), /*#__PURE__*/React.createElement(Input, {
    label: "Stock disponibile",
    type: "number",
    placeholder: "12"
  })), /*#__PURE__*/React.createElement(Select, {
    label: "Categoria",
    defaultValue: "Salumi"
  }, /*#__PURE__*/React.createElement("option", null, "Salumi"), /*#__PURE__*/React.createElement("option", null, "Formaggi"), /*#__PURE__*/React.createElement("option", null, "Conserve"), /*#__PURE__*/React.createElement("option", null, "Pasta fresca"), /*#__PURE__*/React.createElement("option", null, "Vini")), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    style: {
      fontSize: '14px',
      fontWeight: 500,
      color: 'var(--ink-700)',
      display: 'block',
      marginBottom: '5px'
    }
  }, "Descrizione"), /*#__PURE__*/React.createElement("textarea", {
    rows: "3",
    placeholder: "Racconta il prodotto: origine, stagionatura, abbinamenti\u2026",
    style: {
      width: '100%',
      boxSizing: 'border-box',
      border: '1px solid var(--cream-300)',
      borderRadius: 'var(--radius-md)',
      padding: '10px 12px',
      fontSize: '15px',
      fontFamily: 'var(--font-sans)',
      resize: 'vertical',
      outline: 'none'
    }
  })), /*#__PURE__*/React.createElement(Checkbox, {
    label: "Spedizione gratuita per questo prodotto"
  })));
}

// ===== Analytics =====
function Analytics() {
  const rev = window.SC_REVENUE_7D;
  const max = Math.max(...rev);
  const days = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
  const top = window.SC_PRODUCTS.slice().sort((a, b) => b.sold - a.sold).slice(0, 5);
  const maxSold = top[0].sold;
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(PageTitle, {
    title: "Analisi",
    sub: "Andamento delle vendite e prodotti migliori"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: '14px',
      marginBottom: '20px'
    }
  }, [['Fatturato 7gg', fmt(window.SC_KPI.revenue7), '+12%', 'olive'], ['Ordini 7gg', window.SC_KPI.orders7, '+8%', 'primary'], ['Scontrino medio', fmt(23.9), '+3%', 'accent'], ['Tasso reso', '1,4%', '−0,2%', 'secondary']].map(([l, v, d, t]) => /*#__PURE__*/React.createElement(Card, {
    key: l,
    variant: "bordered",
    padding: "md"
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '12px',
      color: 'var(--ink-500)',
      fontWeight: 600
    }
  }, l), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '6px 0 0',
      fontSize: '24px',
      fontWeight: 800,
      color: 'var(--ink-900)'
    }
  }, v), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '12px',
      fontWeight: 700,
      color: TINT[t][1]
    }
  }, d, " vs settimana scorsa")))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1.4fr 1fr',
      gap: '20px',
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "lg"
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: '0 0 18px',
      fontFamily: 'var(--font-serif)',
      fontSize: '18px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, "Fatturato \xB7 ultimi 7 giorni"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-end',
      gap: '12px',
      height: '180px'
    }
  }, rev.map((v, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '8px',
      height: '100%'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      width: '100%',
      display: 'flex',
      alignItems: 'flex-end'
    }
  }, /*#__PURE__*/React.createElement("div", {
    title: fmt(v),
    style: {
      width: '100%',
      height: `${v / max * 100}%`,
      background: 'linear-gradient(180deg, var(--primary-500), var(--primary-700))',
      borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0',
      minHeight: '6px'
    }
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '11px',
      color: 'var(--ink-500)'
    }
  }, days[i]))))), /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "lg"
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: '0 0 16px',
      fontFamily: 'var(--font-serif)',
      fontSize: '18px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, "Prodotti pi\xF9 venduti"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '14px'
    }
  }, top.map((p, i) => /*#__PURE__*/React.createElement("div", {
    key: p.id,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '13px',
      fontWeight: 800,
      color: 'var(--ink-300)',
      width: '16px'
    }
  }, i + 1), /*#__PURE__*/React.createElement("img", {
    src: img(p.kw, p.lock),
    alt: "",
    style: {
      width: '36px',
      height: '36px',
      borderRadius: 'var(--radius-md)',
      objectFit: 'cover'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '13px',
      fontWeight: 600,
      color: 'var(--ink-900)',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, p.name), /*#__PURE__*/React.createElement("div", {
    style: {
      height: '5px',
      background: 'var(--cream-200)',
      borderRadius: '3px',
      marginTop: '4px',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'block',
      height: '100%',
      width: `${p.sold / maxSold * 100}%`,
      background: 'var(--olive-500)'
    }
  }))), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '13px',
      fontWeight: 700,
      color: 'var(--ink-700)'
    }
  }, p.sold)))))));
}

// ===== Earnings (COD + Stripe payouts) =====
function Earnings() {
  const [period, setPeriod] = React.useState('30d');
  const periods = [['7d', '7 giorni'], ['30d', '30 giorni'], ['90d', '90 giorni'], ['all', 'Tutto']];
  const payouts = window.SC_PAYOUTS;
  const held = payouts.filter(p => p.status === 'HELD').reduce((s, p) => s + p.net, 0);
  const paid = payouts.filter(p => p.status === 'TRANSFERRED').reduce((s, p) => s + p.net, 0);
  const codCollected = window.SC_ORDERS.filter(o => o.pay === 'cod' && o.status === 'DELIVERED').reduce((s, o) => s + o.total, 0);
  const rev = window.SC_REVENUE_7D;
  const max = Math.max(...rev);
  const STATUS = {
    HELD: ['var(--accent-100)', 'var(--accent-800)', 'In attesa'],
    TRANSFERRED: ['var(--olive-100)', 'var(--olive-800)', 'Pagato']
  };
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(PageTitle, {
    title: "Guadagni",
    sub: "Incassi reali e stato dei bonifici"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: '8px',
      marginBottom: '18px',
      flexWrap: 'wrap'
    }
  }, periods.map(([k, l]) => /*#__PURE__*/React.createElement("button", {
    key: k,
    onClick: () => setPeriod(k),
    style: {
      border: 0,
      background: period === k ? 'var(--primary-700)' : 'var(--surface-0)',
      color: period === k ? '#fff' : 'var(--ink-700)',
      fontWeight: 600,
      fontSize: '13px',
      padding: '7px 16px',
      borderRadius: 'var(--radius-full)',
      cursor: 'pointer',
      fontFamily: 'var(--font-sans)',
      boxShadow: period === k ? 'none' : 'inset 0 0 0 1px var(--cream-300)'
    }
  }, l))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: '14px',
      marginBottom: '20px'
    }
  }, /*#__PURE__*/React.createElement(EStat, {
    label: "Fatturato lordo",
    value: fmt(window.SC_KPI.revenue30),
    hint: `${window.SC_KPI.orders30} ordini`,
    tone: "primary"
  }), /*#__PURE__*/React.createElement(EStat, {
    label: "Commissione MyCity",
    value: '− ' + fmt(window.SC_KPI.revenue30 * 0.1),
    hint: "10% sul venduto",
    tone: "secondary"
  }), /*#__PURE__*/React.createElement(EStat, {
    label: "Incassato",
    value: fmt(paid),
    hint: `${fmt(held)} in arrivo dopo la consegna`,
    tone: "olive",
    highlight: true
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1.3fr 1fr',
      gap: '20px',
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "lg"
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: '0 0 16px',
      fontFamily: 'var(--font-serif)',
      fontSize: '18px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, "Andamento ultimi 7 giorni"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-end',
      gap: '10px',
      height: '130px'
    }
  }, rev.map((v, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      flex: 1,
      height: '100%',
      display: 'flex',
      alignItems: 'flex-end'
    }
  }, /*#__PURE__*/React.createElement("div", {
    title: fmt(v),
    style: {
      width: '100%',
      height: `${v / max * 100}%`,
      background: 'linear-gradient(180deg, var(--primary-400), var(--secondary-600))',
      borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0',
      minHeight: '5px'
    }
  }))))), /*#__PURE__*/React.createElement(Card, {
    variant: "flat",
    padding: "lg",
    style: {
      background: 'var(--olive-50)',
      border: '1px solid var(--olive-200)'
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: '0 0 4px',
      fontFamily: 'var(--font-serif)',
      fontSize: '17px',
      fontWeight: 700,
      color: 'var(--olive-900)',
      display: 'flex',
      alignItems: 'center',
      gap: '8px'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "banknote",
    size: 19,
    color: "var(--olive-700)"
  }), " Contanti (COD)"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '0 0 12px',
      fontSize: '13px',
      color: 'var(--olive-800)',
      lineHeight: 1.5
    }
  }, "Gli ordini pagati alla consegna li incassa il rider e ti vengono accreditati a fine giornata."), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '28px',
      fontWeight: 800,
      color: 'var(--olive-900)'
    }
  }, fmt(codCollected)), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 0',
      fontSize: '12px',
      color: 'var(--olive-700)'
    }
  }, "incassati in contanti questo periodo"))), /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "none",
    style: {
      marginTop: '20px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '16px 20px',
      borderBottom: '1px solid var(--cream-200)'
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-serif)',
      fontSize: '17px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, "Storico pagamenti"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 0',
      fontSize: '12px',
      color: 'var(--ink-500)'
    }
  }, "Stato del bonifico per ogni ordine carta")), /*#__PURE__*/React.createElement("table", {
    style: {
      width: '100%',
      borderCollapse: 'collapse',
      fontFamily: 'var(--font-sans)'
    }
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
    style: {
      background: 'var(--cream-50)'
    }
  }, ['Ordine', 'Data', 'Netto', 'Stato'].map((h, i) => /*#__PURE__*/React.createElement("th", {
    key: h,
    style: {
      textAlign: i >= 2 ? 'right' : 'left',
      padding: '10px 18px',
      fontSize: '11px',
      fontWeight: 700,
      textTransform: 'uppercase',
      color: 'var(--ink-500)'
    }
  }, h)))), /*#__PURE__*/React.createElement("tbody", null, payouts.map(p => {
    const [bg, fg, lbl] = STATUS[p.status];
    return /*#__PURE__*/React.createElement("tr", {
      key: p.id,
      style: {
        borderTop: '1px solid var(--cream-200)'
      }
    }, /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '12px 18px',
        fontFamily: 'var(--font-mono)',
        fontSize: '13px',
        color: 'var(--ink-700)'
      }
    }, "#", p.id), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '12px 18px',
        fontSize: '13px',
        color: 'var(--ink-500)'
      }
    }, p.when), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '12px 18px',
        textAlign: 'right',
        fontWeight: 700,
        color: 'var(--olive-700)'
      }
    }, fmt(p.net)), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '12px 18px',
        textAlign: 'right'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: '12px',
        fontWeight: 600,
        background: bg,
        color: fg,
        padding: '3px 10px',
        borderRadius: '999px'
      }
    }, p.status === 'TRANSFERRED' ? `Pagato ${p.paidOn}` : lbl)));
  })))));
}
function EStat({
  label,
  value,
  hint,
  tone,
  highlight
}) {
  const [bg, fg] = TINT[tone];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: bg,
      border: `1.5px solid ${highlight ? 'var(--olive-300)' : 'transparent'}`,
      borderRadius: 'var(--radius-xl)',
      padding: '18px',
      boxShadow: highlight ? '0 0 0 3px rgba(124,139,90,.18)' : 'none'
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '11px',
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '0.03em',
      color: 'var(--ink-500)'
    }
  }, label), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '8px 0 0',
      fontSize: '28px',
      fontWeight: 800,
      color: fg
    }
  }, value), hint && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 0',
      fontSize: '12px',
      color: 'var(--ink-500)'
    }
  }, hint));
}

// ===== Promotions · Reviews · Customers =====
function Promotions({
  onNew
}) {
  const promos = window.SC_PROMOS;
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(PageTitle, {
    title: "Promozioni",
    sub: "Sconti e offerte a tempo per i tuoi prodotti",
    action: /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      icon: "plus",
      onClick: onNew
    }, "Nuova promo")
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '12px'
    }
  }, promos.map(p => /*#__PURE__*/React.createElement(Card, {
    key: p.id,
    variant: "bordered",
    padding: "lg"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '16px',
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '48px',
      height: '48px',
      borderRadius: 'var(--radius-md)',
      background: p.active ? 'var(--secondary-100)' : 'var(--surface-100)',
      color: p.active ? 'var(--secondary-600)' : 'var(--ink-400)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: p.type === 'shipping' ? 'truck' : 'tag',
    size: 22,
    stroke: 2.2,
    color: p.active ? 'var(--secondary-600)' : 'var(--ink-400)'
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: '180px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px'
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontWeight: 700,
      color: 'var(--ink-900)',
      fontSize: '15px'
    }
  }, p.name), p.active ? /*#__PURE__*/React.createElement(Badge, {
    variant: "new"
  }, "Attiva") : /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '12px',
      color: 'var(--ink-400)',
      fontWeight: 600
    }
  }, "Terminata")), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 0',
      fontSize: '13px',
      color: 'var(--ink-500)'
    }
  }, p.product, " \xB7 scade il ", p.ends)), /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'right'
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '20px',
      fontWeight: 800,
      color: 'var(--secondary-600)'
    }
  }, p.type === 'shipping' ? 'Sped. gratis' : `-${p.value}%`), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '12px',
      color: 'var(--ink-400)'
    }
  }, p.used, " utilizzi")), /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'relative',
      width: '40px',
      height: '23px',
      borderRadius: '999px',
      background: p.active ? 'var(--olive-500)' : 'var(--cream-400)',
      transition: 'background var(--dur-base)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      top: '2px',
      left: p.active ? '19px' : '2px',
      width: '19px',
      height: '19px',
      borderRadius: '50%',
      background: '#fff',
      transition: 'left var(--dur-base)',
      boxShadow: 'var(--shadow-sm)'
    }
  }))))))));
}
function Reviews() {
  const reviews = window.SC_REVIEWS;
  const avg = window.SC_STORE.rating;
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(PageTitle, {
    title: "Recensioni",
    sub: "Reputazione e feedback dei clienti"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '240px 1fr',
      gap: '24px',
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement(Card, {
    variant: "flat",
    padding: "lg"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'center'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-serif)',
      fontSize: '46px',
      fontWeight: 800,
      color: 'var(--ink-900)',
      lineHeight: 1
    }
  }, avg.toFixed(1).replace('.', ',')), /*#__PURE__*/React.createElement("div", {
    style: {
      margin: '8px 0'
    }
  }, /*#__PURE__*/React.createElement(Stars, {
    value: avg,
    size: 18
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: '13px',
      color: 'var(--ink-500)'
    }
  }, window.SC_STORE.reviews, " recensioni")), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: '16px',
      display: 'flex',
      flexDirection: 'column',
      gap: '6px'
    }
  }, [[5, 82], [4, 13], [3, 3], [2, 1], [1, 1]].map(([s, pct]) => /*#__PURE__*/React.createElement("div", {
    key: s,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      fontSize: '12px',
      color: 'var(--ink-500)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '8px'
    }
  }, s), /*#__PURE__*/React.createElement(Lucide, {
    name: "star",
    size: 11,
    color: "var(--accent-500)"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      height: '6px',
      background: 'var(--cream-200)',
      borderRadius: '3px',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'block',
      height: '100%',
      width: `${pct}%`,
      background: 'var(--accent-500)'
    }
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      width: '28px',
      textAlign: 'right'
    }
  }, pct, "%"))))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '12px'
    }
  }, reviews.map((r, i) => /*#__PURE__*/React.createElement(Card, {
    key: i,
    variant: "bordered",
    padding: "md"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      marginBottom: '6px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '34px',
      height: '34px',
      borderRadius: '50%',
      background: 'var(--cream-200)',
      color: 'var(--primary-700)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontWeight: 700,
      fontSize: '13px'
    }
  }, initials(r.who)), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px'
    }
  }, /*#__PURE__*/React.createElement("strong", {
    style: {
      fontSize: '14px',
      color: 'var(--ink-900)'
    }
  }, r.who), /*#__PURE__*/React.createElement(Stars, {
    value: r.rating,
    size: 13
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '12px',
      color: 'var(--ink-400)'
    }
  }, r.when, " \xB7 ", r.product))), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '0 0 10px',
      fontSize: '14px',
      lineHeight: 1.55,
      color: 'var(--ink-700)'
    }
  }, r.text), r.reply ? /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--cream-50)',
      borderLeft: '3px solid var(--primary-400)',
      borderRadius: '0 var(--radius-md) var(--radius-md) 0',
      padding: '8px 12px'
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '12px',
      fontWeight: 700,
      color: 'var(--primary-700)'
    }
  }, "La tua risposta"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 0',
      fontSize: '13px',
      color: 'var(--ink-600)'
    }
  }, r.reply)) : /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    size: "sm",
    icon: "reply"
  }, "Rispondi"))))));
}
function Customers() {
  const custs = window.SC_CUSTOMERS;
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(PageTitle, {
    title: "Clienti",
    sub: "Chi compra dal tuo negozio"
  }), /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "none"
  }, /*#__PURE__*/React.createElement("table", {
    style: {
      width: '100%',
      borderCollapse: 'collapse',
      fontFamily: 'var(--font-sans)'
    }
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
    style: {
      background: 'var(--cream-50)',
      borderBottom: '1px solid var(--cream-300)'
    }
  }, ['Cliente', 'Ordini', 'Speso', 'Ultimo'].map((h, i) => /*#__PURE__*/React.createElement("th", {
    key: h,
    style: {
      textAlign: i === 0 ? 'left' : 'right',
      padding: '12px 18px',
      fontSize: '11px',
      fontWeight: 700,
      textTransform: 'uppercase',
      color: 'var(--ink-500)'
    }
  }, h)))), /*#__PURE__*/React.createElement("tbody", null, custs.map(c => /*#__PURE__*/React.createElement("tr", {
    key: c.name,
    style: {
      borderBottom: '1px solid var(--cream-200)'
    }
  }, /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '12px 18px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '36px',
      height: '36px',
      borderRadius: '50%',
      background: 'linear-gradient(135deg, var(--primary-500), var(--primary-700))',
      color: '#fff',
      fontWeight: 700,
      fontSize: '13px',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, c.initials), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '14px',
      fontWeight: 600,
      color: 'var(--ink-900)'
    }
  }, c.name))), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '12px 18px',
      textAlign: 'right',
      color: 'var(--ink-700)'
    }
  }, c.orders), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '12px 18px',
      textAlign: 'right',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, fmt(c.spent)), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '12px 18px',
      textAlign: 'right',
      color: 'var(--ink-500)',
      fontSize: '13px'
    }
  }, c.last)))))));
}

// ===== Seller app shell (view state + toasts) =====
function App() {
  const [view, setView] = React.useState('dashboard');
  const [orders, setOrders] = React.useState(window.SC_ORDERS);
  const [newProd, setNewProd] = React.useState(false);
  const [toast, setToast] = React.useState(null);
  const timer = React.useRef(null);
  function showToast(text) {
    setToast(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2600);
  }
  function nav(v) {
    setView(v);
    window.scrollTo(0, 0);
  }
  function advance(o) {
    const next = SC_NEXT[o.status];
    if (!next) return;
    setOrders(list => list.map(x => x.id === o.id ? {
      ...x,
      status: next
    } : x));
    showToast(`Ordine #${o.id} → ${next === 'ACCEPTED' ? 'accettato' : next === 'READY' ? 'pronto' : 'assegnato al rider'}`);
  }
  function saveProduct() {
    setNewProd(false);
    showToast('Prodotto pubblicato in vetrina');
  }
  return /*#__PURE__*/React.createElement(SellerShell, {
    view: view,
    onNav: nav,
    onNewProduct: () => setNewProd(true)
  }, view === 'dashboard' && /*#__PURE__*/React.createElement(Dashboard, {
    onNav: nav,
    onNewProduct: () => setNewProd(true)
  }), view === 'orders' && /*#__PURE__*/React.createElement(Orders, {
    orders: orders,
    onAdvance: advance
  }), view === 'products' && /*#__PURE__*/React.createElement(Products, {
    products: window.SC_PRODUCTS,
    onNewProduct: () => setNewProd(true)
  }), view === 'promotions' && /*#__PURE__*/React.createElement(Promotions, {
    onNew: () => showToast('Editor promo (demo)')
  }), view === 'analytics' && /*#__PURE__*/React.createElement(Analytics, null), view === 'customers' && /*#__PURE__*/React.createElement(Customers, null), view === 'reviews' && /*#__PURE__*/React.createElement(Reviews, null), view === 'earnings' && /*#__PURE__*/React.createElement(Earnings, null), /*#__PURE__*/React.createElement(NewProductModal, {
    open: newProd,
    onClose: () => setNewProd(false),
    onSave: saveProduct
  }), toast && ReactDOM.createPortal(/*#__PURE__*/React.createElement("div", {
    style: {
      position: 'fixed',
      left: '50%',
      bottom: '28px',
      transform: 'translateX(-50%)',
      zIndex: 'var(--z-toast)',
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      background: 'var(--ink-900)',
      color: '#fff',
      padding: '12px 18px',
      borderRadius: 'var(--radius-full)',
      boxShadow: 'var(--shadow-warm-xl)',
      animation: 'mc-pop-in var(--dur-medium) var(--ease-out-quint)',
      fontSize: '14px',
      fontWeight: 500
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '24px',
      height: '24px',
      borderRadius: '50%',
      background: 'var(--olive-600)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "check",
    size: 15,
    stroke: 3,
    color: "#fff"
  })), toast), document.body));
}

// ===== Bootstrap — mounts ONLY after index.html grants permission (window.__MC_ALLOW_MOUNT).
// _ds_bundle.js concatenates this file; its embedded copy runs during bundle-eval BEFORE the
// flag is set → bails. The real <script src="app.js"> runs AFTER the flag → mounts. Uses a
// fresh flag name so a stale bundle's old boot (pre-set & neutralized in index.html) can't interfere. =====
(function mcMount() {
  if (!window.__MC_ALLOW_MOUNT) return;
  if (window.__sellerReady) return;
  var ns = window.MyCityDesignSystem_105480;
  if (typeof App === 'undefined' || !ns || !ns.Button || !window.SC_ORDERS) return setTimeout(mcMount, 30);
  window.__sellerReady = true;
  var root = document.getElementById('root');
  if (root) root.style.display = 'none';
  var mount = document.getElementById('mc-app');
  if (!mount) {
    mount = document.createElement('div');
    mount.id = 'mc-app';
    document.body.appendChild(mount);
  }
  ReactDOM.createRoot(mount).render(React.createElement(App));
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/seller/app.js", error: String((e && e.message) || e) }); }

// ui_kits/seller/app.jsx
try { (() => {
/* AUTO-GENERATED from ui_kits/seller/src/*.jsx (numeric order). Do not edit directly. */
(function () {
  "use strict";

  // ===== Seller shared UI (DS wrappers + atoms) =====
  const __ds = n => function DSComp(props) {
    const C = (window.MyCityDesignSystem_105480 || {})[n];
    return C ? React.createElement(C, props) : null;
  };
  const Button = __ds('Button');
  const Badge = __ds('Badge');
  const Card = __ds('Card');
  const OrderStatusBadge = __ds('OrderStatusBadge');
  const Modal = __ds('Modal');
  const EmptyState = __ds('EmptyState');
  const Input = __ds('Input');
  const Select = __ds('Select');
  const Checkbox = __ds('Checkbox');
  const fmt = n => new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR'
  }).format(n);
  const imgUrl = (kw, lock) => `https://loremflickr.com/300/300/${kw}?lock=${lock}`;
  const initials = s => (s || '').trim().split(/\s+/).map(w => w[0] || '').slice(0, 2).join('').toUpperCase();
  function Icon({
    name,
    size = 20,
    stroke = 2,
    color,
    style
  }) {
    return /*#__PURE__*/React.createElement("i", {
      "data-lucide": name,
      ref: el => {
        if (el && window.lucide) try {
          window.lucide.createIcons({
            attrs: {
              width: size,
              height: size,
              'stroke-width': stroke
            }
          });
        } catch (e) {}
      },
      style: {
        width: size,
        height: size,
        display: 'inline-flex',
        color,
        flexShrink: 0,
        ...style
      }
    });
  }
  const TONES = {
    olive: ['var(--olive-100)', 'var(--olive-700)'],
    primary: ['var(--primary-100)', 'var(--primary-700)'],
    accent: ['var(--accent-100)', 'var(--accent-700)'],
    secondary: ['var(--secondary-100)', 'var(--secondary-600)']
  };
  function StatCard({
    kpi
  }) {
    const t = TONES[kpi.tone] || TONES.primary;
    const up = kpi.delta > 0,
      flat = kpi.delta === 0;
    return /*#__PURE__*/React.createElement(Card, {
      variant: "bordered",
      padding: "lg"
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between'
      }
    }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
      style: {
        margin: 0,
        fontSize: '13px',
        color: 'var(--ink-500)',
        fontWeight: 600
      }
    }, kpi.label), /*#__PURE__*/React.createElement("p", {
      style: {
        margin: '8px 0 0',
        fontFamily: 'var(--font-serif)',
        fontSize: '30px',
        fontWeight: 800,
        color: 'var(--ink-900)',
        lineHeight: 1
      }
    }, kpi.value)), /*#__PURE__*/React.createElement("span", {
      style: {
        width: '44px',
        height: '44px',
        borderRadius: 'var(--radius-lg)',
        background: t[0],
        color: t[1],
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center'
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: kpi.icon,
      size: 22,
      stroke: 2.2,
      color: t[1]
    }))), !flat && /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        marginTop: '12px',
        fontSize: '13px',
        fontWeight: 700,
        color: up ? 'var(--olive-700)' : 'var(--secondary-600)'
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: up ? 'trending-up' : 'trending-down',
      size: 15,
      color: up ? 'var(--olive-600)' : 'var(--secondary-600)'
    }), " ", up ? '+' : '', kpi.delta, "% ", /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--ink-400)',
        fontWeight: 500
      }
    }, "vs mese scorso")), flat && /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: '12px',
        fontSize: '13px',
        color: 'var(--ink-400)'
      }
    }, "da saldare al prossimo giro rider"));
  }

  // Simple inline SVG sparkline / bar chart.
  function Sparkline({
    data,
    w = 560,
    h = 120,
    color = 'var(--primary-600)'
  }) {
    const max = Math.max(...data),
      min = Math.min(...data);
    const pts = data.map((v, i) => [i / (data.length - 1) * w, h - (v - min) / (max - min || 1) * (h - 10) - 5]);
    const path = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const area = path + ` L${w} ${h} L0 ${h} Z`;
    return /*#__PURE__*/React.createElement("svg", {
      viewBox: `0 0 ${w} ${h}`,
      width: "100%",
      height: h,
      preserveAspectRatio: "none"
    }, /*#__PURE__*/React.createElement("defs", null, /*#__PURE__*/React.createElement("linearGradient", {
      id: "scfill",
      x1: "0",
      y1: "0",
      x2: "0",
      y2: "1"
    }, /*#__PURE__*/React.createElement("stop", {
      offset: "0",
      stopColor: "var(--primary-500)",
      stopOpacity: "0.22"
    }), /*#__PURE__*/React.createElement("stop", {
      offset: "1",
      stopColor: "var(--primary-500)",
      stopOpacity: "0"
    }))), /*#__PURE__*/React.createElement("path", {
      d: area,
      fill: "url(#scfill)"
    }), /*#__PURE__*/React.createElement("path", {
      d: path,
      fill: "none",
      stroke: color,
      strokeWidth: "2.5",
      strokeLinejoin: "round",
      strokeLinecap: "round"
    }), pts.map((p, i) => i === pts.length - 1 ? /*#__PURE__*/React.createElement("circle", {
      key: i,
      cx: p[0],
      cy: p[1],
      r: "4",
      fill: color
    }) : null));
  }
  function Bars({
    data,
    h = 120,
    color = 'var(--accent-500)'
  }) {
    const max = Math.max(...data);
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'flex-end',
        gap: '6px',
        height: h
      }
    }, data.map((v, i) => /*#__PURE__*/React.createElement("div", {
      key: i,
      title: fmt(v),
      style: {
        flex: 1,
        height: `${v / max * 100}%`,
        background: i === data.length - 1 ? 'var(--primary-600)' : color,
        borderRadius: '4px 4px 0 0',
        minHeight: '4px'
      }
    })));
  }
  function SectionTitle({
    children,
    action
  }) {
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '14px'
      }
    }, /*#__PURE__*/React.createElement("h2", {
      style: {
        margin: 0,
        fontFamily: 'var(--font-serif)',
        fontSize: '20px',
        fontWeight: 700,
        color: 'var(--ink-900)'
      }
    }, children), action);
  }

  // ===== Seller shell (sidebar + topbar) =====
  const SC_NAV = [{
    id: 'dashboard',
    icon: 'layout-dashboard',
    label: 'Dashboard'
  }, {
    id: 'ordini',
    icon: 'shopping-bag',
    label: 'Ordini',
    badge: 3
  }, {
    id: 'prodotti',
    icon: 'package',
    label: 'Prodotti'
  }, {
    id: 'analytics',
    icon: 'bar-chart-3',
    label: 'Analytics'
  }, {
    id: 'incassi',
    icon: 'wallet',
    label: 'Incassi'
  }, {
    id: 'promozioni',
    icon: 'tag',
    label: 'Promozioni'
  }, {
    id: 'recensioni',
    icon: 'star',
    label: 'Recensioni'
  }, {
    id: 'clienti',
    icon: 'users',
    label: 'Clienti'
  }];
  function Sidebar({
    active,
    onNav
  }) {
    const s = window.SC_STORE;
    return /*#__PURE__*/React.createElement("aside", {
      style: {
        width: '248px',
        flexShrink: 0,
        background: 'var(--ink-900)',
        color: 'var(--cream-100)',
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        position: 'sticky',
        top: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        padding: '20px 20px 16px'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontFamily: 'var(--font-serif)',
        fontSize: '22px',
        fontWeight: 800
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--accent-400)'
      }
    }, "My"), "City ", /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: '11px',
        fontWeight: 600,
        color: 'var(--ink-300)',
        letterSpacing: '0.04em'
      }
    }, "SELLER"))), /*#__PURE__*/React.createElement("div", {
      style: {
        margin: '0 12px 12px',
        padding: '12px',
        background: 'rgba(255,255,255,.06)',
        borderRadius: 'var(--radius-lg)',
        display: 'flex',
        alignItems: 'center',
        gap: '10px'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: '38px',
        height: '38px',
        borderRadius: 'var(--radius-md)',
        background: 'linear-gradient(135deg, var(--primary-500), var(--primary-700))',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 800,
        fontSize: '14px',
        flexShrink: 0
      }
    }, initials(s.name)), /*#__PURE__*/React.createElement("div", {
      style: {
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement("p", {
      style: {
        margin: 0,
        fontSize: '13px',
        fontWeight: 700,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis'
      }
    }, s.name), /*#__PURE__*/React.createElement("p", {
      style: {
        margin: 0,
        fontSize: '11px',
        color: 'var(--accent-300)'
      }
    }, s.plan))), /*#__PURE__*/React.createElement("nav", {
      style: {
        flex: 1,
        overflowY: 'auto',
        padding: '0 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '2px'
      }
    }, SC_NAV.map(n => {
      const on = active === n.id;
      return /*#__PURE__*/React.createElement("button", {
        key: n.id,
        onClick: () => onNav(n.id),
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: '11px',
          width: '100%',
          textAlign: 'left',
          border: 0,
          cursor: 'pointer',
          fontFamily: 'var(--font-sans)',
          fontSize: '14px',
          fontWeight: on ? 700 : 500,
          padding: '10px 12px',
          borderRadius: 'var(--radius-md)',
          background: on ? 'var(--primary-700)' : 'transparent',
          color: on ? '#fff' : 'var(--ink-200)'
        }
      }, /*#__PURE__*/React.createElement(Icon, {
        name: n.icon,
        size: 18,
        color: on ? '#fff' : 'var(--ink-300)'
      }), " ", n.label, n.badge && /*#__PURE__*/React.createElement("span", {
        style: {
          marginLeft: 'auto',
          background: 'var(--accent-500)',
          color: 'var(--ink-900)',
          fontSize: '11px',
          fontWeight: 700,
          borderRadius: '999px',
          padding: '1px 7px'
        }
      }, n.badge));
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        padding: '12px',
        borderTop: '1px solid rgba(255,255,255,.08)'
      }
    }, /*#__PURE__*/React.createElement("button", {
      onClick: () => onNav('profilo'),
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        width: '100%',
        border: 0,
        background: active === 'profilo' ? 'rgba(255,255,255,.08)' : 'transparent',
        color: 'var(--ink-200)',
        cursor: 'pointer',
        padding: '10px 12px',
        borderRadius: 'var(--radius-md)',
        fontFamily: 'var(--font-sans)',
        fontSize: '14px'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: '28px',
        height: '28px',
        borderRadius: '50%',
        background: 'var(--cream-200)',
        color: 'var(--primary-700)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
        fontSize: '12px'
      }
    }, "GV"), "Giorgio Verdi")));
  }
  function Topbar({
    title,
    subtitle,
    actions
  }) {
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '16px',
        padding: '20px 28px',
        borderBottom: '1px solid var(--cream-300)',
        background: 'var(--surface-0)',
        position: 'sticky',
        top: 0,
        zIndex: 20
      }
    }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", {
      style: {
        margin: 0,
        fontFamily: 'var(--font-serif)',
        fontSize: '26px',
        fontWeight: 800,
        color: 'var(--ink-900)'
      }
    }, title), subtitle && /*#__PURE__*/React.createElement("p", {
      style: {
        margin: '2px 0 0',
        fontSize: '13px',
        color: 'var(--ink-500)'
      }
    }, subtitle)), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '10px'
      }
    }, actions, /*#__PURE__*/React.createElement("button", {
      title: "Notifiche",
      style: {
        position: 'relative',
        width: '40px',
        height: '40px',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--cream-300)',
        background: 'var(--surface-0)',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--ink-600)'
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "bell",
      size: 19
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        position: 'absolute',
        top: '8px',
        right: '9px',
        width: '7px',
        height: '7px',
        borderRadius: '50%',
        background: 'var(--secondary-600)'
      }
    }))));
  }
  function Layout({
    active,
    onNav,
    title,
    subtitle,
    actions,
    children
  }) {
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        minHeight: '100vh',
        background: 'var(--surface-50)'
      }
    }, /*#__PURE__*/React.createElement(Sidebar, {
      active: active,
      onNav: onNav
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column'
      }
    }, /*#__PURE__*/React.createElement(Topbar, {
      title: title,
      subtitle: subtitle,
      actions: actions
    }), /*#__PURE__*/React.createElement("main", {
      style: {
        flex: 1,
        padding: '28px',
        maxWidth: '1200px',
        width: '100%'
      }
    }, children)));
  }

  // ===== Seller: Dashboard =====
  function Dashboard({
    onNav,
    onOpenOrder
  }) {
    const recent = window.SC_ORDERS.slice(0, 5);
    const low = window.SC_PRODUCTS.filter(p => p.stock > 0 && p.stock <= 3);
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: '24px'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: '16px'
      }
    }, window.SC_KPIS.map(k => /*#__PURE__*/React.createElement(StatCard, {
      key: k.id,
      kpi: k
    }))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'grid',
        gridTemplateColumns: '1.6fr 1fr',
        gap: '20px',
        alignItems: 'start'
      }
    }, /*#__PURE__*/React.createElement(Card, {
      variant: "bordered",
      padding: "lg"
    }, /*#__PURE__*/React.createElement(SectionTitle, {
      action: /*#__PURE__*/React.createElement(Badge, {
        variant: "new"
      }, "+12,4%")
    }, "Incasso \xB7 ultimi 14 giorni"), /*#__PURE__*/React.createElement(Sparkline, {
      data: window.SC_SALES
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        marginTop: '10px',
        fontSize: '12px',
        color: 'var(--ink-400)'
      }
    }, /*#__PURE__*/React.createElement("span", null, "2 set fa"), /*#__PURE__*/React.createElement("span", null, "1 set fa"), /*#__PURE__*/React.createElement("span", null, "oggi"))), /*#__PURE__*/React.createElement(Card, {
      variant: "bordered",
      padding: "lg"
    }, /*#__PURE__*/React.createElement(SectionTitle, null, "Da fare ora"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: '10px'
      }
    }, /*#__PURE__*/React.createElement(TodoRow, {
      icon: "bell-ring",
      tone: "primary",
      text: "3 nuovi ordini da accettare",
      cta: "Vedi",
      onClick: () => onNav('ordini')
    }), /*#__PURE__*/React.createElement(TodoRow, {
      icon: "package-x",
      tone: "secondary",
      text: `${low.length} prodotti in esaurimento`,
      cta: "Rifornisci",
      onClick: () => onNav('prodotti')
    }), /*#__PURE__*/React.createElement(TodoRow, {
      icon: "wallet",
      tone: "olive",
      text: "\u20AC612 contanti da saldare",
      cta: "Salda",
      onClick: () => onNav('incassi')
    }), /*#__PURE__*/React.createElement(TodoRow, {
      icon: "star",
      tone: "accent",
      text: "1 recensione senza risposta",
      cta: "Rispondi",
      onClick: () => onNav('recensioni')
    })))), /*#__PURE__*/React.createElement(Card, {
      variant: "bordered",
      padding: "none"
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        padding: '16px 20px',
        borderBottom: '1px solid var(--cream-200)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }
    }, /*#__PURE__*/React.createElement("h2", {
      style: {
        margin: 0,
        fontFamily: 'var(--font-serif)',
        fontSize: '18px',
        fontWeight: 700,
        color: 'var(--ink-900)'
      }
    }, "Ordini recenti"), /*#__PURE__*/React.createElement(Button, {
      variant: "ghost",
      size: "sm",
      iconRight: "arrow-right",
      onClick: () => onNav('ordini')
    }, "Tutti gli ordini")), /*#__PURE__*/React.createElement(OrdersTable, {
      orders: recent,
      onOpenOrder: onOpenOrder,
      compact: true
    })));
  }
  function TodoRow({
    icon,
    tone,
    text,
    cta,
    onClick
  }) {
    const t = TONES[tone] || TONES.primary;
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '10px 12px',
        borderRadius: 'var(--radius-md)',
        background: 'var(--cream-50)'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: '34px',
        height: '34px',
        borderRadius: 'var(--radius-md)',
        background: t[0],
        color: t[1],
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: icon,
      size: 17,
      color: t[1]
    })), /*#__PURE__*/React.createElement("span", {
      style: {
        flex: 1,
        fontSize: '14px',
        color: 'var(--ink-800)',
        fontWeight: 500
      }
    }, text), /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      size: "sm",
      onClick: onClick
    }, cta));
  }

  // ===== Seller: Orders (table + detail) =====
  function OrdersTable({
    orders,
    onOpenOrder,
    compact
  }) {
    return /*#__PURE__*/React.createElement("div", {
      style: {
        overflowX: 'auto'
      }
    }, /*#__PURE__*/React.createElement("table", {
      style: {
        width: '100%',
        borderCollapse: 'collapse',
        fontFamily: 'var(--font-sans)'
      }
    }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
      style: {
        textAlign: 'left',
        fontSize: '12px',
        color: 'var(--ink-500)',
        textTransform: 'uppercase',
        letterSpacing: '0.03em'
      }
    }, /*#__PURE__*/React.createElement("th", {
      style: th
    }, "Ordine"), /*#__PURE__*/React.createElement("th", {
      style: th
    }, "Cliente"), !compact && /*#__PURE__*/React.createElement("th", {
      style: th
    }, "Articoli"), /*#__PURE__*/React.createElement("th", {
      style: th
    }, "Totale"), /*#__PURE__*/React.createElement("th", {
      style: th
    }, "Pagamento"), /*#__PURE__*/React.createElement("th", {
      style: th
    }, "Stato"), /*#__PURE__*/React.createElement("th", {
      style: th
    }))), /*#__PURE__*/React.createElement("tbody", null, orders.map(o => /*#__PURE__*/React.createElement("tr", {
      key: o.id,
      style: {
        borderTop: '1px solid var(--cream-200)',
        cursor: 'pointer'
      },
      onClick: () => onOpenOrder(o)
    }, /*#__PURE__*/React.createElement("td", {
      style: td
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontWeight: 700,
        color: 'var(--ink-900)'
      }
    }, o.id), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: '12px',
        color: 'var(--ink-400)'
      }
    }, o.when)), /*#__PURE__*/React.createElement("td", {
      style: td
    }, o.customer), !compact && /*#__PURE__*/React.createElement("td", {
      style: td
    }, o.items), /*#__PURE__*/React.createElement("td", {
      style: {
        ...td,
        fontWeight: 700,
        color: 'var(--ink-900)'
      }
    }, fmt(o.total)), /*#__PURE__*/React.createElement("td", {
      style: td
    }, /*#__PURE__*/React.createElement(Badge, {
      variant: "cod",
      icon: "banknote"
    }, "Consegna")), /*#__PURE__*/React.createElement("td", {
      style: td
    }, /*#__PURE__*/React.createElement(OrderStatusBadge, {
      status: o.status,
      size: "sm"
    })), /*#__PURE__*/React.createElement("td", {
      style: {
        ...td,
        textAlign: 'right'
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "chevron-right",
      size: 16,
      color: "var(--ink-400)"
    })))))));
  }
  const th = {
    padding: '12px 20px',
    fontWeight: 600
  };
  const td = {
    padding: '14px 20px',
    fontSize: '14px',
    color: 'var(--ink-700)',
    verticalAlign: 'middle'
  };
  function OrdersView({
    onOpenOrder
  }) {
    const [filter, setFilter] = React.useState('all');
    const tabs = [['all', 'Tutti'], ['NEW', 'Nuovi'], ['ACCEPTED', 'In preparazione'], ['READY', 'Pronti'], ['OUT_FOR_DELIVERY', 'In consegna'], ['DELIVERED', 'Consegnati']];
    const orders = window.SC_ORDERS.filter(o => filter === 'all' || o.status === filter);
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: '16px'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: '6px',
        flexWrap: 'wrap'
      }
    }, tabs.map(([id, label]) => {
      const on = filter === id;
      const count = id === 'all' ? window.SC_ORDERS.length : window.SC_ORDERS.filter(o => o.status === id).length;
      return /*#__PURE__*/React.createElement("button", {
        key: id,
        onClick: () => setFilter(id),
        style: {
          border: `1px solid ${on ? 'var(--primary-600)' : 'var(--cream-300)'}`,
          background: on ? 'var(--primary-700)' : 'var(--surface-0)',
          color: on ? '#fff' : 'var(--ink-700)',
          padding: '8px 14px',
          borderRadius: 'var(--radius-full)',
          fontSize: '13px',
          fontWeight: 600,
          cursor: 'pointer',
          fontFamily: 'var(--font-sans)'
        }
      }, label, " ", count > 0 && /*#__PURE__*/React.createElement("span", {
        style: {
          opacity: .7
        }
      }, "\xB7 ", count));
    })), /*#__PURE__*/React.createElement(Card, {
      variant: "bordered",
      padding: "none"
    }, orders.length === 0 ? /*#__PURE__*/React.createElement("div", {
      style: {
        padding: '24px'
      }
    }, /*#__PURE__*/React.createElement(EmptyState, {
      icon: "inbox",
      title: "Nessun ordine",
      description: "Non ci sono ordini in questo stato."
    })) : /*#__PURE__*/React.createElement(OrdersTable, {
      orders: orders,
      onOpenOrder: onOpenOrder
    })));
  }
  const SC_FLOW = ['NEW', 'ACCEPTED', 'READY', 'ASSIGNED', 'OUT_FOR_DELIVERY', 'DELIVERED'];
  function OrderDetail({
    order,
    onClose,
    onAdvance
  }) {
    if (!order) return null;
    const lines = window.SC_ORDER_LINES[order.id] || [{
      n: 'Prodotto',
      q: order.items,
      p: order.total / order.items,
      kw: 'salami',
      lock: 7
    }];
    const idx = SC_FLOW.indexOf(order.status);
    const next = idx >= 0 && idx < SC_FLOW.length - 1 ? SC_FLOW[idx + 1] : null;
    const NEXT_LABEL = {
      ACCEPTED: 'Accetta ordine',
      READY: 'Segna pronto',
      ASSIGNED: 'Assegna rider',
      OUT_FOR_DELIVERY: 'Affida al rider',
      DELIVERED: 'Segna consegnato'
    };
    return /*#__PURE__*/React.createElement(Modal, {
      open: !!order,
      onClose: onClose,
      title: `Ordine ${order.id}`,
      description: `${order.when} · ${order.customer}`,
      size: "lg",
      footer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
        variant: "ghost",
        onClick: onClose
      }, "Chiudi"), order.status !== 'CANCELED' && order.status !== 'DELIVERED' && next && /*#__PURE__*/React.createElement(Button, {
        variant: "primary",
        icon: "check",
        onClick: () => onAdvance(order, next)
      }, NEXT_LABEL[next]))
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: '16px'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }
    }, /*#__PURE__*/React.createElement(OrderStatusBadge, {
      status: order.status
    }), /*#__PURE__*/React.createElement(Badge, {
      variant: "cod",
      icon: "banknote"
    }, "Paga alla consegna \xB7 ", fmt(order.total))), /*#__PURE__*/React.createElement("div", {
      style: {
        border: '1px solid var(--cream-300)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden'
      }
    }, lines.map((l, i) => /*#__PURE__*/React.createElement("div", {
      key: i,
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '12px 14px',
        borderBottom: i < lines.length - 1 ? '1px solid var(--cream-200)' : 'none'
      }
    }, /*#__PURE__*/React.createElement("img", {
      src: imgUrl(l.kw, l.lock),
      alt: l.n,
      style: {
        width: '44px',
        height: '44px',
        borderRadius: 'var(--radius-md)',
        objectFit: 'cover'
      }
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1
      }
    }, /*#__PURE__*/React.createElement("p", {
      style: {
        margin: 0,
        fontSize: '14px',
        fontWeight: 600,
        color: 'var(--ink-900)'
      }
    }, l.n), /*#__PURE__*/React.createElement("p", {
      style: {
        margin: 0,
        fontSize: '12px',
        color: 'var(--ink-500)'
      }
    }, "\xD7 ", l.q)), /*#__PURE__*/React.createElement("span", {
      style: {
        fontWeight: 700,
        color: 'var(--ink-900)'
      }
    }, fmt(l.p * l.q))))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: '18px',
        fontWeight: 800,
        color: 'var(--ink-900)'
      }
    }, /*#__PURE__*/React.createElement("span", null, "Totale"), /*#__PURE__*/React.createElement("span", null, fmt(order.total))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '12px',
        background: 'var(--cream-50)',
        borderRadius: 'var(--radius-md)',
        fontSize: '13px',
        color: 'var(--ink-600)'
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "map-pin",
      size: 16,
      color: "var(--primary-600)"
    }), " ", order.customer, " \xB7 Via Roma 12, Piacenza \xB7 contanti al rider")));
  }

  // ===== Seller: Products =====
  function ProductsView() {
    const [editing, setEditing] = React.useState(null); // product or 'new'
    const [q, setQ] = React.useState('');
    const STATUS = {
      active: ['Attivo', 'new'],
      soldout: ['Esaurito', 'soldout'],
      draft: ['Bozza', 'local']
    };
    const list = window.SC_PRODUCTS.filter(p => !q || p.name.toLowerCase().includes(q.toLowerCase()));
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: '16px'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: '10px',
        alignItems: 'center'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        maxWidth: '320px'
      }
    }, /*#__PURE__*/React.createElement(Input, {
      placeholder: "Cerca nel catalogo\u2026",
      value: q,
      onChange: e => setQ(e.target.value),
      leading: /*#__PURE__*/React.createElement(Icon, {
        name: "search",
        size: 16,
        color: "var(--ink-400)"
      })
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        marginLeft: 'auto'
      }
    }, /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      icon: "plus",
      onClick: () => setEditing('new')
    }, "Nuovo prodotto"))), /*#__PURE__*/React.createElement(Card, {
      variant: "bordered",
      padding: "none"
    }, /*#__PURE__*/React.createElement("table", {
      style: {
        width: '100%',
        borderCollapse: 'collapse'
      }
    }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
      style: {
        textAlign: 'left',
        fontSize: '12px',
        color: 'var(--ink-500)',
        textTransform: 'uppercase',
        letterSpacing: '0.03em'
      }
    }, /*#__PURE__*/React.createElement("th", {
      style: th
    }, "Prodotto"), /*#__PURE__*/React.createElement("th", {
      style: th
    }, "Categoria"), /*#__PURE__*/React.createElement("th", {
      style: th
    }, "Prezzo"), /*#__PURE__*/React.createElement("th", {
      style: th
    }, "Scorte"), /*#__PURE__*/React.createElement("th", {
      style: th
    }, "Venduti"), /*#__PURE__*/React.createElement("th", {
      style: th
    }, "Stato"), /*#__PURE__*/React.createElement("th", {
      style: th
    }))), /*#__PURE__*/React.createElement("tbody", null, list.map(p => /*#__PURE__*/React.createElement("tr", {
      key: p.id,
      style: {
        borderTop: '1px solid var(--cream-200)'
      }
    }, /*#__PURE__*/React.createElement("td", {
      style: td
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '10px'
      }
    }, /*#__PURE__*/React.createElement("img", {
      src: imgUrl(p.kw, p.lock),
      alt: p.name,
      style: {
        width: '40px',
        height: '40px',
        borderRadius: 'var(--radius-md)',
        objectFit: 'cover'
      }
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        fontWeight: 600,
        color: 'var(--ink-900)'
      }
    }, p.name))), /*#__PURE__*/React.createElement("td", {
      style: td
    }, p.cat), /*#__PURE__*/React.createElement("td", {
      style: {
        ...td,
        fontWeight: 700,
        color: 'var(--ink-900)'
      }
    }, fmt(p.price)), /*#__PURE__*/React.createElement("td", {
      style: td
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        color: p.stock === 0 ? 'var(--secondary-600)' : p.stock <= 3 ? 'var(--accent-700)' : 'var(--ink-700)',
        fontWeight: p.stock <= 3 ? 700 : 500
      }
    }, p.stock)), /*#__PURE__*/React.createElement("td", {
      style: td
    }, p.sold), /*#__PURE__*/React.createElement("td", {
      style: td
    }, /*#__PURE__*/React.createElement(Badge, {
      variant: STATUS[p.status][1]
    }, STATUS[p.status][0])), /*#__PURE__*/React.createElement("td", {
      style: {
        ...td,
        textAlign: 'right'
      }
    }, /*#__PURE__*/React.createElement(Button, {
      variant: "ghost",
      size: "sm",
      icon: "pencil",
      onClick: () => setEditing(p)
    }, "Modifica"))))))), /*#__PURE__*/React.createElement(ProductEditor, {
      product: editing === 'new' ? null : editing,
      open: !!editing,
      onClose: () => setEditing(null)
    }));
  }
  function ProductEditor({
    product,
    open,
    onClose
  }) {
    if (!open) return null;
    const isNew = !product;
    return /*#__PURE__*/React.createElement(Modal, {
      open: open,
      onClose: onClose,
      title: isNew ? 'Nuovo prodotto' : 'Modifica prodotto',
      size: "lg",
      footer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
        variant: "ghost",
        onClick: onClose
      }, "Annulla"), /*#__PURE__*/React.createElement(Button, {
        variant: "primary",
        icon: "check",
        onClick: onClose
      }, isNew ? 'Pubblica' : 'Salva'))
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'grid',
        gridTemplateColumns: '120px 1fr',
        gap: '18px'
      }
    }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      style: {
        width: '120px',
        height: '120px',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        border: '1px solid var(--cream-300)',
        background: 'var(--surface-100)'
      }
    }, product ? /*#__PURE__*/React.createElement("img", {
      src: imgUrl(product.kw, product.lock),
      alt: "",
      style: {
        width: '100%',
        height: '100%',
        objectFit: 'cover'
      }
    }) : /*#__PURE__*/React.createElement("div", {
      style: {
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--ink-300)'
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "image-plus",
      size: 28,
      color: "var(--ink-300)"
    }))), /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      size: "sm",
      icon: "upload",
      style: {
        marginTop: '8px',
        width: '120px'
      }
    }, "Foto")), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: '12px'
      }
    }, /*#__PURE__*/React.createElement(Input, {
      label: "Nome prodotto",
      defaultValue: product ? product.name : '',
      placeholder: "Es. Coppa Piacentina DOP 200g"
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr',
        gap: '12px'
      }
    }, /*#__PURE__*/React.createElement(Input, {
      label: "Prezzo (\u20AC)",
      defaultValue: product ? String(product.price) : '',
      placeholder: "0,00"
    }), /*#__PURE__*/React.createElement(Input, {
      label: "Scorte",
      defaultValue: product ? String(product.stock) : '',
      placeholder: "0"
    }), /*#__PURE__*/React.createElement(Select, {
      label: "Categoria",
      defaultValue: product ? product.cat : 'Salumi'
    }, /*#__PURE__*/React.createElement("option", null, "Salumi"), /*#__PURE__*/React.createElement("option", null, "Formaggi"), /*#__PURE__*/React.createElement("option", null, "Conserve"))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
      style: {
        fontSize: '14px',
        fontWeight: 500,
        color: 'var(--ink-700)'
      }
    }, "Descrizione"), /*#__PURE__*/React.createElement("textarea", {
      rows: "3",
      defaultValue: product ? 'Stagionata 90 giorni, taglio a mano.' : '',
      placeholder: "Racconta il prodotto\u2026",
      style: {
        width: '100%',
        boxSizing: 'border-box',
        marginTop: '5px',
        border: '1px solid var(--cream-300)',
        borderRadius: 'var(--radius-md)',
        padding: '10px 12px',
        fontFamily: 'var(--font-sans)',
        fontSize: '15px',
        resize: 'vertical',
        outline: 'none'
      }
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: '8px',
        flexWrap: 'wrap'
      }
    }, /*#__PURE__*/React.createElement(Badge, {
      variant: "local"
    }, "DOP"), /*#__PURE__*/React.createElement(Badge, {
      variant: "local"
    }, "Taglio a mano"), /*#__PURE__*/React.createElement("button", {
      style: {
        border: '1px dashed var(--cream-400)',
        background: 'transparent',
        color: 'var(--primary-700)',
        borderRadius: 'var(--radius-sm)',
        fontSize: '11px',
        padding: '2px 8px',
        cursor: 'pointer',
        fontFamily: 'var(--font-sans)'
      }
    }, "+ Tag")))));
  }

  // ===== Seller: Analytics =====
  function AnalyticsView() {
    const top = [...window.SC_PRODUCTS].sort((a, b) => b.sold - a.sold).slice(0, 5);
    const maxSold = Math.max(...top.map(p => p.sold));
    const byCat = [['Salumi', 64], ['Formaggi', 28], ['Conserve', 8]];
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: '20px'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: '16px'
      }
    }, [['Visite vetrina', '3.842', '+18%'], ['Tasso conversione', '4,8%', '+0,6pt'], ['Prodotti venduti', '423', '+9%'], ['Resi', '1,2%', '-0,3pt']].map(([l, v, d]) => /*#__PURE__*/React.createElement(Card, {
      key: l,
      variant: "bordered",
      padding: "lg"
    }, /*#__PURE__*/React.createElement("p", {
      style: {
        margin: 0,
        fontSize: '13px',
        color: 'var(--ink-500)',
        fontWeight: 600
      }
    }, l), /*#__PURE__*/React.createElement("p", {
      style: {
        margin: '6px 0 0',
        fontFamily: 'var(--font-serif)',
        fontSize: '26px',
        fontWeight: 800,
        color: 'var(--ink-900)'
      }
    }, v), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: '12px',
        fontWeight: 700,
        color: 'var(--olive-700)'
      }
    }, d)))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'grid',
        gridTemplateColumns: '1.6fr 1fr',
        gap: '20px',
        alignItems: 'start'
      }
    }, /*#__PURE__*/React.createElement(Card, {
      variant: "bordered",
      padding: "lg"
    }, /*#__PURE__*/React.createElement(SectionTitle, null, "Vendite per giorno \xB7 14 giorni"), /*#__PURE__*/React.createElement(Bars, {
      data: window.SC_SALES,
      h: 180
    })), /*#__PURE__*/React.createElement(Card, {
      variant: "bordered",
      padding: "lg"
    }, /*#__PURE__*/React.createElement(SectionTitle, null, "Vendite per categoria"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        marginTop: '4px'
      }
    }, byCat.map(([c, pct], i) => /*#__PURE__*/React.createElement("div", {
      key: c
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: '13px',
        marginBottom: '4px'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--ink-700)',
        fontWeight: 600
      }
    }, c), /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--ink-500)'
      }
    }, pct, "%")), /*#__PURE__*/React.createElement("div", {
      style: {
        height: '10px',
        background: 'var(--cream-200)',
        borderRadius: '5px',
        overflow: 'hidden'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        width: pct + '%',
        height: '100%',
        background: ['var(--primary-600)', 'var(--accent-500)', 'var(--olive-500)'][i]
      }
    }))))))), /*#__PURE__*/React.createElement(Card, {
      variant: "bordered",
      padding: "lg"
    }, /*#__PURE__*/React.createElement(SectionTitle, null, "Prodotti pi\xF9 venduti"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: '12px'
      }
    }, top.map((p, i) => /*#__PURE__*/React.createElement("div", {
      key: p.id,
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '12px'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: '22px',
        fontFamily: 'var(--font-serif)',
        fontWeight: 800,
        color: 'var(--ink-400)'
      }
    }, i + 1), /*#__PURE__*/React.createElement("img", {
      src: imgUrl(p.kw, p.lock),
      alt: p.name,
      style: {
        width: '36px',
        height: '36px',
        borderRadius: 'var(--radius-md)',
        objectFit: 'cover'
      }
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        flex: 1,
        fontSize: '14px',
        fontWeight: 600,
        color: 'var(--ink-900)'
      }
    }, p.name), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        maxWidth: '200px',
        height: '8px',
        background: 'var(--cream-200)',
        borderRadius: '4px',
        overflow: 'hidden'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        width: p.sold / maxSold * 100 + '%',
        height: '100%',
        background: 'var(--primary-600)'
      }
    })), /*#__PURE__*/React.createElement("span", {
      style: {
        width: '60px',
        textAlign: 'right',
        fontSize: '13px',
        fontWeight: 700,
        color: 'var(--ink-900)'
      }
    }, p.sold, " pz"))))));
  }

  // ===== Seller: Earnings, Promos, Reviews, Customers, Profile =====
  function EarningsView() {
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: '20px'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '16px'
      }
    }, /*#__PURE__*/React.createElement(Card, {
      variant: "bordered",
      padding: "lg",
      style: {
        background: 'var(--olive-50)',
        borderColor: 'var(--olive-200)'
      }
    }, /*#__PURE__*/React.createElement("p", {
      style: {
        margin: 0,
        fontSize: '13px',
        color: 'var(--olive-800)',
        fontWeight: 600
      }
    }, "Saldo disponibile"), /*#__PURE__*/React.createElement("p", {
      style: {
        margin: '6px 0 12px',
        fontFamily: 'var(--font-serif)',
        fontSize: '32px',
        fontWeight: 800,
        color: 'var(--ink-900)'
      }
    }, "\u20AC1.226,40"), /*#__PURE__*/React.createElement(Button, {
      variant: "success",
      icon: "banknote"
    }, "Richiedi payout")), /*#__PURE__*/React.createElement(Card, {
      variant: "bordered",
      padding: "lg",
      style: {
        background: 'var(--secondary-50)',
        borderColor: 'var(--secondary-200)'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start'
      }
    }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
      style: {
        margin: 0,
        fontSize: '13px',
        color: 'var(--secondary-700)',
        fontWeight: 600
      }
    }, "Contanti incassati da saldare"), /*#__PURE__*/React.createElement("p", {
      style: {
        margin: '6px 0 12px',
        fontFamily: 'var(--font-serif)',
        fontSize: '32px',
        fontWeight: 800,
        color: 'var(--ink-900)'
      }
    }, "\u20AC612,00")), /*#__PURE__*/React.createElement(Icon, {
      name: "wallet",
      size: 26,
      color: "var(--secondary-600)"
    })), /*#__PURE__*/React.createElement("p", {
      style: {
        margin: '0 0 12px',
        fontSize: '12px',
        color: 'var(--ink-600)'
      }
    }, "I rider ti consegnano i contanti raccolti; la quota MyCity viene trattenuta dal payout."), /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      icon: "check"
    }, "Conferma saldo contanti"))), /*#__PURE__*/React.createElement(Card, {
      variant: "bordered",
      padding: "none"
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        padding: '16px 20px',
        borderBottom: '1px solid var(--cream-200)'
      }
    }, /*#__PURE__*/React.createElement("h2", {
      style: {
        margin: 0,
        fontFamily: 'var(--font-serif)',
        fontSize: '18px',
        fontWeight: 700,
        color: 'var(--ink-900)'
      }
    }, "Storico payout")), /*#__PURE__*/React.createElement("table", {
      style: {
        width: '100%',
        borderCollapse: 'collapse'
      }
    }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
      style: {
        textAlign: 'left',
        fontSize: '12px',
        color: 'var(--ink-500)',
        textTransform: 'uppercase'
      }
    }, /*#__PURE__*/React.createElement("th", {
      style: th
    }, "ID"), /*#__PURE__*/React.createElement("th", {
      style: th
    }, "Periodo"), /*#__PURE__*/React.createElement("th", {
      style: th
    }, "Importo"), /*#__PURE__*/React.createElement("th", {
      style: th
    }, "Stato"), /*#__PURE__*/React.createElement("th", {
      style: th
    }, "Data"))), /*#__PURE__*/React.createElement("tbody", null, window.SC_PAYOUTS.map(p => /*#__PURE__*/React.createElement("tr", {
      key: p.id,
      style: {
        borderTop: '1px solid var(--cream-200)'
      }
    }, /*#__PURE__*/React.createElement("td", {
      style: {
        ...td,
        fontWeight: 700,
        color: 'var(--ink-900)'
      }
    }, p.id), /*#__PURE__*/React.createElement("td", {
      style: td
    }, p.period), /*#__PURE__*/React.createElement("td", {
      style: {
        ...td,
        fontWeight: 700
      }
    }, fmt(p.amount)), /*#__PURE__*/React.createElement("td", {
      style: td
    }, /*#__PURE__*/React.createElement(Badge, {
      variant: "new"
    }, p.status)), /*#__PURE__*/React.createElement("td", {
      style: td
    }, p.when)))))));
  }
  function PromosView() {
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: '16px'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        marginLeft: 'auto'
      }
    }, /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      icon: "plus"
    }, "Nuova promozione"))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '16px'
      }
    }, window.SC_PROMOS.map(p => /*#__PURE__*/React.createElement(Card, {
      key: p.id,
      variant: "bordered",
      padding: "lg"
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '8px'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: 'var(--font-mono)',
        fontSize: '13px',
        fontWeight: 700,
        background: 'var(--cream-200)',
        padding: '3px 8px',
        borderRadius: 'var(--radius-sm)',
        color: 'var(--ink-800)'
      }
    }, p.id), /*#__PURE__*/React.createElement(Badge, {
      variant: p.status === 'active' ? 'new' : 'soldout'
    }, p.status === 'active' ? 'Attiva' : 'Terminata')), /*#__PURE__*/React.createElement("p", {
      style: {
        margin: 0,
        fontFamily: 'var(--font-serif)',
        fontSize: '18px',
        fontWeight: 700,
        color: 'var(--ink-900)'
      }
    }, p.type), /*#__PURE__*/React.createElement("p", {
      style: {
        margin: '2px 0 12px',
        fontSize: '13px',
        color: 'var(--ink-500)'
      }
    }, p.cond), /*#__PURE__*/React.createElement("div", {
      style: {
        height: '8px',
        background: 'var(--cream-200)',
        borderRadius: '4px',
        overflow: 'hidden'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        width: p.uses / p.cap * 100 + '%',
        height: '100%',
        background: 'var(--accent-500)'
      }
    })), /*#__PURE__*/React.createElement("p", {
      style: {
        margin: '6px 0 0',
        fontSize: '12px',
        color: 'var(--ink-500)'
      }
    }, p.uses, " / ", p.cap, " utilizzi")))));
  }
  function ReviewsView() {
    const [reviews, setReviews] = React.useState(window.SC_REVIEWS);
    function reply(i) {
      setReviews(prev => prev.map((r, j) => j === i ? {
        ...r,
        reply: 'Grazie mille per il feedback!'
      } : r));
    }
    const avg = (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1).replace('.', ',');
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: '16px'
      }
    }, /*#__PURE__*/React.createElement(Card, {
      variant: "bordered",
      padding: "lg"
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '16px'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        textAlign: 'center'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontFamily: 'var(--font-serif)',
        fontSize: '40px',
        fontWeight: 800,
        color: 'var(--ink-900)',
        lineHeight: 1
      }
    }, avg), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: '12px',
        color: 'var(--ink-500)'
      }
    }, window.SC_STORE.reviews, " recensioni")), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        fontSize: '14px',
        color: 'var(--ink-600)'
      }
    }, "Rispondi alle recensioni per fidelizzare i clienti. Un negozio che risponde vende il ", /*#__PURE__*/React.createElement("strong", {
      style: {
        color: 'var(--ink-900)'
      }
    }, "+23%"), "."))), reviews.map((r, i) => /*#__PURE__*/React.createElement(Card, {
      key: i,
      variant: "bordered",
      padding: "lg"
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        marginBottom: '6px'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: '34px',
        height: '34px',
        borderRadius: '50%',
        background: 'var(--cream-200)',
        color: 'var(--primary-700)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
        fontSize: '13px'
      }
    }, initials(r.who)), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1
      }
    }, /*#__PURE__*/React.createElement("strong", {
      style: {
        fontSize: '14px',
        color: 'var(--ink-900)'
      }
    }, r.who), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: '12px',
        color: 'var(--ink-400)'
      }
    }, r.when, " \xB7 ", r.product)), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'inline-flex',
        gap: '1px'
      }
    }, [1, 2, 3, 4, 5].map(s => /*#__PURE__*/React.createElement(Icon, {
      key: s,
      name: "star",
      size: 14,
      color: s <= r.rating ? 'var(--accent-500)' : 'var(--cream-300)'
    })))), /*#__PURE__*/React.createElement("p", {
      style: {
        margin: '0 0 10px',
        fontSize: '14px',
        color: 'var(--ink-700)',
        lineHeight: 1.5
      }
    }, r.text), r.reply ? /*#__PURE__*/React.createElement("div", {
      style: {
        background: 'var(--cream-50)',
        borderLeft: '3px solid var(--primary-400)',
        padding: '10px 12px',
        borderRadius: '0 var(--radius-md) var(--radius-md) 0',
        fontSize: '13px',
        color: 'var(--ink-700)'
      }
    }, /*#__PURE__*/React.createElement("strong", {
      style: {
        color: 'var(--primary-700)'
      }
    }, "La tua risposta \xB7 "), r.reply) : /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      size: "sm",
      icon: "reply",
      onClick: () => reply(i)
    }, "Rispondi"))));
  }
  function CustomersView() {
    return /*#__PURE__*/React.createElement(Card, {
      variant: "bordered",
      padding: "none"
    }, /*#__PURE__*/React.createElement("table", {
      style: {
        width: '100%',
        borderCollapse: 'collapse'
      }
    }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
      style: {
        textAlign: 'left',
        fontSize: '12px',
        color: 'var(--ink-500)',
        textTransform: 'uppercase'
      }
    }, /*#__PURE__*/React.createElement("th", {
      style: th
    }, "Cliente"), /*#__PURE__*/React.createElement("th", {
      style: th
    }, "Zona"), /*#__PURE__*/React.createElement("th", {
      style: th
    }, "Ordini"), /*#__PURE__*/React.createElement("th", {
      style: th
    }, "Speso"), /*#__PURE__*/React.createElement("th", {
      style: th
    }, "Ultimo"))), /*#__PURE__*/React.createElement("tbody", null, window.SC_CUSTOMERS.map(c => /*#__PURE__*/React.createElement("tr", {
      key: c.name,
      style: {
        borderTop: '1px solid var(--cream-200)'
      }
    }, /*#__PURE__*/React.createElement("td", {
      style: td
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '10px'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: '34px',
        height: '34px',
        borderRadius: '50%',
        background: 'linear-gradient(135deg, var(--primary-500), var(--primary-700))',
        color: '#fff',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
        fontSize: '13px'
      }
    }, initials(c.name)), /*#__PURE__*/React.createElement("span", {
      style: {
        fontWeight: 600,
        color: 'var(--ink-900)'
      }
    }, c.name))), /*#__PURE__*/React.createElement("td", {
      style: td
    }, c.area), /*#__PURE__*/React.createElement("td", {
      style: td
    }, c.orders), /*#__PURE__*/React.createElement("td", {
      style: {
        ...td,
        fontWeight: 700,
        color: 'var(--ink-900)'
      }
    }, fmt(c.spent)), /*#__PURE__*/React.createElement("td", {
      style: td
    }, c.last))))));
  }
  function ProfileView() {
    const s = window.SC_STORE;
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '20px',
        alignItems: 'start'
      }
    }, /*#__PURE__*/React.createElement(Card, {
      variant: "bordered",
      padding: "lg"
    }, /*#__PURE__*/React.createElement(SectionTitle, null, "Vetrina"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: '12px'
      }
    }, /*#__PURE__*/React.createElement(Input, {
      label: "Nome negozio",
      defaultValue: s.name
    }), /*#__PURE__*/React.createElement(Input, {
      label: "Zona",
      defaultValue: s.area
    }), /*#__PURE__*/React.createElement(Select, {
      label: "Categoria principale",
      defaultValue: "Gastronomia"
    }, /*#__PURE__*/React.createElement("option", null, "Gastronomia"), /*#__PURE__*/React.createElement("option", null, "Alimentari"), /*#__PURE__*/React.createElement("option", null, "Vini & Cantina")), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
      style: {
        fontSize: '14px',
        fontWeight: 500,
        color: 'var(--ink-700)'
      }
    }, "Descrizione"), /*#__PURE__*/React.createElement("textarea", {
      rows: "3",
      defaultValue: "Salumi e formaggi piacentini selezionati, tagliati a mano ogni giorno.",
      style: {
        width: '100%',
        boxSizing: 'border-box',
        marginTop: '5px',
        border: '1px solid var(--cream-300)',
        borderRadius: 'var(--radius-md)',
        padding: '10px 12px',
        fontFamily: 'var(--font-sans)',
        fontSize: '15px',
        resize: 'vertical'
      }
    })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Button, {
      variant: "primary"
    }, "Salva vetrina")))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: '20px'
      }
    }, /*#__PURE__*/React.createElement(Card, {
      variant: "bordered",
      padding: "lg"
    }, /*#__PURE__*/React.createElement(SectionTitle, null, "Orari & consegna"), [['Lun – Ven', '8:00 – 19:30'], ['Sabato', '8:00 – 19:30'], ['Domenica', 'Chiuso']].map(([d, h]) => /*#__PURE__*/React.createElement("div", {
      key: d,
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        padding: '8px 0',
        borderBottom: '1px solid var(--cream-200)',
        fontSize: '14px'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--ink-600)'
      }
    }, d), /*#__PURE__*/React.createElement("span", {
      style: {
        fontWeight: 600,
        color: h === 'Chiuso' ? 'var(--secondary-600)' : 'var(--ink-900)'
      }
    }, h))), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: '12px'
      }
    }, /*#__PURE__*/React.createElement(Checkbox, {
      defaultChecked: true,
      label: "Consegna in giornata disponibile"
    }))), /*#__PURE__*/React.createElement(Card, {
      variant: "bordered",
      padding: "lg",
      style: {
        background: 'var(--ink-900)',
        color: '#fff'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        marginBottom: '8px'
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: "shield-check",
      size: 20,
      color: "var(--accent-400)"
    }), /*#__PURE__*/React.createElement("strong", {
      style: {
        fontFamily: 'var(--font-serif)',
        fontSize: '17px'
      }
    }, "Piano ", s.plan)), /*#__PURE__*/React.createElement("p", {
      style: {
        margin: 0,
        fontSize: '13px',
        color: 'var(--ink-300)',
        lineHeight: 1.5
      }
    }, "Zero commissioni sugli ordini. Attivo dal ", s.since, ". Verificato da MyCity."))));
  }

  // ===== Seller app shell =====
  function App() {
    const [view, setView] = React.useState('dashboard');
    const [order, setOrder] = React.useState(null);
    const [orders, setOrders] = React.useState(window.SC_ORDERS);
    function nav(v) {
      setView(v);
      window.scrollTo(0, 0);
    }
    function advance(o, next) {
      setOrders(prev => prev.map(x => x.id === o.id ? {
        ...x,
        status: next
      } : x));
      setOrder(cur => cur ? {
        ...cur,
        status: next
      } : cur);
    }
    const TITLES = {
      dashboard: ['Ciao, Giorgio 👋', 'Ecco com’è andata oggi a ' + window.SC_STORE.name],
      ordini: ['Ordini', 'Gestisci e fai avanzare gli ordini'],
      prodotti: ['Prodotti', 'Il tuo catalogo'],
      analytics: ['Analytics', 'Andamento del negozio'],
      incassi: ['Incassi', 'Pagamenti alla consegna e payout'],
      promozioni: ['Promozioni', 'Coupon e offerte'],
      recensioni: ['Recensioni', 'Cosa dicono i clienti'],
      clienti: ['Clienti', 'I tuoi clienti abituali'],
      profilo: ['Profilo negozio', 'Vetrina e impostazioni']
    };
    const [title, subtitle] = TITLES[view] || ['', ''];
    const actions = view === 'prodotti' ? /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      icon: "plus"
    }, "Nuovo prodotto") : view === 'dashboard' ? /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      icon: "external-link"
    }, "Vai al negozio") : null;

    // window.SC_ORDERS kept in sync for child views reading it
    window.SC_ORDERS = orders;
    return /*#__PURE__*/React.createElement(Layout, {
      active: view,
      onNav: nav,
      title: title,
      subtitle: subtitle,
      actions: actions
    }, view === 'dashboard' && /*#__PURE__*/React.createElement(Dashboard, {
      onNav: nav,
      onOpenOrder: setOrder
    }), view === 'ordini' && /*#__PURE__*/React.createElement(OrdersView, {
      onOpenOrder: setOrder
    }), view === 'prodotti' && /*#__PURE__*/React.createElement(ProductsView, null), view === 'analytics' && /*#__PURE__*/React.createElement(AnalyticsView, null), view === 'incassi' && /*#__PURE__*/React.createElement(EarningsView, null), view === 'promozioni' && /*#__PURE__*/React.createElement(PromosView, null), view === 'recensioni' && /*#__PURE__*/React.createElement(ReviewsView, null), view === 'clienti' && /*#__PURE__*/React.createElement(CustomersView, null), view === 'profilo' && /*#__PURE__*/React.createElement(ProfileView, null), /*#__PURE__*/React.createElement(OrderDetail, {
      order: order,
      onClose: () => setOrder(null),
      onAdvance: advance
    }));
  }
  function __ready() {
    var ns = window.MyCityDesignSystem_105480;
    return ns && ns.Button && ns.Card && ns.OrderStatusBadge && ns.Modal && window.SC_ORDERS;
  }
  function __mountOnce() {
    var el = document.getElementById('root');
    if (!el) return;
    try {
      if (window.__scRoot) {
        window.__scRoot.unmount();
      }
    } catch (e) {}
    el.innerHTML = '';
    window.__scRoot = ReactDOM.createRoot(el);
    window.__scRoot.render(React.createElement(App));
  }
  (function waitReady(t) {
    if (__ready()) {
      __mountOnce();
      setTimeout(function () {
        var r = document.getElementById('root');
        if (r && r.children.length === 0) {
          __mountOnce();
        }
      }, 200);
      return;
    }
    if (t > 200) return;
    setTimeout(function () {
      waitReady(t + 1);
    }, 30);
  })(0);
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/seller/app.jsx", error: String((e && e.message) || e) }); }

// ui_kits/seller/src/00-ui.js
try { (() => {
// ===== Shared (concat first) =====
const {
  Button,
  Badge,
  Card,
  OrderStatusBadge,
  Modal,
  EmptyState,
  Input,
  Select,
  Checkbox
} = window.MyCityDesignSystem_105480;
const fmt = n => new Intl.NumberFormat('it-IT', {
  style: 'currency',
  currency: 'EUR'
}).format(n);
const img = (kw, lock) => `https://loremflickr.com/640/640/${kw}?lock=${lock}`;
const initials = name => (name || '').trim().split(/\s+/).map(w => w[0] || '').slice(0, 2).join('').toUpperCase();
function Lucide({
  name,
  size = 20,
  stroke = 2,
  color,
  style
}) {
  return /*#__PURE__*/React.createElement("i", {
    "data-lucide": name,
    ref: el => {
      if (el && window.lucide) try {
        window.lucide.createIcons({
          attrs: {
            width: size,
            height: size,
            'stroke-width': stroke
          }
        });
      } catch (e) {}
    },
    style: {
      width: size,
      height: size,
      display: 'inline-flex',
      color,
      flexShrink: 0,
      ...style
    }
  });
}
function Stars({
  value = 5,
  size = 14
}) {
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      gap: '1px'
    }
  }, [1, 2, 3, 4, 5].map(i => /*#__PURE__*/React.createElement("svg", {
    key: i,
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: i <= Math.round(value) ? 'var(--accent-500)' : 'var(--cream-300)'
  }, /*#__PURE__*/React.createElement("path", {
    d: "M12 2l2.9 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l7.1-1.01L12 2z"
  }))));
}
const TINT = {
  primary: ['var(--primary-100)', 'var(--primary-700)'],
  olive: ['var(--olive-100)', 'var(--olive-700)'],
  accent: ['var(--accent-100)', 'var(--accent-700)'],
  secondary: ['var(--secondary-100)', 'var(--secondary-600)']
};
function PageTitle({
  title,
  sub,
  action
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      gap: '16px',
      flexWrap: 'wrap',
      marginBottom: '20px'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-serif)',
      fontSize: '30px',
      fontWeight: 800,
      color: 'var(--ink-900)'
    }
  }, title), sub && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '4px 0 0',
      fontSize: '14px',
      color: 'var(--ink-500)'
    }
  }, sub)), action);
}
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/seller/src/00-ui.js", error: String((e && e.message) || e) }); }

// ui_kits/seller/src/00-ui.jsx
try { (() => {
// ===== Seller shared UI (DS wrappers + atoms) =====
const __ds = n => function DSComp(props) {
  const C = (window.MyCityDesignSystem_105480 || {})[n];
  return C ? React.createElement(C, props) : null;
};
const Button = __ds('Button');
const Badge = __ds('Badge');
const Card = __ds('Card');
const OrderStatusBadge = __ds('OrderStatusBadge');
const Modal = __ds('Modal');
const EmptyState = __ds('EmptyState');
const Input = __ds('Input');
const Select = __ds('Select');
const Checkbox = __ds('Checkbox');
const fmt = n => new Intl.NumberFormat('it-IT', {
  style: 'currency',
  currency: 'EUR'
}).format(n);
const imgUrl = (kw, lock) => `https://loremflickr.com/300/300/${kw}?lock=${lock}`;
const initials = s => (s || '').trim().split(/\s+/).map(w => w[0] || '').slice(0, 2).join('').toUpperCase();
function Icon({
  name,
  size = 20,
  stroke = 2,
  color,
  style
}) {
  return /*#__PURE__*/React.createElement("i", {
    "data-lucide": name,
    ref: el => {
      if (el && window.lucide) try {
        window.lucide.createIcons({
          attrs: {
            width: size,
            height: size,
            'stroke-width': stroke
          }
        });
      } catch (e) {}
    },
    style: {
      width: size,
      height: size,
      display: 'inline-flex',
      color,
      flexShrink: 0,
      ...style
    }
  });
}
const TONES = {
  olive: ['var(--olive-100)', 'var(--olive-700)'],
  primary: ['var(--primary-100)', 'var(--primary-700)'],
  accent: ['var(--accent-100)', 'var(--accent-700)'],
  secondary: ['var(--secondary-100)', 'var(--secondary-600)']
};
function StatCard({
  kpi
}) {
  const t = TONES[kpi.tone] || TONES.primary;
  const up = kpi.delta > 0,
    flat = kpi.delta === 0;
  return /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "lg"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '13px',
      color: 'var(--ink-500)',
      fontWeight: 600
    }
  }, kpi.label), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '8px 0 0',
      fontFamily: 'var(--font-serif)',
      fontSize: '30px',
      fontWeight: 800,
      color: 'var(--ink-900)',
      lineHeight: 1
    }
  }, kpi.value)), /*#__PURE__*/React.createElement("span", {
    style: {
      width: '44px',
      height: '44px',
      borderRadius: 'var(--radius-lg)',
      background: t[0],
      color: t[1],
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: kpi.icon,
    size: 22,
    stroke: 2.2,
    color: t[1]
  }))), !flat && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px',
      marginTop: '12px',
      fontSize: '13px',
      fontWeight: 700,
      color: up ? 'var(--olive-700)' : 'var(--secondary-600)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: up ? 'trending-up' : 'trending-down',
    size: 15,
    color: up ? 'var(--olive-600)' : 'var(--secondary-600)'
  }), " ", up ? '+' : '', kpi.delta, "% ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--ink-400)',
      fontWeight: 500
    }
  }, "vs mese scorso")), flat && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: '12px',
      fontSize: '13px',
      color: 'var(--ink-400)'
    }
  }, "da saldare al prossimo giro rider"));
}

// Simple inline SVG sparkline / bar chart.
function Sparkline({
  data,
  w = 560,
  h = 120,
  color = 'var(--primary-600)'
}) {
  const max = Math.max(...data),
    min = Math.min(...data);
  const pts = data.map((v, i) => [i / (data.length - 1) * w, h - (v - min) / (max - min || 1) * (h - 10) - 5]);
  const path = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const area = path + ` L${w} ${h} L0 ${h} Z`;
  return /*#__PURE__*/React.createElement("svg", {
    viewBox: `0 0 ${w} ${h}`,
    width: "100%",
    height: h,
    preserveAspectRatio: "none"
  }, /*#__PURE__*/React.createElement("defs", null, /*#__PURE__*/React.createElement("linearGradient", {
    id: "scfill",
    x1: "0",
    y1: "0",
    x2: "0",
    y2: "1"
  }, /*#__PURE__*/React.createElement("stop", {
    offset: "0",
    stopColor: "var(--primary-500)",
    stopOpacity: "0.22"
  }), /*#__PURE__*/React.createElement("stop", {
    offset: "1",
    stopColor: "var(--primary-500)",
    stopOpacity: "0"
  }))), /*#__PURE__*/React.createElement("path", {
    d: area,
    fill: "url(#scfill)"
  }), /*#__PURE__*/React.createElement("path", {
    d: path,
    fill: "none",
    stroke: color,
    strokeWidth: "2.5",
    strokeLinejoin: "round",
    strokeLinecap: "round"
  }), pts.map((p, i) => i === pts.length - 1 ? /*#__PURE__*/React.createElement("circle", {
    key: i,
    cx: p[0],
    cy: p[1],
    r: "4",
    fill: color
  }) : null));
}
function Bars({
  data,
  h = 120,
  color = 'var(--accent-500)'
}) {
  const max = Math.max(...data);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-end',
      gap: '6px',
      height: h
    }
  }, data.map((v, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    title: fmt(v),
    style: {
      flex: 1,
      height: `${v / max * 100}%`,
      background: i === data.length - 1 ? 'var(--primary-600)' : color,
      borderRadius: '4px 4px 0 0',
      minHeight: '4px'
    }
  })));
}
function SectionTitle({
  children,
  action
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: '14px'
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-serif)',
      fontSize: '20px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, children), action);
}
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/seller/src/00-ui.jsx", error: String((e && e.message) || e) }); }

// ui_kits/seller/src/10-shell.js
try { (() => {
// ===== Seller shell (sidebar + topbar) =====
const SC_NAV = [{
  id: 'dashboard',
  icon: 'layout-dashboard',
  label: 'Dashboard'
}, {
  id: 'orders',
  icon: 'receipt',
  label: 'Ordini',
  badge: 'todo'
}, {
  id: 'products',
  icon: 'package',
  label: 'Prodotti'
}, {
  id: 'promotions',
  icon: 'tag',
  label: 'Promozioni'
}, {
  id: 'analytics',
  icon: 'bar-chart-3',
  label: 'Analisi'
}, {
  id: 'customers',
  icon: 'users',
  label: 'Clienti'
}, {
  id: 'reviews',
  icon: 'star',
  label: 'Recensioni'
}, {
  id: 'earnings',
  icon: 'wallet',
  label: 'Guadagni'
}];
function SellerShell({
  view,
  onNav,
  onNewProduct,
  children
}) {
  const store = window.SC_STORE;
  const todo = window.SC_ORDERS.filter(o => ['NEW', 'ACCEPTED', 'READY'].includes(o.status)).length;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '248px 1fr',
      minHeight: '100vh',
      background: 'var(--cream-100)'
    }
  }, /*#__PURE__*/React.createElement("aside", {
    style: {
      background: 'var(--ink-900)',
      color: '#fff',
      display: 'flex',
      flexDirection: 'column',
      position: 'sticky',
      top: 0,
      height: '100vh'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '20px 20px 14px',
      borderBottom: '1px solid rgba(255,255,255,.1)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-serif)',
      fontSize: '22px',
      fontWeight: 800,
      letterSpacing: '-0.01em'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--accent-300)'
    }
  }, "My"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: '#fff'
    }
  }, "City"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: '11px',
      fontWeight: 700,
      color: 'var(--ink-300)',
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      marginLeft: '6px'
    }
  }, "Seller"))), /*#__PURE__*/React.createElement("nav", {
    style: {
      flex: 1,
      padding: '12px 12px',
      display: 'flex',
      flexDirection: 'column',
      gap: '2px',
      overflowY: 'auto'
    }
  }, SC_NAV.map(n => {
    const on = view === n.id;
    return /*#__PURE__*/React.createElement("button", {
      key: n.id,
      onClick: () => onNav(n.id),
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '11px',
        border: 0,
        background: on ? 'var(--primary-700)' : 'transparent',
        color: on ? '#fff' : 'rgba(255,255,255,.78)',
        fontWeight: on ? 700 : 500,
        fontSize: '14px',
        padding: '10px 12px',
        borderRadius: 'var(--radius-md)',
        cursor: 'pointer',
        fontFamily: 'var(--font-sans)',
        textAlign: 'left',
        width: '100%'
      }
    }, /*#__PURE__*/React.createElement(Lucide, {
      name: n.icon,
      size: 18,
      stroke: 2.2,
      color: on ? '#fff' : 'rgba(255,255,255,.7)'
    }), " ", n.label, n.badge === 'todo' && todo > 0 && /*#__PURE__*/React.createElement("span", {
      style: {
        marginLeft: 'auto',
        background: 'var(--accent-500)',
        color: 'var(--ink-900)',
        fontSize: '11px',
        fontWeight: 700,
        borderRadius: '999px',
        minWidth: '20px',
        height: '20px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 5px'
      }
    }, todo));
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '12px',
      borderTop: '1px solid rgba(255,255,255,.1)'
    }
  }, /*#__PURE__*/React.createElement("a", {
    href: "../buyer/index.html",
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      color: 'rgba(255,255,255,.7)',
      fontSize: '13px',
      padding: '8px 12px',
      textDecoration: 'none'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "external-link",
    size: 16,
    color: "rgba(255,255,255,.6)"
  }), " Vai al marketplace"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("header", {
    style: {
      position: 'sticky',
      top: 0,
      zIndex: 'var(--z-sticky)',
      background: 'var(--surface-0)',
      borderBottom: '1px solid var(--cream-300)',
      padding: '12px 28px',
      display: 'flex',
      alignItems: 'center',
      gap: '16px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      flex: 1,
      maxWidth: '420px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      left: '12px',
      top: '50%',
      transform: 'translateY(-50%)',
      pointerEvents: 'none'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "search",
    size: 17,
    color: "var(--ink-400)"
  })), /*#__PURE__*/React.createElement("input", {
    placeholder: "Cerca ordini, prodotti, clienti\u2026",
    style: {
      width: '100%',
      boxSizing: 'border-box',
      border: '1px solid var(--cream-300)',
      borderRadius: 'var(--radius-full)',
      padding: '9px 14px 9px 38px',
      fontSize: '14px',
      fontFamily: 'var(--font-sans)',
      outline: 'none',
      background: 'var(--cream-50)'
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginLeft: 'auto',
      display: 'flex',
      alignItems: 'center',
      gap: '12px'
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    size: "sm",
    icon: "plus",
    onClick: onNewProduct
  }, "Pubblica prodotto"), /*#__PURE__*/React.createElement("button", {
    style: {
      position: 'relative',
      border: 0,
      background: 'transparent',
      cursor: 'pointer',
      display: 'inline-flex',
      padding: '6px'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "bell",
    size: 20,
    color: "var(--ink-600)"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      top: '2px',
      right: '2px',
      width: '8px',
      height: '8px',
      borderRadius: '50%',
      background: 'var(--secondary-600)'
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '34px',
      height: '34px',
      borderRadius: '50%',
      background: 'linear-gradient(135deg, var(--primary-500), var(--primary-700))',
      color: '#fff',
      fontWeight: 700,
      fontSize: '13px',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, store.initials), /*#__PURE__*/React.createElement("div", {
    style: {
      lineHeight: 1.1
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '13px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, store.name), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '11px',
      color: 'var(--ink-400)'
    }
  }, store.area))))), /*#__PURE__*/React.createElement("main", {
    style: {
      flex: 1,
      padding: '28px',
      maxWidth: '1100px',
      width: '100%',
      boxSizing: 'border-box'
    }
  }, children)));
}
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/seller/src/10-shell.js", error: String((e && e.message) || e) }); }

// ui_kits/seller/src/10-shell.jsx
try { (() => {
// ===== Seller shell (sidebar + topbar) =====
const SC_NAV = [{
  id: 'dashboard',
  icon: 'layout-dashboard',
  label: 'Dashboard'
}, {
  id: 'ordini',
  icon: 'shopping-bag',
  label: 'Ordini',
  badge: 3
}, {
  id: 'prodotti',
  icon: 'package',
  label: 'Prodotti'
}, {
  id: 'analytics',
  icon: 'bar-chart-3',
  label: 'Analytics'
}, {
  id: 'incassi',
  icon: 'wallet',
  label: 'Incassi'
}, {
  id: 'promozioni',
  icon: 'tag',
  label: 'Promozioni'
}, {
  id: 'recensioni',
  icon: 'star',
  label: 'Recensioni'
}, {
  id: 'clienti',
  icon: 'users',
  label: 'Clienti'
}];
function Sidebar({
  active,
  onNav
}) {
  const s = window.SC_STORE;
  return /*#__PURE__*/React.createElement("aside", {
    style: {
      width: '248px',
      flexShrink: 0,
      background: 'var(--ink-900)',
      color: 'var(--cream-100)',
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      position: 'sticky',
      top: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '20px 20px 16px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-serif)',
      fontSize: '22px',
      fontWeight: 800
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--accent-400)'
    }
  }, "My"), "City ", /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '11px',
      fontWeight: 600,
      color: 'var(--ink-300)',
      letterSpacing: '0.04em'
    }
  }, "SELLER"))), /*#__PURE__*/React.createElement("div", {
    style: {
      margin: '0 12px 12px',
      padding: '12px',
      background: 'rgba(255,255,255,.06)',
      borderRadius: 'var(--radius-lg)',
      display: 'flex',
      alignItems: 'center',
      gap: '10px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '38px',
      height: '38px',
      borderRadius: 'var(--radius-md)',
      background: 'linear-gradient(135deg, var(--primary-500), var(--primary-700))',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontWeight: 800,
      fontSize: '14px',
      flexShrink: 0
    }
  }, initials(s.name)), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '13px',
      fontWeight: 700,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, s.name), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '11px',
      color: 'var(--accent-300)'
    }
  }, s.plan))), /*#__PURE__*/React.createElement("nav", {
    style: {
      flex: 1,
      overflowY: 'auto',
      padding: '0 12px',
      display: 'flex',
      flexDirection: 'column',
      gap: '2px'
    }
  }, SC_NAV.map(n => {
    const on = active === n.id;
    return /*#__PURE__*/React.createElement("button", {
      key: n.id,
      onClick: () => onNav(n.id),
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '11px',
        width: '100%',
        textAlign: 'left',
        border: 0,
        cursor: 'pointer',
        fontFamily: 'var(--font-sans)',
        fontSize: '14px',
        fontWeight: on ? 700 : 500,
        padding: '10px 12px',
        borderRadius: 'var(--radius-md)',
        background: on ? 'var(--primary-700)' : 'transparent',
        color: on ? '#fff' : 'var(--ink-200)'
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: n.icon,
      size: 18,
      color: on ? '#fff' : 'var(--ink-300)'
    }), " ", n.label, n.badge && /*#__PURE__*/React.createElement("span", {
      style: {
        marginLeft: 'auto',
        background: 'var(--accent-500)',
        color: 'var(--ink-900)',
        fontSize: '11px',
        fontWeight: 700,
        borderRadius: '999px',
        padding: '1px 7px'
      }
    }, n.badge));
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '12px',
      borderTop: '1px solid rgba(255,255,255,.08)'
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => onNav('profilo'),
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      width: '100%',
      border: 0,
      background: active === 'profilo' ? 'rgba(255,255,255,.08)' : 'transparent',
      color: 'var(--ink-200)',
      cursor: 'pointer',
      padding: '10px 12px',
      borderRadius: 'var(--radius-md)',
      fontFamily: 'var(--font-sans)',
      fontSize: '14px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '28px',
      height: '28px',
      borderRadius: '50%',
      background: 'var(--cream-200)',
      color: 'var(--primary-700)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontWeight: 700,
      fontSize: '12px'
    }
  }, "GV"), "Giorgio Verdi")));
}
function Topbar({
  title,
  subtitle,
  actions
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '16px',
      padding: '20px 28px',
      borderBottom: '1px solid var(--cream-300)',
      background: 'var(--surface-0)',
      position: 'sticky',
      top: 0,
      zIndex: 20
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-serif)',
      fontSize: '26px',
      fontWeight: 800,
      color: 'var(--ink-900)'
    }
  }, title), subtitle && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 0',
      fontSize: '13px',
      color: 'var(--ink-500)'
    }
  }, subtitle)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px'
    }
  }, actions, /*#__PURE__*/React.createElement("button", {
    title: "Notifiche",
    style: {
      position: 'relative',
      width: '40px',
      height: '40px',
      borderRadius: 'var(--radius-md)',
      border: '1px solid var(--cream-300)',
      background: 'var(--surface-0)',
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'var(--ink-600)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "bell",
    size: 19
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      top: '8px',
      right: '9px',
      width: '7px',
      height: '7px',
      borderRadius: '50%',
      background: 'var(--secondary-600)'
    }
  }))));
}
function Layout({
  active,
  onNav,
  title,
  subtitle,
  actions,
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      minHeight: '100vh',
      background: 'var(--surface-50)'
    }
  }, /*#__PURE__*/React.createElement(Sidebar, {
    active: active,
    onNav: onNav
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0,
      display: 'flex',
      flexDirection: 'column'
    }
  }, /*#__PURE__*/React.createElement(Topbar, {
    title: title,
    subtitle: subtitle,
    actions: actions
  }), /*#__PURE__*/React.createElement("main", {
    style: {
      flex: 1,
      padding: '28px',
      maxWidth: '1200px',
      width: '100%'
    }
  }, children)));
}
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/seller/src/10-shell.jsx", error: String((e && e.message) || e) }); }

// ui_kits/seller/src/20-dashboard.js
try { (() => {
// ===== Dashboard =====
function Dashboard({
  onNav,
  onNewProduct
}) {
  const k = window.SC_KPI,
    store = window.SC_STORE;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '24px'
    }
  }, /*#__PURE__*/React.createElement("section", {
    style: {
      position: 'relative',
      overflow: 'hidden',
      borderRadius: 'var(--radius-2xl)',
      background: 'linear-gradient(135deg, var(--primary-700), var(--primary-600) 55%, var(--secondary-700))',
      color: '#fff',
      boxShadow: 'var(--shadow-warm-lg)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    "aria-hidden": true,
    style: {
      position: 'absolute',
      top: '-60px',
      right: '-40px',
      width: '260px',
      height: '260px',
      borderRadius: '50%',
      background: 'rgba(255,255,255,.1)',
      filter: 'blur(40px)'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      padding: '28px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '16px',
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '60px',
      height: '60px',
      borderRadius: 'var(--radius-xl)',
      background: 'rgba(255,255,255,.18)',
      border: '3px solid rgba(255,255,255,.25)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'var(--font-serif)',
      fontSize: '24px',
      fontWeight: 800
    }
  }, store.initials), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: '180px'
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '13px',
      color: 'rgba(255,255,255,.75)'
    }
  }, "Bentornato"), /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: '2px 0 0',
      fontFamily: 'var(--font-serif)',
      fontSize: '30px',
      fontWeight: 800,
      color: '#fff'
    }
  }, store.name), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      marginTop: '6px',
      fontSize: '12px',
      fontWeight: 600,
      background: 'rgba(90,124,66,.9)',
      color: '#fff',
      borderRadius: '999px',
      padding: '3px 10px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '6px',
      height: '6px',
      borderRadius: '50%',
      background: '#fff'
    }
  }), " Negozio attivo")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: '8px',
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    icon: "plus",
    onClick: onNewProduct
  }, "Pubblica prodotto"), /*#__PURE__*/React.createElement("button", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px',
      background: 'rgba(255,255,255,.15)',
      border: '1px solid rgba(255,255,255,.25)',
      color: '#fff',
      fontWeight: 600,
      padding: '10px 16px',
      borderRadius: 'var(--radius-md)',
      cursor: 'pointer',
      fontFamily: 'var(--font-sans)',
      fontSize: '14px'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "external-link",
    size: 16
  }), " Vetrina"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: '12px',
      marginTop: '22px'
    }
  }, [['Oggi', k.revenueToday, `${k.ordersToday} articoli`], ['7 giorni', k.revenue7, `${k.orders7} articoli`], ['30 giorni', k.revenue30, `${k.orders30} articoli`]].map(([l, v, s]) => /*#__PURE__*/React.createElement("div", {
    key: l,
    style: {
      borderRadius: 'var(--radius-xl)',
      background: 'rgba(255,255,255,.1)',
      border: '1px solid rgba(255,255,255,.15)',
      padding: '14px 16px'
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '11px',
      textTransform: 'uppercase',
      letterSpacing: '0.04em',
      color: 'rgba(255,255,255,.7)',
      fontWeight: 700
    }
  }, l), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '4px 0 0',
      fontSize: '24px',
      fontWeight: 800,
      lineHeight: 1
    }
  }, fmt(v)), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 0',
      fontSize: '11px',
      color: 'rgba(255,255,255,.6)'
    }
  }, s)))))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: '14px'
    }
  }, /*#__PURE__*/React.createElement(KpiCard, {
    icon: "trending-up",
    tone: "olive",
    value: fmt(k.revenueTotal),
    label: "Fatturato totale",
    hint: `${k.itemsSold} articoli venduti`
  }), /*#__PURE__*/React.createElement(KpiCard, {
    icon: "package",
    tone: "primary",
    value: k.productsAvailable,
    label: "Prodotti in vendita",
    hint: `su ${k.productsTotal} totali`
  }), /*#__PURE__*/React.createElement(KpiCard, {
    icon: "star",
    tone: "accent",
    value: `${k.avgRating.toFixed(1).replace('.', ',')} ★`,
    label: "Valutazione media",
    hint: `${k.reviewCount} recensioni`
  }), /*#__PURE__*/React.createElement(KpiCard, {
    icon: "receipt",
    tone: "secondary",
    value: k.itemsSold,
    label: "Articoli venduti",
    hint: "Dall'inizio"
  })), /*#__PURE__*/React.createElement(NavGroup, {
    title: "Vendite",
    hint: "Catalogo, ordini, marketing"
  }, /*#__PURE__*/React.createElement(NavTile, {
    icon: "package",
    title: "Prodotti",
    desc: "Catalogo e disponibilit\xE0",
    meta: `${window.SC_KPI.productsAvailable} in vendita`,
    onClick: () => onNav('products')
  }), /*#__PURE__*/React.createElement(NavTile, {
    icon: "receipt",
    title: "Ordini",
    desc: "Prepara e gestisci",
    onClick: () => onNav('orders')
  }), /*#__PURE__*/React.createElement(NavTile, {
    icon: "tag",
    title: "Promozioni",
    desc: "Sconti e offerte",
    onClick: () => onNav('promotions')
  }), /*#__PURE__*/React.createElement(NavTile, {
    icon: "bar-chart-3",
    title: "Analisi",
    desc: "Andamento e insight",
    onClick: () => onNav('analytics')
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '20px',
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "lg"
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: '0 0 6px',
      fontFamily: 'var(--font-serif)',
      fontSize: '18px',
      fontWeight: 700,
      color: 'var(--ink-900)',
      display: 'flex',
      alignItems: 'center',
      gap: '8px'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "activity",
    size: 19,
    color: "var(--olive-600)"
  }), " Salute del negozio"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '0 0 14px',
      fontSize: '13px',
      color: 'var(--ink-500)'
    }
  }, "Pi\xF9 \xE8 alto, pi\xF9 sei visibile nel marketplace."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '16px'
    }
  }, /*#__PURE__*/React.createElement(Ring, {
    value: store.healthScore
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      gap: '8px'
    }
  }, [['Catalogo completo', true], ['Risposte alle recensioni', true], ['Promo attiva', true], ['Foto di qualità', false]].map(([t, ok]) => /*#__PURE__*/React.createElement("span", {
    key: t,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px',
      fontSize: '13px',
      color: ok ? 'var(--ink-700)' : 'var(--ink-400)'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: ok ? 'check-circle-2' : 'circle',
    size: 15,
    color: ok ? 'var(--olive-600)' : 'var(--ink-300)'
  }), " ", t))))), /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "lg"
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: '0 0 6px',
      fontFamily: 'var(--font-serif)',
      fontSize: '18px',
      fontWeight: 700,
      color: 'var(--ink-900)',
      display: 'flex',
      alignItems: 'center',
      gap: '8px'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "megaphone",
    size: 19,
    color: "var(--accent-600)"
  }), " Fai crescere le vendite"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '0 0 14px',
      fontSize: '13px',
      color: 'var(--ink-500)'
    }
  }, "Tre mosse semplici per pi\xF9 clienti."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '4px'
    }
  }, /*#__PURE__*/React.createElement(TipRow, {
    icon: "tag",
    title: "Lancia una promo",
    desc: "Uno sconto a tempo crea urgenza.",
    onClick: () => onNav('promotions')
  }), /*#__PURE__*/React.createElement(TipRow, {
    icon: "camera",
    title: "Pubblica una storia",
    desc: "Le storie (24h) portano clienti.",
    onClick: () => onNav('products')
  }), /*#__PURE__*/React.createElement(TipRow, {
    icon: "share-2",
    title: "Condividi la vetrina",
    desc: "Manda il link a clienti e amici.",
    onClick: () => onNav('dashboard')
  })))));
}
function KpiCard({
  icon,
  tone,
  value,
  label,
  hint
}) {
  const [bg, fg] = TINT[tone];
  return /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "md"
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '40px',
      height: '40px',
      borderRadius: 'var(--radius-md)',
      background: bg,
      color: fg,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: icon,
    size: 20,
    stroke: 2.2,
    color: fg
  })), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '12px 0 0',
      fontSize: '24px',
      fontWeight: 800,
      color: 'var(--ink-900)',
      lineHeight: 1
    }
  }, value), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '6px 0 0',
      fontSize: '14px',
      color: 'var(--ink-600)'
    }
  }, label), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 0',
      fontSize: '12px',
      color: 'var(--ink-400)'
    }
  }, hint));
}
function NavGroup({
  title,
  hint,
  children
}) {
  return /*#__PURE__*/React.createElement("section", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      marginBottom: '12px'
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-serif)',
      fontSize: '20px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, title), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '13px',
      color: 'var(--ink-400)'
    }
  }, hint)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: '12px'
    }
  }, children));
}
function NavTile({
  icon,
  title,
  desc,
  meta,
  onClick
}) {
  const [h, setH] = React.useState(false);
  return /*#__PURE__*/React.createElement("button", {
    onClick: onClick,
    onMouseEnter: () => setH(true),
    onMouseLeave: () => setH(false),
    style: {
      textAlign: 'left',
      display: 'flex',
      gap: '12px',
      background: 'var(--surface-0)',
      border: `1px solid ${h ? 'var(--primary-200)' : 'var(--cream-300)'}`,
      borderRadius: 'var(--radius-xl)',
      padding: '14px',
      cursor: 'pointer',
      boxShadow: h ? 'var(--shadow-warm)' : 'none',
      transition: 'box-shadow var(--dur-base), border-color var(--dur-base)',
      fontFamily: 'var(--font-sans)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '44px',
      height: '44px',
      borderRadius: 'var(--radius-md)',
      background: 'var(--primary-100)',
      color: 'var(--primary-700)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: icon,
    size: 21,
    stroke: 2.2,
    color: "var(--primary-700)"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0,
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '6px'
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontWeight: 700,
      color: 'var(--ink-900)',
      fontSize: '15px'
    }
  }, title), /*#__PURE__*/React.createElement(Lucide, {
    name: "arrow-right",
    size: 16,
    color: h ? 'var(--primary-600)' : 'var(--ink-300)'
  })), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 0',
      fontSize: '13px',
      color: 'var(--ink-500)',
      lineHeight: 1.35
    }
  }, desc), meta && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '6px 0 0',
      fontSize: '12px',
      fontWeight: 600,
      color: 'var(--ink-400)'
    }
  }, meta)));
}
function TipRow({
  icon,
  title,
  desc,
  onClick
}) {
  return /*#__PURE__*/React.createElement("button", {
    onClick: onClick,
    style: {
      textAlign: 'left',
      display: 'flex',
      gap: '12px',
      alignItems: 'center',
      background: 'transparent',
      border: 0,
      borderRadius: 'var(--radius-md)',
      padding: '8px',
      cursor: 'pointer',
      fontFamily: 'var(--font-sans)',
      width: '100%'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '36px',
      height: '36px',
      borderRadius: 'var(--radius-md)',
      background: 'var(--accent-100)',
      color: 'var(--accent-700)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: icon,
    size: 18,
    stroke: 2.2,
    color: "var(--accent-700)"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '14px',
      fontWeight: 600,
      color: 'var(--ink-900)'
    }
  }, title), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '12px',
      color: 'var(--ink-500)'
    }
  }, desc)), /*#__PURE__*/React.createElement(Lucide, {
    name: "arrow-right",
    size: 15,
    color: "var(--ink-300)"
  }));
}
function Ring({
  value
}) {
  const r = 34,
    c = 2 * Math.PI * r,
    off = c - value / 100 * c;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      width: '88px',
      height: '88px',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "88",
    height: "88",
    viewBox: "0 0 88 88"
  }, /*#__PURE__*/React.createElement("circle", {
    cx: "44",
    cy: "44",
    r: r,
    fill: "none",
    stroke: "var(--cream-200)",
    strokeWidth: "8"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "44",
    cy: "44",
    r: r,
    fill: "none",
    stroke: "var(--olive-500)",
    strokeWidth: "8",
    strokeLinecap: "round",
    strokeDasharray: c,
    strokeDashoffset: off,
    transform: "rotate(-90 44 44)"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      inset: 0,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '22px',
      fontWeight: 800,
      color: 'var(--ink-900)'
    }
  }, value), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '10px',
      color: 'var(--ink-400)'
    }
  }, "/ 100")));
}
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/seller/src/20-dashboard.js", error: String((e && e.message) || e) }); }

// ui_kits/seller/src/20-dashboard.jsx
try { (() => {
// ===== Seller: Dashboard =====
function Dashboard({
  onNav,
  onOpenOrder
}) {
  const recent = window.SC_ORDERS.slice(0, 5);
  const low = window.SC_PRODUCTS.filter(p => p.stock > 0 && p.stock <= 3);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '24px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: '16px'
    }
  }, window.SC_KPIS.map(k => /*#__PURE__*/React.createElement(StatCard, {
    key: k.id,
    kpi: k
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1.6fr 1fr',
      gap: '20px',
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "lg"
  }, /*#__PURE__*/React.createElement(SectionTitle, {
    action: /*#__PURE__*/React.createElement(Badge, {
      variant: "new"
    }, "+12,4%")
  }, "Incasso \xB7 ultimi 14 giorni"), /*#__PURE__*/React.createElement(Sparkline, {
    data: window.SC_SALES
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      marginTop: '10px',
      fontSize: '12px',
      color: 'var(--ink-400)'
    }
  }, /*#__PURE__*/React.createElement("span", null, "2 set fa"), /*#__PURE__*/React.createElement("span", null, "1 set fa"), /*#__PURE__*/React.createElement("span", null, "oggi"))), /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "lg"
  }, /*#__PURE__*/React.createElement(SectionTitle, null, "Da fare ora"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '10px'
    }
  }, /*#__PURE__*/React.createElement(TodoRow, {
    icon: "bell-ring",
    tone: "primary",
    text: "3 nuovi ordini da accettare",
    cta: "Vedi",
    onClick: () => onNav('ordini')
  }), /*#__PURE__*/React.createElement(TodoRow, {
    icon: "package-x",
    tone: "secondary",
    text: `${low.length} prodotti in esaurimento`,
    cta: "Rifornisci",
    onClick: () => onNav('prodotti')
  }), /*#__PURE__*/React.createElement(TodoRow, {
    icon: "wallet",
    tone: "olive",
    text: "\u20AC612 contanti da saldare",
    cta: "Salda",
    onClick: () => onNav('incassi')
  }), /*#__PURE__*/React.createElement(TodoRow, {
    icon: "star",
    tone: "accent",
    text: "1 recensione senza risposta",
    cta: "Rispondi",
    onClick: () => onNav('recensioni')
  })))), /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "none"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '16px 20px',
      borderBottom: '1px solid var(--cream-200)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between'
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-serif)',
      fontSize: '18px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, "Ordini recenti"), /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    size: "sm",
    iconRight: "arrow-right",
    onClick: () => onNav('ordini')
  }, "Tutti gli ordini")), /*#__PURE__*/React.createElement(OrdersTable, {
    orders: recent,
    onOpenOrder: onOpenOrder,
    compact: true
  })));
}
function TodoRow({
  icon,
  tone,
  text,
  cta,
  onClick
}) {
  const t = TONES[tone] || TONES.primary;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      padding: '10px 12px',
      borderRadius: 'var(--radius-md)',
      background: 'var(--cream-50)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '34px',
      height: '34px',
      borderRadius: 'var(--radius-md)',
      background: t[0],
      color: t[1],
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: icon,
    size: 17,
    color: t[1]
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      fontSize: '14px',
      color: 'var(--ink-800)',
      fontWeight: 500
    }
  }, text), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "sm",
    onClick: onClick
  }, cta));
}
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/seller/src/20-dashboard.jsx", error: String((e && e.message) || e) }); }

// ui_kits/seller/src/30-orders.js
try { (() => {
// ===== Orders (grouped + detail drawer with status advancement) =====
const SC_NEXT = {
  NEW: 'ACCEPTED',
  ACCEPTED: 'READY',
  READY: 'ASSIGNED'
};
const SC_NEXT_LABEL = {
  NEW: 'Accetta ordine',
  ACCEPTED: 'Segna come pronto',
  READY: 'Assegna al rider'
};
const SC_GROUPS = [{
  label: 'Da fare',
  statuses: ['NEW', 'ACCEPTED', 'READY']
}, {
  label: 'In consegna',
  statuses: ['ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY']
}, {
  label: 'Completati',
  statuses: ['DELIVERED', 'CANCELED']
}];
function Orders({
  orders,
  onAdvance
}) {
  const [sel, setSel] = React.useState(null);
  const groups = SC_GROUPS.map(g => ({
    ...g,
    items: orders.filter(o => g.statuses.includes(o.status))
  }));
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(PageTitle, {
    title: "Ordini ricevuti",
    sub: "Prepara, conferma e affida gli ordini ai rider",
    action: /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: '8px'
      }
    }, groups.map(g => /*#__PURE__*/React.createElement("span", {
      key: g.label,
      style: {
        fontSize: '12px',
        background: 'var(--cream-100)',
        color: 'var(--ink-600)',
        borderRadius: '999px',
        padding: '5px 12px'
      }
    }, g.label, ": ", /*#__PURE__*/React.createElement("strong", {
      style: {
        color: 'var(--ink-900)'
      }
    }, g.items.length))))
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '22px'
    }
  }, groups.map(g => g.items.length === 0 ? null : /*#__PURE__*/React.createElement("section", {
    key: g.label
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: '0 0 10px',
      fontSize: '14px',
      fontWeight: 700,
      color: 'var(--ink-700)',
      textTransform: 'uppercase',
      letterSpacing: '0.03em'
    }
  }, g.label), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '8px'
    }
  }, g.items.map(o => {
    const count = o.items.reduce((s, i) => s + i.q, 0);
    return /*#__PURE__*/React.createElement("button", {
      key: o.id,
      onClick: () => setSel(o),
      style: {
        textAlign: 'left',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        flexWrap: 'wrap',
        background: 'var(--surface-0)',
        border: '1px solid var(--cream-300)',
        borderRadius: 'var(--radius-lg)',
        padding: '14px 18px',
        cursor: 'pointer',
        fontFamily: 'var(--font-sans)'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: 'var(--font-mono)',
        fontSize: '12px',
        color: 'var(--ink-400)'
      }
    }, "#", o.id), /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--ink-300)'
      }
    }, "\xB7"), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: '12px',
        color: 'var(--ink-500)'
      }
    }, o.when), o.pay === 'cod' && /*#__PURE__*/React.createElement(Badge, {
      variant: "cod",
      icon: "banknote"
    }, "Contanti")), /*#__PURE__*/React.createElement("p", {
      style: {
        margin: '3px 0 0',
        fontWeight: 700,
        color: 'var(--ink-900)'
      }
    }, o.cust), /*#__PURE__*/React.createElement("p", {
      style: {
        margin: 0,
        fontSize: '13px',
        color: 'var(--ink-500)'
      }
    }, count, " ", count === 1 ? 'articolo' : 'articoli', " \xB7 ", o.addr)), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '14px'
      }
    }, /*#__PURE__*/React.createElement(OrderStatusBadge, {
      status: o.status,
      size: "sm"
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        fontWeight: 800,
        color: 'var(--ink-900)',
        fontSize: '16px'
      }
    }, fmt(o.total)), /*#__PURE__*/React.createElement(Lucide, {
      name: "chevron-right",
      size: 18,
      color: "var(--ink-300)"
    })));
  }))))), /*#__PURE__*/React.createElement(OrderDrawer, {
    order: sel,
    onClose: () => setSel(null),
    onAdvance: o => {
      onAdvance(o);
      setSel(null);
    }
  }));
}
function OrderDrawer({
  order,
  onClose,
  onAdvance
}) {
  if (!order) return null;
  const o = order;
  const next = SC_NEXT[o.status];
  return ReactDOM.createPortal(/*#__PURE__*/React.createElement("div", {
    onClick: onClose,
    style: {
      position: 'fixed',
      inset: 0,
      zIndex: 'var(--z-modal)',
      background: 'rgba(0,0,0,.4)',
      backdropFilter: 'blur(2px)',
      display: 'flex',
      justifyContent: 'flex-end',
      animation: 'mc-fade-in var(--dur-fast) ease-out'
    }
  }, /*#__PURE__*/React.createElement("div", {
    onClick: e => e.stopPropagation(),
    style: {
      width: '440px',
      maxWidth: '92vw',
      height: '100%',
      background: 'var(--surface-0)',
      display: 'flex',
      flexDirection: 'column',
      boxShadow: 'var(--shadow-warm-xl)',
      animation: 'mc-slide-right var(--dur-medium) var(--ease-out-quint)'
    }
  }, /*#__PURE__*/React.createElement("header", {
    style: {
      padding: '18px 20px',
      borderBottom: '1px solid var(--cream-200)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-mono)',
      fontSize: '12px',
      color: 'var(--ink-400)'
    }
  }, "#", o.id), /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: '2px 0 0',
      fontFamily: 'var(--font-serif)',
      fontSize: '20px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, o.cust)), /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    "aria-label": "Chiudi",
    style: {
      border: 0,
      background: 'transparent',
      cursor: 'pointer',
      color: 'var(--ink-500)'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "x",
    size: 22
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflowY: 'auto',
      padding: '20px',
      display: 'flex',
      flexDirection: 'column',
      gap: '18px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between'
    }
  }, /*#__PURE__*/React.createElement(OrderStatusBadge, {
    status: o.status
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '13px',
      color: 'var(--ink-500)'
    }
  }, o.when)), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '0 0 8px',
      fontSize: '12px',
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '0.03em',
      color: 'var(--ink-500)'
    }
  }, "Articoli"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '10px'
    }
  }, o.items.map((it, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: 'flex',
      gap: '10px',
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: img(it.kw, it.lock),
    alt: it.name,
    style: {
      width: '48px',
      height: '48px',
      borderRadius: 'var(--radius-md)',
      objectFit: 'cover'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '14px',
      fontWeight: 600,
      color: 'var(--ink-900)'
    }
  }, it.name), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '12px',
      color: 'var(--ink-500)'
    }
  }, fmt(it.price), " \xD7 ", it.q)), /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, fmt(it.price * it.q)))))), /*#__PURE__*/React.createElement("div", {
    style: {
      borderTop: '1px solid var(--cream-200)',
      paddingTop: '14px',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px'
    }
  }, /*#__PURE__*/React.createElement(Row, {
    label: "Consegna",
    val: o.addr
  }), /*#__PURE__*/React.createElement(Row, {
    label: "Pagamento",
    val: o.pay === 'cod' ? 'Contanti alla consegna' : 'Carta (online)'
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      fontSize: '18px',
      fontWeight: 800,
      color: 'var(--ink-900)',
      marginTop: '4px'
    }
  }, /*#__PURE__*/React.createElement("span", null, "Totale"), /*#__PURE__*/React.createElement("span", null, fmt(o.total)))), o.pay === 'cod' && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      background: 'var(--olive-50)',
      borderRadius: 'var(--radius-md)',
      padding: '10px 12px',
      fontSize: '13px',
      color: 'var(--olive-800)'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "banknote",
    size: 16,
    color: "var(--olive-700)"
  }), " Il rider incassa ", /*#__PURE__*/React.createElement("strong", null, fmt(o.total)), " in contanti.")), /*#__PURE__*/React.createElement("footer", {
    style: {
      padding: '16px 20px',
      borderTop: '1px solid var(--cream-200)',
      display: 'flex',
      gap: '8px'
    }
  }, next ? /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    size: "lg",
    fullWidth: true,
    iconRight: "arrow-right",
    onClick: () => onAdvance(o)
  }, SC_NEXT_LABEL[o.status]) : /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      textAlign: 'center',
      fontSize: '14px',
      color: 'var(--ink-500)',
      padding: '10px'
    }
  }, o.status === 'DELIVERED' ? 'Ordine consegnato ✓' : o.status === 'CANCELED' ? 'Ordine annullato' : 'In gestione al rider'), o.status === 'NEW' && /*#__PURE__*/React.createElement(Button, {
    variant: "danger",
    size: "lg",
    icon: "x"
  }, "Rifiuta")))), document.body);
}
function Row({
  label,
  val
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      gap: '12px',
      fontSize: '14px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--ink-500)'
    }
  }, label), /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 600,
      color: 'var(--ink-800)',
      textAlign: 'right'
    }
  }, val));
}
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/seller/src/30-orders.js", error: String((e && e.message) || e) }); }

// ui_kits/seller/src/30-orders.jsx
try { (() => {
// ===== Seller: Orders (table + detail) =====
function OrdersTable({
  orders,
  onOpenOrder,
  compact
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      overflowX: 'auto'
    }
  }, /*#__PURE__*/React.createElement("table", {
    style: {
      width: '100%',
      borderCollapse: 'collapse',
      fontFamily: 'var(--font-sans)'
    }
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
    style: {
      textAlign: 'left',
      fontSize: '12px',
      color: 'var(--ink-500)',
      textTransform: 'uppercase',
      letterSpacing: '0.03em'
    }
  }, /*#__PURE__*/React.createElement("th", {
    style: th
  }, "Ordine"), /*#__PURE__*/React.createElement("th", {
    style: th
  }, "Cliente"), !compact && /*#__PURE__*/React.createElement("th", {
    style: th
  }, "Articoli"), /*#__PURE__*/React.createElement("th", {
    style: th
  }, "Totale"), /*#__PURE__*/React.createElement("th", {
    style: th
  }, "Pagamento"), /*#__PURE__*/React.createElement("th", {
    style: th
  }, "Stato"), /*#__PURE__*/React.createElement("th", {
    style: th
  }))), /*#__PURE__*/React.createElement("tbody", null, orders.map(o => /*#__PURE__*/React.createElement("tr", {
    key: o.id,
    style: {
      borderTop: '1px solid var(--cream-200)',
      cursor: 'pointer'
    },
    onClick: () => onOpenOrder(o)
  }, /*#__PURE__*/React.createElement("td", {
    style: td
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, o.id), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: '12px',
      color: 'var(--ink-400)'
    }
  }, o.when)), /*#__PURE__*/React.createElement("td", {
    style: td
  }, o.customer), !compact && /*#__PURE__*/React.createElement("td", {
    style: td
  }, o.items), /*#__PURE__*/React.createElement("td", {
    style: {
      ...td,
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, fmt(o.total)), /*#__PURE__*/React.createElement("td", {
    style: td
  }, /*#__PURE__*/React.createElement(Badge, {
    variant: "cod",
    icon: "banknote"
  }, "Consegna")), /*#__PURE__*/React.createElement("td", {
    style: td
  }, /*#__PURE__*/React.createElement(OrderStatusBadge, {
    status: o.status,
    size: "sm"
  })), /*#__PURE__*/React.createElement("td", {
    style: {
      ...td,
      textAlign: 'right'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "chevron-right",
    size: 16,
    color: "var(--ink-400)"
  })))))));
}
const th = {
  padding: '12px 20px',
  fontWeight: 600
};
const td = {
  padding: '14px 20px',
  fontSize: '14px',
  color: 'var(--ink-700)',
  verticalAlign: 'middle'
};
function OrdersView({
  onOpenOrder
}) {
  const [filter, setFilter] = React.useState('all');
  const tabs = [['all', 'Tutti'], ['NEW', 'Nuovi'], ['ACCEPTED', 'In preparazione'], ['READY', 'Pronti'], ['OUT_FOR_DELIVERY', 'In consegna'], ['DELIVERED', 'Consegnati']];
  const orders = window.SC_ORDERS.filter(o => filter === 'all' || o.status === filter);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '16px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: '6px',
      flexWrap: 'wrap'
    }
  }, tabs.map(([id, label]) => {
    const on = filter === id;
    const count = id === 'all' ? window.SC_ORDERS.length : window.SC_ORDERS.filter(o => o.status === id).length;
    return /*#__PURE__*/React.createElement("button", {
      key: id,
      onClick: () => setFilter(id),
      style: {
        border: `1px solid ${on ? 'var(--primary-600)' : 'var(--cream-300)'}`,
        background: on ? 'var(--primary-700)' : 'var(--surface-0)',
        color: on ? '#fff' : 'var(--ink-700)',
        padding: '8px 14px',
        borderRadius: 'var(--radius-full)',
        fontSize: '13px',
        fontWeight: 600,
        cursor: 'pointer',
        fontFamily: 'var(--font-sans)'
      }
    }, label, " ", count > 0 && /*#__PURE__*/React.createElement("span", {
      style: {
        opacity: .7
      }
    }, "\xB7 ", count));
  })), /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "none"
  }, orders.length === 0 ? /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '24px'
    }
  }, /*#__PURE__*/React.createElement(EmptyState, {
    icon: "inbox",
    title: "Nessun ordine",
    description: "Non ci sono ordini in questo stato."
  })) : /*#__PURE__*/React.createElement(OrdersTable, {
    orders: orders,
    onOpenOrder: onOpenOrder
  })));
}
const SC_FLOW = ['NEW', 'ACCEPTED', 'READY', 'ASSIGNED', 'OUT_FOR_DELIVERY', 'DELIVERED'];
function OrderDetail({
  order,
  onClose,
  onAdvance
}) {
  if (!order) return null;
  const lines = window.SC_ORDER_LINES[order.id] || [{
    n: 'Prodotto',
    q: order.items,
    p: order.total / order.items,
    kw: 'salami',
    lock: 7
  }];
  const idx = SC_FLOW.indexOf(order.status);
  const next = idx >= 0 && idx < SC_FLOW.length - 1 ? SC_FLOW[idx + 1] : null;
  const NEXT_LABEL = {
    ACCEPTED: 'Accetta ordine',
    READY: 'Segna pronto',
    ASSIGNED: 'Assegna rider',
    OUT_FOR_DELIVERY: 'Affida al rider',
    DELIVERED: 'Segna consegnato'
  };
  return /*#__PURE__*/React.createElement(Modal, {
    open: !!order,
    onClose: onClose,
    title: `Ordine ${order.id}`,
    description: `${order.when} · ${order.customer}`,
    size: "lg",
    footer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      variant: "ghost",
      onClick: onClose
    }, "Chiudi"), order.status !== 'CANCELED' && order.status !== 'DELIVERED' && next && /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      icon: "check",
      onClick: () => onAdvance(order, next)
    }, NEXT_LABEL[next]))
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '16px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between'
    }
  }, /*#__PURE__*/React.createElement(OrderStatusBadge, {
    status: order.status
  }), /*#__PURE__*/React.createElement(Badge, {
    variant: "cod",
    icon: "banknote"
  }, "Paga alla consegna \xB7 ", fmt(order.total))), /*#__PURE__*/React.createElement("div", {
    style: {
      border: '1px solid var(--cream-300)',
      borderRadius: 'var(--radius-lg)',
      overflow: 'hidden'
    }
  }, lines.map((l, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      padding: '12px 14px',
      borderBottom: i < lines.length - 1 ? '1px solid var(--cream-200)' : 'none'
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: imgUrl(l.kw, l.lock),
    alt: l.n,
    style: {
      width: '44px',
      height: '44px',
      borderRadius: 'var(--radius-md)',
      objectFit: 'cover'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '14px',
      fontWeight: 600,
      color: 'var(--ink-900)'
    }
  }, l.n), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '12px',
      color: 'var(--ink-500)'
    }
  }, "\xD7 ", l.q)), /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, fmt(l.p * l.q))))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      fontSize: '18px',
      fontWeight: 800,
      color: 'var(--ink-900)'
    }
  }, /*#__PURE__*/React.createElement("span", null, "Totale"), /*#__PURE__*/React.createElement("span", null, fmt(order.total))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      padding: '12px',
      background: 'var(--cream-50)',
      borderRadius: 'var(--radius-md)',
      fontSize: '13px',
      color: 'var(--ink-600)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "map-pin",
    size: 16,
    color: "var(--primary-600)"
  }), " ", order.customer, " \xB7 Via Roma 12, Piacenza \xB7 contanti al rider")));
}
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/seller/src/30-orders.jsx", error: String((e && e.message) || e) }); }

// ui_kits/seller/src/40-products.js
try { (() => {
// ===== Products (catalogue table + new-product modal) =====
function Products({
  products,
  onNewProduct,
  onToggle
}) {
  const [filter, setFilter] = React.useState('all');
  const tabs = [['all', 'Tutti'], ['available', 'In vendita'], ['soldout', 'Esauriti'], ['draft', 'Bozze']];
  const list = products.filter(p => filter === 'all' || p.status === filter);
  const STATUS = {
    available: ['var(--olive-50)', 'var(--olive-700)', 'In vendita'],
    soldout: ['var(--secondary-50)', 'var(--secondary-600)', 'Esaurito'],
    draft: ['var(--surface-100)', 'var(--ink-500)', 'Bozza']
  };
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(PageTitle, {
    title: "Prodotti",
    sub: `${products.length} prodotti a catalogo`,
    action: /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: '8px'
      }
    }, /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      icon: "upload"
    }, "Importa CSV"), /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      icon: "plus",
      onClick: onNewProduct
    }, "Nuovo prodotto"))
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: '4px',
      marginBottom: '16px'
    }
  }, tabs.map(([id, label]) => /*#__PURE__*/React.createElement("button", {
    key: id,
    onClick: () => setFilter(id),
    style: {
      border: 0,
      background: filter === id ? 'var(--primary-700)' : 'var(--surface-0)',
      color: filter === id ? '#fff' : 'var(--ink-600)',
      fontWeight: 600,
      fontSize: '13px',
      padding: '8px 14px',
      borderRadius: 'var(--radius-full)',
      cursor: 'pointer',
      fontFamily: 'var(--font-sans)',
      boxShadow: filter === id ? 'none' : 'inset 0 0 0 1px var(--cream-300)'
    }
  }, label))), /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "none"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      overflowX: 'auto'
    }
  }, /*#__PURE__*/React.createElement("table", {
    style: {
      width: '100%',
      borderCollapse: 'collapse',
      fontFamily: 'var(--font-sans)'
    }
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
    style: {
      background: 'var(--cream-50)',
      borderBottom: '1px solid var(--cream-300)'
    }
  }, ['Prodotto', 'Prezzo', 'Stock', 'Venduti', 'Stato', ''].map((h, i) => /*#__PURE__*/React.createElement("th", {
    key: i,
    style: {
      textAlign: i > 0 && i < 5 ? 'right' : 'left',
      padding: '12px 16px',
      fontSize: '11px',
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '0.03em',
      color: 'var(--ink-500)'
    }
  }, h)))), /*#__PURE__*/React.createElement("tbody", null, list.map(p => {
    const [bg, fg, lbl] = STATUS[p.status];
    const fp = p.discount > 0 ? p.price * (1 - p.discount / 100) : p.price;
    return /*#__PURE__*/React.createElement("tr", {
      key: p.id,
      style: {
        borderBottom: '1px solid var(--cream-200)'
      }
    }, /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '12px 16px'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '12px'
      }
    }, /*#__PURE__*/React.createElement("img", {
      src: img(p.kw, p.lock),
      alt: p.name,
      style: {
        width: '44px',
        height: '44px',
        borderRadius: 'var(--radius-md)',
        objectFit: 'cover'
      }
    }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
      style: {
        margin: 0,
        fontSize: '14px',
        fontWeight: 600,
        color: 'var(--ink-900)'
      }
    }, p.name), /*#__PURE__*/React.createElement("p", {
      style: {
        margin: 0,
        fontSize: '12px',
        color: 'var(--ink-400)'
      }
    }, p.cat)))), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '12px 16px',
        textAlign: 'right'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontWeight: 700,
        color: 'var(--ink-900)'
      }
    }, fmt(fp)), p.discount > 0 && /*#__PURE__*/React.createElement("span", {
      style: {
        display: 'block',
        fontSize: '11px',
        color: 'var(--secondary-600)',
        fontWeight: 600
      }
    }, "-", p.discount, "%")), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '12px 16px',
        textAlign: 'right',
        fontWeight: 600,
        color: p.stock === 0 ? 'var(--secondary-600)' : p.stock <= 3 ? 'var(--accent-700)' : 'var(--ink-700)'
      }
    }, p.stock), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '12px 16px',
        textAlign: 'right',
        color: 'var(--ink-600)'
      }
    }, p.sold), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '12px 16px',
        textAlign: 'right'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: '12px',
        fontWeight: 600,
        background: bg,
        color: fg,
        padding: '3px 10px',
        borderRadius: '999px'
      }
    }, lbl)), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '12px 16px',
        textAlign: 'right',
        whiteSpace: 'nowrap'
      }
    }, /*#__PURE__*/React.createElement("button", {
      title: "Modifica",
      style: iconBtn
    }, /*#__PURE__*/React.createElement(Lucide, {
      name: "pencil",
      size: 16,
      color: "var(--ink-500)"
    })), /*#__PURE__*/React.createElement("button", {
      title: "Altro",
      style: iconBtn
    }, /*#__PURE__*/React.createElement(Lucide, {
      name: "more-horizontal",
      size: 16,
      color: "var(--ink-500)"
    }))));
  }))))));
}
const iconBtn = {
  border: 0,
  background: 'transparent',
  cursor: 'pointer',
  padding: '6px',
  borderRadius: 'var(--radius-md)',
  display: 'inline-flex'
};
function NewProductModal({
  open,
  onClose,
  onSave
}) {
  return /*#__PURE__*/React.createElement(Modal, {
    open: open,
    onClose: onClose,
    title: "Nuovo prodotto",
    description: "Pubblica un articolo nella tua vetrina",
    size: "lg",
    footer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      onClick: onClose
    }, "Annulla"), /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      icon: "check",
      onClick: onSave
    }, "Pubblica prodotto"))
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '16px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: '14px',
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: '88px',
      height: '88px',
      borderRadius: 'var(--radius-lg)',
      border: '1.5px dashed var(--cream-400)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'var(--ink-400)',
      flexShrink: 0,
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "camera",
    size: 22,
    color: "var(--ink-400)"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '10px',
      marginTop: '4px'
    }
  }, "Foto")), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement(Input, {
    label: "Nome prodotto",
    placeholder: "Es. Coppa Piacentina DOP 200g"
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '14px'
    }
  }, /*#__PURE__*/React.createElement(Input, {
    label: "Prezzo (\u20AC)",
    type: "number",
    placeholder: "8,90"
  }), /*#__PURE__*/React.createElement(Input, {
    label: "Stock disponibile",
    type: "number",
    placeholder: "12"
  })), /*#__PURE__*/React.createElement(Select, {
    label: "Categoria",
    defaultValue: "Salumi"
  }, /*#__PURE__*/React.createElement("option", null, "Salumi"), /*#__PURE__*/React.createElement("option", null, "Formaggi"), /*#__PURE__*/React.createElement("option", null, "Conserve"), /*#__PURE__*/React.createElement("option", null, "Pasta fresca"), /*#__PURE__*/React.createElement("option", null, "Vini")), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    style: {
      fontSize: '14px',
      fontWeight: 500,
      color: 'var(--ink-700)',
      display: 'block',
      marginBottom: '5px'
    }
  }, "Descrizione"), /*#__PURE__*/React.createElement("textarea", {
    rows: "3",
    placeholder: "Racconta il prodotto: origine, stagionatura, abbinamenti\u2026",
    style: {
      width: '100%',
      boxSizing: 'border-box',
      border: '1px solid var(--cream-300)',
      borderRadius: 'var(--radius-md)',
      padding: '10px 12px',
      fontSize: '15px',
      fontFamily: 'var(--font-sans)',
      resize: 'vertical',
      outline: 'none'
    }
  })), /*#__PURE__*/React.createElement(Checkbox, {
    label: "Spedizione gratuita per questo prodotto"
  })));
}
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/seller/src/40-products.js", error: String((e && e.message) || e) }); }

// ui_kits/seller/src/40-products.jsx
try { (() => {
// ===== Seller: Products =====
function ProductsView() {
  const [editing, setEditing] = React.useState(null); // product or 'new'
  const [q, setQ] = React.useState('');
  const STATUS = {
    active: ['Attivo', 'new'],
    soldout: ['Esaurito', 'soldout'],
    draft: ['Bozza', 'local']
  };
  const list = window.SC_PRODUCTS.filter(p => !q || p.name.toLowerCase().includes(q.toLowerCase()));
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '16px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: '10px',
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      maxWidth: '320px'
    }
  }, /*#__PURE__*/React.createElement(Input, {
    placeholder: "Cerca nel catalogo\u2026",
    value: q,
    onChange: e => setQ(e.target.value),
    leading: /*#__PURE__*/React.createElement(Icon, {
      name: "search",
      size: 16,
      color: "var(--ink-400)"
    })
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginLeft: 'auto'
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    icon: "plus",
    onClick: () => setEditing('new')
  }, "Nuovo prodotto"))), /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "none"
  }, /*#__PURE__*/React.createElement("table", {
    style: {
      width: '100%',
      borderCollapse: 'collapse'
    }
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
    style: {
      textAlign: 'left',
      fontSize: '12px',
      color: 'var(--ink-500)',
      textTransform: 'uppercase',
      letterSpacing: '0.03em'
    }
  }, /*#__PURE__*/React.createElement("th", {
    style: th
  }, "Prodotto"), /*#__PURE__*/React.createElement("th", {
    style: th
  }, "Categoria"), /*#__PURE__*/React.createElement("th", {
    style: th
  }, "Prezzo"), /*#__PURE__*/React.createElement("th", {
    style: th
  }, "Scorte"), /*#__PURE__*/React.createElement("th", {
    style: th
  }, "Venduti"), /*#__PURE__*/React.createElement("th", {
    style: th
  }, "Stato"), /*#__PURE__*/React.createElement("th", {
    style: th
  }))), /*#__PURE__*/React.createElement("tbody", null, list.map(p => /*#__PURE__*/React.createElement("tr", {
    key: p.id,
    style: {
      borderTop: '1px solid var(--cream-200)'
    }
  }, /*#__PURE__*/React.createElement("td", {
    style: td
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px'
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: imgUrl(p.kw, p.lock),
    alt: p.name,
    style: {
      width: '40px',
      height: '40px',
      borderRadius: 'var(--radius-md)',
      objectFit: 'cover'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 600,
      color: 'var(--ink-900)'
    }
  }, p.name))), /*#__PURE__*/React.createElement("td", {
    style: td
  }, p.cat), /*#__PURE__*/React.createElement("td", {
    style: {
      ...td,
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, fmt(p.price)), /*#__PURE__*/React.createElement("td", {
    style: td
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: p.stock === 0 ? 'var(--secondary-600)' : p.stock <= 3 ? 'var(--accent-700)' : 'var(--ink-700)',
      fontWeight: p.stock <= 3 ? 700 : 500
    }
  }, p.stock)), /*#__PURE__*/React.createElement("td", {
    style: td
  }, p.sold), /*#__PURE__*/React.createElement("td", {
    style: td
  }, /*#__PURE__*/React.createElement(Badge, {
    variant: STATUS[p.status][1]
  }, STATUS[p.status][0])), /*#__PURE__*/React.createElement("td", {
    style: {
      ...td,
      textAlign: 'right'
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    size: "sm",
    icon: "pencil",
    onClick: () => setEditing(p)
  }, "Modifica"))))))), /*#__PURE__*/React.createElement(ProductEditor, {
    product: editing === 'new' ? null : editing,
    open: !!editing,
    onClose: () => setEditing(null)
  }));
}
function ProductEditor({
  product,
  open,
  onClose
}) {
  if (!open) return null;
  const isNew = !product;
  return /*#__PURE__*/React.createElement(Modal, {
    open: open,
    onClose: onClose,
    title: isNew ? 'Nuovo prodotto' : 'Modifica prodotto',
    size: "lg",
    footer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      variant: "ghost",
      onClick: onClose
    }, "Annulla"), /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      icon: "check",
      onClick: onClose
    }, isNew ? 'Pubblica' : 'Salva'))
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '120px 1fr',
      gap: '18px'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      width: '120px',
      height: '120px',
      borderRadius: 'var(--radius-lg)',
      overflow: 'hidden',
      border: '1px solid var(--cream-300)',
      background: 'var(--surface-100)'
    }
  }, product ? /*#__PURE__*/React.createElement("img", {
    src: imgUrl(product.kw, product.lock),
    alt: "",
    style: {
      width: '100%',
      height: '100%',
      objectFit: 'cover'
    }
  }) : /*#__PURE__*/React.createElement("div", {
    style: {
      width: '100%',
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'var(--ink-300)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "image-plus",
    size: 28,
    color: "var(--ink-300)"
  }))), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "sm",
    icon: "upload",
    style: {
      marginTop: '8px',
      width: '120px'
    }
  }, "Foto")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '12px'
    }
  }, /*#__PURE__*/React.createElement(Input, {
    label: "Nome prodotto",
    defaultValue: product ? product.name : '',
    placeholder: "Es. Coppa Piacentina DOP 200g"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr 1fr',
      gap: '12px'
    }
  }, /*#__PURE__*/React.createElement(Input, {
    label: "Prezzo (\u20AC)",
    defaultValue: product ? String(product.price) : '',
    placeholder: "0,00"
  }), /*#__PURE__*/React.createElement(Input, {
    label: "Scorte",
    defaultValue: product ? String(product.stock) : '',
    placeholder: "0"
  }), /*#__PURE__*/React.createElement(Select, {
    label: "Categoria",
    defaultValue: product ? product.cat : 'Salumi'
  }, /*#__PURE__*/React.createElement("option", null, "Salumi"), /*#__PURE__*/React.createElement("option", null, "Formaggi"), /*#__PURE__*/React.createElement("option", null, "Conserve"))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    style: {
      fontSize: '14px',
      fontWeight: 500,
      color: 'var(--ink-700)'
    }
  }, "Descrizione"), /*#__PURE__*/React.createElement("textarea", {
    rows: "3",
    defaultValue: product ? 'Stagionata 90 giorni, taglio a mano.' : '',
    placeholder: "Racconta il prodotto\u2026",
    style: {
      width: '100%',
      boxSizing: 'border-box',
      marginTop: '5px',
      border: '1px solid var(--cream-300)',
      borderRadius: 'var(--radius-md)',
      padding: '10px 12px',
      fontFamily: 'var(--font-sans)',
      fontSize: '15px',
      resize: 'vertical',
      outline: 'none'
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: '8px',
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    variant: "local"
  }, "DOP"), /*#__PURE__*/React.createElement(Badge, {
    variant: "local"
  }, "Taglio a mano"), /*#__PURE__*/React.createElement("button", {
    style: {
      border: '1px dashed var(--cream-400)',
      background: 'transparent',
      color: 'var(--primary-700)',
      borderRadius: 'var(--radius-sm)',
      fontSize: '11px',
      padding: '2px 8px',
      cursor: 'pointer',
      fontFamily: 'var(--font-sans)'
    }
  }, "+ Tag")))));
}
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/seller/src/40-products.jsx", error: String((e && e.message) || e) }); }

// ui_kits/seller/src/50-analytics.js
try { (() => {
// ===== Analytics =====
function Analytics() {
  const rev = window.SC_REVENUE_7D;
  const max = Math.max(...rev);
  const days = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
  const top = window.SC_PRODUCTS.slice().sort((a, b) => b.sold - a.sold).slice(0, 5);
  const maxSold = top[0].sold;
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(PageTitle, {
    title: "Analisi",
    sub: "Andamento delle vendite e prodotti migliori"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: '14px',
      marginBottom: '20px'
    }
  }, [['Fatturato 7gg', fmt(window.SC_KPI.revenue7), '+12%', 'olive'], ['Ordini 7gg', window.SC_KPI.orders7, '+8%', 'primary'], ['Scontrino medio', fmt(23.9), '+3%', 'accent'], ['Tasso reso', '1,4%', '−0,2%', 'secondary']].map(([l, v, d, t]) => /*#__PURE__*/React.createElement(Card, {
    key: l,
    variant: "bordered",
    padding: "md"
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '12px',
      color: 'var(--ink-500)',
      fontWeight: 600
    }
  }, l), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '6px 0 0',
      fontSize: '24px',
      fontWeight: 800,
      color: 'var(--ink-900)'
    }
  }, v), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '12px',
      fontWeight: 700,
      color: TINT[t][1]
    }
  }, d, " vs settimana scorsa")))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1.4fr 1fr',
      gap: '20px',
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "lg"
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: '0 0 18px',
      fontFamily: 'var(--font-serif)',
      fontSize: '18px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, "Fatturato \xB7 ultimi 7 giorni"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-end',
      gap: '12px',
      height: '180px'
    }
  }, rev.map((v, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '8px',
      height: '100%'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      width: '100%',
      display: 'flex',
      alignItems: 'flex-end'
    }
  }, /*#__PURE__*/React.createElement("div", {
    title: fmt(v),
    style: {
      width: '100%',
      height: `${v / max * 100}%`,
      background: 'linear-gradient(180deg, var(--primary-500), var(--primary-700))',
      borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0',
      minHeight: '6px'
    }
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '11px',
      color: 'var(--ink-500)'
    }
  }, days[i]))))), /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "lg"
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: '0 0 16px',
      fontFamily: 'var(--font-serif)',
      fontSize: '18px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, "Prodotti pi\xF9 venduti"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '14px'
    }
  }, top.map((p, i) => /*#__PURE__*/React.createElement("div", {
    key: p.id,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '13px',
      fontWeight: 800,
      color: 'var(--ink-300)',
      width: '16px'
    }
  }, i + 1), /*#__PURE__*/React.createElement("img", {
    src: img(p.kw, p.lock),
    alt: "",
    style: {
      width: '36px',
      height: '36px',
      borderRadius: 'var(--radius-md)',
      objectFit: 'cover'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '13px',
      fontWeight: 600,
      color: 'var(--ink-900)',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, p.name), /*#__PURE__*/React.createElement("div", {
    style: {
      height: '5px',
      background: 'var(--cream-200)',
      borderRadius: '3px',
      marginTop: '4px',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'block',
      height: '100%',
      width: `${p.sold / maxSold * 100}%`,
      background: 'var(--olive-500)'
    }
  }))), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '13px',
      fontWeight: 700,
      color: 'var(--ink-700)'
    }
  }, p.sold)))))));
}
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/seller/src/50-analytics.js", error: String((e && e.message) || e) }); }

// ui_kits/seller/src/50-analytics.jsx
try { (() => {
// ===== Seller: Analytics =====
function AnalyticsView() {
  const top = [...window.SC_PRODUCTS].sort((a, b) => b.sold - a.sold).slice(0, 5);
  const maxSold = Math.max(...top.map(p => p.sold));
  const byCat = [['Salumi', 64], ['Formaggi', 28], ['Conserve', 8]];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '20px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: '16px'
    }
  }, [['Visite vetrina', '3.842', '+18%'], ['Tasso conversione', '4,8%', '+0,6pt'], ['Prodotti venduti', '423', '+9%'], ['Resi', '1,2%', '-0,3pt']].map(([l, v, d]) => /*#__PURE__*/React.createElement(Card, {
    key: l,
    variant: "bordered",
    padding: "lg"
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '13px',
      color: 'var(--ink-500)',
      fontWeight: 600
    }
  }, l), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '6px 0 0',
      fontFamily: 'var(--font-serif)',
      fontSize: '26px',
      fontWeight: 800,
      color: 'var(--ink-900)'
    }
  }, v), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '12px',
      fontWeight: 700,
      color: 'var(--olive-700)'
    }
  }, d)))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1.6fr 1fr',
      gap: '20px',
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "lg"
  }, /*#__PURE__*/React.createElement(SectionTitle, null, "Vendite per giorno \xB7 14 giorni"), /*#__PURE__*/React.createElement(Bars, {
    data: window.SC_SALES,
    h: 180
  })), /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "lg"
  }, /*#__PURE__*/React.createElement(SectionTitle, null, "Vendite per categoria"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '14px',
      marginTop: '4px'
    }
  }, byCat.map(([c, pct], i) => /*#__PURE__*/React.createElement("div", {
    key: c
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      fontSize: '13px',
      marginBottom: '4px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--ink-700)',
      fontWeight: 600
    }
  }, c), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--ink-500)'
    }
  }, pct, "%")), /*#__PURE__*/React.createElement("div", {
    style: {
      height: '10px',
      background: 'var(--cream-200)',
      borderRadius: '5px',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: pct + '%',
      height: '100%',
      background: ['var(--primary-600)', 'var(--accent-500)', 'var(--olive-500)'][i]
    }
  }))))))), /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "lg"
  }, /*#__PURE__*/React.createElement(SectionTitle, null, "Prodotti pi\xF9 venduti"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '12px'
    }
  }, top.map((p, i) => /*#__PURE__*/React.createElement("div", {
    key: p.id,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '22px',
      fontFamily: 'var(--font-serif)',
      fontWeight: 800,
      color: 'var(--ink-400)'
    }
  }, i + 1), /*#__PURE__*/React.createElement("img", {
    src: imgUrl(p.kw, p.lock),
    alt: p.name,
    style: {
      width: '36px',
      height: '36px',
      borderRadius: 'var(--radius-md)',
      objectFit: 'cover'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      fontSize: '14px',
      fontWeight: 600,
      color: 'var(--ink-900)'
    }
  }, p.name), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      maxWidth: '200px',
      height: '8px',
      background: 'var(--cream-200)',
      borderRadius: '4px',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: p.sold / maxSold * 100 + '%',
      height: '100%',
      background: 'var(--primary-600)'
    }
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      width: '60px',
      textAlign: 'right',
      fontSize: '13px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, p.sold, " pz"))))));
}
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/seller/src/50-analytics.jsx", error: String((e && e.message) || e) }); }

// ui_kits/seller/src/60-earnings.js
try { (() => {
// ===== Earnings (COD + Stripe payouts) =====
function Earnings() {
  const [period, setPeriod] = React.useState('30d');
  const periods = [['7d', '7 giorni'], ['30d', '30 giorni'], ['90d', '90 giorni'], ['all', 'Tutto']];
  const payouts = window.SC_PAYOUTS;
  const held = payouts.filter(p => p.status === 'HELD').reduce((s, p) => s + p.net, 0);
  const paid = payouts.filter(p => p.status === 'TRANSFERRED').reduce((s, p) => s + p.net, 0);
  const codCollected = window.SC_ORDERS.filter(o => o.pay === 'cod' && o.status === 'DELIVERED').reduce((s, o) => s + o.total, 0);
  const rev = window.SC_REVENUE_7D;
  const max = Math.max(...rev);
  const STATUS = {
    HELD: ['var(--accent-100)', 'var(--accent-800)', 'In attesa'],
    TRANSFERRED: ['var(--olive-100)', 'var(--olive-800)', 'Pagato']
  };
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(PageTitle, {
    title: "Guadagni",
    sub: "Incassi reali e stato dei bonifici"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: '8px',
      marginBottom: '18px',
      flexWrap: 'wrap'
    }
  }, periods.map(([k, l]) => /*#__PURE__*/React.createElement("button", {
    key: k,
    onClick: () => setPeriod(k),
    style: {
      border: 0,
      background: period === k ? 'var(--primary-700)' : 'var(--surface-0)',
      color: period === k ? '#fff' : 'var(--ink-700)',
      fontWeight: 600,
      fontSize: '13px',
      padding: '7px 16px',
      borderRadius: 'var(--radius-full)',
      cursor: 'pointer',
      fontFamily: 'var(--font-sans)',
      boxShadow: period === k ? 'none' : 'inset 0 0 0 1px var(--cream-300)'
    }
  }, l))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: '14px',
      marginBottom: '20px'
    }
  }, /*#__PURE__*/React.createElement(EStat, {
    label: "Fatturato lordo",
    value: fmt(window.SC_KPI.revenue30),
    hint: `${window.SC_KPI.orders30} ordini`,
    tone: "primary"
  }), /*#__PURE__*/React.createElement(EStat, {
    label: "Commissione MyCity",
    value: '− ' + fmt(window.SC_KPI.revenue30 * 0.1),
    hint: "10% sul venduto",
    tone: "secondary"
  }), /*#__PURE__*/React.createElement(EStat, {
    label: "Incassato",
    value: fmt(paid),
    hint: `${fmt(held)} in arrivo dopo la consegna`,
    tone: "olive",
    highlight: true
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1.3fr 1fr',
      gap: '20px',
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "lg"
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: '0 0 16px',
      fontFamily: 'var(--font-serif)',
      fontSize: '18px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, "Andamento ultimi 7 giorni"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-end',
      gap: '10px',
      height: '130px'
    }
  }, rev.map((v, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      flex: 1,
      height: '100%',
      display: 'flex',
      alignItems: 'flex-end'
    }
  }, /*#__PURE__*/React.createElement("div", {
    title: fmt(v),
    style: {
      width: '100%',
      height: `${v / max * 100}%`,
      background: 'linear-gradient(180deg, var(--primary-400), var(--secondary-600))',
      borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0',
      minHeight: '5px'
    }
  }))))), /*#__PURE__*/React.createElement(Card, {
    variant: "flat",
    padding: "lg",
    style: {
      background: 'var(--olive-50)',
      border: '1px solid var(--olive-200)'
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: '0 0 4px',
      fontFamily: 'var(--font-serif)',
      fontSize: '17px',
      fontWeight: 700,
      color: 'var(--olive-900)',
      display: 'flex',
      alignItems: 'center',
      gap: '8px'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "banknote",
    size: 19,
    color: "var(--olive-700)"
  }), " Contanti (COD)"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '0 0 12px',
      fontSize: '13px',
      color: 'var(--olive-800)',
      lineHeight: 1.5
    }
  }, "Gli ordini pagati alla consegna li incassa il rider e ti vengono accreditati a fine giornata."), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '28px',
      fontWeight: 800,
      color: 'var(--olive-900)'
    }
  }, fmt(codCollected)), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 0',
      fontSize: '12px',
      color: 'var(--olive-700)'
    }
  }, "incassati in contanti questo periodo"))), /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "none",
    style: {
      marginTop: '20px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '16px 20px',
      borderBottom: '1px solid var(--cream-200)'
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-serif)',
      fontSize: '17px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, "Storico pagamenti"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 0',
      fontSize: '12px',
      color: 'var(--ink-500)'
    }
  }, "Stato del bonifico per ogni ordine carta")), /*#__PURE__*/React.createElement("table", {
    style: {
      width: '100%',
      borderCollapse: 'collapse',
      fontFamily: 'var(--font-sans)'
    }
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
    style: {
      background: 'var(--cream-50)'
    }
  }, ['Ordine', 'Data', 'Netto', 'Stato'].map((h, i) => /*#__PURE__*/React.createElement("th", {
    key: h,
    style: {
      textAlign: i >= 2 ? 'right' : 'left',
      padding: '10px 18px',
      fontSize: '11px',
      fontWeight: 700,
      textTransform: 'uppercase',
      color: 'var(--ink-500)'
    }
  }, h)))), /*#__PURE__*/React.createElement("tbody", null, payouts.map(p => {
    const [bg, fg, lbl] = STATUS[p.status];
    return /*#__PURE__*/React.createElement("tr", {
      key: p.id,
      style: {
        borderTop: '1px solid var(--cream-200)'
      }
    }, /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '12px 18px',
        fontFamily: 'var(--font-mono)',
        fontSize: '13px',
        color: 'var(--ink-700)'
      }
    }, "#", p.id), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '12px 18px',
        fontSize: '13px',
        color: 'var(--ink-500)'
      }
    }, p.when), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '12px 18px',
        textAlign: 'right',
        fontWeight: 700,
        color: 'var(--olive-700)'
      }
    }, fmt(p.net)), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '12px 18px',
        textAlign: 'right'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: '12px',
        fontWeight: 600,
        background: bg,
        color: fg,
        padding: '3px 10px',
        borderRadius: '999px'
      }
    }, p.status === 'TRANSFERRED' ? `Pagato ${p.paidOn}` : lbl)));
  })))));
}
function EStat({
  label,
  value,
  hint,
  tone,
  highlight
}) {
  const [bg, fg] = TINT[tone];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: bg,
      border: `1.5px solid ${highlight ? 'var(--olive-300)' : 'transparent'}`,
      borderRadius: 'var(--radius-xl)',
      padding: '18px',
      boxShadow: highlight ? '0 0 0 3px rgba(124,139,90,.18)' : 'none'
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '11px',
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '0.03em',
      color: 'var(--ink-500)'
    }
  }, label), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '8px 0 0',
      fontSize: '28px',
      fontWeight: 800,
      color: fg
    }
  }, value), hint && /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 0',
      fontSize: '12px',
      color: 'var(--ink-500)'
    }
  }, hint));
}
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/seller/src/60-earnings.js", error: String((e && e.message) || e) }); }

// ui_kits/seller/src/60-more.jsx
try { (() => {
// ===== Seller: Earnings, Promos, Reviews, Customers, Profile =====
function EarningsView() {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '20px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '16px'
    }
  }, /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "lg",
    style: {
      background: 'var(--olive-50)',
      borderColor: 'var(--olive-200)'
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '13px',
      color: 'var(--olive-800)',
      fontWeight: 600
    }
  }, "Saldo disponibile"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '6px 0 12px',
      fontFamily: 'var(--font-serif)',
      fontSize: '32px',
      fontWeight: 800,
      color: 'var(--ink-900)'
    }
  }, "\u20AC1.226,40"), /*#__PURE__*/React.createElement(Button, {
    variant: "success",
    icon: "banknote"
  }, "Richiedi payout")), /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "lg",
    style: {
      background: 'var(--secondary-50)',
      borderColor: 'var(--secondary-200)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '13px',
      color: 'var(--secondary-700)',
      fontWeight: 600
    }
  }, "Contanti incassati da saldare"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '6px 0 12px',
      fontFamily: 'var(--font-serif)',
      fontSize: '32px',
      fontWeight: 800,
      color: 'var(--ink-900)'
    }
  }, "\u20AC612,00")), /*#__PURE__*/React.createElement(Icon, {
    name: "wallet",
    size: 26,
    color: "var(--secondary-600)"
  })), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '0 0 12px',
      fontSize: '12px',
      color: 'var(--ink-600)'
    }
  }, "I rider ti consegnano i contanti raccolti; la quota MyCity viene trattenuta dal payout."), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    icon: "check"
  }, "Conferma saldo contanti"))), /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "none"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '16px 20px',
      borderBottom: '1px solid var(--cream-200)'
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-serif)',
      fontSize: '18px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, "Storico payout")), /*#__PURE__*/React.createElement("table", {
    style: {
      width: '100%',
      borderCollapse: 'collapse'
    }
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
    style: {
      textAlign: 'left',
      fontSize: '12px',
      color: 'var(--ink-500)',
      textTransform: 'uppercase'
    }
  }, /*#__PURE__*/React.createElement("th", {
    style: th
  }, "ID"), /*#__PURE__*/React.createElement("th", {
    style: th
  }, "Periodo"), /*#__PURE__*/React.createElement("th", {
    style: th
  }, "Importo"), /*#__PURE__*/React.createElement("th", {
    style: th
  }, "Stato"), /*#__PURE__*/React.createElement("th", {
    style: th
  }, "Data"))), /*#__PURE__*/React.createElement("tbody", null, window.SC_PAYOUTS.map(p => /*#__PURE__*/React.createElement("tr", {
    key: p.id,
    style: {
      borderTop: '1px solid var(--cream-200)'
    }
  }, /*#__PURE__*/React.createElement("td", {
    style: {
      ...td,
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, p.id), /*#__PURE__*/React.createElement("td", {
    style: td
  }, p.period), /*#__PURE__*/React.createElement("td", {
    style: {
      ...td,
      fontWeight: 700
    }
  }, fmt(p.amount)), /*#__PURE__*/React.createElement("td", {
    style: td
  }, /*#__PURE__*/React.createElement(Badge, {
    variant: "new"
  }, p.status)), /*#__PURE__*/React.createElement("td", {
    style: td
  }, p.when)))))));
}
function PromosView() {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '16px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      marginLeft: 'auto'
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    icon: "plus"
  }, "Nuova promozione"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: '16px'
    }
  }, window.SC_PROMOS.map(p => /*#__PURE__*/React.createElement(Card, {
    key: p.id,
    variant: "bordered",
    padding: "lg"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '8px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: '13px',
      fontWeight: 700,
      background: 'var(--cream-200)',
      padding: '3px 8px',
      borderRadius: 'var(--radius-sm)',
      color: 'var(--ink-800)'
    }
  }, p.id), /*#__PURE__*/React.createElement(Badge, {
    variant: p.status === 'active' ? 'new' : 'soldout'
  }, p.status === 'active' ? 'Attiva' : 'Terminata')), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-serif)',
      fontSize: '18px',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, p.type), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 12px',
      fontSize: '13px',
      color: 'var(--ink-500)'
    }
  }, p.cond), /*#__PURE__*/React.createElement("div", {
    style: {
      height: '8px',
      background: 'var(--cream-200)',
      borderRadius: '4px',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: p.uses / p.cap * 100 + '%',
      height: '100%',
      background: 'var(--accent-500)'
    }
  })), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '6px 0 0',
      fontSize: '12px',
      color: 'var(--ink-500)'
    }
  }, p.uses, " / ", p.cap, " utilizzi")))));
}
function ReviewsView() {
  const [reviews, setReviews] = React.useState(window.SC_REVIEWS);
  function reply(i) {
    setReviews(prev => prev.map((r, j) => j === i ? {
      ...r,
      reply: 'Grazie mille per il feedback!'
    } : r));
  }
  const avg = (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1).replace('.', ',');
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '16px'
    }
  }, /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "lg"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '16px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'center'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-serif)',
      fontSize: '40px',
      fontWeight: 800,
      color: 'var(--ink-900)',
      lineHeight: 1
    }
  }, avg), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: '12px',
      color: 'var(--ink-500)'
    }
  }, window.SC_STORE.reviews, " recensioni")), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      fontSize: '14px',
      color: 'var(--ink-600)'
    }
  }, "Rispondi alle recensioni per fidelizzare i clienti. Un negozio che risponde vende il ", /*#__PURE__*/React.createElement("strong", {
    style: {
      color: 'var(--ink-900)'
    }
  }, "+23%"), "."))), reviews.map((r, i) => /*#__PURE__*/React.createElement(Card, {
    key: i,
    variant: "bordered",
    padding: "lg"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      marginBottom: '6px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '34px',
      height: '34px',
      borderRadius: '50%',
      background: 'var(--cream-200)',
      color: 'var(--primary-700)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontWeight: 700,
      fontSize: '13px'
    }
  }, initials(r.who)), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("strong", {
    style: {
      fontSize: '14px',
      color: 'var(--ink-900)'
    }
  }, r.who), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: '12px',
      color: 'var(--ink-400)'
    }
  }, r.when, " \xB7 ", r.product)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'inline-flex',
      gap: '1px'
    }
  }, [1, 2, 3, 4, 5].map(s => /*#__PURE__*/React.createElement(Icon, {
    key: s,
    name: "star",
    size: 14,
    color: s <= r.rating ? 'var(--accent-500)' : 'var(--cream-300)'
  })))), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '0 0 10px',
      fontSize: '14px',
      color: 'var(--ink-700)',
      lineHeight: 1.5
    }
  }, r.text), r.reply ? /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--cream-50)',
      borderLeft: '3px solid var(--primary-400)',
      padding: '10px 12px',
      borderRadius: '0 var(--radius-md) var(--radius-md) 0',
      fontSize: '13px',
      color: 'var(--ink-700)'
    }
  }, /*#__PURE__*/React.createElement("strong", {
    style: {
      color: 'var(--primary-700)'
    }
  }, "La tua risposta \xB7 "), r.reply) : /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "sm",
    icon: "reply",
    onClick: () => reply(i)
  }, "Rispondi"))));
}
function CustomersView() {
  return /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "none"
  }, /*#__PURE__*/React.createElement("table", {
    style: {
      width: '100%',
      borderCollapse: 'collapse'
    }
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
    style: {
      textAlign: 'left',
      fontSize: '12px',
      color: 'var(--ink-500)',
      textTransform: 'uppercase'
    }
  }, /*#__PURE__*/React.createElement("th", {
    style: th
  }, "Cliente"), /*#__PURE__*/React.createElement("th", {
    style: th
  }, "Zona"), /*#__PURE__*/React.createElement("th", {
    style: th
  }, "Ordini"), /*#__PURE__*/React.createElement("th", {
    style: th
  }, "Speso"), /*#__PURE__*/React.createElement("th", {
    style: th
  }, "Ultimo"))), /*#__PURE__*/React.createElement("tbody", null, window.SC_CUSTOMERS.map(c => /*#__PURE__*/React.createElement("tr", {
    key: c.name,
    style: {
      borderTop: '1px solid var(--cream-200)'
    }
  }, /*#__PURE__*/React.createElement("td", {
    style: td
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '34px',
      height: '34px',
      borderRadius: '50%',
      background: 'linear-gradient(135deg, var(--primary-500), var(--primary-700))',
      color: '#fff',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontWeight: 700,
      fontSize: '13px'
    }
  }, initials(c.name)), /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 600,
      color: 'var(--ink-900)'
    }
  }, c.name))), /*#__PURE__*/React.createElement("td", {
    style: td
  }, c.area), /*#__PURE__*/React.createElement("td", {
    style: td
  }, c.orders), /*#__PURE__*/React.createElement("td", {
    style: {
      ...td,
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, fmt(c.spent)), /*#__PURE__*/React.createElement("td", {
    style: td
  }, c.last))))));
}
function ProfileView() {
  const s = window.SC_STORE;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '20px',
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "lg"
  }, /*#__PURE__*/React.createElement(SectionTitle, null, "Vetrina"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '12px'
    }
  }, /*#__PURE__*/React.createElement(Input, {
    label: "Nome negozio",
    defaultValue: s.name
  }), /*#__PURE__*/React.createElement(Input, {
    label: "Zona",
    defaultValue: s.area
  }), /*#__PURE__*/React.createElement(Select, {
    label: "Categoria principale",
    defaultValue: "Gastronomia"
  }, /*#__PURE__*/React.createElement("option", null, "Gastronomia"), /*#__PURE__*/React.createElement("option", null, "Alimentari"), /*#__PURE__*/React.createElement("option", null, "Vini & Cantina")), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    style: {
      fontSize: '14px',
      fontWeight: 500,
      color: 'var(--ink-700)'
    }
  }, "Descrizione"), /*#__PURE__*/React.createElement("textarea", {
    rows: "3",
    defaultValue: "Salumi e formaggi piacentini selezionati, tagliati a mano ogni giorno.",
    style: {
      width: '100%',
      boxSizing: 'border-box',
      marginTop: '5px',
      border: '1px solid var(--cream-300)',
      borderRadius: 'var(--radius-md)',
      padding: '10px 12px',
      fontFamily: 'var(--font-sans)',
      fontSize: '15px',
      resize: 'vertical'
    }
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Button, {
    variant: "primary"
  }, "Salva vetrina")))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '20px'
    }
  }, /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "lg"
  }, /*#__PURE__*/React.createElement(SectionTitle, null, "Orari & consegna"), [['Lun – Ven', '8:00 – 19:30'], ['Sabato', '8:00 – 19:30'], ['Domenica', 'Chiuso']].map(([d, h]) => /*#__PURE__*/React.createElement("div", {
    key: d,
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      padding: '8px 0',
      borderBottom: '1px solid var(--cream-200)',
      fontSize: '14px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--ink-600)'
    }
  }, d), /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 600,
      color: h === 'Chiuso' ? 'var(--secondary-600)' : 'var(--ink-900)'
    }
  }, h))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: '12px'
    }
  }, /*#__PURE__*/React.createElement(Checkbox, {
    defaultChecked: true,
    label: "Consegna in giornata disponibile"
  }))), /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "lg",
    style: {
      background: 'var(--ink-900)',
      color: '#fff'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      marginBottom: '8px'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "shield-check",
    size: 20,
    color: "var(--accent-400)"
  }), /*#__PURE__*/React.createElement("strong", {
    style: {
      fontFamily: 'var(--font-serif)',
      fontSize: '17px'
    }
  }, "Piano ", s.plan)), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '13px',
      color: 'var(--ink-300)',
      lineHeight: 1.5
    }
  }, "Zero commissioni sugli ordini. Attivo dal ", s.since, ". Verificato da MyCity."))));
}
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/seller/src/60-more.jsx", error: String((e && e.message) || e) }); }

// ui_kits/seller/src/70-more.js
try { (() => {
// ===== Promotions · Reviews · Customers =====
function Promotions({
  onNew
}) {
  const promos = window.SC_PROMOS;
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(PageTitle, {
    title: "Promozioni",
    sub: "Sconti e offerte a tempo per i tuoi prodotti",
    action: /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      icon: "plus",
      onClick: onNew
    }, "Nuova promo")
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '12px'
    }
  }, promos.map(p => /*#__PURE__*/React.createElement(Card, {
    key: p.id,
    variant: "bordered",
    padding: "lg"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '16px',
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '48px',
      height: '48px',
      borderRadius: 'var(--radius-md)',
      background: p.active ? 'var(--secondary-100)' : 'var(--surface-100)',
      color: p.active ? 'var(--secondary-600)' : 'var(--ink-400)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: p.type === 'shipping' ? 'truck' : 'tag',
    size: 22,
    stroke: 2.2,
    color: p.active ? 'var(--secondary-600)' : 'var(--ink-400)'
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: '180px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px'
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontWeight: 700,
      color: 'var(--ink-900)',
      fontSize: '15px'
    }
  }, p.name), p.active ? /*#__PURE__*/React.createElement(Badge, {
    variant: "new"
  }, "Attiva") : /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '12px',
      color: 'var(--ink-400)',
      fontWeight: 600
    }
  }, "Terminata")), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 0',
      fontSize: '13px',
      color: 'var(--ink-500)'
    }
  }, p.product, " \xB7 scade il ", p.ends)), /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'right'
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '20px',
      fontWeight: 800,
      color: 'var(--secondary-600)'
    }
  }, p.type === 'shipping' ? 'Sped. gratis' : `-${p.value}%`), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '12px',
      color: 'var(--ink-400)'
    }
  }, p.used, " utilizzi")), /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'relative',
      width: '40px',
      height: '23px',
      borderRadius: '999px',
      background: p.active ? 'var(--olive-500)' : 'var(--cream-400)',
      transition: 'background var(--dur-base)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      top: '2px',
      left: p.active ? '19px' : '2px',
      width: '19px',
      height: '19px',
      borderRadius: '50%',
      background: '#fff',
      transition: 'left var(--dur-base)',
      boxShadow: 'var(--shadow-sm)'
    }
  }))))))));
}
function Reviews() {
  const reviews = window.SC_REVIEWS;
  const avg = window.SC_STORE.rating;
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(PageTitle, {
    title: "Recensioni",
    sub: "Reputazione e feedback dei clienti"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '240px 1fr',
      gap: '24px',
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement(Card, {
    variant: "flat",
    padding: "lg"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'center'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-serif)',
      fontSize: '46px',
      fontWeight: 800,
      color: 'var(--ink-900)',
      lineHeight: 1
    }
  }, avg.toFixed(1).replace('.', ',')), /*#__PURE__*/React.createElement("div", {
    style: {
      margin: '8px 0'
    }
  }, /*#__PURE__*/React.createElement(Stars, {
    value: avg,
    size: 18
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: '13px',
      color: 'var(--ink-500)'
    }
  }, window.SC_STORE.reviews, " recensioni")), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: '16px',
      display: 'flex',
      flexDirection: 'column',
      gap: '6px'
    }
  }, [[5, 82], [4, 13], [3, 3], [2, 1], [1, 1]].map(([s, pct]) => /*#__PURE__*/React.createElement("div", {
    key: s,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      fontSize: '12px',
      color: 'var(--ink-500)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '8px'
    }
  }, s), /*#__PURE__*/React.createElement(Lucide, {
    name: "star",
    size: 11,
    color: "var(--accent-500)"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      height: '6px',
      background: 'var(--cream-200)',
      borderRadius: '3px',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'block',
      height: '100%',
      width: `${pct}%`,
      background: 'var(--accent-500)'
    }
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      width: '28px',
      textAlign: 'right'
    }
  }, pct, "%"))))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '12px'
    }
  }, reviews.map((r, i) => /*#__PURE__*/React.createElement(Card, {
    key: i,
    variant: "bordered",
    padding: "md"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      marginBottom: '6px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '34px',
      height: '34px',
      borderRadius: '50%',
      background: 'var(--cream-200)',
      color: 'var(--primary-700)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontWeight: 700,
      fontSize: '13px'
    }
  }, initials(r.who)), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px'
    }
  }, /*#__PURE__*/React.createElement("strong", {
    style: {
      fontSize: '14px',
      color: 'var(--ink-900)'
    }
  }, r.who), /*#__PURE__*/React.createElement(Stars, {
    value: r.rating,
    size: 13
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '12px',
      color: 'var(--ink-400)'
    }
  }, r.when, " \xB7 ", r.product))), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '0 0 10px',
      fontSize: '14px',
      lineHeight: 1.55,
      color: 'var(--ink-700)'
    }
  }, r.text), r.reply ? /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--cream-50)',
      borderLeft: '3px solid var(--primary-400)',
      borderRadius: '0 var(--radius-md) var(--radius-md) 0',
      padding: '8px 12px'
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: '12px',
      fontWeight: 700,
      color: 'var(--primary-700)'
    }
  }, "La tua risposta"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '2px 0 0',
      fontSize: '13px',
      color: 'var(--ink-600)'
    }
  }, r.reply)) : /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    size: "sm",
    icon: "reply"
  }, "Rispondi"))))));
}
function Customers() {
  const custs = window.SC_CUSTOMERS;
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(PageTitle, {
    title: "Clienti",
    sub: "Chi compra dal tuo negozio"
  }), /*#__PURE__*/React.createElement(Card, {
    variant: "bordered",
    padding: "none"
  }, /*#__PURE__*/React.createElement("table", {
    style: {
      width: '100%',
      borderCollapse: 'collapse',
      fontFamily: 'var(--font-sans)'
    }
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
    style: {
      background: 'var(--cream-50)',
      borderBottom: '1px solid var(--cream-300)'
    }
  }, ['Cliente', 'Ordini', 'Speso', 'Ultimo'].map((h, i) => /*#__PURE__*/React.createElement("th", {
    key: h,
    style: {
      textAlign: i === 0 ? 'left' : 'right',
      padding: '12px 18px',
      fontSize: '11px',
      fontWeight: 700,
      textTransform: 'uppercase',
      color: 'var(--ink-500)'
    }
  }, h)))), /*#__PURE__*/React.createElement("tbody", null, custs.map(c => /*#__PURE__*/React.createElement("tr", {
    key: c.name,
    style: {
      borderBottom: '1px solid var(--cream-200)'
    }
  }, /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '12px 18px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '36px',
      height: '36px',
      borderRadius: '50%',
      background: 'linear-gradient(135deg, var(--primary-500), var(--primary-700))',
      color: '#fff',
      fontWeight: 700,
      fontSize: '13px',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, c.initials), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: '14px',
      fontWeight: 600,
      color: 'var(--ink-900)'
    }
  }, c.name))), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '12px 18px',
      textAlign: 'right',
      color: 'var(--ink-700)'
    }
  }, c.orders), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '12px 18px',
      textAlign: 'right',
      fontWeight: 700,
      color: 'var(--ink-900)'
    }
  }, fmt(c.spent)), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '12px 18px',
      textAlign: 'right',
      color: 'var(--ink-500)',
      fontSize: '13px'
    }
  }, c.last)))))));
}
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/seller/src/70-more.js", error: String((e && e.message) || e) }); }

// ui_kits/seller/src/90-app.js
try { (() => {
// ===== Seller app shell (view state + toasts) =====
function App() {
  const [view, setView] = React.useState('dashboard');
  const [orders, setOrders] = React.useState(window.SC_ORDERS);
  const [newProd, setNewProd] = React.useState(false);
  const [toast, setToast] = React.useState(null);
  const timer = React.useRef(null);
  function showToast(text) {
    setToast(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2600);
  }
  function nav(v) {
    setView(v);
    window.scrollTo(0, 0);
  }
  function advance(o) {
    const next = SC_NEXT[o.status];
    if (!next) return;
    setOrders(list => list.map(x => x.id === o.id ? {
      ...x,
      status: next
    } : x));
    showToast(`Ordine #${o.id} → ${next === 'ACCEPTED' ? 'accettato' : next === 'READY' ? 'pronto' : 'assegnato al rider'}`);
  }
  function saveProduct() {
    setNewProd(false);
    showToast('Prodotto pubblicato in vetrina');
  }
  return /*#__PURE__*/React.createElement(SellerShell, {
    view: view,
    onNav: nav,
    onNewProduct: () => setNewProd(true)
  }, view === 'dashboard' && /*#__PURE__*/React.createElement(Dashboard, {
    onNav: nav,
    onNewProduct: () => setNewProd(true)
  }), view === 'orders' && /*#__PURE__*/React.createElement(Orders, {
    orders: orders,
    onAdvance: advance
  }), view === 'products' && /*#__PURE__*/React.createElement(Products, {
    products: window.SC_PRODUCTS,
    onNewProduct: () => setNewProd(true)
  }), view === 'promotions' && /*#__PURE__*/React.createElement(Promotions, {
    onNew: () => showToast('Editor promo (demo)')
  }), view === 'analytics' && /*#__PURE__*/React.createElement(Analytics, null), view === 'customers' && /*#__PURE__*/React.createElement(Customers, null), view === 'reviews' && /*#__PURE__*/React.createElement(Reviews, null), view === 'earnings' && /*#__PURE__*/React.createElement(Earnings, null), /*#__PURE__*/React.createElement(NewProductModal, {
    open: newProd,
    onClose: () => setNewProd(false),
    onSave: saveProduct
  }), toast && ReactDOM.createPortal(/*#__PURE__*/React.createElement("div", {
    style: {
      position: 'fixed',
      left: '50%',
      bottom: '28px',
      transform: 'translateX(-50%)',
      zIndex: 'var(--z-toast)',
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      background: 'var(--ink-900)',
      color: '#fff',
      padding: '12px 18px',
      borderRadius: 'var(--radius-full)',
      boxShadow: 'var(--shadow-warm-xl)',
      animation: 'mc-pop-in var(--dur-medium) var(--ease-out-quint)',
      fontSize: '14px',
      fontWeight: 500
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '24px',
      height: '24px',
      borderRadius: '50%',
      background: 'var(--olive-600)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement(Lucide, {
    name: "check",
    size: 15,
    stroke: 3,
    color: "#fff"
  })), toast), document.body));
}
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/seller/src/90-app.js", error: String((e && e.message) || e) }); }

// ui_kits/seller/src/90-app.jsx
try { (() => {
// ===== Seller app shell =====
function App() {
  const [view, setView] = React.useState('dashboard');
  const [order, setOrder] = React.useState(null);
  const [orders, setOrders] = React.useState(window.SC_ORDERS);
  function nav(v) {
    setView(v);
    window.scrollTo(0, 0);
  }
  function advance(o, next) {
    setOrders(prev => prev.map(x => x.id === o.id ? {
      ...x,
      status: next
    } : x));
    setOrder(cur => cur ? {
      ...cur,
      status: next
    } : cur);
  }
  const TITLES = {
    dashboard: ['Ciao, Giorgio 👋', 'Ecco com’è andata oggi a ' + window.SC_STORE.name],
    ordini: ['Ordini', 'Gestisci e fai avanzare gli ordini'],
    prodotti: ['Prodotti', 'Il tuo catalogo'],
    analytics: ['Analytics', 'Andamento del negozio'],
    incassi: ['Incassi', 'Pagamenti alla consegna e payout'],
    promozioni: ['Promozioni', 'Coupon e offerte'],
    recensioni: ['Recensioni', 'Cosa dicono i clienti'],
    clienti: ['Clienti', 'I tuoi clienti abituali'],
    profilo: ['Profilo negozio', 'Vetrina e impostazioni']
  };
  const [title, subtitle] = TITLES[view] || ['', ''];
  const actions = view === 'prodotti' ? /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    icon: "plus"
  }, "Nuovo prodotto") : view === 'dashboard' ? /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    icon: "external-link"
  }, "Vai al negozio") : null;

  // window.SC_ORDERS kept in sync for child views reading it
  window.SC_ORDERS = orders;
  return /*#__PURE__*/React.createElement(Layout, {
    active: view,
    onNav: nav,
    title: title,
    subtitle: subtitle,
    actions: actions
  }, view === 'dashboard' && /*#__PURE__*/React.createElement(Dashboard, {
    onNav: nav,
    onOpenOrder: setOrder
  }), view === 'ordini' && /*#__PURE__*/React.createElement(OrdersView, {
    onOpenOrder: setOrder
  }), view === 'prodotti' && /*#__PURE__*/React.createElement(ProductsView, null), view === 'analytics' && /*#__PURE__*/React.createElement(AnalyticsView, null), view === 'incassi' && /*#__PURE__*/React.createElement(EarningsView, null), view === 'promozioni' && /*#__PURE__*/React.createElement(PromosView, null), view === 'recensioni' && /*#__PURE__*/React.createElement(ReviewsView, null), view === 'clienti' && /*#__PURE__*/React.createElement(CustomersView, null), view === 'profilo' && /*#__PURE__*/React.createElement(ProfileView, null), /*#__PURE__*/React.createElement(OrderDetail, {
    order: order,
    onClose: () => setOrder(null),
    onAdvance: advance
  }));
}
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/seller/src/90-app.jsx", error: String((e && e.message) || e) }); }

// ui_kits/seller/src/data.js
try { (() => {
// MyCity Seller — demo data (plain globals; loaded before app.js).
const LF = (k, lock) => `https://loremflickr.com/640/640/${k}?lock=${lock}`;
window.SC_STORE = {
  name: 'Salumeria Verdi',
  area: 'Centro storico',
  since: 1962,
  rating: 4.9,
  reviews: 214,
  initials: 'SV',
  subscription: 'active',
  healthScore: 86
};
window.SC_KPI = {
  revenueToday: 142.5,
  ordersToday: 6,
  revenue7: 980.4,
  orders7: 41,
  revenue30: 4120.9,
  orders30: 173,
  revenueTotal: 28640.0,
  itemsSold: 1240,
  productsAvailable: 18,
  productsTotal: 22,
  avgRating: 4.9,
  reviewCount: 214
};

// Ordini ricevuti dal negozio (8 stati). cust = cliente, addr, items.
window.SC_ORDERS = [{
  id: 'PCA1F3',
  cust: 'Lucia Bianchi',
  addr: 'Via Roma 12',
  when: 'Oggi 10:24',
  status: 'NEW',
  total: 27.4,
  pay: 'cod',
  items: [{
    kw: 'salami',
    lock: 7,
    name: 'Coppa Piacentina DOP 200g',
    q: 2,
    price: 7.12
  }, {
    kw: 'cheese',
    lock: 3,
    name: 'Grana Padano DOP 18 mesi 1kg',
    q: 1,
    price: 17.01
  }]
}, {
  id: 'PCB2K9',
  cust: 'Marco Rossi',
  addr: 'Via Cavour 48',
  when: 'Oggi 09:50',
  status: 'ACCEPTED',
  total: 23.0,
  pay: 'cod',
  items: [{
    kw: 'prosciutto',
    lock: 3,
    name: 'Salame nostrano 300g',
    q: 2,
    price: 11.5
  }]
}, {
  id: 'PCC7M2',
  cust: 'Anna Conti',
  addr: 'Via Borghetto 5',
  when: 'Oggi 09:12',
  status: 'READY',
  total: 17.8,
  pay: 'card',
  items: [{
    kw: 'cheese',
    lock: 7,
    name: 'Grana Padano DOP 18 mesi 1kg',
    q: 1,
    price: 17.01
  }]
}, {
  id: 'PCD4P8',
  cust: 'Davide Neri',
  addr: 'Stradone Farnese 22',
  when: 'Oggi 08:40',
  status: 'ASSIGNED',
  total: 35.6,
  pay: 'cod',
  items: [{
    kw: 'salami',
    lock: 15,
    name: 'Coppa Piacentina DOP 200g',
    q: 4,
    price: 7.12
  }]
}, {
  id: 'PCE9R1',
  cust: 'Sara Galli',
  addr: 'Via Taverna 9',
  when: 'Ieri 18:30',
  status: 'OUT_FOR_DELIVERY',
  total: 14.2,
  pay: 'card',
  items: [{
    kw: 'prosciutto',
    lock: 7,
    name: 'Salame nostrano 300g',
    q: 1,
    price: 11.5
  }]
}, {
  id: 'PCF3T6',
  cust: 'Paolo Ferri',
  addr: 'Via Genova 3',
  when: 'Ieri 16:10',
  status: 'DELIVERED',
  total: 42.3,
  pay: 'cod',
  items: [{
    kw: 'cheese',
    lock: 15,
    name: 'Grana Padano DOP 18 mesi 1kg',
    q: 2,
    price: 17.01
  }]
}, {
  id: 'PCG8W4',
  cust: 'Elena Vitali',
  addr: 'Via Alberoni 17',
  when: '14 giu',
  status: 'DELIVERED',
  total: 21.4,
  pay: 'card',
  items: [{
    kw: 'salami',
    lock: 3,
    name: 'Coppa Piacentina DOP 200g',
    q: 3,
    price: 7.12
  }]
}, {
  id: 'PCH1Z7',
  cust: 'Luca Moretti',
  addr: 'Via Scalabrini 30',
  when: '13 giu',
  status: 'CANCELED',
  total: 11.5,
  pay: 'cod',
  items: [{
    kw: 'prosciutto',
    lock: 15,
    name: 'Salame nostrano 300g',
    q: 1,
    price: 11.5
  }]
}];
window.SC_PRODUCTS = [{
  id: 'sp1',
  name: 'Coppa Piacentina DOP 200g',
  kw: 'salami',
  lock: 7,
  price: 8.9,
  discount: 20,
  stock: 12,
  status: 'available',
  sold: 184,
  cat: 'Salumi'
}, {
  id: 'sp2',
  name: 'Grana Padano DOP 18 mesi 1kg',
  kw: 'cheese',
  lock: 3,
  price: 18.9,
  discount: 10,
  stock: 8,
  status: 'available',
  sold: 142,
  cat: 'Formaggi'
}, {
  id: 'sp3',
  name: 'Salame nostrano stagionato 300g',
  kw: 'prosciutto',
  lock: 3,
  price: 11.5,
  discount: 0,
  stock: 6,
  status: 'available',
  sold: 97,
  cat: 'Salumi'
}, {
  id: 'sp4',
  name: 'Pancetta arrotolata 250g',
  kw: 'salami',
  lock: 3,
  price: 9.4,
  discount: 0,
  stock: 3,
  status: 'available',
  sold: 64,
  cat: 'Salumi'
}, {
  id: 'sp5',
  name: 'Gorgonzola DOP 200g',
  kw: 'cheese',
  lock: 15,
  price: 6.2,
  discount: 0,
  stock: 0,
  status: 'soldout',
  sold: 51,
  cat: 'Formaggi'
}, {
  id: 'sp6',
  name: 'Mostarda di Cremona 250g',
  kw: 'marmalade',
  lock: 7,
  price: 7.2,
  discount: 0,
  stock: 15,
  status: 'available',
  sold: 38,
  cat: 'Conserve'
}, {
  id: 'sp7',
  name: 'Culatello di Zibello 150g',
  kw: 'prosciutto',
  lock: 7,
  price: 14.0,
  discount: 0,
  stock: 4,
  status: 'available',
  sold: 29,
  cat: 'Salumi'
}, {
  id: 'sp8',
  name: 'Pecorino stagionato 300g',
  kw: 'cheese',
  lock: 7,
  price: 9.8,
  discount: 0,
  stock: 0,
  status: 'draft',
  sold: 0,
  cat: 'Formaggi'
}];
window.SC_CUSTOMERS = [{
  name: 'Lucia Bianchi',
  orders: 14,
  spent: 312.4,
  last: 'Oggi',
  initials: 'LB'
}, {
  name: 'Marco Rossi',
  orders: 9,
  spent: 198.0,
  last: 'Oggi',
  initials: 'MR'
}, {
  name: 'Paolo Ferri',
  orders: 7,
  spent: 164.5,
  last: 'Ieri',
  initials: 'PF'
}, {
  name: 'Elena Vitali',
  orders: 6,
  spent: 142.8,
  last: '14 giu',
  initials: 'EV'
}, {
  name: 'Sara Galli',
  orders: 5,
  spent: 98.2,
  last: 'Ieri',
  initials: 'SG'
}, {
  name: 'Davide Neri',
  orders: 4,
  spent: 87.6,
  last: 'Oggi',
  initials: 'DN'
}];
window.SC_REVIEWS = [{
  who: 'Marco B.',
  rating: 5,
  when: '2 giorni fa',
  product: 'Coppa Piacentina DOP',
  text: 'La vera coppa piacentina, come quella di mio nonno. Taglio perfetto, arrivata freschissima.',
  reply: null
}, {
  who: 'Giulia R.',
  rating: 5,
  when: '1 settimana fa',
  product: 'Grana Padano DOP',
  text: 'Stagionatura perfetta, granuloso e saporito. Si sente la qualità.',
  reply: 'Grazie Giulia! A presto 🙂'
}, {
  who: 'Anna T.',
  rating: 4,
  when: '1 settimana fa',
  product: 'Salame nostrano',
  text: 'Ottimo salame, magari un filo più di stagionatura. Consegna puntuale.',
  reply: null
}, {
  who: 'Paolo F.',
  rating: 5,
  when: '2 settimane fa',
  product: 'Coppa Piacentina DOP',
  text: 'Servizio impeccabile e prodotto top. Comodo pagare alla consegna.',
  reply: null
}];
window.SC_PROMOS = [{
  id: 'pr1',
  name: 'Sconto Coppa -20%',
  product: 'Coppa Piacentina DOP 200g',
  type: 'percent',
  value: 20,
  active: true,
  ends: '20 giu',
  used: 47
}, {
  id: 'pr2',
  name: 'Grana -10%',
  product: 'Grana Padano DOP 18 mesi',
  type: 'percent',
  value: 10,
  active: true,
  ends: '30 giu',
  used: 23
}, {
  id: 'pr3',
  name: 'Spedizione gratis weekend',
  product: 'Tutti i prodotti',
  type: 'shipping',
  value: 0,
  active: false,
  ends: '15 giu',
  used: 112
}];

// Earnings: payout per ordine carta. cod = contanti (incassati dal rider).
window.SC_PAYOUTS = [{
  id: 'PCC7M2',
  when: 'Oggi',
  net: 15.6,
  status: 'HELD'
}, {
  id: 'PCE9R1',
  when: 'Ieri',
  net: 13.0,
  status: 'HELD'
}, {
  id: 'PCK22A',
  when: '13 giu',
  net: 38.9,
  status: 'TRANSFERRED',
  paidOn: '14 giu'
}, {
  id: 'PCK19B',
  when: '11 giu',
  net: 19.6,
  status: 'TRANSFERRED',
  paidOn: '12 giu'
}, {
  id: 'PCK08C',
  when: '8 giu',
  net: 27.2,
  status: 'TRANSFERRED',
  paidOn: '9 giu'
}];
window.SC_REVENUE_7D = [320, 410, 280, 520, 470, 610, 540]; // last 7 days gross
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/seller/src/data.js", error: String((e && e.message) || e) }); }

__ds_ns.OrderStatusBadge = __ds_scope.OrderStatusBadge;

__ds_ns.ProductCard = __ds_scope.ProductCard;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.EmptyState = __ds_scope.EmptyState;

__ds_ns.Modal = __ds_scope.Modal;

__ds_ns.Checkbox = __ds_scope.Checkbox;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Field = __ds_scope.Field;

__ds_ns.Select = __ds_scope.Select;

})();
