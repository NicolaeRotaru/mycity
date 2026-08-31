'use client';

import { AlertTriangle, RotateCcw, ArrowLeft, LifeBuoy } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button } from './Button';

/**
 * Error state riusabile — copia per Next error boundaries, mutation errors,
 * fetch fallback.
 *
 * Esperti consultati:
 * - Content Designer: "Errori non sono 'fault' utente. Tone neutro, soluzione concreta."
 * - UX Researcher: "1 CTA (retry) > 2 CTA. Backup CTA solo se serve."
 */

/**
 * #7 — C'erano DUE «ErrorState» diversi e incompatibili, usati insieme nello
 * stesso sito: `components/ErrorState.tsx` (sei pagine, prop `onRetry`) e
 * questo (dieci pagine, prop `retry`). Stesso nome, stesso scopo, aspetto
 * diverso e nomi delle proprieta' diversi: importarne uno per l'altro compilava
 * e non mostrava il pulsante «Riprova», in silenzio.
 *
 * Ne resta uno solo, questo, che accetta anche i nomi dell'altro.
 */
type Props = {
  title?: string;
  description?: string;
  retry?: () => void;
  /** Sinonimo di `retry`: era il nome usato dall'altro componente. */
  onRetry?: () => void;
  backHref?: string;
  backLabel?: string;
  /** Versione ridotta, per le liste dentro una pagina. */
  variant?: 'default' | 'compact';
  className?: string;
  /** CTA secondaria "Contatta il supporto". Default: /faq. Passa `null` per nasconderla. */
  supportHref?: string | null;
  /**
   * 31/8/2026 (R194) — Il `digest` che Next scrive nei log del server. Sta qui
   * dentro, e non sotto il riquadro, perche' e' `role="alert"` ad annunciare
   * l'errore: chi usa un lettore di schermo deve sentire il codice insieme al
   * guasto, non trovarlo scorrendo la pagina dopo.
   */
  codiceErrore?: string;
};

export function ErrorState({
  title,
  description,
  retry,
  onRetry,
  backHref,
  backLabel,
  variant = 'default',
  className = '',
  supportHref = '/faq',
  codiceErrore,
}: Props) {
  const riprova = retry ?? onRetry;
  const compatto = variant === 'compact';
  const tErrors = useTranslations('errors');
  const tActions = useTranslations('actions');
  const _title = title ?? 'Qualcosa è andato storto';
  const _desc = description ?? tErrors('generic');
  const _back = backLabel ?? tActions('back');
  return (
    <div className={`${compatto ? 'py-6' : 'py-12'} px-4 text-center ${className}`} role="alert">
      <div className={`mx-auto rounded-full bg-secondary-50 text-secondary-600 flex items-center justify-center mb-6 ${compatto ? 'w-12 h-12' : 'w-24 h-24'}`}>
        <AlertTriangle size={compatto ? 22 : 42} strokeWidth={1.8} aria-hidden />
      </div>
      <h2 className={`font-serif font-bold text-ink-900 ${compatto ? 'text-base' : 'text-2xl'}`}>{_title}</h2>
      <p className={`text-ink-600 mt-2.5 max-w-md mx-auto leading-relaxed ${compatto ? 'text-xs' : 'text-base'}`}>{_desc}</p>
      <div className="mt-4 flex items-center justify-center gap-2 flex-wrap">
        {riprova && (
          <Button onClick={riprova} icon={RotateCcw} variant="primary">{tActions('retry')}</Button>
        )}
        {backHref && (
          <Link
            href={backHref}
            className="inline-flex items-center gap-1.5 bg-white border border-cream-300 hover:bg-cream-50 text-ink-700 px-4 py-2.5 rounded-lg font-semibold text-sm"
          >
            <ArrowLeft size={14} strokeWidth={2.4} aria-hidden />
            {_back}
          </Link>
        )}
        {supportHref && (
          <Link
            href={supportHref}
            className="inline-flex items-center gap-1.5 bg-white border border-cream-300 hover:bg-cream-50 text-ink-700 px-4 py-2.5 rounded-lg font-semibold text-sm"
          >
            <LifeBuoy size={14} strokeWidth={2.4} aria-hidden />
            Contatta il supporto
          </Link>
        )}
      </div>
      {/*
        Se il codice non c'e' (errori che Next non digerisce, sviluppo in
        locale) non resta un'etichetta spaiata: una riga «Codice errore:» senza
        codice, o la parola «undefined», sotto le scuse sembra un secondo guasto.
      */}
      {codiceErrore ? (
        <p className="mt-6 text-xs leading-relaxed text-ink-500">
          Codice errore:{' '}
          <code className="font-mono text-ink-700 select-all break-all">{codiceErrore}</code>
          {' — riportalo se ci scrivi.'}
        </p>
      ) : null}
    </div>
  );
}
