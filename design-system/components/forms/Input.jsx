import React from 'react';

/**
 * MyCity Input — labelled text field with hint/error, optional leading/trailing
 * adornments. 16px text avoids iOS zoom. Bound to the design-system tokens.
 */
export function Input({
  label, hint, error, required, id, leading, trailing, labelAction,
  containerStyle, style, ...props
}) {
  const autoId = React.useId();
  const fieldId = id || autoId;
  const [focus, setFocus] = React.useState(false);
  const borderColor = error ? 'var(--secondary-400)' : (focus ? 'var(--primary-400)' : 'var(--cream-300)');

  const control = (
    <input
      id={fieldId} required={required}
      aria-invalid={error ? true : undefined}
      onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
      style={{
        width: '100%', boxSizing: 'border-box',
        fontFamily: 'var(--font-sans)', fontSize: '16px', color: 'var(--ink-900)',
        background: 'var(--surface-0)', borderRadius: 'var(--radius-md)',
        border: `1px solid ${borderColor}`,
        boxShadow: focus ? `0 0 0 3px ${error ? 'rgba(214,62,59,.18)' : 'rgba(228,122,90,.22)'}` : 'none',
        padding: '10px 12px',
        paddingLeft: leading ? '40px' : '12px', paddingRight: trailing ? '44px' : '12px',
        outline: 'none', transition: 'border-color var(--dur-base), box-shadow var(--dur-base)',
        ...style,
      }}
      {...props}
    />
  );

  return (
    <Field id={fieldId} label={label} required={required} hint={hint} error={error} labelAction={labelAction} style={containerStyle}>
      {leading || trailing ? (
        <div style={{ position: 'relative' }}>
          {leading && <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-400)', display: 'inline-flex', pointerEvents: 'none' }}>{leading}</span>}
          {control}
          {trailing && <span style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', display: 'inline-flex' }}>{trailing}</span>}
        </div>
      ) : control}
    </Field>
  );
}

/** Label + control + hint/error wrapper. Exported for custom controls. */
export function Field({ id, label, required, hint, error, labelAction, children, style }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', ...style }}>
      {(label || labelAction) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
          {label ? (
            <label htmlFor={id} style={{ fontFamily: 'var(--font-sans)', fontSize: '14px', fontWeight: 500, color: 'var(--ink-700)' }}>
              {label}{required && <span style={{ color: 'var(--secondary-600)' }}> *</span>}
            </label>
          ) : <span />}
          {labelAction}
        </div>
      )}
      {children}
      {hint && !error && <p style={{ margin: 0, fontSize: '12px', color: 'var(--ink-500)' }}>{hint}</p>}
      {error && <p style={{ margin: 0, fontSize: '12px', fontWeight: 500, color: 'var(--secondary-600)' }}>{error}</p>}
    </div>
  );
}
