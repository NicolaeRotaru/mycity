import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';
import { getAdminSupabase } from '@/lib/supabase/server';
import { FASCE, FRASE_PARTNER } from '@/lib/agenzia/preventivo';
import { CODICE_VALIDO } from '@/lib/agenzia/preventivo-col-codice';
import { PAGAMENTO_ONLINE_SERVIZI } from '@/lib/agenzia/pagamento-servizi';
import { leggiDemoDalLink } from '@/lib/agenzia/demo-dal-link';
import { indirizziDemo } from '@/lib/agenzia/indirizzi-demo';
import { fasciaDaIndirizzo, hrefFascia, PERCORSO_ABBONAMENTO } from '@/lib/agenzia/indirizzi-servizi';
import { descriviAttivita } from '@/lib/agenzia/tipi-attivita';
import AbbonamentiInBreve from '@/components/seller/AbbonamentiInBreve';
import AnalisiAziendale from '@/components/seller/AnalisiAziendale';
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
 *
 * 25/11/2026 — Dal link si apre il pannello demo (app/preventivo/[codice]/page.tsx, Nicola: «una demo
 * come quella di pane quotidiano»): questa pagina ne è la voce «Abbonamento». Ogni fascia apre il suo
 * preventivo (?fascia=business, Nicola: «in base all'azienda e all'abbonamento»): l'offerta su misura,
 * la fascia evidenziata e quella proposta per accettare sono quelle dell'indirizzo, o la consigliata.
 * 27/11/2026 — Fra le due, la fascia che il titolare ha scelto davanti all'agente (`fascia_scelta` del preventivo aperto).
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
  searchParams: Promise<{ pagato?: string; fascia?: string | string[] }>;
}) {
  const { codice } = await params;
  const { pagato, fascia } = await searchParams;
  if (!CODICE_VALIDO.test(codice)) notFound();

  const demo = await leggiDemoDalLink(codice);
  if (demo.tipo === 'non-trovato') notFound();
  if (demo.tipo === 'guasto') {
    return <Cornice><p className="text-ink-700">{demo.messaggio}</p></Cornice>;
  }
  const pc = demo.pc;

  if (demo.tipo === 'accettato') {
    // Pagato davvero lo dice la tabella degli abbonamenti (la scrive il webhook di Stripe), non l'indirizzo.
    const abbonamento = await getAdminSupabase()
      .from('abbonamenti_servizi')
      // `*`: regge anche prima della migrazione 999 (senza `origine` la riga vale Stripe).
      .select('*')
      .eq('seller_id', pc.sellerId)
      .in('stato', ['active', 'past_due'])
      .limit(5);
    const righe = abbonamento.error ? [] : ((abbonamento.data ?? []) as { origine?: string | null }[]);
    const attivo = righe.length > 0;
    // 27/11/2026 — Sbloccato in contanti (migrazione 999): attivo, ma i contanti vanno ancora ritirati.
    const inContanti = attivo && righe.every((r) => r.origine === 'contanti');
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
          {/* 27/11/2026 — Chi ha confermato da questo telefono è già dentro: il pulsante lo riporta alla sua pagina. */}
          <Link href={PERCORSO_ABBONAMENTO} className="mt-3 inline-flex rounded-lg bg-primary-700 px-4 py-2 text-sm font-bold text-white hover:bg-primary-800">
            Entra nella tua pagina
          </Link>
        </div>
        {/* 26/11/2026 — Per ora si paga in contanti (lib/agenzia/pagamento-servizi.ts): niente «Paga» qui. */}
        {(!attivo || inContanti) && !PAGAMENTO_ONLINE_SERVIZI && (
          <div className="mt-4 rounded-2xl border-2 border-cream-300 bg-surface-0 p-5">
            <p className="text-sm text-ink-700">
              {inContanti
                ? `L’abbonamento ${pc.fasciaScelta ? FASCE[pc.fasciaScelta].nome : ''} si paga in contanti, di persona, al primo servizio: ti contattiamo noi per fissarlo.`
                : `L’abbonamento ${pc.fasciaScelta ? FASCE[pc.fasciaScelta].nome : ''} si paga in contanti, di persona: ti contattiamo noi per fissare l’inizio.`}
            </p>
          </div>
        )}
        {!attivo && PAGAMENTO_ONLINE_SERVIZI && (
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

  const { preventivo: p, scheda } = demo;
  // 27/11/2026 — Senza fascia nell'indirizzo vale quella scelta dal titolare davanti all'agente, poi la consigliata.
  const scelta = fasciaDaIndirizzo(fascia) ?? pc.fasciaScelta ?? p.consigliato;
  const qui = indirizziDemo(codice).abbonamento;

  return (
    <Cornice>
      <header>
        <p className="text-xs font-bold uppercase tracking-wide text-primary-700">Preventivo n. {p.numero} · {FASCE[scelta].nome}</p>
        <h1 className="mt-1 font-serif text-2xl font-extrabold text-ink-900">Il preventivo di {p.attivita} col {FASCE[scelta].nome}</h1>
        <p className="mt-1 text-sm text-ink-600">{descriviAttivita(p.tipoAttivita)} · {FRASE_PARTNER}</p>
      </header>

      {PAGAMENTO_ONLINE_SERVIZI && pagato === '0' && (
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
                <AnteprimaServizio id={r.id} nome={p.attivita} tipo={p.tipoAttivita} giorno={p.data} nascita={p.nascitaAttivita} scheda={scheda} />
              )}
            </li>
          ))}
        </ul>
      </section>

      <OffertaSuMisura corta offerta={p.offerta} fascia={scelta} />
      {/* 25/11/2026 — L'analisi del business dell'attività (Nicola, mycity#330): corta, il dettaglio nella demo. */}
      <AnalisiAziendale corta analisi={p.analisiAziendale} stato={p.analisiAziendaleStato} fascia={scelta} dettaglioHref={indirizziDemo(codice).servizio('analisi')} />

      {/* 25/11/2026 — Nicola, 18:30: nel preventivo i servizi corti, una riga ciascuno, solo per la fascia guardata. Ogni fascia apre il suo preventivo (#331). */}
      <AbbonamentiInBreve consigliato={p.consigliato} prezzi={p.prezzi} primoMeseScontato={p.primoMeseScontato} perche={p.perche_consigliato} scelta={scelta} hrefDi={(f) => hrefFascia(f, qui)} />

      {/* Il modulo segue `scelta` da sé (AccettaDalLink): cambiando fascia non si perde l'email scritta. */}
      <AccettaDalLink codice={codice} consigliato={scelta} prezzi={p.prezzi} primoMeseScontato={p.primoMeseScontato} />
    </Cornice>
  );
}

// Un <div>, non un <main>: il «contenuto principale» lo mette già il guscio del sito (app/layout.tsx).
function Cornice({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-3xl">{children}</div>;
}
