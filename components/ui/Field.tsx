'use client';

import {
  forwardRef,
  useId,
  useState,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
  type SelectHTMLAttributes,
  type ReactNode,
} from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Primitive form — Input / Textarea / Select / PasswordInput / Checkbox.
 *
 * Obiettivi (Step 10.1):
 * - coerenza visiva (un solo set di classi: bordo/rounded/padding/focus ring);
 * - a11y: label associata via htmlFor/id, `aria-invalid` + `aria-describedby` su
 *   errori/hint, focus-visible coerente;
 * - mobile: `text-base` (≥16px) per non innescare lo zoom automatico su iOS;
 * - compatibile con form controllati e con react-hook-form (forwardRef + spread);
 * - copre anche i controlli "custom": adornment leading/trailing, azione nella
 *   riga della label (es. "Password dimenticata?"), toggle mostra/nascondi
 *   password e checkbox con label ricca — così OGNI campo passa dalla primitiva.
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
  /** Elemento allineato a destra nella riga della label (es. link "Password dimenticata?"). */
  labelAction?: ReactNode;
  children: ReactNode;
};

/** Wrapper label + controllo + hint/errore. Esportato per controlli custom. */
export function Field({ id, label, required, hint, error, className, labelAction, children }: FieldShellProps) {
  return (
    <div className={cn('space-y-1', className)}>
      {(label || labelAction) && (
        <div className="flex items-center justify-between gap-2">
          {label ? (
            <label htmlFor={id} className="block text-sm font-medium text-ink-700">
              {label}
              {required && <span className="text-rose-600" aria-hidden> *</span>}
            </label>
          ) : (
            <span />
          )}
          {labelAction}
        </div>
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

type Common = {
  label?: string;
  hint?: string;
  error?: string;
  id?: string;
  containerClassName?: string;
  labelAction?: ReactNode;
};

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> & Common & {
  /** Icona/elemento dentro il controllo a sinistra. */
  leading?: ReactNode;
  /** Icona/bottone dentro il controllo a destra (es. toggle password). */
  trailing?: ReactNode;
};
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, required, id, className, containerClassName, labelAction, leading, trailing, ...props },
  ref,
) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const control = (
    <input
      ref={ref}
      id={fieldId}
      required={required}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy(fieldId, hint, error)}
      className={cn(CONTROL_BASE, PAD, leading ? 'pl-10' : '', trailing ? 'pr-11' : '', error ? CONTROL_ERR : CONTROL_OK, className)}
      {...props}
    />
  );
  return (
    <Field id={fieldId} label={label} required={required} hint={hint} error={error} className={containerClassName} labelAction={labelAction}>
      {leading || trailing ? (
        <div className="relative">
          {leading && (
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none">{leading}</span>
          )}
          {control}
          {trailing && (
            <span className="absolute right-1.5 top-1/2 -translate-y-1/2">{trailing}</span>
          )}
        </div>
      ) : (
        control
      )}
    </Field>
  );
});

/** Input password con toggle mostra/nascondi integrato (sostituisce i toggle custom). */
type PasswordInputProps = Omit<InputProps, 'type' | 'trailing' | 'leading'>;
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(function PasswordInput(props, ref) {
  const [show, setShow] = useState(false);
  return (
    <Input
      ref={ref}
      type={show ? 'text' : 'password'}
      trailing={
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          aria-label={show ? 'Nascondi password' : 'Mostra password'}
          aria-pressed={show}
          tabIndex={-1}
          className="text-ink-500 hover:text-ink-700 hover:bg-cream-100 rounded-md p-1.5 transition-colors"
        >
          {show ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
        </button>
      }
      {...props}
    />
  );
});

type TextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> & Common;
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, required, id, className, containerClassName, labelAction, ...props },
  ref,
) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <Field id={fieldId} label={label} required={required} hint={hint} error={error} className={containerClassName} labelAction={labelAction}>
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
  { label, hint, error, required, id, className, containerClassName, labelAction, children, ...props },
  ref,
) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <Field id={fieldId} label={label} required={required} hint={hint} error={error} className={containerClassName} labelAction={labelAction}>
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

/** Checkbox con label ricca (ReactNode) + stato errore. Per TOS, opt-in, toggle. */
type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'id'> & {
  label?: ReactNode;
  id?: string;
  error?: string;
  containerClassName?: string;
};
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, id, error, className, containerClassName, ...props },
  ref,
) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <div className={containerClassName}>
      <label htmlFor={fieldId} className="flex items-start gap-2 text-sm text-ink-700 cursor-pointer">
        <input
          ref={ref}
          id={fieldId}
          type="checkbox"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${fieldId}-error` : undefined}
          className={cn(
            'mt-0.5 h-4 w-4 rounded border-cream-300 text-primary-700 accent-primary-600 focus-visible:ring-2 focus-visible:ring-primary-400',
            className,
          )}
          {...props}
        />
        {label && <span>{label}</span>}
      </label>
      {error && (
        <p id={`${fieldId}-error`} className="text-xs font-medium text-rose-600 mt-1">{error}</p>
      )}
    </div>
  );
});
