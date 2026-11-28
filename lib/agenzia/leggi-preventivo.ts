import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import {
  ABBONAMENTI,
  consigliataDallOfferta,
  costruisciPreventivo,
  leggiImpostazioniAgenzia,
  impostazioniSenzaPrezzi,
  type Abbonamento,
  type AbbonamentoAttivo,
  type Preventivo,
} from '@/lib/agenzia/preventivo';
import { tipoDelProfilo } from '@/lib/agenzia/tipi-attivita';
import { leggiSchedaSalvata, sitoUfficialeDi, soloConfermati } from '@/lib/agenzia/scheda-cliente';
import { analisiAziendale, leggiAnalisiCanali, leggiRisultatoSito, sitoInParole, statoAnalisiBusiness } from '@/lib/agenzia/analisi';
import { leggiGiudizioSito, offertaSuMisura } from '@/lib/agenzia/offerta-su-misura';
import { conLAnalisi, schedaEPagellaAperte, schedaPerIlSito, statoCheApre } from '@/lib/agenzia/scheda-dopo-abbonamento';
import { primoMeseAncoraScontato } from '@/lib/agenzia/abbonamento-contanti';
import { abbonamentoIncluso } from '@/lib/agenzia/abbonamento-di-sdg';

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
 * misura usa allora solo i dati confermati della scheda; il sito misurato da Google PageSpeed e il giudizio
 * dell’AD sul sito sì (Nicola, 25/11/2026: «sì, anche nel link»), e dal 25/11 sera anche l'analisi dei social
 * (lettura di pagine pubbliche, con le fonti: `agenzia.social-come-il-sito`).
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
      // `*`: regge anche prima della migrazione 999 (senza `origine` ogni riga vale Stripe).
      .select('*')
      .eq('seller_id', idAttivita)
      .order('creato_il', { ascending: false })
      .limit(20),
    // 24/11/2026 — Per l'offerta su misura: la scheda di n8n (708) e l'analisi dei canali e del sito (711).
    // Tutte e due facoltative: se non ci sono, o la tabella manca, l'offerta si fa con la vetrina.
    admin.from('schede_clienti').select('scheda').eq('id_attivita', idAttivita).maybeSingle(),
    // 25/11/2026 — Nel link pubblico entra il sito misurato da Google PageSpeed (Nicola: «sì, anche nel
    // link»): è una misura di Google, non un dato da confermare. Dal 25/11 sera anche i social: sono pagine pubbliche.
    admin.from('analisi_negozi').select('sito, canali').eq('id_attivita', idAttivita).maybeSingle(),
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
  const canaliLetti = leggiAnalisiCanali(analisi?.canali);
  const schedaLettaIntera = schedaLetta.error ? null : leggiSchedaSalvata((schedaLetta.data as { scheda?: unknown } | null)?.scheda);
  // 25/11/2026 — La scheda del cliente vale solo dopo l'abbonamento (Nicola): prima, dell'offerta su
  // misura resta l'analisi (lib/agenzia/scheda-dopo-abbonamento.ts). Una lettura caduta vale «chiusa».
  const aperta = schedaEPagellaAperte({
    visibileSenzaAbbonamento: p.visibile_senza_abbonamento,
    statiAbbonamenti: abbonamento.error ? [] : ((abbonamento.data as Array<{ stato?: unknown; origine?: unknown }> | null) ?? []).map(statoCheApre),
  });
  // 25/11/2026 sera — Un sito noto conta come sito anche senza la misura di Google: oltre alla vetrina (dove lo scrive
  // anche il modulo 12) e alla misura, quello che il flusso 16 ha trovato (`campi.sito_ufficiale`), ma solo se è
  // confermato o se la scheda è aperta: prima dell'abbonamento un dato non confermato non decide frasi pubbliche.
  // Non entra fra i canali «che ci hai scritto»: il titolare non l'ha scritto (dal collaudo).
  const sitoTrovato = !!sitoMisurato || !!sitoUfficialeDi(aperta ? schedaLettaIntera : soloConfermati(schedaLettaIntera));
  // I profili trovati dall'analisi: mai «nessun profilo» se c'è, ma nemmeno «ci hai scritto Instagram».
  const profiliTrovati = (['instagram', 'facebook', 'tiktok'] as const)
    .filter((k) => ['fatta', 'privato'].includes(canaliLetti?.canali[k]?.stato ?? ''))
    .map((k) => ({ instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok' })[k]);
  const socialsPerIlConto = socials;
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
      sitoTrovato,
      profiliTrovati,
    },
    impostazioni: impostazioni.error
      ? colonnaAncoraAssente ? leggiImpostazioniAgenzia(null) : impostazioniSenzaPrezzi()
      : leggiImpostazioniAgenzia(impostazioni.data?.agenzia),
    adesso: new Date(),
    scelto,
    // 28/11/2026 — SDG ha il Premium per regola, senza pagarlo (Nicola): prima della tabella.
    attivo: abbonamentoIncluso(idAttivita) ?? abbonamentoAttivo(abbonamento),
    // Chi ha già avuto un abbonamento dei servizi non ha più il primo mese a metà (lo rifiuta anche la cassa).
    // 27/11/2026 — Quello in contanti in corso, sbloccato al «Sì» dell'agente, è il primo: lo sconto resta.
    primoMeseScontato: abbonamento.error ? true : primoMeseAncoraScontato((abbonamento.data as { stato?: string | null; origine?: string | null }[] | null) ?? []),
  });
  // L'armonia nascosta (28/11/2026): la firma del sito nasce dal giorno d'iscrizione, che non cambia mai.
  // `p.data` invece è «oggi»: con quello la bozza cambiava faccia da un giorno all'altro (collaudo del 28/11).
  preventivo.nascitaAttivita = typeof p.created_at === 'string' ? p.created_at.slice(0, 10) : null;
  // L'offerta su misura (24/11/2026): dalla vetrina, dalla scheda e dalle analisi. Un guasto qui non
  // ferma il preventivo: senza offerta la pagina mostra quello che mostrava prima.
  try {
    const schedaIntera = schedaPerIlSito(schedaLettaIntera, aperta);
    preventivo.offerta = offertaSuMisura({
      nome: preventivo.attivita,
      tipo: preventivo.tipoAttivita,
      dati: {
        storeLogo: (p.store_logo as string | null) ?? null,
        storeMedia: p.store_media,
        prodotti: (prodotti.data ?? []) as { images: unknown }[],
        socials: socialsPerIlConto,
      },
      // 25/11/2026 — Nicola: il preventivo si cuce sull'analisi, anche nel link. Nel link resta l'analisi
      // (punti di forza, idee, analisi del business con le sue fonti); dei campi solo quelli confermati.
      scheda: opzioni.pubblico ? conLAnalisi(soloConfermati(schedaIntera), schedaIntera) : schedaIntera,
      canali: canaliLetti,
      sito: sitoMisurato,
      // Il giudizio dell'AD sul sito vale anche nel link: è un parere su un sito pubblico, non un dato del titolare.
      giudizioSito: leggiGiudizioSito((schedaIntera?.analisi as Record<string, unknown> | undefined)?.giudizio_sito),
      analisiAziendale: analisiAziendale(schedaIntera),
      sitoTrovato,
    });
    // Il sito che si rifà in qualche fascia non è «già a posto»: la pagina del servizio non deve dire «ce l'hai già» (dal collaudo).
    if (preventivo.offerta.proposte.some((x) => x.id === 'sito-rifatto')) preventivo.giaAPosto = preventivo.giaAPosto.filter((x) => x !== 'sito_web');
    // 25/11/2026 — L'analisi del business (Nicola): è analisi, quindi c'è anche in demo e nel link.
    preventivo.analisiAziendale = analisiAziendale(schedaIntera);
    preventivo.analisiAziendaleStato = statoAnalisiBusiness(schedaIntera);
    preventivo.canali = canaliLetti;
    // 25/11/2026 — Il consiglio tiene conto del sito e dell'analisi (Nicola, «ok sito»).
    const consiglio = consigliataDallOfferta({ id: preventivo.consigliato, perche: preventivo.perche_consigliato }, preventivo.offerta);
    preventivo.consigliato = consiglio.id;
    preventivo.perche_consigliato = consiglio.perche;
  } catch (errore) {
    logger.warn('[preventivo] offerta su misura non preparata', { errore: String(errore) });
  }
  const telefono = (p.store_phone as string | null) || (p.phone as string | null) || null;
  return { preventivo, telefono, socials };
}

