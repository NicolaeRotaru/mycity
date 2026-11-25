import AnalisiAziendale from '@/components/seller/AnalisiAziendale';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { FASCE, FRASE_PARTNER } from '@/lib/agenzia/preventivo';
import { leggiPreventivo } from '@/lib/agenzia/leggi-preventivo';
import { CODICE_VALIDO, leggiPreventivoColCodice } from '@/lib/agenzia/preventivo-col-codice';
import { leggiSchedaSalvata, soloConfermati } from '@/lib/agenzia/scheda-cliente';
import { leggiSchedaEPagellaAperte, schedaPerIlSito } from '@/lib/agenzia/scheda-dopo-abbonamento';
import { descriviAttivita } from '@/lib/agenzia/tipi-attivita';
import AbbonamentiInBreve from '@/components/seller/AbbonamentiInBreve';
import AnteprimaServizio from '@/components/seller/AnteprimaServizio';
import OffertaSuMisura from '@/components/seller/OffertaSuMisura';
import AccettaDalLink from './AccettaDalLink';
import PagaDalLink from './PagaDalLink';

/**
 * IL PREVENTIVO DAL LINK COL CODICE — 24/11/2026.
 *
 * Nicola ha scelto «link col codice» per Ora del Gusto, che è in «modalità preventivo» e non ha
 * ancora un accesso. Questa pagina mostra SOLO quel preventivo: il nome e il tipo dell'attività,
 * cosa le manca, la bozza del sito e il piano dei post, i tre abbonamenti. Nessun dato personale.
 * Non si indicizza e non passa il codice ad altri siti (referrer spento).
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Il tuo preventivo · MyCity',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default async function PreventivoDalLink({
  params,
  searchParams,
}: {
  params: Promise<{ codice: string }>;
  searchParams: Promise<{ pagato?: string }>;
}) {
  const { codice } = await params;
  const { pagato } = await searchParams;
  if (!CODICE_VALIDO.test(codice)) notFound();

  const pc = await leggiPreventivoColCodice(codice).catch((e: unknown) => {
    logger.error('[preventivo-codice] pagina: lettura non riuscita', { errore: String(e) });
    return undefined;
  });
  if (pc === null || pc?.stato === 'chiuso') notFound();
  if (!pc) {
    return <Cornice><p className="text-ink-700">Non riesco a leggere il preventivo in questo momento. Riprova fra qualche minuto.</p></Cornice>;
  }

  if (pc.stato === 'accettato') {
    // Pagato davvero lo dice la tabella degli abbonamenti (la scrive il webhook di Stripe), non l'indirizzo.
    const abbonamento = await getAdminSupabase()
      .from('abbonamenti_servizi')
      .select('stato')
      .eq('seller_id', pc.sellerId)
      .in('stato', ['active', 'past_due'])
      .limit(1);
    const attivo = !abbonamento.error && (abbonamento.data ?? []).length > 0;
    return (
      <Cornice>
        <div role="status" className="rounded-2xl border-2 border-olive-300 bg-olive-50 p-5">
          <p className="inline-flex items-center gap-2 font-semibold text-ink-900">
            <CheckCircle2 size={18} className="text-olive-700" aria-hidden />
            {attivo ? 'Il tuo abbonamento è attivo' : 'Hai accettato il preventivo'}
          </p>
          <p className="mt-1 text-sm text-ink-700">
            Ti abbiamo scritto all’email che ci hai dato, col link per entrare nella pagina di {pc.nomeAttivita}.
            Controlliamo i dati del negozio e poi va online.
          </p>
        </div>
        {!attivo && (
          <div className="mt-4 rounded-2xl border-2 border-cream-300 bg-surface-0 p-5">
            {pagato === '1' ? (
              <p className="text-sm text-ink-700">Se hai appena pagato, l’abbonamento si attiva in pochi secondi: ricarica la pagina fra un momento.</p>
            ) : (
              <p className="text-sm text-ink-700">L’abbonamento {pc.fasciaScelta ? FASCE[pc.fasciaScelta].nome : ''} non è ancora pagato. Puoi pagarlo da qui.</p>
            )}
            <PagaDalLink codice={codice} />
          </div>
        )}
      </Cornice>
    );
  }

  let letti;
  let scheda = null;
  try {
    const admin = getAdminSupabase();
    const [l, s, aperta] = await Promise.all([
      // Pubblico: l'offerta su misura usa solo i dati confermati, senza le analisi (24/11).
      leggiPreventivo(pc.sellerId, undefined, { pubblico: true }),
      admin.from('schede_clienti').select('scheda').eq('id_attivita', pc.sellerId).maybeSingle(),
      // 25/11/2026 — La scheda del cliente vale solo dopo l'abbonamento (Nicola).
      leggiSchedaEPagellaAperte(admin, pc.sellerId),
    ]);
    letti = l;
    // Il link non è la pagina del negozio: qui solo i dati confermati, niente «da confermare» (collaudo del 24/11).
    scheda = s.error ? null : soloConfermati(schedaPerIlSito(leggiSchedaSalvata(s.data?.scheda), aperta));
  } catch (e) {
    logger.error('[preventivo-codice] pagina: preventivo non preparato', { errore: String(e) });
    return <Cornice><p className="text-ink-700">Non riesco a preparare il preventivo in questo momento. Riprova fra qualche minuto.</p></Cornice>;
  }
  const p = letti.preventivo;

  return (
    <Cornice>
      <header>
        <p className="text-xs font-bold uppercase tracking-wide text-primary-700">Preventivo n. {p.numero}</p>
        <h1 className="mt-1 font-serif text-2xl font-extrabold text-ink-900">Il preventivo di {p.attivita}</h1>
        <p className="mt-1 text-sm text-ink-600">{descriviAttivita(p.tipoAttivita)} · {FRASE_PARTNER}</p>
      </header>

      {pagato === '0' && (
        <p role="status" className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-ink-800">
          Il pagamento non è stato completato. Puoi riprovare qui sotto.
        </p>
      )}

      <section className="mt-6" aria-labelledby="cosa-manca">
        <h2 id="cosa-manca" className="text-lg font-bold text-ink-900">Cosa ti serve</h2>
        <ul className="mt-2 space-y-3">
          {p.righe.map((r) => (
            <li key={r.id} className="rounded-xl border border-cream-200 bg-surface-0 p-4">
              <p className="font-semibold text-ink-900">{r.titolo}</p>
              <ul className="mt-1 list-disc pl-5 text-sm text-ink-700">
                {r.perche.map((x) => <li key={x}>{x}</li>)}
              </ul>
              {(r.id === 'sito_web' || r.id === 'social') && (
                <AnteprimaServizio id={r.id} nome={p.attivita} tipo={p.tipoAttivita} giorno={p.data} scheda={scheda} />
              )}
            </li>
          ))}
        </ul>
      </section>

      <OffertaSuMisura corta offerta={p.offerta} fascia={p.consigliato} />
      {/* 25/11/2026 — L'analisi del business dell'attività (Nicola): parte generale e parte specifica. */}
      <AnalisiAziendale corta analisi={p.analisiAziendale} fascia={p.consigliato} />

      {/* 25/11/2026 — Nicola, 18:30: nel preventivo i servizi corti, una riga ciascuno, solo per la fascia guardata. */}
      <AbbonamentiInBreve consigliato={p.consigliato} prezzi={p.prezzi} primoMeseScontato={p.primoMeseScontato} perche={p.perche_consigliato} />

      <AccettaDalLink codice={codice} consigliato={p.consigliato} prezzi={p.prezzi} primoMeseScontato={p.primoMeseScontato} />
    </Cornice>
  );
}

function Cornice({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>;
}
