import React from 'react';

/**
 * MyCity Button — "Mediterranean Modern" primitive.
 * 6 variants · 3 sizes · rounded/pill · loading + icon slots.
 * Styling is bound to the design-system CSS custom properties (no Tailwind).
 *
 * Icons: pass a Lucide icon NAME (e.g. icon="shopping-cart") and load the
 * Lucide UMD script on the page, or pass any React node.
 */

const VARIANTS = {
  primary:   { bg: 'var(--primary-700)', hover: 'var(--primary-800)', color: '#fff', shadow: 'var(--shadow-warm-sm)' },
  accent:    { bg: 'var(--accent-400)', hover: 'var(--accent-500)', color: 'var(--ink-900)', shadow: 'var(--shadow-sm)' },
  secondary: { bg: 'var(--surface-0)', hover: 'var(--cream-50)', color: 'var(--ink-900)', border: '1px solid var(--cream-300)' },
  ghost:     { bg: 'transparent', hover: 'var(--primary-50)', color: 'var(--primary-700)' },
  danger:    { bg: 'var(--danger)', hover: '#B91C1C', color: '#fff' },
  success:   { bg: 'var(--olive-600)', hover: 'var(--olive-700)', color: '#fff' },
};

const SIZES = {
  sm: { padding: '6px 12px', fontSize: '12px', gap: '4px', minHeight: '32px' },
  md: { padding: '10px 16px', fontSize: '14px', gap: '6px', minHeight: '44px' },
  lg: { padding: '12px 20px', fontSize: '16px', gap: '8px', minHeight: '48px' },
};
const ICON_SIZE = { sm: 12, md: 14, lg: 18 };

export function Button({
  variant = 'primary', size = 'md', shape = 'rounded',
  loading = false, disabled = false, fullWidth = false,
  icon, iconRight, href, onClick, type = 'button', children, style, ...rest
}) {
  const v = VARIANTS[variant] || VARIANTS.primary;
  const s = SIZES[size] || SIZES.md;
  const sz = ICON_SIZE[size];
  const isDisabled = disabled || loading;
  const [hover, setHover] = React.useState(false);
  const [active, setActive] = React.useState(false);

  const styles = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: 'var(--font-sans)', fontWeight: 600, lineHeight: 1,
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
    ...s, ...style,
  };

  const handlers = {
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => { setHover(false); setActive(false); },
    onMouseDown: () => setActive(true),
    onMouseUp: () => setActive(false),
  };

  const content = (
    <>
      {loading && <Spinner size={sz} />}
      {!loading && icon && <Glyph icon={icon} size={sz} />}
      {children}
      {!loading && iconRight && <Glyph icon={iconRight} size={sz} />}
    </>
  );

  if (href && !isDisabled) {
    return <a href={href} style={styles} {...handlers} {...rest}>{content}</a>;
  }
  return (
    <button type={type} disabled={isDisabled} onClick={onClick}
      aria-busy={loading || undefined} style={styles} {...handlers} {...rest}>
      {content}
    </button>
  );
}

function Glyph({ icon, size }) {
  if (typeof icon === 'string') {
    return <i data-lucide={icon} ref={mountLucide(size)} style={{ width: size, height: size, display: 'inline-flex' }} />;
  }
  return icon || null;
}

function Spinner({ size }) {
  return <span style={{
    width: size, height: size, borderRadius: '50%',
    border: '2px solid currentColor', borderTopColor: 'transparent',
    display: 'inline-block', animation: 'mc-spin 0.7s linear infinite',
  }} />;
}

function mountLucide(size) {
  return (el) => {
    if (el && typeof window !== 'undefined' && window.lucide) {
      try { window.lucide.createIcons({ attrs: { width: size, height: size, 'stroke-width': 2.4 } }); } catch (e) {}
    }
  };
}
