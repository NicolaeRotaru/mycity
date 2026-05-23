'use client';

import { useEffect, useSyncExternalStore } from 'react';

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
 * Funzionamento:
 *  - Un singolo <ConfirmDialogHost /> montato in app/layout.tsx ascolta lo
 *    store interno e renderizza il modal quando c'è uno state attivo.
 *  - confirmDialog() ritorna una Promise<boolean> che si risolve al click
 *    (true = conferma, false = annulla / ESC / click sul backdrop).
 *  - Multiple chiamate concorrenti: la nuova sostituisce la precedente che
 *    viene risolta come false.
 */

export type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  icon?: string;
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
    if (current) current.resolve(false); // chiusura silenziosa della precedente
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
  const state = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );

  // Tasti ESC (annulla) e Enter (conferma)
  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); closeWith(false); }
      if (e.key === 'Enter')  { e.preventDefault(); closeWith(true); }
    };
    document.addEventListener('keydown', onKey);
    // blocca lo scroll del body mentre il modal è aperto
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [state]);

  if (!state) return null;

  const isDanger = !!state.danger;
  const icon = state.icon ?? (isDanger ? '⚠️' : '❓');

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn"
      onClick={(e) => { if (e.target === e.currentTarget) closeWith(false); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden animate-popIn"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header colorato */}
        <div
          className={`px-6 pt-6 pb-4 text-center ${
            isDanger
              ? 'bg-gradient-to-br from-rose-50 to-orange-50'
              : 'bg-gradient-to-br from-indigo-50 to-purple-50'
          }`}
        >
          <div
            className={`w-16 h-16 mx-auto rounded-full flex items-center justify-center text-3xl mb-2 shadow ${
              isDanger ? 'bg-rose-100' : 'bg-indigo-100'
            }`}
          >
            {icon}
          </div>
          <h2 id="confirm-title" className="text-xl font-extrabold text-gray-900">
            {state.title}
          </h2>
        </div>

        {/* Body */}
        {state.message && (
          <p className="px-6 pt-4 text-center text-sm text-gray-600 leading-relaxed">
            {state.message}
          </p>
        )}

        {/* Footer */}
        <div className="px-6 py-5 flex flex-col-reverse sm:flex-row gap-2 sm:gap-3">
          <button
            type="button"
            onClick={() => closeWith(false)}
            className="flex-1 px-4 py-3 rounded-lg font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors"
          >
            {state.cancelLabel ?? 'Annulla'}
          </button>
          <button
            type="button"
            onClick={() => closeWith(true)}
            autoFocus
            className={`flex-1 px-4 py-3 rounded-lg font-bold text-white transition-colors shadow ${
              isDanger
                ? 'bg-rose-600 hover:bg-rose-700'
                : 'bg-indigo-600 hover:bg-indigo-700'
            }`}
          >
            {state.confirmLabel ?? 'Conferma'}
          </button>
        </div>
      </div>
    </div>
  );
}
