import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CODICE_VALIDO } from '@/lib/agenzia/preventivo-col-codice';

/**
 * IL LINK COL CODICE — 27/11/2026.
 *
 * Nicola: «l'imprenditore non entra più nella sua pagina demo ma in uno schermo che fa vedere i 3
 * abbonamenti e conferma l'abbonamento scelto che ha detto al venditore». Il link apre la pagina della
 * conferma (page.tsx), senza il guscio della demo. Le pagine della demo restano nel gruppo `(demo)`,
 * col loro guscio (components/preventivo/DemoShell.tsx), ma il link non ci porta più.
 *
 * Qui restano le regole del link del 24/11, una volta per tutte: nessuna pagina si indicizza o passa
 * il codice ad altri siti.
 */
export const metadata: Metadata = {
  title: 'Il tuo abbonamento · MyCity',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default async function LayoutDelLink({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ codice: string }>;
}) {
  const { codice } = await params;
  if (!CODICE_VALIDO.test(codice)) notFound();
  return <>{children}</>;
}
