import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSupabase, getAdminSupabase } from '@/lib/supabase/server';
import { withAuthRateLimit } from '@/lib/api/middleware';
import { ApiErrors } from '@/lib/api/responses';
import { conRipiegoSchema, senzaCampi } from '@/lib/db/migrazione-124';
import { compensoTrattenutoCents, contanteDaRimettereCents } from '@/lib/shipping';
import { jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { giornoLocale } from '@/lib/tempo/giorno-locale';

export const runtime = 'nodejs';

/**
 * Percorso dentro il secchio privato `cod-proof`, non un indirizzo pubblico.
 * Le prove d'incasso non stanno piu' nel secchio pubblico, quindi qui arriva
 * `<utente>/<ordine>/cash-....jpg`. Vietati i due punti (nessun http://) e i
 * passi indietro (`..`), per non poter uscire dalla propria cartella.
 */
const PercorsoProva = z
  .string()
  .max(300)
  .regex(/^[A-Za-z0-9][A-Za-z0-9/_.-]*$/, 'Percorso non valido')
  .refine((v) => !v.includes('..'), 'Percorso non valido');

const Body = z.object({
  orderId: z.string().uuid(),
  cashCollectedCents: z.number().int().nonnegative(),
  photoUrl: PercorsoProva.optional(),
  signatureUrl: PercorsoProva.optional(),
  deliveryPhotoUrl: PercorsoProva.optional(),
});

/** Sopra questa soglia la prova (foto contanti o firma) è obbligatoria. */
const HIGH_VALUE_THRESHOLD_CENTS = 5000; // €50
/** Tolleranza per arrotondamenti prima di considerarlo un mismatch. */
const MISMATCH_TOLERANCE_CENTS = 50; // €0,50

/**
 * Il rider conferma di aver incassato contanti al momento della consegna.
 *
 * Salva:
 *  - cash_collected_cents (importo)
 *  - cash_photo_url (foto contanti/scontrino)
 *  - cash_signature_url (firma digitale buyer, opzionale)
 *  - delivery_photo_url (foto pacco lasciato)
 *  - cash_confirmed_at + cash_collected_by
 *
 * Aggiorna il record cod_reconciliations per la giornata (anche
 * giornaliera): expected viene calcolato come somma total_price di
 * tutti gli ordini COD delivered dal rider quel giorno.
 *
 * RLS-safe: il rider puo' aggiornare solo i propri ordini con
 * delivery_status PICKED_UP/OUT_FOR_DELIVERY/DELIVERED (controllo
 * server-side).
 */
// Rate limit: 60 conferme / ora per rider (anti-abuse, ma rider attivi ~30/giorno)
export const POST = withAuthRateLimit({ name: 'rider-cash-confirm', max: 60, windowMs: 60 * 60_000 }, async ({ user, req }): Promise<NextResponse> => {
  let body;
  try {
    body = Body.parse(await jsonRichiesta(req, TETTO_JSON));
  } catch (e) {
    return ApiErrors.invalidRequest('Dati non validi', e instanceof Error ? e.message : undefined);
  }

  const supa = await getServerSupabase();
  const { data: order, error } = await supa
    .from('orders')
    .select('id, rider_id, total_price, rider_fee_cents, shipping_cost, pickup_in_store, payment_method, delivery_status, cash_confirmed_at')
    .eq('id', body.orderId)
    .single();

  if (error || !order) return ApiErrors.notFound('Ordine non trovato');
  if (order.rider_id !== user.id) {
    return ApiErrors.forbidden('Non autorizzato (ordine di altro rider)');
  }
  if (order.payment_method !== 'cod') {
    return ApiErrors.conflict('Ordine non in cash on delivery');
  }
  if (order.cash_confirmed_at) {
    return ApiErrors.conflict("Incasso gia' confermato");
  }

  // 155 — IL FATTORINO NON LAVORAVA GRATIS PER SBAGLIO: PER COSTRUZIONE.
  //
  // Sul contrassegno gli si chiedeva di rimettere TUTTO il contante, fee di
  // consegna compresa. E l'unica funzione che paga un fattorino esce subito
  // con «COD: il rider incassa i contanti»: nessun bonifico partiva mai.
  // Risultato: su ogni consegna pagata in contanti — il metodo naturale del
  // cliente anziano di Piacenza — il fattorino consegnava e non prendeva
  // niente. Alla prima settimana i fattorini smettono di prendere quegli
  // ordini e la consegna si ferma.
  //
  // La strada scelta e' la piu' semplice e la piu' onesta: il compenso se lo
  // tiene dal contante che ha in mano, e rimette il resto. Nessun bonifico da
  // fare, nessun saldo piattaforma da anticipare. L'atteso scende di
  // conseguenza, qui e nella quadratura di fine giornata.
  const compensoTenutoCents = compensoTrattenutoCents(order);
  const expectedCents = contanteDaRimettereCents(order);

  // Cap difensivo: rifiuta importi palesemente fuori range (errore di battitura/abuso).
  if (body.cashCollectedCents > expectedCents * 2 + 1000) {
    return ApiErrors.invalidRequest('Importo incassato fuori range rispetto al totale ordine.');
  }
  // Prova obbligatoria sopra soglia (anti-frode + dispute "non ho pagato/ricevuto").
  if (expectedCents >= HIGH_VALUE_THRESHOLD_CENTS && !body.photoUrl && !body.signatureUrl) {
    return ApiErrors.invalidRequest('Per ordini sopra €50 allega una prova: foto dei contanti o firma del cliente.');
  }

  const admin = getAdminSupabase();
  const now = new Date();
  // 189 — La giornata di cassa del fattorino è quella di Piacenza. Con
  // `toISOString()` era quella di Greenwich: d'estate le consegne fra le 22 e
  // mezzanotte finivano nel giorno dopo, e la quadratura risultava sbagliata
  // proprio nelle sere più cariche.
  const today = giornoLocale(now);

  // Guard atomico contro la "doppia cassa": solo il PRIMO writer (con
  // cash_confirmed_at ancora NULL) vince. Il check a riga ~63 è solo un fast-path
  // UX: NON è atomico (TOCTOU tra la lettura e la scrittura). La condizione
  // .is('cash_confirmed_at', null) sposta la guardia nel DB — il row-lock di
  // Postgres serializza due conferme concorrenti e la seconda non matcha più
  // (0 righe), così non può sovrascrivere cash_collected_cents/le prove.
  // Stesso pattern del claim payout in lib/stripe/payout.ts.
  // Lo stato 'CASH_WITHHELD' nasce con la migrazione 124: prima di quella il
  // vincolo del database lo rifiuta, e con lui l'intero aggiornamento. Il
  // ripiego conferma comunque l'incasso, senza scrivere quel campo
  // (lib/db/migrazione-124.ts).
  const CAMPI_COMPENSO = ['rider_payout_status', 'rider_payout_at'] as const;
  const aggiornamento = {
    cash_collected_cents: body.cashCollectedCents,
    cash_photo_url: body.photoUrl ?? null,
    cash_signature_url: body.signatureUrl ?? null,
    delivery_photo_url: body.deliveryPhotoUrl ?? null,
    cash_confirmed_at: now.toISOString(),
    cash_collected_by: user.id,
    // L'ordine in contanti diventa PAGATO qui, che è il momento in cui i soldi
    // sono davvero passati di mano. Prima restava 'PENDING' per sempre: in
    // tutto il codice l'unico punto che scriveva 'PAID' era il webhook della
    // carta. Conseguenza: l'annullamento da pannello trattava un contante già
    // incassato come un ordine mai pagato, e non restituiva niente al cliente.
    payment_status: 'PAID',
    // 155 — Il compenso e' stato pagato, in contanti, adesso. Prima questo
    // campo restava NULL per sempre e non c'era modo di distinguere «pagato
    // in contanti» da «mai pagato».
    rider_payout_status: compensoTenutoCents > 0 ? 'CASH_WITHHELD' : null,
    rider_payout_at: compensoTenutoCents > 0 ? now.toISOString() : null,
  };

  const conferma = (valori: Record<string, unknown>) =>
    admin
      .from('orders')
      .update(valori)
      .eq('id', body.orderId)
      .eq('rider_id', user.id)
      .is('cash_confirmed_at', null)
      // 056/172 — il commento in cima al file dichiarava questa guardia
      // («il rider puo' aggiornare solo i propri ordini con delivery_status
      // PICKED_UP/OUT_FOR_DELIVERY/DELIVERED, controllo server-side») e nel codice
      // non c'era: un fattorino poteva marcare PAGATO un ordine appena assegnato,
      // mai ritirato e mai consegnato — e da lì l'ordine risultava incassato.
      // Ora la condizione sta dentro la stessa UPDATE, quindi la decide il
      // database e non un `if` che qualcuno può spostare.
      .in('delivery_status', ['PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED'])
      .select('id');

  const { data: claimed, error: updErr } = await conRipiegoSchema(
    'orders.update (conferma incasso)',
    () => conferma(aggiornamento),
    () => conferma(senzaCampi(aggiornamento, CAMPI_COMPENSO)),
  );

  if (updErr) return ApiErrors.internal('Update fallito');
  if (!claimed || claimed.length === 0) {
    // Un'altra conferma concorrente ha già vinto la corsa.
    return ApiErrors.conflict("Incasso gia' confermato");
  }

  // Aggiorna riconciliazione giornaliera (include i COD consegnati ma NON confermati).
  await upsertReconciliation(admin, user.id, today);

  // Mismatch → alert agli ADMIN (NON al rider, che è la parte da controllare).
  const delta = body.cashCollectedCents - expectedCents;
  if (Math.abs(delta) > MISMATCH_TOLERANCE_CENTS) {
    const { data: admins } = await admin.from('profiles').select('id').eq('role', 'admin');
    const rows = (admins ?? []).map((a) => ({
      user_id: a.id,
      title: '⚠️ Incasso COD non quadra',
      body: `Rider ${user.id.slice(0, 8)} · ordine ${body.orderId.slice(0, 8)}: incassati €${(body.cashCollectedCents / 100).toFixed(2)}, attesi €${(expectedCents / 100).toFixed(2)} (Δ €${(delta / 100).toFixed(2)}).`,
      link: '/admin/orders',
    }));
    if (rows.length > 0) await admin.from('notifications').insert(rows);
  }

  return NextResponse.json({ ok: true, delta, expectedCents }, { status: 200 });
});

type AdminSupabase = ReturnType<typeof import('@/lib/supabase/server').getAdminSupabase>;
type ReconciliationRow = {
  total_price: number | string | null;
  cash_collected_cents: number | null;
  rider_fee_cents: number | null;
  shipping_cost: number | string | null;
  pickup_in_store: boolean | null;
};

/**
 * Quanto il fattorino trattiene dal contante come proprio compenso (#155).
 *
 * Fonte unica: la usano sia la conferma dell'incasso sia la quadratura di fine
 * giornata, così l'atteso è lo stesso numero in tutti e due i posti. Il
 * ripiego su `shipping_cost` copre gli ordini nati prima della migrazione 111,
 * quando il compenso non aveva una colonna sua — è lo stesso ripiego che fa
 * `releaseRiderPayout`. Sul ritiro in negozio non c'è consegna, quindi non c'è
 * compenso.
 */

/** Mezzanotte locale di quel giorno, espressa in UTC. */
function inizioGiornoLocale(isoDate: string): Date {
  // Si parte dalla mezzanotte UTC e si corregge con lo scarto vero del fuso in
  // quella data: così l'ora legale è gestita dal calendario, non da una costante.
  const mezzanotteUtc = new Date(`${isoDate}T00:00:00Z`);
  const scartoMin = scartoFusoMinuti(mezzanotteUtc);
  return new Date(mezzanotteUtc.getTime() - scartoMin * 60_000);
}

function scartoFusoMinuti(d: Date): number {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Rome', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(d);
  const g = (t: string) => Number(f.find((p) => p.type === t)?.value ?? '0');
  const locale = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'));
  return Math.round((locale - d.getTime()) / 60_000);
}

async function upsertReconciliation(admin: AdminSupabase, riderId: string, isoDate: string) {
  // 189 — Prima la finestra era `T00:00:00Z … T23:59:59Z`: sbagliato due volte.
  // Il fuso (le consegne serali finivano nel giorno dopo) e l'ultimo secondo,
  // che restava fuori — una consegna alle 23:59:59.400 non veniva contata.
  // Ora: da mezzanotte locale INCLUSA a mezzanotte locale del giorno dopo ESCLUSA.
  const start = inizioGiornoLocale(isoDate).toISOString();
  const end = new Date(inizioGiornoLocale(isoDate).getTime() + 24 * 60 * 60_000).toISOString();

  // 🟡-7: atteso E incassato sono ancorati allo STESSO insieme di ordini —
  // quelli consegnati quel giorno (per delivered_at). Prima l'incassato usava
  // cash_confirmed_at: un ordine consegnato a fine giornata e confermato dopo
  // mezzanotte cadeva in atteso[X] ma incassato[X+1] → falso MISMATCH ricorrente.
  // Includere i COD consegnati ANCHE se mai confermati (cash_collected_cents=0)
  // fa emergere come ammanco un rider che non conferma, invece di farlo sparire.
  const { data: deliveredRows } = await admin
    .from('orders')
    .select('total_price, cash_collected_cents, rider_fee_cents, shipping_cost, pickup_in_store')
    .eq('rider_id', riderId)
    .eq('payment_method', 'cod')
    .eq('delivery_status', 'DELIVERED')
    .gte('delivered_at', start)
    .lt('delivered_at', end);
  const rows = (deliveredRows ?? []) as ReconciliationRow[];
  // 155 — L'atteso e' il contante MENO il compenso che il fattorino si tiene:
  // e' quello che deve davvero riportare in cassa. Sommare i total_price
  // interi faceva risultare un ammanco pari al compenso su ogni consegna.
  const expected = rows.reduce(
    (s, r) => s + contanteDaRimettereCents(r),
    0,
  );
  const collected = rows.reduce((s, r) => s + Number(r.cash_collected_cents ?? 0), 0);

  const status = Math.abs(expected - collected) <= 50 ? 'OK' : 'MISMATCH';

  await admin
    .from('cod_reconciliations')
    .upsert(
      {
        rider_id: riderId,
        for_date: isoDate,
        expected_cents: expected,
        collected_cents: collected,
        status,
      },
      { onConflict: 'rider_id,for_date' },
    );
}
