import { randomUUID } from 'node:crypto';
import { after } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { notifyAdmins } from '@/lib/stripe/webhook/comune';
import { adCollegato, avviaLavoro, leggiLavoro } from '@/lib/agenti/n8n';
import { FLUSSO } from '@/lib/agenti/compito';
import { sitoCerto } from '@/lib/agenti/scheda';
import { eDiSdg } from '@/lib/products/sdgSeller';
import { FASCE, canonePrimoMese, type Abbonamento } from './preventivo';
import { tipoDelProfilo, type TipoAttivita } from './tipi-attivita';
import { leggiSchedaSalvata } from './scheda-cliente';
import { primoMeseAncoraScontato } from './abbonamento-contanti';
import { pianoDelPrimoMese, type PianoDelMese } from './piano-del-primo-mese';
import { fraseVisita } from './visita';

export { fraseVisita };
import { COMPITO_PIANO, SCHEMA_PIANO, VENDITORE_DEI_PIANI, dallaSchedaDellAgente, datiPerIlPianoCompleto, pianoDallaRisposta } from './piano-completo-ad';
import { PEZZI_ORDINE, chiediIlPezzo, schedaDellAgente } from './pezzi-dell-ordine';
import { ETICHETTE_SERVIZI, LAVORO_DEL_SERVIZIO, leggiServiziScelti, servizioScelto, type ServizioAgenzia } from './servizi-scelti';


/**
 * L'ORDINE DI SERVIZIO CHE ARRIVA A SDG — 27/11/2026.
 *
 * Nicola, 27/11 17:25: quando il titolare conferma l'abbonamento dal link, «in automatico deve arrivare l'ordine del
 * servizio … nella pagina venditore di SDG … con su scritto tutti i dati, quindi che abbonamento ha scelto
 * l'imprenditore, e tutto il piano editoriale già fatto».
 *
 * `creaOrdineSdg` la chiama una riga sola, dopo l'avviso a Nicola, in accettaPreventivoColCodice
 * (lib/agenzia/preventivo-col-codice.ts). NON LANCIA MAI ERRORI: un ordine che non nasce non deve togliere al
 * titolare la sua conferma. Cosa fa:
 *  1. rilegge il preventivo dal codice e procede solo se è davvero «accettato» e del negozio giusto;
 *  2. raccoglie i dati: nome e indirizzo dal profilo, l'agente e la sua scheda dal preventivo (migrazione 999c),
 *     la data della visita (colonna visita_il della 999b, o quella passata da chi chiama), il canone della fascia;
 *  3. scrive l'ordine in ordini_sdg col piano del primo mese calcolato qui (lib/agenzia/piano-del-primo-mese.ts):
 *     UNO per attività, una seconda chiamata non fa un doppione e non cambia il primo;
 *  4. avvisa Nicola, che oggi è chi apre la pagina di SDG (l'account di SDG non entra ancora);
 *  5. DOPO la risposta al titolare chiede all'AD il piano completo (lib/agenzia/piano-completo-ad.ts): se n8n non
 *     risponde l'ordine resta col piano del sito e lo stato «da collegare», e si può richiedere dalla pagina.
 *     28/11/2026 — Insieme al piano partono la bozza del sito e l'analisi all'avvio, secondo la fascia
 *     (lib/agenzia/pezzi-dell-ordine.ts, migrazione 999h): tre lavori, tre corse dell'AD per cliente. Anche loro dopo
 *     la risposta e senza mai fermare l'accettazione: se l'AD non risponde restano «da collegare».
 * Gli abbonamenti di SDG non entrano mai in `orders` (trigger della 707): l'ordine ha la sua tabella.
 */

export type EsitoOrdineSdg =
  | { ok: true; nuovo: boolean; id: string | null }
  | { ok: false; motivo: 'non-accettato' | 'guasto'; dettaglio?: string };

export type StatoPianoCompleto = 'da_collegare' | 'in_corso' | 'pronto' | 'errore';

export type DatiAttivita = {
  tipo: TipoAttivita;
  dettaglio: string | null;
  indirizzo: string | null;
  citta: string | null;
  /** Dalla scheda dell'agente, quando c'è: cosa è il locale per l'AD, il sito, i social, cosa faremo con la fascia. */
  dallaScheda?: {
    tipo: string | null;
    sito: string | null;
    social: { canale: string; fonte: string | null }[];
    perche: string | null;
    servizi: Record<string, string>;
  } | null;
  /**
   * 28/11/2026 — Quali servizi gli servono, scelti dall'agente insieme all'abbonamento (migrazione 999h, dal
   * preventivo). `null` o assente = la scelta non c'è (preventivo di prima): valgono tutti e quattro.
   */
  servizi?: ServizioAgenzia[] | null;
  /** La nota libera dell'agente: un'indicazione per l'AD e per SDG, mai un testo da pubblicare. */
  notaAgente?: string | null;
};

export type OrdineSdg = {
  id: string;
  seller_id: string;
  nome_attivita: string;
  dati_attivita: DatiAttivita;
  fascia: Abbonamento;
  canone_centesimi: number | null;
  primo_mese_centesimi: number | null;
  visita_il: string | null;
  agente_email: string | null;
  lavoro: string | null;
  accettato_il: string | null;
  piano: PianoDelMese;
  piano_origine: 'sito' | 'ad';
  piano_completo_stato: StatoPianoCompleto;
  lavoro_piano: string | null;
  piano_completo_errore: string | null;
  piano_completo_il: string | null;
  creato_il: string;
  aggiornato_il: string;
};

export const COLONNE_ORDINE =
  'id, seller_id, nome_attivita, dati_attivita, fascia, canone_centesimi, primo_mese_centesimi, visita_il, agente_email, lavoro, accettato_il, piano, piano_origine, piano_completo_stato, lavoro_piano, piano_completo_errore, piano_completo_il, creato_il, aggiornato_il';

/**
 * Chi legge gli ordini di SDG: l'admin (oggi Nicola) e l'account di SDG Agenzia, il giorno che avrà un accesso vero.
 * La tabella ha la stessa regola (RLS della 999c): questa è la porta del sito, quella del database.
 */
export const puoLeggereGliOrdiniSdg = (userId: string, ruolo: string | null | undefined): boolean => ruolo === 'admin' || eDiSdg(userId);

/** Dopo quanto un piano chiesto all'AD e non tornato si dà per perso (l'AD aspetta al massimo 15 minuti). */
export const ATTESA_MASSIMA_PIANO_MS = 45 * 60_000;

/** Un lavoro dopo la risposta. Fuori da una richiesta (le prove) `after` non c'è: si lancia e basta. */
const dopoLaRisposta = (fn: () => Promise<void>) => {
  try {
    after(fn);
  } catch {
    void fn();
  }
};

const fasciaValida = (f: unknown): f is Abbonamento => typeof f === 'string' && f in FASCE;
const emailValida = (e: unknown): string | null => (typeof e === 'string' && /^[^\s@]+@[^\s@]+$/.test(e.trim()) ? e.trim().toLowerCase().slice(0, 254) : null);
const uuidValido = (u: unknown): string | null => (typeof u === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(u) ? u.toLowerCase() : null);

/** Una colonna che può non esserci ancora (999b, 999c non applicate): `undefined` se la lettura non riesce. */
async function colonneFacoltative(admin: SupabaseClient, codice: string, colonne: string): Promise<Record<string, unknown> | undefined> {
  const { data, error } = await admin.from('preventivi_con_codice').select(colonne).eq('codice', codice).maybeSingle();
  if (error || !data) return undefined;
  return data as unknown as Record<string, unknown>;
}

/** Crea l'ordine di servizio per SDG di un preventivo appena accettato. Non lancia mai. */
export async function creaOrdineSdg(input: {
  sellerId: string;
  codice: string;
  fascia: Abbonamento;
  visitaIl?: string | null;
  /**
   * Collaudo 28/11/2026 — I servizi confermati dal titolare nel link. Valgono loro, non quelli riletti dal preventivo:
   * se la loro scrittura sul preventivo non è riuscita (o manca la 999h), dal database tornerebbero quelli del
   * venditore (o tutti e quattro) e partirebbero i lavori sbagliati. Assenti: si rileggono dal preventivo.
   */
  servizi?: readonly ServizioAgenzia[] | null;
}): Promise<EsitoOrdineSdg> {
  try {
    return await creaOrdine(input);
  } catch (e) {
    logger.error('[ordine-sdg] ordine non creato', { sellerId: input?.sellerId, errore: String(e) });
    return { ok: false, motivo: 'guasto', dettaglio: String(e) };
  }
}

async function creaOrdine({ sellerId, codice, fascia, visitaIl, servizi: confermati }: { sellerId: string; codice: string; fascia: Abbonamento; visitaIl?: string | null; servizi?: readonly ServizioAgenzia[] | null }): Promise<EsitoOrdineSdg> {
  if (!fasciaValida(fascia)) return { ok: false, motivo: 'guasto', dettaglio: `fascia non valida: ${String(fascia)}` };
  const admin = getAdminSupabase();

  // 1) Il preventivo, dal codice: solo se è accettato ed è di questo negozio.
  const prev = await admin.from('preventivi_con_codice').select('seller_id, stato, accettato_il').eq('codice', codice).maybeSingle();
  if (prev.error) return { ok: false, motivo: 'guasto', dettaglio: `preventivo non letto: ${prev.error.message}` };
  const riga = prev.data as { seller_id?: string; stato?: string; accettato_il?: string | null } | null;
  if (!riga || riga.seller_id !== sellerId || riga.stato !== 'accettato') return { ok: false, motivo: 'non-accettato' };

  // 2) Agente e scheda (999c), visita (999b, se chi chiama non la passa), profilo, scheda del locale, canone.
  const [chi, visita, profilo, schedaLocale, abbonamenti, richiesta] = await Promise.all([
    colonneFacoltative(admin, codice, 'lavoro, agente_email'),
    visitaIl === undefined ? colonneFacoltative(admin, codice, 'visita_il') : Promise.resolve({ visita_il: visitaIl }),
    admin.from('profiles').select('store_name, store_address, city, business_type, business_type_detail').eq('id', sellerId).maybeSingle(),
    admin.from('schede_clienti').select('scheda').eq('id_attivita', sellerId).maybeSingle(),
    admin.from('abbonamenti_servizi').select('fascia, canone_centesimi, stato, origine').eq('seller_id', sellerId),
    // 28/11 — I servizi scelti dall'agente (999h): prima della migrazione non ci sono, e valgono tutti e quattro.
    colonneFacoltative(admin, codice, 'servizi_scelti, nota_agente'),
  ]);
  const letti = leggiServiziScelti(richiesta?.servizi_scelti, richiesta?.nota_agente);
  const notaAgente = letti.nota;
  const servizi = (confermati?.length ? leggiServiziScelti(confermati, null).servizi : null) ?? letti.servizi;
  const p = (profilo.data ?? {}) as { store_name?: string | null; store_address?: string | null; city?: string | null; business_type?: string | null; business_type_detail?: string | null };
  const nome = String(p.store_name ?? '').trim().slice(0, 120) || 'Attività senza nome';
  const tipo = tipoDelProfilo(p.business_type);
  const visitaLetta = typeof visita?.visita_il === 'string' && !Number.isNaN(Date.parse(visita.visita_il)) ? new Date(visita.visita_il).toISOString() : null;
  const righe = (abbonamenti.error ? null : (abbonamenti.data ?? [])) as { fascia?: string; canone_centesimi?: number | null; stato?: string | null; origine?: string | null }[] | null;
  const inCorso = righe?.find((r) => r.fascia === fascia && ['active', 'past_due', 'trialing'].includes(String(r.stato)));
  const canone = typeof inCorso?.canone_centesimi === 'number' && inCorso.canone_centesimi > 0 ? inCorso.canone_centesimi : FASCE[fascia].prezzoMese;
  // Il primo mese a metà solo se vale davvero (lib/agenzia/abbonamento-contanti.ts); se non si legge, non si dice.
  const primoMese = righe ? (primoMeseAncoraScontato(righe) ? canonePrimoMese(canone) : canone) : null;

  const piano = pianoDelPrimoMese({
    nome, tipo, fascia,
    indirizzo: p.store_address ?? null,
    citta: p.city ?? null,
    visitaIl: visitaLetta,
    accettatoIl: riga.accettato_il ?? null,
    scheda: schedaLocale.error ? null : leggiSchedaSalvata((schedaLocale.data as { scheda?: unknown } | null)?.scheda),
  });
  const dati: DatiAttivita = { tipo, dettaglio: p.business_type_detail ?? null, indirizzo: p.store_address ?? null, citta: p.city ?? null, dallaScheda: null, servizi, notaAgente };

  // 3) L'ordine: uno per attività. Con la chiave unica su seller_id, un secondo invio non scrive niente.
  const scritto = await admin
    .from('ordini_sdg')
    .upsert({
      seller_id: sellerId,
      nome_attivita: nome,
      dati_attivita: dati,
      fascia,
      canone_centesimi: canone,
      primo_mese_centesimi: primoMese,
      visita_il: visitaLetta,
      agente_email: emailValida(chi?.agente_email),
      lavoro: uuidValido(chi?.lavoro),
      accettato_il: riga.accettato_il ?? new Date().toISOString(),
      piano,
      piano_origine: 'sito',
      piano_completo_stato: 'da_collegare',
    }, { onConflict: 'seller_id', ignoreDuplicates: true })
    .select('id');
  if (scritto.error) {
    logger.error('[ordine-sdg] ordine non scritto: controlla che la migrazione 999c sia applicata', { sellerId, message: scritto.error.message });
    // Il titolare ha confermato lo stesso: l'ordine perso non deve restare solo nel log (collaudo del 27/11).
    await notifyAdmins(
      `ATTENZIONE: l'ordine di servizio per SDG di ${nome} non è nato`,
      `Il titolare ha confermato l'abbonamento ${FASCE[fascia].nome}, ma l'ordine di SDG non si è scritto. Controlla che la migrazione 999c sia applicata e prepara l'ordine a mano. ${fraseVisita(visitaLetta)}.`,
      '/admin/preventivi',
      { unaVoltaPer: `ordine-sdg-mancato:${sellerId}` },
    ).catch((e: unknown) => logger.warn('[ordine-sdg] avviso dell ordine mancato non partito', { sellerId, errore: String(e) }));
    return { ok: false, motivo: 'guasto', dettaglio: scritto.error.message };
  }
  const id = ((scritto.data ?? []) as { id?: string }[])[0]?.id ?? null;
  if (!id) return { ok: true, nuovo: false, id: null };
  logger.info('[ordine-sdg] ordine di servizio creato', { sellerId, fascia, conAgente: Boolean(chi?.agente_email), conVisita: Boolean(visitaLetta) });

  // 4) L'avviso a Nicola, una volta per attività.
  await notifyAdmins(
    `Ordine di servizio per SDG: ${nome}`,
    [
      `Abbonamento ${FASCE[fascia].nome}, ${(canone / 100).toLocaleString('it-IT')} € al mese, in contanti al primo servizio.`,
      `${fraseVisita(visitaLetta)}.`,
      emailValida(chi?.agente_email) ? `Portato dall'agente ${emailValida(chi?.agente_email)}.` : 'Senza agente (preventivo nato fuori dalla pagina degli agenti).',
      servizi ? `Servizi scelti: ${servizi.map((x) => ETICHETTE_SERVIZI[x]).join(', ')}.` : 'L’agente non ha scelto i servizi: valgono tutti e quattro.',
      notaAgente ? `Nota dell’agente: «${notaAgente}».` : '',
      `L’AD prepara: ${lavoriDaChiedere(servizi).map((l) => NOME_DEL_LAVORO[l]).join(', ') || 'niente (solo foto e video, li fa la squadra alla visita)'}.`,
    ].filter(Boolean).join(' '),
    '/seller/ordini-sdg',
    { unaVoltaPer: `ordine-sdg:${sellerId}` },
  ).catch((e: unknown) => logger.warn('[ordine-sdg] avviso a Nicola non partito', { sellerId, errore: String(e) }));

  // 5) Il piano completo, la bozza del sito e l'analisi all'avvio, dopo la risposta al titolare. Ognuno per conto
  //    suo: se uno non parte gli altri partono lo stesso, e nessuno lancia.
  //    28/11 — Solo per i servizi scelti dall'agente (Gestione social e Google → piano, Gestione sito web → sito,
  //    Analisi di mercato → analisi); quelli non scelti non partono e non costano corse dell'AD.
  const lavori = lavoriDaChiedere(servizi);
  dopoLaRisposta(() => Promise.all([
    ...(lavori.includes('piano') ? [chiediIlPianoCompleto(id)] : []),
    ...PEZZI_ORDINE.filter((pezzo) => lavori.includes(pezzo)).map((pezzo) => chiediIlPezzo(id, pezzo)),
  ]).then(() => undefined));
  return { ok: true, nuovo: true, id };
}

/** I lavori dell'AD per i servizi scelti (tutti e tre quando la scelta non c'è), nell'ordine piano, sito, analisi. */
export function lavoriDaChiedere(servizi: readonly ServizioAgenzia[] | null | undefined): ('piano' | 'sito' | 'analisi')[] {
  return (['social', 'sito_web', 'analisi'] as const).filter((id) => servizioScelto(servizi, id)).map((id) => LAVORO_DEL_SERVIZIO[id]!);
}
const NOME_DEL_LAVORO = { piano: 'il piano editoriale completo', sito: 'la bozza del sito', analisi: 'l’analisi di mercato all’avvio' } as const;

export type EsitoRichiestaPiano = { esito: 'chiesto' | 'non-serve' | 'non-partito' | 'guasto'; dettaglio?: string };

/**
 * Chiede all'AD il piano completo di un ordine, una volta: solo se il piano è «da collegare». Prende l'ordine con
 * un aggiornamento condizionato prima di mandare il lavoro, così due richieste insieme non fanno due lavori. Se n8n
 * non risponde, l'ordine torna «da collegare» col motivo, e il piano del sito resta. Non lancia mai.
 */
export async function chiediIlPianoCompleto(ordineId: string): Promise<EsitoRichiestaPiano> {
  try {
    const admin = getAdminSupabase();
    const letto = await admin.from('ordini_sdg').select(COLONNE_ORDINE).eq('id', ordineId).maybeSingle();
    if (letto.error || !letto.data) return { esito: 'guasto', dettaglio: letto.error?.message ?? 'ordine non trovato' };
    const o = letto.data as unknown as OrdineSdg;
    if (o.piano_completo_stato !== 'da_collegare') return { esito: 'non-serve' };

    // La scheda dell'agente arricchisce i dati dell'ordine anche quando l'AD non è collegato.
    const scheda = await schedaDellAgente(o.lavoro);
    if (scheda) {
      const su = scheda.su_misura?.[o.fascia];
      const misura = scheda.sito?.misura;
      const dallaScheda: DatiAttivita['dallaScheda'] = {
        tipo: scheda.tipo ? scheda.tipo.slice(0, 120) : null,
        // 28/11/2026 — Un sito trovato solo dal nome e mai confermato può essere di un omonimo: a SDG non va come «sito di oggi».
        sito: sitoCerto(misura)?.slice(0, 300) ?? null,
        social: (scheda.social ?? []).filter((x) => x.stato === 'trovato').slice(0, 3).map((x) => ({ canale: x.canale, fonte: x.fonte && /^https:\/\//i.test(x.fonte) ? x.fonte.slice(0, 300) : null })),
        perche: su?.perche ? su.perche.slice(0, 400) : null,
        servizi: Object.fromEntries(Object.entries(su?.servizi ?? {}).map(([k, v]) => [k, String(v).slice(0, 360)])),
      };
      await admin.from('ordini_sdg').update({ dati_attivita: { ...o.dati_attivita, dallaScheda }, aggiornato_il: new Date().toISOString() }).eq('id', o.id);
    }

    if (!adCollegato()) {
      await admin.from('ordini_sdg').update({ piano_completo_errore: 'il collegamento con l’AD non è acceso (manca N8N_SCHEDA_SEGRETO)', aggiornato_il: new Date().toISOString() }).eq('id', o.id).eq('piano_completo_stato', 'da_collegare');
      return { esito: 'non-partito', dettaglio: 'collegamento con l’AD non acceso' };
    }

    const lavoroPiano = randomUUID();
    const presa = await admin
      .from('ordini_sdg')
      .update({ piano_completo_stato: 'in_corso', lavoro_piano: lavoroPiano, piano_completo_errore: null, aggiornato_il: new Date().toISOString() })
      .eq('id', o.id)
      .eq('piano_completo_stato', 'da_collegare')
      .select('id');
    if (presa.error) return { esito: 'guasto', dettaglio: presa.error.message };
    if (!presa.data || presa.data.length === 0) return { esito: 'non-serve' };

    const dati = datiPerIlPianoCompleto({
      nome: o.nome_attivita,
      tipo: scheda?.tipo ?? o.dati_attivita?.tipo ?? 'altro',
      citta: o.dati_attivita?.citta ?? scheda?.citta ?? 'Piacenza',
      indirizzo: o.dati_attivita?.indirizzo ?? scheda?.indirizzo ?? null,
      fascia: o.fascia,
      piano: o.piano,
      scheda: dallaSchedaDellAgente(scheda, o.fascia),
    });
    const prima = { nome: o.nome_attivita, lavoro: 'piano-editoriale', fascia: o.fascia, periodo: o.piano.periodo };
    const partito = await avviaLavoro(lavoroPiano, VENDITORE_DEI_PIANI, `Piano · ${o.nome_attivita}`.slice(0, 120), prima, { flusso: FLUSSO, compito: COMPITO_PIANO, schema: SCHEMA_PIANO, dati });
    if (partito.ok) return { esito: 'chiesto' };
    await admin
      .from('ordini_sdg')
      .update({ piano_completo_stato: 'da_collegare', lavoro_piano: null, piano_completo_errore: `l’AD non è partito: ${partito.errore ?? 'n8n non risponde'}`.slice(0, 400), aggiornato_il: new Date().toISOString() })
      .eq('id', o.id)
      .eq('lavoro_piano', lavoroPiano);
    return { esito: 'non-partito', dettaglio: partito.errore };
  } catch (e) {
    logger.warn('[ordine-sdg] piano completo non chiesto', { ordineId, errore: String(e) });
    return { esito: 'guasto', dettaglio: String(e) };
  }
}

/**
 * Guarda se il piano completo di un ordine «in corso» è tornato: se è pronto e regge i controlli
 * (lib/agenzia/piano-completo-ad.ts → pianoDallaRisposta) prende il posto del piano del sito; se l'AD ha
 * sbagliato o non risponde da troppo, l'ordine lo dice e il piano del sito resta. Restituisce l'ordine aggiornato.
 */
export async function aggiornaPianoCompleto(admin: SupabaseClient, o: OrdineSdg, adesso = Date.now()): Promise<OrdineSdg> {
  if (o.piano_completo_stato !== 'in_corso' || !o.lavoro_piano) return o;
  try {
    const r = await leggiLavoro(o.lavoro_piano);
    let cambio: Partial<OrdineSdg> | null = null;
    if (r.stato === 'pronta' && r.venditore === VENDITORE_DEI_PIANI) {
      const esito = pianoDallaRisposta(r.risultato, o.piano, o.fascia);
      cambio = esito.ok
        ? { piano: esito.piano, piano_origine: 'ad', piano_completo_stato: 'pronto', piano_completo_errore: null, piano_completo_il: new Date(adesso).toISOString() }
        : { piano_completo_stato: 'errore', piano_completo_errore: esito.motivo.slice(0, 400) };
    } else if (r.stato === 'errore') {
      cambio = { piano_completo_stato: 'errore', piano_completo_errore: `l’AD non è riuscito a finire: ${r.errore ?? 'senza motivo'}`.slice(0, 400) };
    } else if (adesso - Date.parse(o.aggiornato_il) > ATTESA_MASSIMA_PIANO_MS) {
      cambio = { piano_completo_stato: 'errore', piano_completo_errore: 'l’AD non ha risposto in 45 minuti' };
    }
    if (!cambio) return o;
    const { error } = await admin.from('ordini_sdg').update({ ...cambio, aggiornato_il: new Date(adesso).toISOString() }).eq('id', o.id).eq('lavoro_piano', o.lavoro_piano).eq('piano_completo_stato', 'in_corso');
    if (error) {
      logger.warn('[ordine-sdg] piano completo non salvato', { ordineId: o.id, message: error.message });
      return o;
    }
    return { ...o, ...cambio } as OrdineSdg;
  } catch (e) {
    logger.warn('[ordine-sdg] piano completo non letto', { ordineId: o.id, errore: String(e) });
    return o;
  }
}

/**
 * Rimette «da collegare» un ordine il cui piano completo è andato storto, perché lo si possa chiedere di nuovo
 * (il pulsante della pagina di SDG). Un piano già pronto non si tocca.
 */
export async function riapriIlPianoCompleto(admin: SupabaseClient, ordineId: string): Promise<boolean> {
  const { data, error } = await admin
    .from('ordini_sdg')
    .update({ piano_completo_stato: 'da_collegare', lavoro_piano: null, aggiornato_il: new Date().toISOString() })
    .eq('id', ordineId)
    .eq('piano_completo_stato', 'errore')
    .select('id');
  return !error && (data ?? []).length > 0;
}
