import React from 'react';
import { Field } from './Input.jsx';

/**
 * MyCity Select — native select wrapped in the shared Field shell, with a
 * chevron adornment. Bound to the design-system tokens.
 */
export function Select({ label, hint, error, required, id, children, containerStyle, style, ...props }) {
  const autoId = React.useId();
  const fieldId = id || autoId;
  const [focus, setFocus] = React.useState(false);
  const borderColor = error ? 'var(--secondary-400)' : (focus ? 'var(--primary-400)' : 'var(--cream-300)');
  return (
    <Field id={fieldId} label={label} required={required} hint={hint} error={error} style={containerStyle}>
      <div style={{ position: 'relative' }}>
        <select
          id={fieldId} required={required}
          aria-invalid={error ? true : undefined}
          onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
          style={{
            width: '100%', boxSizing: 'border-box', appearance: 'none',
            fontFamily: 'var(--font-sans)', fontSize: '16px', color: 'var(--ink-900)',
            background: 'var(--surface-0)', borderRadius: 'var(--radius-md)',
            border: `1px solid ${borderColor}`,
            boxShadow: focus ? '0 0 0 3px rgba(228,122,90,.22)' : 'none',
            padding: '10px 36px 10px 12px', outline: 'none', cursor: 'pointer',
            transition: 'border-color var(--dur-base), box-shadow var(--dur-base)',
            ...style,
          }}
          {...props}
        >
          {children}
        </select>
        <span aria-hidden style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--ink-400)' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </span>
      </div>
    </Field>
  );
}
