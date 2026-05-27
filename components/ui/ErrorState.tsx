'use client';

import { AlertCircle, RotateCcw, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { Button } from './Button';
import { COPY } from '@/lib/copy';

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
  title = 'Qualcosa è andato storto',
  description = 'Abbiamo registrato il problema. Prova a ricaricare la pagina.',
  retry,
  backHref,
  backLabel = COPY.actions.back,
}: Props) {
  return (
    <div className="py-12 px-4 text-center" role="alert">
      <div className="mx-auto rounded-full bg-rose-50 text-rose-600 flex items-center justify-center w-16 h-16 mb-3">
        <AlertCircle size={30} strokeWidth={1.8} aria-hidden />
      </div>
      <h2 className="font-serif text-lg font-bold text-ink-900">{title}</h2>
      <p className="text-sm text-ink-500 mt-1 max-w-md mx-auto">{description}</p>
      <div className="mt-4 flex items-center justify-center gap-2 flex-wrap">
        {retry && (
          <Button onClick={retry} icon={RotateCcw} variant="primary">{COPY.actions.retry}</Button>
        )}
        {backHref && (
          <Link
            href={backHref}
            className="inline-flex items-center gap-1.5 bg-white border border-cream-300 hover:bg-cream-50 text-ink-700 px-4 py-2.5 rounded-lg font-semibold text-sm"
          >
            <ArrowLeft size={14} strokeWidth={2.4} aria-hidden />
            {backLabel}
          </Link>
        )}
      </div>
    </div>
  );
}
