import React from 'react';
import { createPortal } from 'react-dom';

/**
 * MyCity Modal — bottom sheet on mobile, centered dialog on desktop.
 * Body scroll-lock, Esc to close, click-outside, slide-up animation.
 * Bound to the design-system tokens.
 */
const SIZES = { sm: '384px', md: '448px', lg: '512px', xl: '672px' };

export function Modal({
  open, onClose, title, description, children, footer,
  size = 'md', closeOnBackdrop = true, closeOnEsc = true,
}) {
  React.useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (closeOnEsc && e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
  }, [open, closeOnEsc, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      onClick={closeOnBackdrop ? onClose : undefined}
      style={{
        position: 'fixed', inset: 0, zIndex: 'var(--z-modal)',
        background: 'rgba(0,0,0,.4)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        animation: 'mc-fade-in var(--dur-fast) ease-out',
      }}
      data-modal-backdrop
    >
      <div
        role="dialog" aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--surface-0)', width: '100%', maxWidth: SIZES[size] || SIZES.md,
          borderRadius: 'var(--radius-2xl) var(--radius-2xl) 0 0',
          boxShadow: 'var(--shadow-warm-xl)', overflow: 'hidden',
          maxHeight: '90vh', display: 'flex', flexDirection: 'column',
          animation: 'mc-slide-up var(--dur-medium) var(--ease-out-quint)',
          margin: '0',
        }}
        className="mc-modal-panel"
      >
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '16px 20px', borderBottom: '1px solid var(--cream-200)', flexShrink: 0 }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontWeight: 700, fontSize: '18px', color: 'var(--ink-900)' }}>{title}</h2>
            {description && <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--ink-500)' }}>{description}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Chiudi"
            style={{ flexShrink: 0, border: 0, background: 'transparent', color: 'var(--ink-500)', cursor: 'pointer', borderRadius: 'var(--radius-full)', padding: '6px', display: 'inline-flex' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </header>
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>{children}</div>
        {footer && (
          <footer style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px', padding: '16px 20px', borderTop: '1px solid var(--cream-200)', flexShrink: 0 }}>
            {footer}
          </footer>
        )}
      </div>
      <style>{`@media (min-width:640px){.mc-modal-panel{margin:16px!important;border-radius:var(--radius-2xl)!important}[data-modal-backdrop]{align-items:center!important}}`}</style>
    </div>,
    document.body,
  );
}
