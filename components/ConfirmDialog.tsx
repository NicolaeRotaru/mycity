'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Check, type LucideIcon } from 'lucide-react';

/**
 * Dialog di conferma globale con API imperativa, sostituto di window.confirm().
 *
 *   const ok = await confirmDialog({
 *     title: "Annullare l'ordine?",
 *     message: "L'azione è irreversibile.",
 *     confirmLabel: "Sì, annulla",
 *     danger: true,
 *   });
 *   if (ok) cancel.mutate();
 *
 * UI:
 *  - Mobile  → bottom sheet che sale dal basso (gesto familiare app-like)
 *  - Desktop → modal centrato classico
 *  - Top accent bar con il gradient brand MyCity (o rose per danger)
 */

export type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  // Accetta un'icona Lucide (preferito). Stringhe legacy (vecchie emoji) sono
  // tollerate per retro-compatibilità ma non vengono renderizzate: il fallback
  // brand (AlertTriangle/Check) prende il loro posto.
  icon?: LucideIcon | string;
};

type State = (ConfirmOptions & { resolve: (ok: boolean) => void }) | null;

let current: State = null;
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
};
const notify = () => listeners.forEach((cb) => cb());

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (current) current.resolve(false); // chiudi silenziosamente la precedente
    current = { ...opts, resolve };
    notify();
  });
}

function closeWith(ok: boolean) {
  if (!current) return;
  const s = current;
  current = null;
  notify();
  s.resolve(ok);
}

export function ConfirmDialogHost() {
  const tActions = useTranslations('actions');
  const state = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );

  // ESC chiude, Enter conferma, blocca lo scroll del body mentre aperto
  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); closeWith(false); }
      if (e.key === 'Enter')  { e.preventDefault(); closeWith(true); }
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [state]);

  if (!state) return null;

  const isDanger = !!state.danger;
  // Le icone Lucide sono componenti (forwardRef → oggetto/funzione). Le stringhe
  // legacy (vecchie emoji) ricadono sul fallback brand: la UI resta senza emoji.
  const Icon = state.icon && typeof state.icon !== 'string'
    ? state.icon
    : (isDanger ? AlertTriangle : Check);

  const accentBar = isDanger
    ? 'bg-gradient-to-r from-rose-500 via-orange-500 to-accent-500'
    : 'bg-gradient-to-r from-primary-600 via-purple-600 to-pink-600';

  const iconBg = isDanger
    ? 'bg-gradient-to-br from-rose-100 to-orange-100 text-rose-600 ring-rose-200'
    : 'bg-gradient-to-br from-primary-100 to-purple-100 text-primary-700 ring-primary-200';

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm animate-fadeIn"
      onClick={(e) => { if (e.target === e.currentTarget) closeWith(false); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
    >
      <div
        className="bg-white w-full sm:w-auto sm:min-w-[420px] sm:max-w-md rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden animate-slideUp sm:animate-popIn pb-[max(env(safe-area-inset-bottom),16px)] sm:pb-0"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top accent bar brand */}
        <div className={`h-1.5 ${accentBar}`} />

        {/* Handle del bottom sheet (solo mobile) */}
        <div className="sm:hidden flex justify-center pt-2 pb-1">
          <div className="w-10 h-1 rounded-full bg-cream-200" />
        </div>

        {/* Corpo */}
        <div className="px-6 pt-4 sm:pt-7 pb-6 text-center">
          <div
            className={`w-14 h-14 mx-auto rounded-2xl ${iconBg} ring-4 flex items-center justify-center mb-4`}
          >
            <Icon size={24} strokeWidth={2.2} aria-hidden />
          </div>
          <h2
            id="confirm-title"
            className="text-lg sm:text-xl font-extrabold text-ink-900 leading-snug"
          >
            {state.title}
          </h2>
          {state.message && (
            <p className="mt-2 text-sm text-ink-500 leading-relaxed max-w-[36ch] mx-auto">
              {state.message}
            </p>
          )}
        </div>

        {/* Bottoni */}
        <div className="px-6 pb-6 sm:pb-7 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => closeWith(false)}
            className="px-4 py-3 rounded-xl font-semibold text-ink-700 bg-white border-2 border-cream-300 hover:border-cream-300 hover:bg-cream-50 active:scale-[0.98] transition-all"
          >
            {state.cancelLabel ?? tActions('cancel')}
          </button>
          <button
            type="button"
            onClick={() => closeWith(true)}
            autoFocus
            className={`px-4 py-3 rounded-xl font-bold text-white shadow-md active:scale-[0.98] transition-all ${
              isDanger
                ? 'bg-rose-600 hover:bg-rose-700 shadow-rose-200'
                : 'bg-gradient-to-r from-primary-600 to-purple-600 hover:from-primary-700 hover:to-purple-700 shadow-indigo-200'
            }`}
          >
            {state.confirmLabel ?? tActions('confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
