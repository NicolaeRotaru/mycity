import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ABBONAMENTI, FASCE, FRASE_PARTNER, LISTINO, SERVIZI_AGENZIA, canonePrimoMese, scriviCanone } from '@/lib/agenzia/preventivo';
import { SERVIZI_IN_BREVE } from '@/lib/agenzia/preventivo-corto';
import { CODICE_VALIDO } from '@/lib/agenzia/preventivo-col-codice';
import { leggiDemoDalLink } from '@/lib/agenzia/demo-dal-link';
import { indirizziDemo } from '@/lib/agenzia/indirizzi-demo';
import { fasciaDaIndirizzo } from '@/lib/agenzia/indirizzi-servizi';
import { descriviAttivita } from '@/lib/agenzia/tipi-attivita';
import { formatPriceFromCents } from '@/lib/format';
import { fasciaValida } from '@/lib/agenzia/abbonamento-contanti';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { giorniDellaVisita } from '@/lib/agenzia/visita-sdg';
import ConfermaAbbonamento, { type FasciaDaConfermare } from './ConfermaAbbonamento';
import SitoPronto from '@/components/seller/lavoro-consegnato/SitoPronto';
import { sitoConsegnatoDi } from '@/lib/agenzia/lavoro-consegnato/registro';

/**
 * LA CONFERMA DELL'ABBONAMENTO DAL LINK — 27/11/2026.
 *
 * Nicola, 27/11 15:06, con la foto del link di Grida Caffè: «l'imprenditore non entra più nella sua pagina
 * demo ma in uno schermo che fa vedere i 3 abbonamenti al cliente e conferma l'abbonamento scelto che ha
 * detto al venditore». E alla domanda sulle due scelte: «può toccare un altro abbonamento e confermare
 * quello, e dopo il click entra nella sua pagina venditore con l'abbonamento che ha scelto».
 *
 * Quindi qui: le tre fasce, quella detta al venditore (`fascia_scelta` del preventivo) già segnata come
 * «La tua scelta», la possibilità di toccarne un'altra, l'email (serve per rientrare) e un pulsante solo,
 * «Confermo il …». Al clic il server accetta, sblocca la pagina nella fascia confermata e apre la sessione
 * del titolare (app/api/preventivo/[codice]/accetta): il browser va dritto nel pannello del negozio.
 *
 * Il ritorno dal pagamento Stripe e un preventivo già accettato vanno ancora alla pagina dell'abbonamento,
 * che sa cosa dire (app/preventivo/[codice]/(demo)/abbonamento).
 *
 * 27/11/2026 verso le 17:40 — Nicola: nella stessa pagina il titolare sceglie anche giorno e ora in cui il
 * team creativo di SDG passa da lui (piano editoriale, foto e video). I giorni li calcola il server
 * (lib/agenzia/visita-sdg.ts), senza le ore già prese da altre attività.
 */

export const dynamic = 'force-dynamic';

/** Le ore già fissate da altre attività, da oggi in poi. Se non si leggono (o manca la 999b), nessuna. */
async function orariGiaPresi(): Promise<string[]> {
  try {
    const { data, error } = await getAdminSupabase()
      .from('preventivi_con_codice')
      .select('visita_il')
      .gte('visita_il', new Date().toISOString());
    if (error) throw new Error(error.message);
    return ((data ?? []) as { visita_il: string | null }[]).map((r) => r.visita_il).filter((v): v is string => Boolean(v));
  } catch (errore) {
    logger.warn('[preventivo-codice] ore della visita già prese non lette: tutte libere', { errore: String(errore) });
    return [];
  }
}

export default async function ConfermaDalLink({
  params,
  searchParams,
}: {
  params: Promise<{ codice: string }>;
  searchParams: Promise<{ pagato?: string; fascia?: string | string[] }>;
}) {
  const { codice } = await params;
  const { pagato, fascia } = await searchParams;
  if (!CODICE_VALIDO.test(codice)) notFound();
  const ind = indirizziDemo(codice);
  if (pagato === '0' || pagato === '1') redirect(`${ind.abbonamento}?pagato=${pagato}`);

  const demo = await leggiDemoDalLink(codice);
  if (demo.tipo === 'non-trovato') notFound();
  if (demo.tipo === 'accettato') redirect(ind.abbonamento);
  if (demo.tipo === 'guasto') return <Cornice><p className="text-ink-700">{demo.messaggio}</p></Cornice>;

  const p = demo.preventivo;
  // Il riquadro del sito non deve mai far cadere la conferma, che è quella che incassa.
  let sitoPronto: ReturnType<typeof sitoConsegnatoDi> = null;
  try {
    sitoPronto = sitoConsegnatoDi(demo.pc.sellerId);
  } catch (errore) {
    logger.warn('[preventivo-codice] sito pronto non letto: la pagina va avanti senza', { errore: String(errore) });
  }
  // Una fascia scritta male nel database non rompe la pagina: vale la consigliata.
  const dalVenditore = fasciaValida(demo.pc.fasciaScelta) ? demo.pc.fasciaScelta : null;
  const fasce: FasciaDaConfermare[] = ABBONAMENTI.map((f) => {
    const primo = p.primoMeseScontato ? canonePrimoMese(p.prezzi[f]) : null;
    return {
      id: f,
      nome: FASCE[f].nome,
      canone: scriviCanone(p.prezzi[f]),
      // «Il primo mese 150,00 €», senza un secondo «al mese» (come la dashboard della demo).
      primoMese: primo !== null ? formatPriceFromCents(primo) : null,
      perChi: FASCE[f].perChi,
      servizi: SERVIZI_AGENZIA.map((s) => ({ titolo: LISTINO[s].titolo, testo: SERVIZI_IN_BREVE[f][s] })),
    };
  });

  return (
    <Cornice>
      <header>
        <p className="text-xs font-bold uppercase tracking-wide text-primary-700">Preventivo n. {p.numero}</p>
        <h1 className="mt-1 font-serif text-2xl font-extrabold text-ink-900 sm:text-3xl">{p.attivita}, ecco il tuo abbonamento</h1>
        <p className="mt-2 text-ink-700">
          {dalVenditore
            ? `Con il nostro venditore hai scelto il ${FASCE[dalVenditore].nome}: lo trovi già segnato. Se preferisci un altro abbonamento, toccalo. Poi conferma.`
            : 'Tocca l’abbonamento che preferisci e confermalo.'}
        </p>
        <p className="mt-1 text-sm text-ink-600">{descriviAttivita(p.tipoAttivita)} · {FRASE_PARTNER}</p>
      </header>
      {/* 27/11/2026 — Nicola: il sito già fatto per lui si vede appena il titolare apre il link del venditore. Solo il sito. */}
      {sitoPronto && <SitoPronto sito={sitoPronto.sito} versione={sitoPronto.fascia} attivita={p.attivita} />}
      {/* ?fascia= arriva dal pulsante della vecchia pagina dell'abbonamento: sceglie, ma l'etichetta resta su quella del venditore. */}
      <ConfermaAbbonamento
        codice={codice}
        fasce={fasce}
        iniziale={fasciaDaIndirizzo(fascia) ?? dalVenditore ?? p.consigliato}
        segnata={dalVenditore ?? p.consigliato}
        dalVenditore={dalVenditore !== null}
        giorni={giorniDellaVisita(new Date(), await orariGiaPresi())}
        serviziDelVenditore={demo.pc.serviziScelti ?? null}
      />
    </Cornice>
  );
}

// Il marchio in cima riporta al sito: la barra del sito qui è nascosta (collaudo del 25/11).
// Un <div>, non un <main>: il «contenuto principale» lo mette già il guscio del sito (app/layout.tsx).
function Cornice({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <div className="border-b border-cream-300 bg-surface-0 px-4 py-3">
        <Link href="/" className="font-serif text-2xl font-extrabold leading-none tracking-tight">
          <span className="text-primary-700">My</span><span className="text-ink-900">City</span>
        </Link>
      </div>
      <div className="mx-auto max-w-5xl px-4 py-8">{children}</div>
    </div>
  );
}
