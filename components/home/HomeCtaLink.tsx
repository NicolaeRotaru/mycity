'use client';

import Link from 'next/link';
import { trackHomeCtaClicked } from '@/lib/analytics/events';

/**
 * Link della home con tracking del click (`home_cta_clicked`).
 *
 * Sostituisce <Link> sui CTA chiave della home per misurare quale punto di
 * ingresso porta avanti il funnel. Drop-in: stesse className/children di Link.
 * Il track è fire-and-forget (gated dal consenso in posthog.tsx) e non blocca
 * la navigazione.
 */

type Props = {
  href: string;
  ctaId: string;
  location?: string;
  variant?: string;
  className?: string;
  children: React.ReactNode;
};

export default function HomeCtaLink({ href, ctaId, location, variant, className, children }: Props) {
  return (
    <Link
      href={href}
      className={className}
      onClick={() => {
        void trackHomeCtaClicked(ctaId, { location, href, variant });
      }}
    >
      {children}
    </Link>
  );
}
