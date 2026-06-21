'use client';

import { useEffect, useRef } from 'react';
import { Bike, LifeBuoy, MessageCircle, Phone, Store, X, type LucideIcon } from 'lucide-react';

/**
 * Bottom-sheet di contatto per la pagina tracking ordine.
 *
 * - Apertura dal basso (animazione slide-up), backdrop scuro che chiude.
 * - Focus handling: porta il focus dentro al sheet, lo intrappola (Tab),
 *   chiude con Escape e ripristina il focus all'elemento che l'ha aperto.
 * - Azione primaria sempre disponibile: chiamata telefonica (tel:).
 */

export type ContactKind = 'rider' | 'store' | 'help';

export type ContactTarget = {
  kind: ContactKind;
  name: string;
  sub: string;
  phone: string | null;
  /** Riferimento ordine mostrato a piè di sheet (es. #A1B2C3). */
  orderRef?: string;
};

const KIND_ICON: Record<ContactKind, LucideIcon> = {
  rider: Bike,
  store: Store,
  help: LifeBuoy,
};

export function ContactSheet({ target, onClose }: { target: ContactTarget; onClose: () => void }) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const Icon = KIND_ICON[target.kind];
  const tel = target.phone ? target.phone.replace(/\s/g, '') : null;

  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const node = sheetRef.current;
    // Focus al primo elemento focusabile del sheet.
    const focusables = node?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    focusables?.[0]?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !node) return;
      const items = node.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused.current?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-modal flex items-end justify-center bg-black/45 animate-fade-in"
    >
      <div
        ref={sheetRef}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Contatta ${target.name}`}
        className="w-full max-w-md rounded-t-3xl bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] shadow-warm-xl animate-slide-up"
      >
        <div className="mb-4 flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-100 text-primary-700">
            <Icon size={22} strokeWidth={2.2} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-serif text-base font-bold text-ink-900">{target.name}</p>
            <p className="text-sm text-ink-500">{target.sub}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Chiudi"
            className="flex h-8 w-8 items-center justify-center rounded-full text-ink-400 hover:bg-cream-100 hover:text-ink-700"
          >
            <X size={20} aria-hidden />
          </button>
        </div>

        {tel ? (
          <a
            href={`tel:${tel}`}
            className="flex items-center justify-center gap-2 rounded-full bg-primary-700 px-4 py-3.5 text-[15px] font-bold text-white transition-colors hover:bg-primary-800"
          >
            <Phone size={17} strokeWidth={2.4} aria-hidden /> Chiama {target.phone}
          </a>
        ) : (
          <p className="rounded-xl bg-cream-50 px-4 py-3 text-center text-sm text-ink-500">
            Numero di telefono non disponibile per questo contatto.
          </p>
        )}

        {target.kind !== 'help' && (
          <button
            type="button"
            onClick={onClose}
            className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-full border border-cream-300 px-4 py-3 text-sm font-semibold text-ink-700 transition-colors hover:bg-cream-50"
          >
            <MessageCircle size={16} strokeWidth={2.2} aria-hidden /> Invia un messaggio
          </button>
        )}

        {target.orderRef && (
          <p className="mt-3 text-center text-xs text-ink-400">
            Riferimento ordine · {target.orderRef}
          </p>
        )}
      </div>
    </div>
  );
}
