import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { ABBONAMENTI, FASCE, FRASE_CONDIZIONI, FRASE_PARTNER, LISTINO, SERVIZI_AGENZIA, canonePrimoMese, scriviCanone } from '@/lib/agenzia/preventivo';
import { leggiPreventivo } from '@/lib/agenzia/leggi-preventivo';
import { CODICE_VALIDO, leggiPreventivoColCodice } from '@/lib/agenzia/preventivo-col-codice';
import { leggiSchedaSalvata } from '@/lib/agenzia/scheda-cliente';
import { descriviAttivita } from '@/lib/agenzia/tipi-attivita';
import AnteprimaServizio from '@/components/seller/AnteprimaServizio';
import AccettaDalLink from './AccettaDalLink';

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
    return (
      <Cornice>
        <div role="status" className="rounded-2xl border-2 border-olive-300 bg-olive-50 p-5">
          <p className="inline-flex items-center gap-2 font-semibold text-ink-900">
            <CheckCircle2 size={18} className="text-olive-700" aria-hidden />
            {pagato === '1' ? 'Pagamento ricevuto, grazie!' : 'Hai accettato il preventivo'}
          </p>
          <p className="mt-1 text-sm text-ink-700">
            Ti abbiamo scritto all’email che ci hai dato: da lì entri nella pagina di {pc.nomeAttivita}
            {pagato === '1' ? ' e trovi l’abbonamento attivo.' : ', dove trovi il preventivo e puoi pagare l’abbonamento.'}
          </p>
        </div>
      </Cornice>
    );
  }

  let letti;
  let scheda = null;
  try {
    const [l, s] = await Promise.all([
      leggiPreventivo(pc.sellerId),
      getAdminSupabase().from('schede_clienti').select('scheda').eq('id_attivita', pc.sellerId).maybeSingle(),
    ]);
    letti = l;
    scheda = s.error ? null : leggiSchedaSalvata(s.data?.scheda);
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

      <section className="mt-6" aria-labelledby="abbonamenti">
        <h2 id="abbonamenti" className="text-lg font-bold text-ink-900">I tre abbonamenti</h2>
        <p className="mt-1 text-sm text-ink-600">Ognuno comprende tutti i servizi: cambia quanto. {FRASE_CONDIZIONI}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {ABBONAMENTI.map((f) => (
            <div key={f} className={`rounded-xl border-2 p-4 ${f === p.consigliato ? 'border-primary-600 bg-primary-50' : 'border-cream-200 bg-surface-0'}`}>
              <p className="font-bold text-ink-900">{FASCE[f].nome}{f === p.consigliato ? ' · consigliato' : ''}</p>
              <p className="mt-1 text-xl font-extrabold text-ink-900">{scriviCanone(p.prezzi[f])}</p>
              {p.primoMeseScontato && p.prezzi[f] ? (
                <p className="text-xs text-olive-700">Il primo mese {scriviCanone(canonePrimoMese(p.prezzi[f]))}</p>
              ) : null}
              <p className="mt-2 text-xs text-ink-600">{FASCE[f].perChi}</p>
              <ul className="mt-2 space-y-1 text-xs text-ink-700">
                {SERVIZI_AGENZIA.map((s) => <li key={s}><strong>{LISTINO[s].titolo}:</strong> {FASCE[f].servizi[s]}</li>)}
              </ul>
            </div>
          ))}
        </div>
        {p.consigliato && <p className="mt-2 text-xs text-ink-600">Perché consigliamo {FASCE[p.consigliato].nome}: {p.perche_consigliato}</p>}
      </section>

      <AccettaDalLink codice={codice} consigliato={p.consigliato} prezzi={p.prezzi} primoMeseScontato={p.primoMeseScontato} />
    </Cornice>
  );
}

function Cornice({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>;
}
