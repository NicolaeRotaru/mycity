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
      /*
       * 6/9/2026 — IL PULSANTE SI RICONOSCEVA SOLO DALLE PAROLE STAMPATE SOPRA.
       *
       * La home e' un test A/B: il pulsante principale dice «Inizia a esplorare»
       * in un braccio e «Scopri cosa c'e' oggi» nell'altro, e il braccio si
       * calcola da indirizzo di rete + browser. La prova nel browser cercava il
       * testo del primo braccio, quindi il suo esito non dipendeva dal fatto che
       * il pulsante funzionasse: dipendeva da quale meta' dell'esperimento
       * toccava alla macchina che la eseguiva.
       *
       * L'identificativo del punto d'ingresso c'era gia' — lo riceviamo per
       * misurare i click — ma restava dentro il componente. Adesso e' anche
       * nell'HTML: chi deve ritrovare questo pulsante lo cerca per quello che
       * e', non per come e' scritto oggi.
       */
      data-cta={ctaId}
      className={className}
      onClick={() => {
        void trackHomeCtaClicked(ctaId, { location, href, variant });
      }}
    >
      {children}
    </Link>
  );
}
