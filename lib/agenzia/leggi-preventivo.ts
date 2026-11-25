import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import {
  ABBONAMENTI,
  costruisciPreventivo,
  leggiImpostazioniAgenzia,
  impostazioniSenzaPrezzi,
  type Abbonamento,
  type AbbonamentoAttivo,
  type Preventivo,
} from '@/lib/agenzia/preventivo';
import { tipoDelProfilo } from '@/lib/agenzia/tipi-attivita';
import { leggiSchedaSalvata, soloConfermati } from '@/lib/agenzia/scheda-cliente';
import { leggiAnalisiCanali, leggiRisultatoSito, sitoInParole } from '@/lib/agenzia/analisi';
import { leggiGiudizioSito, offertaSuMisura } from '@/lib/agenzia/offerta-su-misura';
import { schedaEPagellaAperte, schedaPerIlSito } from '@/lib/agenzia/scheda-dopo-abbonamento';

/**
 * IL PREVENTIVO LETTO DAL DATABASE — una funzione sola per la dashboard (/api/seller/preventivo) e
 * per la pagina col codice (/preventivo/<codice>, 24/11/2026): lo stesso calcolo, gli stessi dati.
 * Sta qui da quando serve a due strade; prima era dentro la rotta della dashboard.
 */

/** I prodotti che contano per «senza foto»: quelli ancora in catalogo. */
const STATI_IN_CATALOGO = ['available', 'draft', 'out_of_stock', 'pending_approval'];

/** Un negozio con migliaia di schede non deve far leggere tutto: oltre questo numero si conta fin qui. */
const TETTO_PRODOTTI = 2000;

export type Letti = { preventivo: Preventivo; telefono: string | null; socials: unknown };

/**
 * L'abbonamento dei servizi attivo, dalla lettura della tabella. Una lettura caduta, o la tabella
 * che non c'è ancora (migrazione 706 non applicata), vale «nessuno»: la pagina mostra la cassa, e
 * la cassa stessa si ferma se la tabella non si legge (`paga/route.ts`).
 */
function abbonamentoAttivo(r: { data: unknown; error: { message: string } | null }): AbbonamentoAttivo | null {
  if (r.error) {
    logger.warn('[preventivo] abbonamento dei servizi non letto', { message: r.error.message });
    return null;
  }
  const riga = (r.data as Array<{ fascia: string; stato: string; rinnovo_il: string | null }> | null)
    ?.find((x) => x.stato === 'active' || x.stato === 'past_due');
  if (!riga || !(ABBONAMENTI as readonly string[]).includes(riga.fascia)) return null;
  if (riga.stato !== 'active' && riga.stato !== 'past_due') return null;
  return { fascia: riga.fascia as Abbonamento, stato: riga.stato, rinnovoIl: riga.rinnovo_il };
}

/**
 * `pubblico`: il preventivo si mostra fuori dalla pagina del negozio (il link col codice). L'offerta su
 * misura usa allora solo i dati confermati della scheda e nessuna analisi dei canali; il sito misurato da
 * Google PageSpeed e il giudizio dell’AD sul sito sì (Nicola, 25/11/2026: «sì, anche nel link»).
 */
export async function leggiPreventivo(idAttivita: string, scelto?: Abbonamento, opzioni: { pubblico?: boolean } = {}): Promise<Letti> {
  const admin = getAdminSupabase();
  const [profilo, prodotti, impostazioni, abbonamento, schedaLetta, analisiLetta] = await Promise.all([
    admin
      .from('profiles')
      .select('*')
      .eq('id', idAttivita)
      .maybeSingle(),
    admin
      .from('products')
      .select('images')
      .eq('seller_id', idAttivita)
      .in('status', STATI_IN_CATALOGO)
      .limit(TETTO_PRODOTTI),
    admin.from('site_settings').select('agenzia').eq('id', 1).maybeSingle(),
    // 24/11/2026 — L'abbonamento dei servizi già pagato, se c'è (migrazione 706).
    admin
      .from('abbonamenti_servizi')
      .select('fascia, stato, rinnovo_il')
      .eq('seller_id', idAttivita)
      .order('creato_il', { ascending: false })
      .limit(20),
    // 24/11/2026 — Per l'offerta su misura: la scheda di n8n (708) e l'analisi dei canali e del sito (711).
    // Tutte e due facoltative: se non ci sono, o la tabella manca, l'offerta si fa con la vetrina.
    admin.from('schede_clienti').select('scheda').eq('id_attivita', idAttivita).maybeSingle(),
    // 25/11/2026 — Nel link pubblico entra il sito misurato da Google PageSpeed (Nicola: «sì, anche nel
    // link»): è una misura di Google, non un dato da confermare. I canali restano solo nell'area del negozio.
    admin.from('analisi_negozi').select(opzioni.pubblico ? 'sito' : 'sito, canali').eq('id_attivita', idAttivita).maybeSingle(),
  ]);
  if (profilo.error) throw new Error(`profilo non letto: ${profilo.error.message}`);
  if (!profilo.data) throw new Error('profilo non trovato');
  // «Non ho letto i prodotti» non è «non hai prodotti»: senza questa riga un catalogo
  // di quaranta schede senza foto risulterebbe a posto.
  if (prodotti.error) throw new Error(`prodotti non letti: ${prodotti.error.message}`);
  // Le impostazioni dell'agenzia sono facoltative. Riga vuota, o migrazione 703 non ancora
  // applicata (la colonna non c'è): valgono il nome e il listino scritti nel codice.
  // Qualunque altro errore di lettura: tutti i prezzi «su richiesta». Se Nicola ha tolto un
  // prezzo dalle impostazioni, un guasto di lettura non deve rimetterlo davanti al cliente.
  const colonnaAncoraAssente = impostazioni.error && ['42703', 'PGRST204'].includes(String(impostazioni.error.code));
  if (impostazioni.error) {
    logger.warn(
      colonnaAncoraAssente
        ? '[preventivo] colonna site_settings.agenzia assente (migrazione 703): vale il listino del codice'
        : '[preventivo] impostazioni dell agenzia non lette: prezzi su richiesta',
      { message: impostazioni.error.message },
    );
  }

  // `select('*')`: le colonne del tipo di attività arrivano con la migrazione 703, e chiederle
  // per nome prima di quella farebbe fallire la lettura. Con `*` ci sono se ci sono.
  const p = profilo.data as Record<string, unknown>;
  const personalizzazione = p.store_customization as { socials?: unknown } | null | undefined;
  const socials = personalizzazione?.socials ?? null;
  // 25/11/2026 — Il sito che ha già, misurato da Google: se c'è, il preventivo parla del suo sito. Un
  // sito misurato è un sito che esiste, anche se nei canali della vetrina non è ancora scritto.
  const analisi = analisiLetta.error ? null : (analisiLetta.data as { sito?: unknown; canali?: unknown } | null);
  const sitoMisurato = leggiRisultatoSito(analisi?.sito);
  const socialsPerIlConto =
    sitoMisurato && !(socials && typeof socials === 'object' && typeof (socials as Record<string, unknown>).website === 'string' && ((socials as Record<string, string>).website).trim())
      ? { ...(socials && typeof socials === 'object' ? (socials as Record<string, unknown>) : {}), website: sitoMisurato.url }
      : socials;
  const sitoOggi = sitoMisurato
    ? [`Il tuo sito c’è, e Google l’ha misurato:`, ...sitoInParole(sitoMisurato).map((v) => `${v.titolo}: ${v.punteggio} su 100. ${v.frase}`)]
    : undefined;
  const preventivo = costruisciPreventivo({
    idAttivita,
    nomeAttivita: String(p.store_name ?? ''),
    tipoAttivita: tipoDelProfilo(p.business_type),
    dati: {
      storeLogo: (p.store_logo as string | null) ?? null,
      storeMedia: p.store_media,
      prodotti: (prodotti.data ?? []) as { images: unknown }[],
      socials: socialsPerIlConto,
      sitoOggi,
    },
    impostazioni: impostazioni.error
      ? colonnaAncoraAssente ? leggiImpostazioniAgenzia(null) : impostazioniSenzaPrezzi()
      : leggiImpostazioniAgenzia(impostazioni.data?.agenzia),
    adesso: new Date(),
    scelto,
    attivo: abbonamentoAttivo(abbonamento),
    // Chi ha già avuto un abbonamento dei servizi non ha più il primo mese a metà (lo rifiuta anche la cassa).
    primoMeseScontato: abbonamento.error ? true : ((abbonamento.data as unknown[] | null) ?? []).length === 0,
  });
  // L'offerta su misura (24/11/2026): dalla vetrina, dalla scheda e dalle analisi. Un guasto qui non
  // ferma il preventivo: senza offerta la pagina mostra quello che mostrava prima.
  try {
    // 25/11/2026 — La scheda del cliente vale solo dopo l'abbonamento (Nicola): prima, dell'offerta su
    // misura resta l'analisi (lib/agenzia/scheda-dopo-abbonamento.ts). Una lettura caduta vale «chiusa».
    const aperta = schedaEPagellaAperte({
      visibileSenzaAbbonamento: p.visibile_senza_abbonamento,
      statiAbbonamenti: abbonamento.error ? [] : ((abbonamento.data as Array<{ stato?: unknown }> | null) ?? []).map((r) => r.stato),
    });
    const schedaIntera = schedaPerIlSito(
      schedaLetta.error ? null : leggiSchedaSalvata((schedaLetta.data as { scheda?: unknown } | null)?.scheda),
      aperta,
    );
    preventivo.offerta = offertaSuMisura({
      nome: preventivo.attivita,
      tipo: preventivo.tipoAttivita,
      dati: {
        storeLogo: (p.store_logo as string | null) ?? null,
        storeMedia: p.store_media,
        prodotti: (prodotti.data ?? []) as { images: unknown }[],
        socials: socialsPerIlConto,
      },
      scheda: opzioni.pubblico ? soloConfermati(schedaIntera) : schedaIntera,
      canali: opzioni.pubblico ? null : leggiAnalisiCanali(analisi?.canali),
      sito: sitoMisurato,
      // Il giudizio dell'AD sul sito vale anche nel link: è un parere su un sito pubblico, non un dato del titolare.
      giudizioSito: leggiGiudizioSito((schedaIntera?.analisi as Record<string, unknown> | undefined)?.giudizio_sito),
    });
  } catch (errore) {
    logger.warn('[preventivo] offerta su misura non preparata', { errore: String(errore) });
  }
  const telefono = (p.store_phone as string | null) || (p.phone as string | null) || null;
  return { preventivo, telefono, socials };
}

