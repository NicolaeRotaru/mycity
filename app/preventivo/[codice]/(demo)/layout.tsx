import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import DemoShell from '@/components/preventivo/DemoShell';
import { CODICE_VALIDO } from '@/lib/agenzia/preventivo-col-codice';
import { leggiDemoDalLink } from '@/lib/agenzia/demo-dal-link';

/**
 * IL GUSCIO DEL PANNELLO DEMO — 25/11/2026 (components/preventivo/DemoShell.tsx).
 *
 * 27/11/2026 — Il link non apre più la demo (Nicola): apre la conferma dell'abbonamento,
 * app/preventivo/[codice]/page.tsx. Questo guscio avvolge solo le pagine del gruppo `(demo)`.
 *
 * Avvolge la dashboard della demo, le pagine dei servizi e quella dell'abbonamento. Nessuna di
 * queste pagine si indicizza o passa il codice ad altri siti (regole del link del 24/11, qui una
 * volta per tutte). A preventivo accettato il guscio sparisce: la pagina dice solo cosa succede ora.
 */
export const metadata: Metadata = {
  title: 'Il tuo pannello demo · MyCity',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default async function LayoutDemoDalLink({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ codice: string }>;
}) {
  const { codice } = await params;
  if (!CODICE_VALIDO.test(codice)) notFound();
  const demo = await leggiDemoDalLink(codice);
  if (demo.tipo === 'non-trovato') notFound();
  // Senza demo (preventivo accettato, lettura caduta) resta almeno il marchio che riporta al sito: la
  // barra del sito qui è nascosta, e senza questo non c'era un modo di tornare indietro (collaudo del 25/11).
  if (demo.tipo !== 'aperto') {
    return (
      <div>
        <div className="border-b border-cream-300 bg-surface-0 px-4 py-3">
          <Link href="/" className="font-serif text-2xl font-extrabold leading-none tracking-tight">
            <span className="text-primary-700">My</span><span className="text-ink-900">City</span>
          </Link>
        </div>
        <div className="px-4 py-8">{children}</div>
      </div>
    );
  }
  return (
    <DemoShell codice={codice} nome={demo.preventivo.attivita} consigliato={demo.preventivo.consigliato}>
      {children}
    </DemoShell>
  );
}
