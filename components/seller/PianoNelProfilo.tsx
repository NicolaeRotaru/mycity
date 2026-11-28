'use client';

import Link from 'next/link';
import { AlertTriangle, ArrowRight, BadgeCheck } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { formatDate } from '@/lib/format';
import { PERCORSO_ABBONAMENTO } from '@/lib/agenzia/indirizzi-servizi';
import { usePianoDelNegozio } from '@/components/seller/MenuAccount';

/**
 * L'ABBONAMENTO NELLE IMPOSTAZIONI — 24/11/2026.
 *
 * Nicola: «lo metti nelle impostazioni, però è sempre visibile». Il Profilo è la pagina delle
 * impostazioni del negozio: in cima dice con quale piano sei e porta alla pagina dell'abbonamento.
 * La frase è la stessa del menu in basso a sinistra (lib/agenzia/etichetta-piano.ts).
 */
export default function PianoNelProfilo() {
  const { attivo, etichetta } = usePianoDelNegozio();
  const daSistemare = etichetta.tono === 'da_sistemare';
  const Icona = daSistemare ? AlertTriangle : BadgeCheck;

  const sotto =
    etichetta.tono === 'attivo'
      ? attivo?.incluso
        ? 'Incluso: non paghi niente.'
        : attivo?.rinnovoIl
        ? `Attivo · si rinnova il ${formatDate(attivo.rinnovoIl)}`
        : 'Attivo'
      : daSistemare
        ? 'Il pagamento non è riuscito: scrivici dall’Aiuto e lo sistemiamo insieme.'
        : etichetta.tono === 'nessuno'
          ? 'Foto e video, sito web, social e analisi del business: scegli il piano che fa per te.'
          : 'Qui vedi con quale piano sei.';

  const pulsante =
    etichetta.tono === 'nessuno' ? 'Scegli il tuo abbonamento' : etichetta.tono === 'sconosciuto' ? 'Apri l’abbonamento' : 'Vedi il tuo abbonamento';

  return (
    <Card variant="elevated" radius="2xl" padding="lg">
      <section aria-labelledby="profilo-abbonamento" className="flex items-start gap-3">
        <Icona size={20} className={`mt-0.5 shrink-0 ${daSistemare ? 'text-amber-600' : 'text-primary-600'}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 id="profilo-abbonamento" className="font-sans text-sm font-semibold text-ink-500">Il tuo abbonamento</h2>
          {etichetta.tono !== 'sconosciuto' && (
            <p className="mt-0.5 font-serif text-xl font-bold text-ink-900" data-testid="piano-nel-profilo">{etichetta.testo}</p>
          )}
          <p className={`mt-0.5 text-sm ${daSistemare ? 'font-semibold text-amber-700' : 'text-ink-500'}`}>{sotto}</p>
          <Link
            href={daSistemare ? '/seller/help' : PERCORSO_ABBONAMENTO}
            className="mt-3 inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-700"
          >
            {daSistemare ? 'Scrivici dall’Aiuto' : pulsante} <ArrowRight size={16} aria-hidden />
          </Link>
        </div>
      </section>
    </Card>
  );
}
