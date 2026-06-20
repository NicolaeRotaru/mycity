'use client';

import { AlertTriangle, RotateCcw, ArrowLeft } from 'lucide-react';
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

type Props = {
  title?: string;
  description?: string;
  retry?: () => void;
  backHref?: string;
  backLabel?: string;
};

export function ErrorState({
  title,
  description,
  retry,
  backHref,
  backLabel,
}: Props) {
  const tErrors = useTranslations('errors');
  const tActions = useTranslations('actions');
  const _title = title ?? 'Qualcosa è andato storto';
  const _desc = description ?? tErrors('generic');
  const _back = backLabel ?? tActions('back');
  return (
    <div className="py-12 px-4 text-center" role="alert">
      <div className="mx-auto rounded-full bg-secondary-50 text-secondary-600 flex items-center justify-center w-24 h-24 mb-6">
        <AlertTriangle size={42} strokeWidth={1.8} aria-hidden />
      </div>
      <h2 className="font-serif text-2xl font-bold text-ink-900">{_title}</h2>
      <p className="text-base text-ink-600 mt-2.5 max-w-md mx-auto leading-relaxed">{_desc}</p>
      <div className="mt-4 flex items-center justify-center gap-2 flex-wrap">
        {retry && (
          <Button onClick={retry} icon={RotateCcw} variant="primary">{tActions('retry')}</Button>
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
      </div>
    </div>
  );
}
