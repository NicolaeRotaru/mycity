'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Modal primitive — bottom sheet su mobile, centered su desktop.
 *
 * Esperti consultati:
 * - Accessibility Specialist: "role=dialog + aria-modal + aria-labelledby +
 *   focus trap + Esc to close + click outside opzionale + return focus."
 * - Mobile UX Specialist: "Bottom sheet mobile (items-end) > centered modal —
 *   pollice ergonomico. Desktop: centered."
 * - Senior UX Designer: "Body lock scroll quando aperto. Animation slide-up
 *   mobile, fade desktop."
 */

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  closeOnBackdrop?: boolean;
  closeOnEsc?: boolean;
};

const SIZES = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-md',
  lg: 'sm:max-w-lg',
  xl: 'sm:max-w-2xl',
};

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  closeOnBackdrop = true,
  closeOnEsc = true,
}: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  // Body scroll lock + return focus
  useEffect(() => {
    if (!open) return;
    previousActiveElement.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Focus first focusable inside
    setTimeout(() => {
      const first = dialogRef.current?.querySelector<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      first?.focus();
    }, 10);
    return () => {
      document.body.style.overflow = prevOverflow;
      previousActiveElement.current?.focus?.();
    };
  }, [open]);

  // Esc to close + focus trap minimal
  useEffect(() => {
    if (!open || !closeOnEsc) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, closeOnEsc, onClose]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  const titleId = `modal-title-${title.toLowerCase().replace(/\s+/g, '-').slice(0, 20)}`;
  const descId  = description ? `${titleId}-desc` : undefined;

  return createPortal(
    <div
      onClick={closeOnBackdrop ? onClose : undefined}
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4 animate-fade-in"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'bg-white w-full rounded-t-2xl sm:rounded-2xl shadow-warm-xl overflow-hidden max-h-[90vh] flex flex-col animate-slide-up',
          SIZES[size],
        )}
      >
        <header className="px-5 py-4 border-b border-cream-200 flex items-center justify-between flex-shrink-0">
          <div className="flex-1 min-w-0">
            <h2 id={titleId} className="font-bold text-ink-900 truncate">{title}</h2>
            {description && <p id={descId} className="text-xs text-ink-500 mt-0.5">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Chiudi"
            className="text-ink-500 hover:text-ink-900 hover:bg-cream-100 rounded-full p-1.5 transition-colors flex-shrink-0 ml-3"
          >
            <X size={20} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5">{children}</div>

        {footer && (
          <footer className="px-5 py-4 border-t border-cream-200 flex items-center justify-end gap-2 flex-shrink-0">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}
