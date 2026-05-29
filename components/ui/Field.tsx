'use client';

import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
  type SelectHTMLAttributes,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/cn';

/**
 * Primitive form — Input / Textarea / Select con label, stato errore e ARIA.
 *
 * Obiettivi (Step 10.1):
 * - coerenza visiva (un solo set di classi: bordo/rounded/padding/focus ring);
 * - a11y: label associata via htmlFor/id, `aria-invalid` + `aria-describedby` su
 *   errori/hint, focus-visible coerente;
 * - mobile: `text-base` (≥16px) per non innescare lo zoom automatico su iOS;
 * - compatibile sia con form controllati (value/onChange) sia con react-hook-form
 *   (`{...register(...)}` + `error={errors.x?.message}`), grazie a forwardRef + spread.
 */

const CONTROL_BASE =
  'w-full rounded-lg border bg-white text-base text-ink-900 placeholder:text-ink-400 transition-colors focus:outline-none focus-visible:ring-2 disabled:opacity-60 disabled:cursor-not-allowed';
const CONTROL_OK = 'border-cream-300 focus-visible:ring-primary-400 focus-visible:border-primary-400';
const CONTROL_ERR = 'border-rose-400 focus-visible:ring-rose-400 focus-visible:border-rose-400';
const PAD = 'px-3 py-2.5';

type FieldShellProps = {
  id: string;
  label?: string;
  required?: boolean;
  hint?: string;
  error?: string;
  className?: string;
  children: ReactNode;
};

/** Wrapper label + controllo + hint/errore. Esportato per controlli custom. */
export function Field({ id, label, required, hint, error, className, children }: FieldShellProps) {
  return (
    <div className={cn('space-y-1', className)}>
      {label && (
        <label htmlFor={id} className="block text-sm font-medium text-ink-700">
          {label}
          {required && <span className="text-rose-600" aria-hidden> *</span>}
        </label>
      )}
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-ink-500">{hint}</p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-xs font-medium text-rose-600">{error}</p>
      )}
    </div>
  );
}

function describedBy(id: string, hint?: string, error?: string): string | undefined {
  return cn(error ? `${id}-error` : '', hint && !error ? `${id}-hint` : '') || undefined;
}

type Common = { label?: string; hint?: string; error?: string; id?: string; containerClassName?: string };

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> & Common;
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, required, id, className, containerClassName, ...props },
  ref,
) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <Field id={fieldId} label={label} required={required} hint={hint} error={error} className={containerClassName}>
      <input
        ref={ref}
        id={fieldId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fieldId, hint, error)}
        className={cn(CONTROL_BASE, PAD, error ? CONTROL_ERR : CONTROL_OK, className)}
        {...props}
      />
    </Field>
  );
});

type TextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> & Common;
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, required, id, className, containerClassName, ...props },
  ref,
) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <Field id={fieldId} label={label} required={required} hint={hint} error={error} className={containerClassName}>
      <textarea
        ref={ref}
        id={fieldId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fieldId, hint, error)}
        className={cn(CONTROL_BASE, PAD, error ? CONTROL_ERR : CONTROL_OK, className)}
        {...props}
      />
    </Field>
  );
});

type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> & Common & { children: ReactNode };
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, required, id, className, containerClassName, children, ...props },
  ref,
) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <Field id={fieldId} label={label} required={required} hint={hint} error={error} className={containerClassName}>
      <select
        ref={ref}
        id={fieldId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fieldId, hint, error)}
        className={cn(CONTROL_BASE, PAD, 'pr-8', error ? CONTROL_ERR : CONTROL_OK, className)}
        {...props}
      >
        {children}
      </select>
    </Field>
  );
});
