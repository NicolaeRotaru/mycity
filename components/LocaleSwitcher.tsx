'use client';

import { useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Globe } from 'lucide-react';

/**
 * Minimal locale switcher button — toggle it/en.
 *
 * UX: cliccando passa all'altra lingua, setta cookie via POST /api/locale,
 * poi router.refresh() per ricaricare i Server Components con nuovo locale.
 *
 * Esperti consultati:
 * - UX: "Per 2 locale, toggle inline e' piu' rapido di un dropdown."
 * - Accessibility: "aria-label esplicito + lang del target — screen reader OK."
 */
export default function LocaleSwitcher({ className }: { className?: string }) {
  const locale = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const next = locale === 'it' ? 'en' : 'it';

  const switchTo = (target: string) => {
    startTransition(async () => {
      await fetch('/api/locale', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locale: target }),
      });
      router.refresh();
    });
  };

  return (
    <button
      type="button"
      onClick={() => switchTo(next)}
      disabled={isPending}
      aria-label={locale === 'it' ? 'Switch to English' : 'Passa all\'italiano'}
      className={className ?? 'inline-flex items-center gap-1.5 text-sm text-ink-600 hover:text-ink-900 disabled:opacity-50'}
    >
      <Globe size={14} />
      <span className="uppercase font-semibold">{next}</span>
    </button>
  );
}
