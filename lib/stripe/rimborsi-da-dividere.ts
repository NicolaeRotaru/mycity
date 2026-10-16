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
 * partire — o ripresa con uno storno se è già partito — e la pausa tolta nella
 * stessa scrittura. Le regole su quello che chi amministra scrive stanno in
 * `lib/rimborsi/divisione-del-rimborso.ts`.
 */
import { getAdminSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { writeAudit } from '@/lib/audit';
import {
  elencoDeiRimborsi,
  etichettaComeRegistrati,
  PAUSA_RIMBORSO_DA_DIVIDERE,
  registraSullOrdine,
  rimborsiDaRegistrare,
  sommaDeiRimborsiDaFuori,
  type OrdineDelRimborso,
  type RimborsoStripe,
} from '@/lib/stripe/webhook/rimborsi-da-fuori';
import { controllaLaDivisione, type ParteDelRimborso } from '@/lib/rimborsi/divisione-del-rimborso';

const COLONNE =
  'id, seller_id, total_price, refunded_amount_cents, payout_status, stripe_payment_intent, stripe_transfer_id, ' +
  'stripe_reversal_id, seller_payout_cents, seller_payout_reversed_cents, internal_dispute_status';

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

const lordoCents = (o: Pick<OrdineDelRimborso, 'total_price'>) => Math.round(Number(o.total_price ?? 0) * 100);

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
  }>;
};

/** I carrelli coi bonifici fermi per un rimborso dal cruscotto da dividere. */
export async function carrelliDaDividere(): Promise<CarrelloDaDividere[]> {
  const admin = getAdminSupabase();
  const { data: fermi, error } = await admin
    .from('orders')
    .select('stripe_payment_intent')
    .eq('internal_dispute_status', PAUSA_RIMBORSO_DA_DIVIDERE)
    .limit(200);
  if (error) throw new Error(`ordini fermi non letti: ${error.message}`);
  const pagamenti = [...new Set((fermi ?? []).map((r) => r.stripe_payment_intent as string | null).filter((p): p is string => !!p))];

  const carrelli: CarrelloDaDividere[] = [];
  for (const pagamento of pagamenti) {
    const ordini = await ordiniDelPagamento(pagamento);
    const fermiQui = ordini.filter((o) => o.internal_dispute_status === PAUSA_RIMBORSO_DA_DIVIDERE);
    if (fermiQui.length === 0) continue;
    const conto = contoDaDividere(ordini, await elencoDeiRimborsi({ payment_intent: pagamento }));

    const idNegozi = [...new Set(fermiQui.map((o) => o.seller_id).filter((s): s is string => !!s))];
    const nomi = new Map<string, string>();
    if (idNegozi.length > 0) {
      const { data: negozi } = await admin.from('profiles').select('id, store_name').in('id', idNegozi);
      for (const n of (negozi ?? []) as Array<{ id: string; store_name: string | null }>) {
        if (n.store_name?.trim()) nomi.set(n.id, n.store_name.trim());
      }
    }

    carrelli.push({
      pagamento,
      daDividereCents: conto.daDividereCents,
      ordini: fermiQui.map((o) => {
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
        };
      }),
    });
  }
  return carrelli;
}

export type EsitoDellaDivisioneFatta =
  | { ok: true; registrati: string[] }
  | { ok: false; stato: 400 | 409; errore: string; registrati: string[] };

/**
 * Registra la divisione decisa da chi amministra e riapre i bonifici.
 *
 * Ogni ordine si scrive in una volta sola — la sua parte, la quota del suo
 * negozio e la pausa tolta — e solo se è ancora fermo e non è cambiato da
 * quando l'ho letto. Così una divisione ripetuta (doppio clic, una seconda
 * scheda) non registra niente due volte: l'ordine già diviso non è più fermo.
 */
export async function dividiIlRimborso(
  pagamento: string,
  parti: ReadonlyArray<ParteDelRimborso>,
  chi: string,
): Promise<EsitoDellaDivisioneFatta> {
  const ordini = await ordiniDelPagamento(pagamento);
  const fermi = ordini.filter((o) => o.internal_dispute_status === PAUSA_RIMBORSO_DA_DIVIDERE);
  if (fermi.length === 0) {
    return { ok: false, stato: 409, errore: 'Su questo pagamento non ci sono bonifici fermi da sbloccare.', registrati: [] };
  }

  const rimborsi = await elencoDeiRimborsi({ payment_intent: pagamento });
  const conto = contoDaDividere(ordini, rimborsi);
  const controllo = controllaLaDivisione(
    fermi.map((o) => ({ id: o.id, lordoCents: lordoCents(o), giaRimborsatoCents: o.refunded_amount_cents ?? 0 })),
    parti,
    conto.daDividereCents,
  );
  if (!controllo.ok) return { ok: false, stato: 400, errore: controllo.errore, registrati: [] };

  const registrati: string[] = [];
  for (const ordine of fermi) {
    const parte = controllo.parti.get(ordine.id) ?? 0;
    try {
      await registraSullOrdine(ordine, parte, { chargeId: null, togliLaPausa: true });
    } catch (err) {
      const motivo = err instanceof Error ? err.message : String(err);
      logger.error('[rimborso da dividere] ordine non registrato', { pagamento, orderId: ordine.id, motivo });
      return {
        ok: false,
        stato: 409,
        errore:
          `L'ordine #${ordine.id.slice(0, 6).toUpperCase()} è cambiato mentre lo registravo, oppure il suo bonifico sta partendo proprio adesso. ` +
          (registrati.length > 0
            ? `${registrati.length} ordine/i sono già registrati e sbloccati. Ricarica la pagina: il rimborso da dividere riparte da quello che manca.`
            : 'Non ho registrato niente: ricarica la pagina e riprova.'),
        registrati,
      };
    }
    registrati.push(ordine.id);
    await writeAudit({
      actorId: chi,
      action: 'order.refund',
      targetTable: 'orders',
      targetId: ordine.id,
      metadata: { origine: 'rimborso_dal_cruscotto_diviso', pagamento, centesimi: parte },
    });
  }

  // Tutto il rimborso da fuori ora è scritto sugli ordini: i suoi rimborsi su
  // Stripe ricevono l'etichetta «registrato», così il prossimo avviso dello
  // stesso pagamento non li ritrova come da dividere. Se i numeri dicono che
  // non era tutto da fuori (un rimborso del sito ancora in corso), non si
  // etichetta niente: al peggio i bonifici si fermano di nuovo, non si toglie
  // niente due volte.
  if (conto.daFuoriCents <= conto.mancanteCents) {
    await etichettaComeRegistrati(rimborsiDaRegistrare(rimborsi, Number.POSITIVE_INFINITY).ids, null);
  }
  return { ok: true, registrati };
}
