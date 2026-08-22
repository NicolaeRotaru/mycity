import React from 'react';

/**
 * MyCity EmptyState — friendly empty/zero-result placeholder. Soft terracotta
 * icon medallion, serif title, optional action. Bound to the design tokens.
 */
export function EmptyState({ icon = 'package-open', title, description, action, tone = 'primary', style }) {
  const TONES = {
    primary:   { bg: 'var(--primary-50)', fg: 'var(--primary-700)' },
    olive:     { bg: 'var(--olive-50)', fg: 'var(--olive-700)' },
    accent:    { bg: 'var(--accent-100)', fg: 'var(--accent-700)' },
    secondary: { bg: 'var(--secondary-50)', fg: 'var(--secondary-600)' },
  };
  const t = TONES[tone] || TONES.primary;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '32px 24px', ...style }}>
      <span style={{ width: '64px', height: '64px', borderRadius: 'var(--radius-full)', background: t.bg, color: t.fg, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px' }}>
        <i data-lucide={icon} ref={(el) => { if (el && window.lucide) try { window.lucide.createIcons({ attrs: { width: 28, height: 28, 'stroke-width': 2 } }); } catch (e) {} }} style={{ width: 28, height: 28, display: 'inline-flex' }} />
      </span>
      <h3 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontWeight: 700, fontSize: '18px', color: 'var(--ink-900)' }}>{title}</h3>
      {description && <p style={{ margin: '6px 0 0', fontSize: '14px', color: 'var(--ink-500)', maxWidth: '320px', lineHeight: 1.5 }}>{description}</p>}
      {action && <div style={{ marginTop: '18px' }}>{action}</div>}
    </div>
  );
}
