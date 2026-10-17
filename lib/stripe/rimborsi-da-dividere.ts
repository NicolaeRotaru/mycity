/**
 * I rimborsi dal cruscotto Stripe da dividere fra i negozi di un carrello: la
 * lista per il pannello e la divisione vera.
 *
 * 16/10/2026 — Su un pagamento di più negozi il webhook ferma i bonifici del
 * carrello (`internal_dispute_status = 'RIMBORSO_DA_RIPARTIRE'`) e chiede di
 * dividere il rimborso a mano. Nessuna pagina e nessuna rotta sapeva farlo: i
 * bonifici si sbloccavano solo scrivendo nel database. Qui la divisione usa la
 * stessa contabilità del rimborso su un ordine solo (`registraSullOrdine`):
 * importo rimborsato, quota del negozio tolta dal bonifico che deve ancora
 * partire — o ripresa con uno storno se è già partito. La pausa si toglie a
 * tutto il carrello quando tutte le parti sono scritte (`dividiIlRimborso`).
 * Le regole su quello che chi amministra scrive stanno in
 * `lib/rimborsi/divisione-del-rimborso.ts`.
 */
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { writeAudit, type AuditAction } from '@/lib/audit';
import { idDaChiave } from '@/lib/stripe/webhook/comune';
import {
  daFuoriDaRegistrare,
  elencoDeiRimborsi,
  etichettaComeRegistrati,
  fermaIBonifici,
  PAUSA_RIMBORSO_DA_DIVIDERE,
  registraSullOrdine,
  rimborsiGiaScritti,
  sommaDeiRimborsiDaFuori,
  type OrdineDelRimborso,
  type RimborsoStripe,
} from '@/lib/stripe/webhook/rimborsi-da-fuori';
import { avvisaDegliStorniNonConfermati } from '@/lib/stripe/storno-senza-esito';
import { controllaLaDivisione, type ParteDelRimborso } from '@/lib/rimborsi/divisione-del-rimborso';

// 16/10 (riesame) — `stripe_refund_id`: dice quali rimborsi dal cruscotto una divisione
// precedente ha già scritto sugli ordini (vedi `rimborsiDaEtichettare`).
// 16/10 (settimo riesame) — `reversal_error`: dice se uno storno chiesto non è mai stato confermato.
const COLONNE =
  'id, seller_id, total_price, refunded_amount_cents, payout_status, stripe_payment_intent, stripe_transfer_id, ' +
  'stripe_reversal_id, stripe_refund_id, seller_payout_cents, seller_payout_reversed_cents, internal_dispute_status, reversal_error';

type OrdineDelCarrello = OrdineDelRimborso & {
  seller_id: string | null;
  stripe_payment_intent: string | null;
  internal_dispute_status: string | null;
};

export type ContoDaDividere = {
  /** Quanto dividere adesso: uscito da fuori e non scritto su nessun ordine. */
  daDividereCents: number;
  /** Rimborsato su Stripe meno rimborsato sul nostro database, per tutto il pagamento. */
  mancanteCents: number;
  /** La somma dei rimborsi da fuori non ancora registrati. */
  daFuoriCents: number;
};

/**
 * Lo stesso conto con cui il webhook ha fermato i bonifici: quello che manca
 * sul database per tutto il pagamento, ma mai più dei rimborsi da fuori non
 * ancora registrati (un rimborso nostro la cui risposta si è persa non si
 * divide: lo ritrova `refundOrder`).
 */
export function contoDaDividere(
  ordini: ReadonlyArray<Pick<OrdineDelRimborso, 'refunded_amount_cents'>>,
  rimborsi: ReadonlyArray<RimborsoStripe>,
): ContoDaDividere {
  const suStripe = rimborsi
    .filter((r) => r.status !== 'failed' && r.status !== 'canceled')
    .reduce((somma, r) => somma + Math.max(0, r.amount ?? 0), 0);
  const registrato = ordini.reduce((somma, o) => somma + (o.refunded_amount_cents ?? 0), 0);
  const mancanteCents = suStripe - registrato;
  const daFuoriCents = sommaDeiRimborsiDaFuori(rimborsi);
  return { daDividereCents: Math.max(0, Math.min(mancanteCents, daFuoriCents)), mancanteCents, daFuoriCents };
}

/**
 * Quanto resta da dividere su un carrello appena riaperto: lo stesso conto con
 * cui il webhook ferma i bonifici quando nessun ordine è fermo — quello che
 * manca sul database, ma mai più dei rimborsi da fuori che nessun ordine ha
 * ancora scritto nel suo elenco.
 *
 * 16/10/2026 (settimo riesame del lotto) — UN RIMBORSO USCITO MENTRE SI DIVIDEVA
 * SPARIVA. Carrello del pane (15,00 €) e dei fiori (12,90 €, bonifico già
 * partito); dal cruscotto escono 3 €, chi amministra li dà ai fiori. Mentre la
 * divisione chiede a Stripe lo storno dei fiori, dal cruscotto escono altri 2 €:
 * il loro avviso trova il carrello già fermo e non cambia niente. Poi la
 * divisione toglie la pausa a tutto il carrello: 5 € usciti, 3 € scritti, il
 * pannello vuoto e i due bonifici ripartiti pieni. Adesso, tolta la pausa, la
 * divisione rilegge ordini e rimborsi e rifà questo conto: se resta qualcosa,
 * il carrello torna fermo e nel pannello. Rileggere DOPO aver tolto la pausa
 * chiude la finestra: un rimborso che Stripe fa dopo la rilettura arriva con un
 * avviso che trova il carrello senza pausa, e la rimette lui.
 */
export function restaDaDividere(
  ordini: ReadonlyArray<Pick<OrdineDelRimborso, 'refunded_amount_cents' | 'stripe_refund_id'>>,
  rimborsi: ReadonlyArray<RimborsoStripe>,
): number {
  const scritti = new Set<string>();
  for (const o of ordini) for (const id of rimborsiGiaScritti(o)) scritti.add(id);
  const { mancanteCents } = contoDaDividere(ordini, rimborsi);
  const daFuori = sommaDeiRimborsiDaFuori(rimborsi.filter((r) => !(r.id && scritti.has(r.id))));
  return Math.max(0, Math.min(mancanteCents, daFuori));
}

const lordoCents = (o: Pick<OrdineDelRimborso, 'total_price'>) => Math.round(Number(o.total_price ?? 0) * 100);

/**
 * Il pagamento ha un rimborso dal cruscotto che aspetta ancora di essere
 * diviso fra i negozi? Lo dice la pausa su uno qualunque dei suoi ordini.
 */
export function aspettaLaDivisione(ordini: ReadonlyArray<{ internal_dispute_status?: string | null }>): boolean {
  return ordini.some((o) => o.internal_dispute_status === PAUSA_RIMBORSO_DA_DIVIDERE);
}

/** Il minimo che serve per leggere gli ordini: così una prova può passarne uno finto. */
type LettoreDegliOrdini = Pick<ReturnType<typeof getAdminSupabase>, 'from'>;

/**
 * 16/10/2026 (riesame del lotto) — PRIMA SI DIVIDE, POI SI ANNULLA.
 *
 * Su un carrello di più negozi il rimborso fatto dal cruscotto non è scritto su
 * nessun ordine finché qualcuno non lo divide: per l'annullo l'ordine risultava
 * «pagato e mai rimborsato», e si chiedeva a Stripe il lordo intero. Un caso:
 * Pane Quotidiano 27,90 € e un fioraio 30,00 € sullo stesso pagamento, 3 € di
 * focaccia resi dal cruscotto, poi Pane Quotidiano non accetta. Il giro lo
 * annullava chiedendo 27,90 €, Stripe li dava (sul pagamento ne restavano
 * 54,90), e il cliente riceveva 30,90 € per un ordine da 27,90. Poi i 3 € da
 * dividere si potevano mettere solo sul fioraio, che non c'entrava.
 *
 * Quanto rendere all'annullo si sa solo a divisione fatta: fino ad allora chi
 * annulla con la carta su quel pagamento aspetta.
 *
 * Si guarda prima la pausa dell'ordine stesso (letta con l'ordine), poi quella
 * degli altri ordini dello stesso pagamento: un ordine con un altro stato (un
 * reclamo) non riceve la pausa, ma i soldi da dividere possono essere suoi. Se
 * il database non risponde alla seconda domanda, vale la prima: la pausa la
 * mette il webhook su tutti gli ordini pagabili del carrello insieme.
 */
export async function ilCarrelloAspettaLaDivisione(
  admin: LettoreDegliOrdini,
  ordine: { id: string; stripe_payment_intent?: string | null; internal_dispute_status?: string | null },
): Promise<boolean> {
  if (aspettaLaDivisione([ordine])) return true;
  if (!ordine.stripe_payment_intent) return false;
  try {
    const { data, error } = await admin
      .from('orders')
      .select('id, internal_dispute_status')
      .eq('stripe_payment_intent', ordine.stripe_payment_intent)
      .eq('internal_dispute_status', PAUSA_RIMBORSO_DA_DIVIDERE)
      .limit(1);
    if (error) throw new Error(error.message);
    return aspettaLaDivisione((data ?? []) as Array<{ internal_dispute_status?: string | null }>);
  } catch (err) {
    logger.warn('[rimborso da dividere] pausa degli altri ordini del carrello non letta: vale quella dell ordine', {
      orderId: ordine.id, message: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

async function ordiniDelPagamento(pagamento: string): Promise<OrdineDelCarrello[]> {
  const { data, error } = await getAdminSupabase().from('orders').select(COLONNE).eq('stripe_payment_intent', pagamento);
  if (error) throw new Error(`ordini del pagamento non letti: ${error.message}`);
  return (data ?? []) as unknown as OrdineDelCarrello[];
}

export type CarrelloDaDividere = {
  pagamento: string;
  daDividereCents: number;
  ordini: Array<{
    id: string;
    negozio: string;
    lordoCents: number;
    giaRimborsatoCents: number;
    restaCents: number;
    bonificoPartito: boolean;
    /** Il suo bonifico è fermo per questo rimborso (la sua parte va scritta, anche zero). */
    fermo: boolean;
  }>;
};

/** Un pagamento fermo che Stripe, adesso, non ha lasciato leggere. */
export type CarrelloNonLetto = { pagamento: string; motivo: string };

export type ElencoDaDividere = {
  carrelli: CarrelloDaDividere[];
  /**
   * 16/10/2026 (riesame del lotto) — UN PAGAMENTO CHE NON SI LEGGE NON SPEGNE GLI ALTRI.
   * Prima un errore di Stripe su un solo pagamento faceva fallire tutto
   * l'elenco: il pannello mostrava solo l'errore, e nessun carrello si poteva
   * dividere — nemmeno quelli che si leggevano benissimo. Adesso quel
   * pagamento finisce qui, e gli altri restano dividibili.
   */
  nonLetti: CarrelloNonLetto[];
};

const fermo = (o: Pick<OrdineDelCarrello, 'internal_dispute_status'>) =>
  o.internal_dispute_status === PAUSA_RIMBORSO_DA_DIVIDERE;

/**
 * Gli ordini del pagamento a cui si può dare una parte del rimborso: quelli
 * fermi (la divisione li riapre) e quelli a cui resta qualcosa da rimborsare.
 *
 * 16/10/2026 (riesame del lotto) — Prima erano solo quelli fermi. Il webhook
 * ferma solo gli ordini pagabili, e la chiusura di un reclamo poteva togliere
 * la pausa a uno di loro: quell'ordine spariva dalla divisione, e il rimborso
 * finiva per forza addosso all'altro negozio.
 */
export function ordiniDaDividere<T extends Pick<OrdineDelCarrello, 'internal_dispute_status' | 'total_price' | 'refunded_amount_cents'>>(
  ordini: ReadonlyArray<T>,
): T[] {
  return ordini.filter((o) => fermo(o) || lordoCents(o) - (o.refunded_amount_cents ?? 0) > 0);
}

/**
 * Quali rimborsi dal cruscotto etichettare come «registrati», a divisione
 * finita (tutti gli ordini fermi riaperti).
 *
 * Tutti quelli da fuori letti all'inizio, se i numeri dicono che erano tutti
 * da dividere: da fuori ≤ mancante sul database. Se invece da fuori è di più,
 * c'è un rimborso del sito ancora in corso che nasconde una parte dei soldi:
 * quella parte la dividerà un avviso successivo, e intanto non si etichetta
 * niente.
 *
 * 16/10/2026 (riesame del lotto) — LA DIVISIONE RIPRESA A METÀ. Una divisione
 * interrotta (un ordine cambiato sotto le mani, risposta 409) registra una
 * parte degli ordini; al secondo tentativo il mancante è più piccolo dei
 * rimborsi da fuori, e con la regola di sopra l'etichetta non si metteva più:
 * i 3 € già divisi restavano «da fuori» per sempre. Adesso conta anche quello
 * che una divisione precedente ha già scritto sugli ordini del carrello (gli id
 * nel loro elenco dei rimborsi).
 */
export function rimborsiDaEtichettare(
  rimborsi: ReadonlyArray<RimborsoStripe>,
  ordini: ReadonlyArray<Pick<OrdineDelRimborso, 'stripe_refund_id'>>,
  conto: Pick<ContoDaDividere, 'daFuoriCents' | 'mancanteCents'>,
): string[] {
  if (unRimborsoDelSitoStaPartendo(rimborsi, ordini, conto)) return [];
  return rimborsi
    .filter(daFuoriDaRegistrare)
    .map((r) => r.id)
    .filter((id): id is string => !!id);
}

/**
 * I numeri dicono che un rimborso del sito ha già prenotato il suo importo su
 * un ordine del carrello, ma su Stripe non c'è ancora: i rimborsi da fuori sono
 * più di quello che manca sul database (contando anche quelli che una divisione
 * precedente ha già scritto sugli ordini).
 *
 * 16/10/2026 (terzo riesame del lotto) — LA DIVISIONE A METÀ NON SI FA PIÙ.
 * Un caso: carrello Pane + fioraio, 3 € dal cruscotto, e un reso del sito da 2 €
 * sul pane che ha prenotato l'importo ma aspetta ancora Stripe. Il pannello
 * mostrava 1 € da dividere; la divisione scriveva sugli ordini l'id del
 * rimborso da 3 €, e quando il reso arrivava su Stripe il webhook lo dava per
 * diviso tutto: 2 € usciti al cliente e mai scritti su nessun ordine, senza
 * avvisi. Adesso in questo stato la divisione si rifiuta e non scrive niente:
 * appena il reso è su Stripe i numeri tornano, e si divide tutto in una volta.
 */
export function unRimborsoDelSitoStaPartendo(
  rimborsi: ReadonlyArray<RimborsoStripe>,
  ordini: ReadonlyArray<Pick<OrdineDelRimborso, 'stripe_refund_id'>>,
  conto: Pick<ContoDaDividere, 'daFuoriCents' | 'mancanteCents'>,
): boolean {
  const scritti = new Set<string>();
  for (const o of ordini) for (const id of rimborsiGiaScritti(o)) scritti.add(id);
  const giaDivisiCents = rimborsi
    .filter(daFuoriDaRegistrare)
    .filter((r) => !!r.id && scritti.has(r.id))
    .reduce((somma, r) => somma + Math.max(0, r.amount ?? 0), 0);
  return conto.daFuoriCents > conto.mancanteCents + giaDivisiCents;
}

/** Un carrello fermo, letto per il pannello. `null` se non c'è più niente di fermo. */
async function carrelloDaDividere(pagamento: string): Promise<CarrelloDaDividere | null> {
  const ordini = await ordiniDelPagamento(pagamento);
  if (!ordini.some(fermo)) return null;
  const conto = contoDaDividere(ordini, await elencoDeiRimborsi({ payment_intent: pagamento }));
  const candidati = ordiniDaDividere(ordini);

  const idNegozi = [...new Set(candidati.map((o) => o.seller_id).filter((s): s is string => !!s))];
  const nomi = new Map<string, string>();
  if (idNegozi.length > 0) {
    const { data: negozi } = await getAdminSupabase().from('profiles').select('id, store_name').in('id', idNegozi);
    for (const n of (negozi ?? []) as Array<{ id: string; store_name: string | null }>) {
      if (n.store_name?.trim()) nomi.set(n.id, n.store_name.trim());
    }
  }

  return {
    pagamento,
    daDividereCents: conto.daDividereCents,
    ordini: candidati.map((o) => {
      const lordo = lordoCents(o);
      const gia = o.refunded_amount_cents ?? 0;
      return {
        id: o.id,
        negozio: (o.seller_id && nomi.get(o.seller_id)) || 'Negozio senza nome',
        lordoCents: lordo,
        giaRimborsatoCents: gia,
        restaCents: Math.max(0, lordo - gia),
        // Lì la quota del negozio si riprende con uno storno (registraSullOrdine).
        bonificoPartito: o.payout_status === 'TRANSFERRED' && !!o.stripe_transfer_id,
        fermo: fermo(o),
      };
    }),
  };
}

/** I carrelli coi bonifici fermi per un rimborso dal cruscotto da dividere. */
export async function carrelliDaDividere(): Promise<ElencoDaDividere> {
  const { data: fermi, error } = await getAdminSupabase()
    .from('orders')
    .select('stripe_payment_intent')
    .eq('internal_dispute_status', PAUSA_RIMBORSO_DA_DIVIDERE)
    .limit(200);
  if (error) throw new Error(`ordini fermi non letti: ${error.message}`);
  const pagamenti = [...new Set((fermi ?? []).map((r) => r.stripe_payment_intent as string | null).filter((p): p is string => !!p))];

  const carrelli: CarrelloDaDividere[] = [];
  const nonLetti: CarrelloNonLetto[] = [];
  for (const pagamento of pagamenti) {
    // Ogni pagamento nel suo riparo: uno che Stripe non lascia leggere non
    // toglie dal pannello gli altri, che restano dividibili.
    try {
      const carrello = await carrelloDaDividere(pagamento);
      if (carrello) carrelli.push(carrello);
    } catch (err) {
      const motivo = err instanceof Error ? err.message : String(err);
      logger.error('[rimborso da dividere] pagamento non letto', { pagamento, motivo });
      nonLetti.push({ pagamento, motivo });
    }
  }
  return { carrelli, nonLetti };
}

export type EsitoDellaDivisioneFatta =
  | { ok: true; registrati: string[] }
  | { ok: false; stato: 400 | 409; errore: string; registrati: string[] };

/*
 * 16/10/2026 (sesto riesame del lotto) — LA DIVISIONE SI DECIDE UNA VOLTA SOLA,
 * E LA PAUSA SI TOGLIE PER ULTIMA.
 *
 * Ogni ordine si scrive con una scrittura sua: fra una e l'altra una seconda
 * scheda può leggere il carrello a metà, e il processo può morire. Il «turno»
 * del quinto riesame (il primo ordine fermo scritto per primo, e la sua pausa
 * tolta subito) lasciava tre buchi, tutti misurati:
 *  ① una scheda che leggeva DOPO il turno ne vedeva un altro, e registrava la
 *    sua divisione sopra quella della prima: 6 € scritti per 3 usciti;
 *  ② se il processo moriva dopo il turno, la pausa non c'era più e la parte del
 *    pane non era scritta: il carrello spariva dal pannello coi bonifici
 *    sbloccati, e il pane riceveva il netto pieno;
 *  ③ dopo un guasto la pausa tornava sul turno identica a prima, e una scheda
 *    letta prima la trovava come l'aveva lasciata: 4 € scritti per 3 usciti.
 *
 * Adesso le regole sono due, e il turno non c'è più.
 *
 * LA DIVISIONE SI DECIDE UNA VOLTA. Le parti scelte si scrivono nel registro
 * delle azioni, in una riga con un identificativo che dipende dal pagamento e
 * dai rimborsi che divide (`idDellaDivisione`). Il database rifiuta la seconda
 * (23505): chi arriva dopo — un doppio clic, un'altra scheda, un altro
 * amministratore, chi riprova dopo un guasto — esegue la divisione già decisa,
 * mai la sua. Se le sue cifre erano altre, lo legge (`stessaDivisione`).
 *
 * LA PAUSA SI TOGLIE PER ULTIMA. Ogni parte si scrive sul suo ordine una volta
 * sola: l'id del rimborso resta scritto sull'ordine, e chi lo trova lo salta
 * (`partiDaScrivere`). La pausa resta su tutto il carrello finché non sono
 * scritte tutte, e si toglie con una scrittura sola alla fine. Se qualcosa si
 * ferma prima, il carrello resta nel pannello col resto, e la prossima
 * richiesta finisce la divisione decisa.
 */

/** L'identificativo della decisione: lo stesso per lo stesso pagamento e gli stessi rimborsi, in qualunque ordine. */
export function idDellaDivisione(pagamento: string, rimborsi: ReadonlyArray<string>): string {
  return idDaChiave(`divisione-del-rimborso:${pagamento}:${[...rimborsi].sort().join(',')}`);
}

/** Le parti decise, per ordine: chi non c'è vale zero. */
export type DivisioneDecisa = Readonly<Record<string, number>>;

/** Gli ordini su cui questa divisione è già scritta: hanno nel loro elenco l'id di tutti i rimborsi che divide. */
export function ordiniGiaScritti(
  ordini: ReadonlyArray<Pick<OrdineDelCarrello, 'id' | 'stripe_refund_id'>>,
  rimborsi: ReadonlyArray<string>,
): Set<string> {
  if (rimborsi.length === 0) return new Set();
  return new Set(
    ordini.filter((o) => {
      const scritti = rimborsiGiaScritti(o);
      return rimborsi.every((id) => scritti.has(id));
    }).map((o) => o.id),
  );
}

/** Quello che resta da scrivere di una divisione decisa: le parti sopra zero, sugli ordini non ancora scritti. */
export function partiDaScrivere(decisa: DivisioneDecisa, giaScritti: ReadonlySet<string>): ParteDelRimborso[] {
  return Object.entries(decisa)
    .filter(([ordine, centesimi]) => centesimi > 0 && !giaScritti.has(ordine))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([ordine, centesimi]) => ({ ordine, centesimi }));
}

/**
 * Le cifre mandate adesso sono quelle già decise? Ordine per ordine, la stessa
 * parte; su un ordine già scritto vale anche zero, perché dopo un guasto il
 * pannello chiede di dividere solo quello che manca.
 */
export function stessaDivisione(
  decisa: DivisioneDecisa,
  parti: ReadonlyArray<ParteDelRimborso>,
  giaScritti: ReadonlySet<string>,
): boolean {
  const mandate = new Map(parti.map((p) => [p.ordine, p.centesimi]));
  const ordini = new Set([...Object.keys(decisa), ...mandate.keys()]);
  return [...ordini].every((ordine) => {
    const mandata = mandate.get(ordine) ?? 0;
    return mandata === (decisa[ordine] ?? 0) || (giaScritti.has(ordine) && mandata === 0);
  });
}

const AZIONE_DELLA_DIVISIONE: AuditAction = 'order.refund';

/** La divisione già decisa per questo identificativo, o `null` se non ce n'è. Lancia se non si legge. */
async function divisioneGiaDecisa(id: string): Promise<DivisioneDecisa | null> {
  const { data, error } = await getAdminSupabase().from('audit_logs').select('metadata').eq('id', id).maybeSingle();
  if (error) throw new Error(`divisione già decisa non letta: ${error.message}`);
  if (!data) return null;
  const parti = (data as { metadata?: { parti?: unknown } | null }).metadata?.parti;
  const leggibile =
    !!parti && typeof parti === 'object' &&
    Object.values(parti).every((c) => typeof c === 'number' && Number.isInteger(c) && c >= 0);
  if (!leggibile) throw new Error(`la divisione già decisa (${id}) non si legge: guarda il registro delle azioni`);
  return parti as DivisioneDecisa;
}

/** Scrive la decisione. `false` se un'altra richiesta l'ha scritta prima (23505). */
async function decidiLaDivisione(
  id: string,
  pagamento: string,
  rimborsi: ReadonlyArray<string>,
  parti: DivisioneDecisa,
  chi: string,
): Promise<boolean> {
  const { error } = await getAdminSupabase().from('audit_logs').insert({
    id,
    actor_id: chi,
    action: AZIONE_DELLA_DIVISIONE,
    target_table: 'orders',
    target_id: null,
    metadata: { origine: 'divisione_del_rimborso_dal_cruscotto', pagamento, rimborsi: [...rimborsi], parti },
  });
  if (!error) return true;
  if ((error as { code?: string }).code === '23505') return false;
  throw new Error(`divisione non scritta nel registro: ${error.message}`);
}

const GIA_DECISA_CON_ALTRE_CIFRE =
  "La divisione di questo rimborso era già stata decisa con altre cifre, da questa o da un'altra scheda: " +
  'vale quella, e le cifre mandate adesso non le ho usate. Ricarica la pagina.';

/**
 * 16/10/2026 (settimo riesame del lotto) — Quello che legge chi amministra
 * quando la parte di un ordine non si scrive. Prima, se non era scritto ancora
 * nessun ordine, diceva «Non ho registrato niente: ricarica la pagina e
 * riprova». Ma la divisione è già nel registro delle azioni prima di toccare
 * gli ordini, e chi riprova esegue quella: chi correggeva le cifre si vedeva
 * applicare quelle di prima. Adesso dice che la divisione è decisa e che va
 * rimandata uguale. La prima frase vale per tutti e tre i motivi per cui la
 * scrittura cade (`registraSullOrdine`). Sotto i 200 caratteri: più lunga, il
 * riquadro la sostituisce con un testo generico (friendlyError, lib/errors.ts).
 */
export function messaggioDellaParteNonScritta(idOrdine: string, giaRegistrati: number): string {
  const perche =
    `L'ordine #${idOrdine.slice(0, 6).toUpperCase()} non si è registrato: il bonifico sta partendo, è cambiato ` +
    'o il database non ha risposto. ';
  if (giaRegistrati <= 0) return `${perche}La divisione però è già decisa: ricarica la pagina e rimanda le stesse cifre.`;
  const quanti = giaRegistrati === 1 ? '1 ordine è già registrato' : `${giaRegistrati} ordini sono già registrati`;
  return `${perche}${quanti}: ricarica la pagina e rimanda le stesse cifre per gli altri.`;
}

/** Tolta la pausa, Stripe o il database non si sono lasciati rileggere: il carrello è fermo di nuovo. */
const PARTI_SCRITTE_BONIFICI_FERMI =
  'Ho registrato tutte le parti, ma i bonifici sono ancora fermi: ricarica la pagina e premi di nuovo «Registra».';

/** Tolta la pausa, la rilettura ha trovato un rimborso uscito mentre si divideva (`restaDaDividere`). */
const UN_ALTRO_RIMBORSO =
  'Ho registrato questa divisione, ma intanto dal cruscotto è uscito un altro rimborso su questo pagamento: ' +
  'i bonifici restano fermi. Ricarica la pagina e dividi quello nuovo.';

/** Il carrello andava fermato di nuovo, e il database non l'ha lasciato fare. */
const BONIFICI_NON_FERMATI =
  'Ho registrato la divisione, ma non sono riuscita a fermare di nuovo i bonifici: guarda su Stripe se su questo ' +
  "pagamento c'è un rimborso dal cruscotto non ancora diviso.";

/**
 * Registra la divisione decisa da chi amministra e riapre i bonifici, con le
 * due regole scritte qui sopra: la divisione si decide una volta sola, e la
 * pausa si toglie per ultima.
 */
export async function dividiIlRimborso(
  pagamento: string,
  parti: ReadonlyArray<ParteDelRimborso>,
  chi: string,
): Promise<EsitoDellaDivisioneFatta> {
  const ordini = await ordiniDelPagamento(pagamento);
  if (!ordini.some(fermo)) {
    return { ok: false, stato: 409, errore: 'Su questo pagamento non ci sono bonifici fermi da sbloccare.', registrati: [] };
  }

  const rimborsi = await elencoDeiRimborsi({ payment_intent: pagamento });
  const conto = contoDaDividere(ordini, rimborsi);
  // Prima di guardare le parti: con un rimborso del sito a metà strada la cifra da dividere
  // non è quella vera (vedi `unRimborsoDelSitoStaPartendo`).
  if (unRimborsoDelSitoStaPartendo(rimborsi, ordini, conto)) {
    return {
      ok: false,
      stato: 409,
      errore:
        'Su questo pagamento un rimborso del sito sta ancora partendo: non ho registrato niente. ' +
        'Aspetta qualche minuto e ricarica la pagina; se non cambia, controlla quel rimborso su Stripe.',
      registrati: [],
    };
  }

  // I rimborsi dal cruscotto che questa divisione copre — tutti: una divisione a
  // metà qui non arriva (`unRimborsoDelSitoStaPartendo`). Si scrivono sugli
  // ordini a cui dà una parte, così il prossimo avviso dello stesso pagamento
  // non li ritrova «da fuori» anche se l'etichetta su Stripe non arriva.
  const daFuoriIds = rimborsi
    .filter(daFuoriDaRegistrare)
    .map((r) => r.id)
    .filter((id): id is string => !!id);
  const giaScritti = ordiniGiaScritti(ordini, daFuoriIds);

  const id = idDellaDivisione(pagamento, daFuoriIds);
  let decisa = await divisioneGiaDecisa(id);
  if (!decisa) {
    const controllo = controllaLaDivisione(
      ordiniDaDividere(ordini).map((o) => ({
        id: o.id, lordoCents: lordoCents(o), giaRimborsatoCents: o.refunded_amount_cents ?? 0, fermo: fermo(o),
      })),
      parti,
      conto.daDividereCents,
    );
    if (!controllo.ok) return { ok: false, stato: 400, errore: controllo.errore, registrati: [] };
    const mia = Object.fromEntries(controllo.parti);
    decisa = (await decidiLaDivisione(id, pagamento, daFuoriIds, mia, chi)) ? mia : await divisioneGiaDecisa(id);
    if (!decisa) throw new Error(`la divisione ${id} risulta già decisa ma non si trova`);
  }
  const conAltreCifre = !stessaDivisione(decisa, parti, giaScritti);

  const registrati: string[] = [];
  for (const { ordine: idOrdine, centesimi } of partiDaScrivere(decisa, giaScritti)) {
    try {
      const ordine = ordini.find((o) => o.id === idOrdine);
      if (!ordine) throw new Error('non è fra gli ordini di questo pagamento');
      await registraSullOrdine(ordine, centesimi, { chargeId: null, rimborsi: daFuoriIds });
    } catch (err) {
      const motivo = err instanceof Error ? err.message : String(err);
      logger.error('[rimborso da dividere] ordine non registrato: il carrello resta fermo', { pagamento, orderId: idOrdine, motivo });
      return {
        ok: false,
        stato: 409,
        errore: conAltreCifre ? GIA_DECISA_CON_ALTRE_CIFRE : messaggioDellaParteNonScritta(idOrdine, registrati.length),
        registrati,
      };
    }
    registrati.push(idOrdine);
    await writeAudit({
      actorId: chi,
      action: 'order.refund',
      targetTable: 'orders',
      targetId: idOrdine,
      metadata: { origine: 'rimborso_dal_cruscotto_diviso', pagamento, centesimi },
    });
  }

  // Tutte le parti sono scritte: la pausa si toglie adesso, a tutto il carrello insieme.
  const { error: errPausa } = await getAdminSupabase()
    .from('orders')
    .update({ internal_dispute_status: null })
    .eq('stripe_payment_intent', pagamento)
    .eq('internal_dispute_status', PAUSA_RIMBORSO_DA_DIVIDERE);
  if (errPausa) {
    logger.error('[rimborso da dividere] parti registrate ma pausa non tolta', { pagamento, message: errPausa.message });
    return {
      ok: false,
      stato: 409,
      errore: conAltreCifre ? GIA_DECISA_CON_ALTRE_CIFRE : PARTI_SCRITTE_BONIFICI_FERMI,
      registrati,
    };
  }

  // Tolta la pausa, si rilegge il carrello: un rimborso uscito mentre si
  // divideva lo rimette fermo (`restaDaDividere`), e uno storno rimasto senza
  // esito si dice agli amministratori (`avvisaDegliStorniNonConfermati`). Se la
  // rilettura non riesce, il carrello si ferma di nuovo: meglio un passaggio in
  // più nel pannello che un rimborso perso.
  let riletto: { ordini: OrdineDelCarrello[]; resta: number } | null = null;
  try {
    const ordiniDopo = await ordiniDelPagamento(pagamento);
    riletto = { ordini: ordiniDopo, resta: restaDaDividere(ordiniDopo, await elencoDeiRimborsi({ payment_intent: pagamento })) };
  } catch (err) {
    logger.error('[rimborso da dividere] carrello non riletto dopo la divisione: lo fermo di nuovo', {
      pagamento, message: err instanceof Error ? err.message : String(err),
    });
  }
  if (riletto) {
    try {
      await avvisaDegliStorniNonConfermati(riletto.ordini);
    } catch (err) {
      logger.error('[rimborso da dividere] avviso dello storno senza esito non mandato', {
        pagamento, message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Tutto il rimborso da fuori ora è scritto sugli ordini: i suoi rimborsi su
  // Stripe ricevono l'etichetta «registrato», così il prossimo avviso dello
  // stesso pagamento non li ritrova come da dividere (vedi `rimborsiDaEtichettare`).
  const daEtichettare = rimborsiDaEtichettare(rimborsi, ordini, conto);
  if (daEtichettare.length > 0) await etichettaComeRegistrati(daEtichettare, null);

  if (!riletto || riletto.resta > 0) {
    const { error: errFermo } = await fermaIBonifici(ordini.map((o) => o.id));
    if (errFermo) {
      logger.error('[rimborso da dividere] carrello da fermare di nuovo, ma la scrittura non è passata', {
        pagamento, message: errFermo.message,
      });
      return { ok: false, stato: 409, errore: BONIFICI_NON_FERMATI, registrati };
    }
  }
  if (conAltreCifre) return { ok: false, stato: 409, errore: GIA_DECISA_CON_ALTRE_CIFRE, registrati };
  if (!riletto) return { ok: false, stato: 409, errore: PARTI_SCRITTE_BONIFICI_FERMI, registrati };
  if (riletto.resta > 0) return { ok: false, stato: 409, errore: UN_ALTRO_RIMBORSO, registrati };
  return { ok: true, registrati };
}
