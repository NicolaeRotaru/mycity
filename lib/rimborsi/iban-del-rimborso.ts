import { logger } from '@/lib/logger';
import { colonnaNonTrovata } from '@/lib/db/migrazione-148';
import { centesimiDelBonificoDalSegno, eUnBonificoDiRimborso } from './bonifici-da-fare';
import { ilBonificoCheIlClienteAspetta } from './bonifico-del-cliente';
import { formatPriceFromCents } from '@/lib/format';
import { rimborsiGiaScritti } from '@/lib/stripe/elenco-dei-rimborsi';
import { haUnaParteInContanti, pagatoInContanti, type OrdineDaRimborsare } from './regole-del-rimborso';
import { MESI_DEI_MESSAGGI_DEI_CONTATTI } from '@/lib/privacy/potature-ritenzione';

/** La pagina della lista dei bonifici (tolta il 17/10/2026: va via insieme a questo file). */
const PAGINA_DEI_BONIFICI_DA_FARE = '/admin/rimborsi-da-bonificare';

/**
 * La tabella dei bonifici dei reclami (162) non c'e'? PostgreSQL risponde 42P01,
 * PostgREST PGRST205. Spostata qui dalla lista dei bonifici, tolta il 17/10/2026:
 * va via insieme a questo file (semplificazione del rimborso dei contanti).
 */
function tabellaDeiBonificiMancante(errore: { code?: string; message?: string } | null | undefined): boolean {
  if (!errore) return false;
  if (errore.code === '42P01' || errore.code === 'PGRST205') return true;
  const testo = (errore.message ?? '').toLowerCase();
  return testo.includes('bonifici_dei_reclami') && (testo.includes('does not exist') || testo.includes('could not find'));
}

/**
 * QUANTO TENIAMO L'IBAN DI UN RIMBORSO (R71, riesame del 16/10).
 *
 * Chi paga in contanti e restituisce un prodotto ci lascia l'IBAN, e noi gli
 * facciamo il bonifico a mano. Prima l'IBAN restava sul reso per sempre: dopo
 * il bonifico, dopo un reso respinto, e anche dopo che il cliente aveva
 * cancellato l'account — su una riga che non portava piu' il suo nome ma il
 * suo conto si', con l'informativa che diceva «usato solo per quel bonifico».
 *
 * LA REGOLA, in una frase: l'IBAN si tiene SOLO finche' il bonifico e' da fare,
 * perche' rimborsare e' un obbligo di legge e per farlo serve il conto.
 *
 *  · Bonifico segnato fatto → l'IBAN si cancella (lo fa la rotta che segna
 *    «fatto», e la 162 non accetta un «fatto» con l'IBAN ancora scritto).
 *  · Reso chiuso senza bonifico — respinto, annullato, rimborsato col credito
 *    o sulla carta → il bonifico non ci sara' mai, l'IBAN si cancella.
 *  · Il cliente chiede di cancellare l'account con un bonifico ancora da fare →
 *    la cancellazione aspetta che il bonifico risulti fatto
 *    (`bonificiPrimaDiCancellare`, qui sotto). Riesame del 16/10, sesto giro:
 *    prima andava avanti e lasciava sul reso IBAN e nome dell'intestatario, e
 *    quel nome lo cercava fra i reclami aperti dalla persona — anche quelli di
 *    un negozio sull'ordine di un cliente.
 *  · Il cliente cancella l'account senza bonifici da fare → l'IBAN se ne va
 *    con l'account.
 *
 * La regola la possono cambiare Nicola e il legale: e' scritta qui, una volta
 * sola, e la informativa la legge da qui (`app/privacy/page.tsx`).
 */

/** Gli stati di un reso ancora in corso: il rimborso deve ancora arrivare. */
export const STATI_APERTI_DEL_RESO = ['REQUESTED', 'APPROVED', 'SHIPPED_BACK', 'RECEIVED'] as const;

/** Quello che serve sapere di un reso per decidere se il suo IBAN serve ancora. */
export interface RigaDelResoPerLIban {
  status: string | null | undefined;
  refund_id?: string | null;
  refund_method?: string | null;
  refund_bonifico_fatto_at?: string | null;
}

/**
 * Il bonifico di questo reso e' ancora da fare — adesso, o quando il reso
 * arrivera' in fondo?
 *
 *  · rimborsato col segno del bonifico e non ancora segnato fatto → si';
 *  · ancora in corso, e il cliente ha scelto il bonifico → si': quando il
 *    negozio rimborsa, il bonifico sara' dovuto;
 *  · ancora in corso SENZA una scelta, su un ordine pagato in contanti → si'
 *    (riesame del 16/10, terzo giro): nessuna scelta vuol dire bonifico, lo
 *    dicono la 162 e `comeTornanoIContanti`. Prima contava solo «BONIFICO»
 *    scritto: un reso aperto prima della 162, o da un modulo che non manda la
 *    scelta, alla cancellazione dell'account restava senza il nome di chi pagare.
 *    «In contanti» vuol dire con una parte pagata in contanti (`haUnaParteInContanti`): un
 *    ordine coperto tutto col credito MyCity torna credito (riesame del 16/10, quinto giro);
 *  · tutto il resto (fatto, respinto, annullato, credito, carta) → no.
 */
export function ilBonificoDelResoEAncoraDaFare(r: RigaDelResoPerLIban, ordineInContanti = false): boolean {
  if (r.refund_bonifico_fatto_at) return false;
  if (r.status === 'REFUNDED') return eUnBonificoDiRimborso(r.refund_id);
  if ((STATI_APERTI_DEL_RESO as readonly string[]).includes(String(r.status))) {
    return r.refund_method === 'BONIFICO' || (r.refund_method == null && ordineInContanti);
  }
  return false;
}

/** I campi che portano via il conto e il nome dal reso. */
export const IBAN_DEL_RESO_CANCELLATO = { refund_iban: null, refund_intestatario: null } as const;

/** I campi che portano via il conto e il nome dal bonifico di un reclamo. */
export const IBAN_DEL_RECLAMO_CANCELLATO = { iban: null, intestatario: null } as const;

// ── Le parole per chi legge: l'informativa e le impostazioni le prendono da qui ──

/** Un numero di mesi detto come lo direbbe una persona: 24 → «2 anni», 18 → «18 mesi». */
export function durataDetta(mesi: number): string {
  if (mesi % 12 === 0) return mesi === 12 ? '1 anno' : `${mesi / 12} anni`;
  return `${mesi} mesi`;
}

/** Quanto resta un messaggio dai Contatti: lo stesso numero che usa la potatura notturna. */
const QUANTO_RESTA_UN_MESSAGGIO = durataDetta(MESI_DEI_MESSAGGI_DEI_CONTATTI);

/** Dove chiediamo l'IBAN, davvero. */
export const DOVE_CHIEDIAMO_L_IBAN =
  "Nel modulo di reso, se scegli il bonifico. Per un reclamo — o se nel reso non l'hai scritto — " +
  "te lo chiediamo per email e ce lo mandi con un messaggio dalla pagina Contatti: quel messaggio " +
  `arriva anche nella casella email dell'assistenza e resta fra i messaggi dell'assistenza al massimo ${QUANTO_RESTA_UN_MESSAGGIO}. ` +
  "Chi fa il bonifico copia l'IBAN sulla richiesta di rimborso.";

/** Perché lo teniamo. */
export const PERCHE_TENIAMO_L_IBAN =
  'Obbligo di rimborsare il consumatore (Codice del Consumo, art. 56; art. 6.1.c GDPR) ed esecuzione del contratto (art. 6.1.b)';

/**
 * Quanto lo teniamo: è la regola qui sopra, detta a chi legge.
 *
 * Riesame del 16/10, terzo giro — la tabella diceva «fatto il bonifico, l'IBAN
 * si cancella» anche per l'IBAN mandato dai Contatti, che e' la strada di ogni
 * reclamo: quel messaggio invece resta fra i messaggi dell'assistenza fino alla
 * potatura notturna. Adesso la riga lo dice, con lo stesso numero della potatura.
 */
export const QUANTO_TENIAMO_L_IBAN =
  'Solo finché il bonifico è da fare. Quando il bonifico è fatto, o la richiesta si chiude senza bonifico, ' +
  "l'IBAN si cancella. Se cancelli l'account e non ti dobbiamo nessun bonifico, l'IBAN se ne va con l'account. " +
  "Se chiedi di cancellare l'account mentre ti dobbiamo ancora un bonifico, la cancellazione aspetta che il " +
  'bonifico risulti fatto. ' +
  "Se l'IBAN ce lo hai mandato con un messaggio dalla pagina Contatti, quel messaggio resta fra i messaggi " +
  `dell'assistenza al massimo ${QUANTO_RESTA_UN_MESSAGGIO}, come tutti i messaggi dei Contatti, e una copia ` +
  "arriva nella casella email dell'assistenza.";

/**
 * La frase per chi sta cancellando l'account: la regola qui sotto
 * (`attesaPerIBonifici`), detta prima di premere.
 */
export const SE_CANCELLI_L_ACCOUNT_CON_UN_BONIFICO_DA_FARE =
  'Se ti dobbiamo ancora un rimborso con un bonifico, o un reso o un reclamo ancora aperto su un tuo ordine ' +
  'pagato in contanti può finire con un bonifico, la cancellazione aspetta che ogni bonifico che ti dobbiamo ' +
  "risulti fatto: così, se ti dobbiamo dei soldi, ti arrivano prima che l'account si chiuda. Se ti dobbiamo un " +
  'bonifico e non ci hai ancora dato il tuo IBAN, mandacelo con un messaggio dalla pagina Contatti.';

// ── Prima di cancellare un account: i bonifici che gli dobbiamo ─────────────────

/**
 * RIESAME DEL 16/10, SESTO GIRO — UNA REGOLA SOLA.
 *
 * La cancellazione di un account aspetta finche' su un ordine di quella persona (`orders.user_id`:
 * chi deve ricevere i soldi, mai chi ha aperto un reclamo) c'e' un bonifico di rimborso non segnato
 * fatto, o un reso ancora aperto in contanti che puo' finire con un bonifico.
 *
 * Il bonifico lo dice l'elenco dei rimborsi dell'ordine (i segni `bonifico:<centesimi>:<chiave>`,
 * che scrive solo il server e che c'e' anche senza la migrazione 162). Il «fatto» sta sul reso o
 * sulla riga del reclamo, ed e' la regola della pagina dell'ordine (`ilBonificoCheIlClienteAspetta`).
 *
 * Quando non si puo' sapere — manca la 162, manca la riga dove si segna «fatto», o un reso o un
 * reclamo parlano di un bonifico che l'ordine non ha — non si indovina: la cancellazione si ferma
 * come per un guasto, e chi amministra viene avvisato.
 *
 * Prima qui c'erano tre regole: i reclami cercati per chi li aveva aperti, i resi per chi li aveva
 * chiesti, e senza la 162 nessun bonifico. Un account con 40 € da restituire si cancellava, e il
 * nome di un negozio finiva sul bonifico di un suo cliente.
 *
 * Settimo giro (collaudo del 16/10):
 *  · anche un RECLAMO ancora aperto su un suo ordine in contanti fa aspettare, come un reso aperto:
 *    chiuso a favore della persona, finisce con un bonifico. Prima la cancellazione andava avanti, e
 *    il bonifico nasceva dopo, senza nome e senza telefono; se il reclamo l'aveva aperto lei,
 *    spariva insieme al suo profilo (`disputes.opener_id` → ON DELETE CASCADE);
 *  · il bonifico di un reclamo scritto sull'ordine ma senza la sua riga in `bonifici_dei_reclami`
 *    (chiuso prima della 162, o la scrittura della riga era caduta) non resta fermo per sempre: con
 *    la 162 la riga si rimette dal segno sull'ordine (`bonificiDeiReclamiDaRimettere`), e il
 *    bonifico entra nella lista dove si segna «fatto». Prima nessuna pagina lo mostrava, il «fatto»
 *    rispondeva 409, e la notte restava rossa ogni notte.
 */
export const MOTIVO_BONIFICO_DA_FARE = 'bonifico_da_fare' as const;

/** Gli stati di un reclamo ancora da decidere (migrations/027): puo' finire con un rimborso. */
export const STATI_APERTI_DEL_RECLAMO = ['open', 'under_review'] as const;

/** Un ordine della persona, con quello che serve per sapere se ha bonifici. */
export interface OrdineDellaPersona extends OrdineDaRimborsare {
  id: string;
  stripe_refund_id?: string | null;
}

/** Un reso della persona. Le colonne della 162 mancano se la 162 non c'e'. */
export interface ResoDellaPersona {
  id: string;
  order_id: string;
  status: string | null;
  refund_id?: string | null;
  refund_method?: string | null;
  refund_bonifico_fatto_at?: string | null;
  refund_iban?: string | null;
}

/** Una riga di `bonifici_dei_reclami` su un suo ordine (162). */
export interface BonificoDelReclamoDellaPersona {
  dispute_id: string;
  order_id: string;
  fatto_at?: string | null;
}

/** Un reclamo su un suo ordine, chiunque l'abbia aperto: lo stato dice se e' ancora da decidere. */
export interface ReclamoSullOrdineDellaPersona {
  id: string;
  order_id: string;
  status: string | null;
}

/** Quello che fa aspettare la cancellazione. */
export interface BonificiDaFare {
  /** Quanto gli dobbiamo ancora col bonifico, dall'elenco dei rimborsi dei suoi ordini. */
  centesimi: number;
  /** Quanti bonifici, o ordini con bonifici, di cui non si puo' sapere se sono stati fatti. */
  incerti: number;
  /** Resi ancora aperti su ordini pagati in contanti che possono finire con un bonifico. */
  resiAperti: number;
  /** Reclami ancora aperti su ordini pagati in contanti: decisi a suo favore, finiscono col bonifico. */
  reclamiAperti: number;
  /** La 162 c'e'? Senza, nessun «fatto» si puo' leggere. */
  con162: boolean;
}

/** La chiave di un segno `bonifico:<centesimi>:<chiave>`. */
function chiaveDelBonifico(segno: string): string {
  return segno.replace(/^bonifico:\d+:/, '');
}

/** Una riga di `bonifici_dei_reclami` da rimettere: quella che la rotta dei reclami scrive (resolve). */
export interface BonificoDelReclamoDaRimettere {
  dispute_id: string;
  order_id: string;
  importo_cents: number;
}

/**
 * I bonifici dei reclami scritti sui suoi ordini che non hanno la loro riga in `bonifici_dei_reclami`.
 *
 * Succede quando il reclamo si e' chiuso col bonifico prima della 162 (la tabella non c'era: resta
 * solo il segno sull'ordine), o quando la scrittura della riga e' caduta. Senza la riga il bonifico
 * non compare nella lista e nessuno lo puo' segnare fatto. La riga si rimette dal segno, che porta la
 * cifra e che scrive solo il server (`refundOrder`): la stessa riga che avrebbe scritto la chiusura
 * del reclamo. Funzione pura: la scrittura sta in `bonificiPrimaDiCancellare`.
 */
export function bonificiDeiReclamiDaRimettere(
  ordini: readonly OrdineDellaPersona[],
  reclami: readonly BonificoDelReclamoDellaPersona[],
): BonificoDelReclamoDaRimettere[] {
  const presenti = new Set(reclami.map((r) => r.dispute_id));
  const daRimettere = new Map<string, BonificoDelReclamoDaRimettere>();
  for (const o of ordini) {
    for (const segno of rimborsiGiaScritti(o)) {
      if (!eUnBonificoDiRimborso(segno)) continue;
      const chiave = chiaveDelBonifico(segno);
      if (!chiave.startsWith('dispute_')) continue;
      const disputeId = chiave.slice('dispute_'.length);
      const centesimi = centesimiDelBonificoDalSegno(segno);
      if (!disputeId || centesimi == null || centesimi <= 0) continue;
      if (presenti.has(disputeId) || daRimettere.has(disputeId)) continue;
      daRimettere.set(disputeId, { dispute_id: disputeId, order_id: o.id, importo_cents: centesimi });
    }
  }
  return [...daRimettere.values()];
}

/** LA REGOLA, su quello che la persona ha. Funzione pura: la lettura sta in `bonificiPrimaDiCancellare`. */
export function iBonificiCheFannoAspettare(dati: {
  ordini: readonly OrdineDellaPersona[];
  resi: readonly ResoDellaPersona[];
  reclami: readonly BonificoDelReclamoDellaPersona[];
  /** I reclami sui suoi ordini (`disputes`), per sapere quali sono ancora aperti. */
  reclamiSugliOrdini?: readonly ReclamoSullOrdineDellaPersona[];
  con162: boolean;
}): BonificiDaFare {
  const ordinePer = new Map(dati.ordini.map((o) => [o.id, o]));
  // Solo i suoi ordini: un reso o un reclamo su un ordine di un altro non e' un debito verso di lei.
  const resi = dati.resi.filter((r) => ordinePer.has(r.order_id));
  const reclami = dati.reclami.filter((b) => ordinePer.has(b.order_id));
  const b: BonificiDaFare = { centesimi: 0, incerti: 0, resiAperti: 0, reclamiAperti: 0, con162: dati.con162 };

  // ① I bonifici scritti sui suoi ordini, contati come li conta la pagina dell'ordine.
  const sullOrdine = new Set<string>();
  for (const o of dati.ordini) {
    for (const segno of rimborsiGiaScritti(o)) if (eUnBonificoDiRimborso(segno)) sullOrdine.add(chiaveDelBonifico(segno));
    const conto = ilBonificoCheIlClienteAspetta({
      ordine: o,
      resi: resi.filter((r) => r.order_id === o.id),
      reclami: reclami.filter((r) => r.order_id === o.id),
      con162: dati.con162,
    });
    if (conto.daFareCents <= 0) continue;
    b.centesimi += conto.daFareCents;
    if (!conto.certo) b.incerti += 1;
  }

  // ② Un reso o un reclamo con un bonifico che l'ordine non ha, non segnato fatto: non si sa.
  for (const r of resi) {
    if (!eUnBonificoDiRimborso(r.refund_id) || sullOrdine.has(`return_${r.id}`)) continue;
    if (!(dati.con162 && r.refund_bonifico_fatto_at)) b.incerti += 1;
  }
  for (const riga of reclami) {
    if (!sullOrdine.has(`dispute_${riga.dispute_id}`) && !riga.fatto_at) b.incerti += 1;
  }

  // ③ I resi ancora aperti che possono finire con un bonifico.
  for (const r of resi) {
    if (!(STATI_APERTI_DEL_RESO as readonly string[]).includes(String(r.status))) continue;
    if (sullOrdine.has(`return_${r.id}`) || eUnBonificoDiRimborso(r.refund_id)) continue;
    if (ilBonificoDelResoEAncoraDaFare(r, haUnaParteInContanti(ordinePer.get(r.order_id)!))) b.resiAperti += 1;
  }

  // ④ I reclami ancora aperti sui suoi ordini in contanti: decisi a suo favore, finiscono col bonifico.
  for (const d of dati.reclamiSugliOrdini ?? []) {
    const o = ordinePer.get(d.order_id);
    if (!o || !haUnaParteInContanti(o)) continue;
    if ((STATI_APERTI_DEL_RECLAMO as readonly string[]).includes(String(d.status))) b.reclamiAperti += 1;
  }
  return b;
}

/** «un reso», «2 resi e un reclamo»: le cose ancora aperte, contate. */
function cosaEAncoraAperto(b: BonificiDaFare, un: (n: number, uno: string, tanti: string) => string): string | null {
  const pezzi = [
    b.resiAperti > 0 ? un(b.resiAperti, 'un reso', 'resi') : null,
    b.reclamiAperti > 0 ? un(b.reclamiAperti, 'un reclamo', 'reclami') : null,
  ].filter((p): p is string => !!p);
  return pezzi.length > 0 ? pezzi.join(' e ') : null;
}

/** Quello che resta da fare a chi amministra, in una riga corta: la pagina la mostra intera. */
export function rinvioPerChiAmministra(b: BonificiDaFare): string {
  if (b.incerti > 0) {
    return b.con162
      ? 'Cancellazione ferma: un bonifico di rimborso di questa persona è registrato solo in parte, fra ordine e reso o reclamo, e non si sa se è stato fatto. Va controllato a mano.'
      : // Settimo giro: applicata la 162, il prossimo tentativo sa leggere il «fatto» e rimette nella
        // lista i bonifici dei reclami rimasti solo sull'ordine. Prima la frase lo lasciava intendere
        // anche quando, per i reclami, la 162 da sola non bastava.
        'Cancellazione ferma: questa persona ha avuto un rimborso col bonifico e, finché sul database manca la migrazione 162, non si sa se è stato fatto. Applicata la 162, riprova.';
  }
  const frasi = ['Cancellazione rinviata:'];
  if (b.centesimi > 0) {
    frasi.push(`le dobbiamo ${formatPriceFromCents(b.centesimi)} col bonifico: fallo e segnalo fatto in «Rimborsi da bonificare».`);
  }
  const aperti = cosaEAncoraAperto(b, (n, uno, tanti) => (n > 1 ? `${n} ${tanti}` : uno));
  if (aperti) {
    const dove = b.resiAperti + b.reclamiAperti > 1 ? 'aperti su ordini' : 'aperto su un ordine';
    frasi.push(`${b.centesimi > 0 ? 'Ha anche' : 'ha'} ${aperti} ${dove} in contanti, da chiudere.`);
  }
  frasi.push('Poi riprova.');
  return frasi.join(' ');
}

/** Il rinvio detto alla persona: lo legge nell'avviso del giro notturno (lib/cron-cancellazioni.ts). */
export function rinvioPerLaPersona(b: BonificiDaFare): string {
  const frasi = ['Cancellazione rinviata:'];
  if (b.centesimi > 0) frasi.push(`ti dobbiamo ancora ${formatPriceFromCents(b.centesimi)} di rimborso con un bonifico.`);
  const aperti = cosaEAncoraAperto(b, (n, uno, tanti) => (n > 1 ? `dei ${tanti}` : uno));
  if (aperti) {
    const dove = b.resiAperti + b.reclamiAperti > 1 ? 'ancora aperti su ordini pagati' : 'ancora aperto su un ordine pagato';
    frasi.push(`${b.centesimi > 0 ? 'Hai anche' : 'hai'} ${aperti} ${dove} in contanti: se ti rimborsiamo, sarà con un bonifico.`);
  }
  frasi.push(
    'La cancellazione riparte da sola quando non ci saranno più bonifici da farti: così, se ti dobbiamo dei soldi, ' +
      "ti arrivano prima che l'account si chiuda. Se non ci hai ancora dato il tuo IBAN, mandacelo con un messaggio dalla pagina " +
      "Contatti, indicando il numero dell'ordine.",
  );
  return frasi.join(' ');
}

/**
 * Cosa fa la cancellazione con questi bonifici: `null` = niente da aspettare. Se qualcosa non si
 * puo' sapere, NON c'e' un motivo: per il giro notturno e' un guasto, e un guasto sveglia chi
 * amministra (lib/cron-cancellazioni.ts). Se no aspetta con un motivo suo, e la persona legge perche'.
 */
export function attesaPerIBonifici(
  b: BonificiDaFare,
): { motivo?: typeof MOTIVO_BONIFICO_DA_FARE; errore: string } | null {
  if (b.incerti > 0) return { errore: rinvioPerChiAmministra(b) };
  if (b.centesimi > 0 || b.resiAperti > 0 || b.reclamiAperti > 0) {
    return { motivo: MOTIVO_BONIFICO_DA_FARE, errore: rinvioPerLaPersona(b) };
  }
  return null;
}

/**
 * L'avviso a chi amministra quando la cancellazione rimette nella lista il bonifico di un reclamo
 * rimasto solo sull'ordine. Quel bonifico, prima, si pagava partendo da un avviso nella campanella
 * (senza la 162, o col «tienine il conto a parte» quando la riga non si scriveva): adesso compare
 * fra i bonifici da fare, e chi l'ha gia' pagato non lo deve pagare due volte.
 */
export function avvisoDelBonificoDelReclamoRimesso(r: BonificoDelReclamoDaRimettere): {
  titolo: string;
  testo: string;
  link: string;
} {
  return {
    titolo: '💶 Un bonifico di un reclamo è tornato nella lista',
    testo:
      `Il bonifico di ${formatPriceFromCents(r.importo_cents)} del reclamo sull'ordine #${r.order_id.slice(0, 8)} ` +
      "era scritto solo sull'ordine, fuori dalla lista dei bonifici da fare. Il cliente ha chiesto di cancellare " +
      "l'account, e la cancellazione aspetta questo bonifico: adesso è nella lista. Se l'avevi già fatto " +
      'partendo da un avviso, non pagarlo di nuovo: segnalo fatto.',
    link: PAGINA_DEI_BONIFICI_DA_FARE,
  };
}

// ── Le scritture ─────────────────────────────────────────────────────────────

/**
 * Il client si accetta «largo» e si restringe qui dentro, come in
 * `scelta-del-reso.ts`: il tipo completo del client di Supabase, confrontato con
 * quelli stretti, manda in giro il controllore dei tipi senza fine.
 */
type ClientLargo = { from(tabella: string): unknown };
type Errore = { code?: string; message?: string } | null;
type Risposta = PromiseLike<{ data?: unknown; error: Errore }>;

/** La catena di filtri minima che usano le scritture e le letture qui sotto. */
interface Catena extends Risposta {
  eq(colonna: string, valore: unknown): Catena;
  in(colonna: string, valori: readonly unknown[]): Catena;
  is(colonna: string, valore: null): Catena;
  maybeSingle(): Risposta;
}
interface Tabella {
  select(colonne: string): Catena;
  update(valori: Record<string, unknown>): Catena;
  insert(valori: readonly Record<string, unknown>[]): Risposta;
}
const tabella = (admin: ClientLargo, nome: string) => admin.from(nome) as Tabella;

export type EsitoDellIban = 'tenuto' | 'cancellato' | 'niente-da-togliere' | 'senza-162' | 'errore';

/**
 * Dopo che un reso ha cambiato stato: se il suo bonifico non ci sara' piu',
 * l'IBAN (e il nome, se c'era) se ne vanno.
 *
 * Lo chiamano le rotte che chiudono un reso (`decide`, `avanza`). Non lancia
 * mai: un guasto qui finisce nei log e non disfa una decisione gia' presa — al
 * peggio l'IBAN resta fino al giro notturno delle potature, che lo riprende
 * (`potaLIbanDeiResiChiusi` in lib/privacy/potature-ritenzione.ts, terzo giro
 * del riesame), ma i soldi del cliente non si toccano. Senza la migrazione 162
 * non c'e' nessun IBAN da togliere.
 */
export async function dimenticaLIbanSeNonServe(
  admin: ClientLargo,
  returnId: string,
): Promise<{ esito: EsitoDellIban; errore?: string }> {
  try {
    const { data, error } = await tabella(admin, 'returns')
      .select('status, refund_id, refund_method, refund_bonifico_fatto_at, refund_iban, refund_intestatario')
      .eq('id', returnId)
      .maybeSingle();
    if (error) {
      if (colonnaNonTrovata(error)) return { esito: 'senza-162' };
      logger.error('[iban del rimborso] reso non letto: l IBAN resta per ora', { returnId, message: error.message });
      return { esito: 'errore', errore: error.message };
    }
    const riga = data as (RigaDelResoPerLIban & { refund_iban?: string | null; refund_intestatario?: string | null }) | null;
    if (!riga) return { esito: 'niente-da-togliere' };
    if (ilBonificoDelResoEAncoraDaFare(riga)) return { esito: 'tenuto' };
    if (!riga.refund_iban && !riga.refund_intestatario) return { esito: 'niente-da-togliere' };

    const { error: errScrittura } = await tabella(admin, 'returns')
      .update({ ...IBAN_DEL_RESO_CANCELLATO })
      .eq('id', returnId)
      .eq('status', String(riga.status));
    if (errScrittura) {
      if (colonnaNonTrovata(errScrittura)) return { esito: 'senza-162' };
      logger.error('[iban del rimborso] IBAN non cancellato', { returnId, message: errScrittura.message });
      return { esito: 'errore', errore: errScrittura.message };
    }
    return { esito: 'cancellato' };
  } catch (e) {
    const errore = e instanceof Error ? e.message : 'errore';
    logger.error('[iban del rimborso] IBAN non cancellato', { returnId, errore });
    return { esito: 'errore', errore };
  }
}

/**
 * PRIMA DI CANCELLARE UN ACCOUNT: legge i suoi ordini, i suoi resi, i bonifici dei reclami sui suoi
 * ordini e i reclami ancora aperti, e applica la regola (`iBonificiCheFannoAspettare`). Se non c'e'
 * niente da aspettare, l'IBAN dei suoi resi se ne va adesso: dopo, senza piu' il legame con la
 * persona, non lo ritroverebbe nessuno.
 *
 * L'unica scrittura quando c'e' da aspettare (settimo giro): con la 162, il bonifico di un reclamo
 * scritto sull'ordine senza la sua riga in `bonifici_dei_reclami` riceve la riga
 * (`bonificiDeiReclamiDaRimettere`). Senza, nessuno lo potrebbe segnare fatto e la cancellazione
 * resterebbe ferma per sempre. Le righe rimesse tornano in `rimessi`: chi chiama avvisa chi
 * amministra (lib/account/cancellazione.ts), perche' quel bonifico forse l'ha gia' pagato da un avviso.
 *
 * Se una lettura o una scrittura cade, la risposta e' «fermati»: la cancellazione si rinvia e
 * domani si riprova.
 */
export async function bonificiPrimaDiCancellare(
  admin: ClientLargo,
  userId: string,
): Promise<
  | { ok: true; bonifici: BonificiDaFare; ibanCancellati: number; rimessi: BonificoDelReclamoDaRimettere[] }
  | { ok: false; errore: string }
> {
  const fermati = (perche: string) => {
    logger.error('[cancellazione] bonifici di rimborso non controllati', { userId, perche });
    return { ok: false as const, errore: perche };
  };

  try {
    const ordini = await tabella(admin, 'orders')
      .select('id, payment_method, stripe_payment_intent, total_price, stripe_refund_id')
      .eq('user_id', userId);
    if (ordini.error) return fermati(`ordini: ${ordini.error.message}`);
    const righeOrdini = (ordini.data ?? []) as OrdineDellaPersona[];

    // Senza la 162 le sue colonne non ci sono: si rilegge con quelle di sempre, e nessun «fatto» si sa.
    let con162 = true;
    let resi = await tabella(admin, 'returns')
      .select('id, order_id, status, refund_id, refund_method, refund_bonifico_fatto_at, refund_iban')
      .eq('buyer_id', userId);
    if (resi.error && colonnaNonTrovata(resi.error)) {
      con162 = false;
      resi = await tabella(admin, 'returns').select('id, order_id, status, refund_id').eq('buyer_id', userId);
    }
    if (resi.error) return fermati(`resi: ${resi.error.message}`);
    const righeResi = (resi.data ?? []) as ResoDellaPersona[];

    // I bonifici dei reclami nascono sugli ordini in contanti; si guardano anche gli ordini che ne
    // portano il segno, perche' un segno senza la sua riga non resti invisibile.
    let righeReclami: BonificoDelReclamoDellaPersona[] = [];
    let rimessi: BonificoDelReclamoDaRimettere[] = [];
    const daGuardare = righeOrdini
      .filter((o) => pagatoInContanti(o) || [...rimborsiGiaScritti(o)].some((s) => eUnBonificoDiRimborso(s)))
      .map((o) => o.id);
    if (daGuardare.length > 0) {
      const leggiReclami = () =>
        tabella(admin, 'bonifici_dei_reclami').select('dispute_id, order_id, fatto_at').in('order_id', daGuardare);
      const reclami = await leggiReclami();
      if (reclami.error && !tabellaDeiBonificiMancante(reclami.error)) {
        return fermati(`bonifici dei reclami: ${reclami.error.message}`);
      }
      if (reclami.error) con162 = false;
      else righeReclami = (reclami.data ?? []) as BonificoDelReclamoDellaPersona[];

      const daRimettere = con162 ? bonificiDeiReclamiDaRimettere(righeOrdini, righeReclami) : [];
      if (daRimettere.length > 0) {
        const scritte = await tabella(admin, 'bonifici_dei_reclami').insert(daRimettere.map((r) => ({ ...r })));
        // 23505: un altro giro l'ha appena scritta. Non e' un guasto: si rilegge.
        if (scritte.error && scritte.error.code !== '23505') {
          return fermati(`bonifici dei reclami da rimettere nella lista: ${scritte.error.message}`);
        }
        if (!scritte.error) rimessi = daRimettere;
        const riletti = await leggiReclami();
        if (riletti.error) return fermati(`bonifici dei reclami: ${riletti.error.message}`);
        righeReclami = (riletti.data ?? []) as BonificoDelReclamoDellaPersona[];
      }
    }

    // I reclami ancora aperti sui suoi ordini in contanti: possono finire con un bonifico.
    let reclamiSugliOrdini: ReclamoSullOrdineDellaPersona[] = [];
    const conContanti = righeOrdini.filter((o) => haUnaParteInContanti(o)).map((o) => o.id);
    if (conContanti.length > 0) {
      const aperti = await tabella(admin, 'disputes')
        .select('id, order_id, status')
        .in('order_id', conContanti)
        .in('status', STATI_APERTI_DEL_RECLAMO);
      if (aperti.error) return fermati(`reclami aperti: ${aperti.error.message}`);
      reclamiSugliOrdini = (aperti.data ?? []) as ReclamoSullOrdineDellaPersona[];
    }

    const bonifici = iBonificiCheFannoAspettare({
      ordini: righeOrdini,
      resi: righeResi,
      reclami: righeReclami,
      reclamiSugliOrdini,
      con162,
    });
    if (attesaPerIBonifici(bonifici)) return { ok: true, bonifici, ibanCancellati: 0, rimessi };

    const conIban = righeResi.filter((r) => r.refund_iban).map((r) => r.id);
    if (conIban.length > 0) {
      const { error } = await tabella(admin, 'returns')
        .update({ ...IBAN_DEL_RESO_CANCELLATO })
        .eq('buyer_id', userId)
        .in('id', conIban);
      if (error) return fermati(`IBAN dei resi: ${error.message}`);
    }
    return { ok: true, bonifici, ibanCancellati: conIban.length, rimessi };
  } catch (e) {
    return fermati(e instanceof Error ? e.message : 'errore');
  }
}
