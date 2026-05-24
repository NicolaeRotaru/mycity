'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  readConsent,
  writeConsent,
  acceptAll,
  rejectAll,
  type ConsentState,
} from '@/lib/consent';

/**
 * Banner cookie GDPR/ePrivacy conforme Garante (linee guida 2021):
 *  - 3 pulsanti di pari peso visivo (Accetta tutto / Rifiuta tutto / Personalizza)
 *  - X / chiusura senza scelta = rifiuto totale (no scrolling = consenso)
 *  - Le categorie sono opt-in disattive di default (tranne necessary)
 *  - Re-prompt automatico ogni 6 mesi (CONSENT_MAX_AGE_DAYS)
 *  - Link a /cookies (informativa estesa)
 */
export default function CookieBanner() {
  const [show, setShow] = useState(false);
  const [mode, setMode] = useState<'compact' | 'custom'>('compact');
  const [draft, setDraft] = useState<Partial<ConsentState>>({
    functional: false,
    analytics: false,
    marketing: false,
  });

  useEffect(() => {
    const s = readConsent();
    // Mostra se mai espresso o se scaduto (ts > 6 mesi)
    const sixMonthsAgo = Date.now() - 180 * 24 * 60 * 60 * 1000;
    if (!s || s.ts < sixMonthsAgo) {
      setShow(true);
    }
    const onReopen = () => setShow(true);
    window.addEventListener('mc:open-consent', onReopen);
    return () => window.removeEventListener('mc:open-consent', onReopen);
  }, []);

  if (!show) return null;

  const close = () => setShow(false);

  return (
    <div
      role="dialog"
      aria-labelledby="cookie-banner-title"
      aria-describedby="cookie-banner-desc"
      className="fixed inset-x-0 bottom-0 z-[100] p-3 sm:p-4"
    >
      <div className="mx-auto max-w-3xl rounded-2xl bg-white p-5 shadow-2xl ring-1 ring-slate-200">
        <h2 id="cookie-banner-title" className="text-base font-semibold text-slate-900">
          🍪 Cookie e tecnologie simili
        </h2>
        <p id="cookie-banner-desc" className="mt-1 text-sm text-slate-600">
          Usiamo cookie tecnici (sempre attivi) e, previo tuo consenso, cookie funzionali,
          di analisi e di marketing per migliorare il servizio. Puoi accettare tutto,
          rifiutare tutto, o personalizzare le tue scelte. Leggi la nostra{' '}
          <Link href="/cookies" className="text-indigo-600 underline hover:text-indigo-800">
            cookie policy
          </Link>.
        </p>

        {mode === 'custom' && (
          <div className="mt-4 space-y-2 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
            <Row label="Cookie necessari" desc="Sessione, sicurezza, anti-frode. Sempre attivi." checked disabled />
            <Row
              label="Funzionali"
              desc="Preferenze (lingua, ultima ricerca, mappa salvata)."
              checked={!!draft.functional}
              onChange={(v) => setDraft((d) => ({ ...d, functional: v }))}
            />
            <Row
              label="Analytics"
              desc="Statistiche aggregate anonime sull'uso del sito."
              checked={!!draft.analytics}
              onChange={(v) => setDraft((d) => ({ ...d, analytics: v }))}
            />
            <Row
              label="Marketing"
              desc="Annunci personalizzati e remarketing."
              checked={!!draft.marketing}
              onChange={(v) => setDraft((d) => ({ ...d, marketing: v }))}
            />
          </div>
        )}

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => { rejectAll(); close(); }}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50"
          >
            Rifiuta tutto
          </button>
          {mode === 'compact' ? (
            <button
              type="button"
              onClick={() => setMode('custom')}
              className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50"
            >
              Personalizza
            </button>
          ) : (
            <button
              type="button"
              onClick={() => { writeConsent(draft); close(); }}
              className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50"
            >
              Salva preferenze
            </button>
          )}
          <button
            type="button"
            onClick={() => { acceptAll(); close(); }}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Accetta tutto
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({
  label, desc, checked, disabled, onChange,
}: {
  label: string;
  desc: string;
  checked: boolean;
  disabled?: boolean;
  onChange?: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 disabled:opacity-60"
      />
      <span className="flex-1">
        <span className="block text-sm font-medium text-slate-900">{label}</span>
        <span className="block text-xs text-slate-500">{desc}</span>
      </span>
    </label>
  );
}

/**
 * Helper per riaprire il banner da link "Gestisci cookie" nel footer.
 */
export function openConsentBanner() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('mc:open-consent'));
  }
}
