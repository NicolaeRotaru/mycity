import React from 'react';

/**
 * MyCity Checkbox — accessible checkbox with a rich (ReactNode) label, for
 * TOS opt-ins, toggles and filters. Accent colour = terracotta.
 */
export function Checkbox({ label, id, error, checked, defaultChecked, onChange, containerStyle, style, ...props }) {
  const autoId = React.useId();
  const fieldId = id || autoId;
  return (
    <div style={containerStyle}>
      <label htmlFor={fieldId} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontFamily: 'var(--font-sans)', fontSize: '14px', color: 'var(--ink-700)', cursor: 'pointer' }}>
        <input
          id={fieldId} type="checkbox"
          checked={checked} defaultChecked={defaultChecked} onChange={onChange}
          aria-invalid={error ? true : undefined}
          style={{
            marginTop: '2px', width: '16px', height: '16px',
            accentColor: 'var(--primary-600)', cursor: 'pointer',
            ...style,
          }}
          {...props}
        />
        {label && <span>{label}</span>}
      </label>
      {error && <p style={{ margin: '4px 0 0', fontSize: '12px', fontWeight: 500, color: 'var(--secondary-600)' }}>{error}</p>}
    </div>
  );
}
