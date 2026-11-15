import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fintoDatabase, type FintoDatabase, type Scrittura } from './aiuti/finto-database-dei-pagamenti';

/**
 * R23-001 — Una prova sul webhook di Stripe controllava l'ordine delle righe cercando una parola
 * («processed: true» dopo «switch (event.type)», col primo `indexOf`), e bastava togliere uno
 * spazio per ingannarla: la marcatura spostata prima dello smistamento non si trovava più, e la
 * prova trovava quella giusta dentro lo smistamento e restava verde.
 *
 * Qui due prove, che si coprono a vicenda:
 *  ① sul testo di app/api/stripe/webhook/route.ts, letto per nome: senza commenti, senza badare a
 *    spazi e virgolette, su TUTTE le marcature; e la prova controlla sé stessa su una rotta finta;
 *  ② sul comportamento, ramo per ramo dello `switch`: la rotta vera, ogni gestore finto. Un
 *    gestore riuscito → la marcatura arriva DOPO; un gestore caduto → nessuna marcatura, 500, e il
 *    turno torna libero perché Stripe riprovi. Una marcatura messa dentro un ramo, prima del suo
 *    gestore, il testo non la vede: questa sì.
 */

const ROTTA = join(process.cwd(), 'app/api/stripe/webhook/route.ts');

/** Dove cade lo smistamento, quante marcature «lavorato» ci sono, e quante prima dello smistamento. */
function marcatureFuoriPosto(sorgente: string): { smistamento: number; marcature: number; primaDelloSmistamento: number } {
  const codice = sorgente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
  const smistamento = codice.search(/switch\s*\(\s*event\.type\s*\)/);
  const posizioni = [...codice.matchAll(/\bprocessed['"]?\s*:\s*(?:true|!0|!false)\b/g)].map((m) => m.index ?? -1);
  return { smistamento, marcature: posizioni.length, primaDelloSmistamento: posizioni.filter((p) => p < smistamento).length };
}

/** I rami dello `switch` della rotta, letti dal testo senza commenti. */
function ramiDelloSmistamento(sorgente: string): string[] {
  const codice = sorgente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
  return [...codice.matchAll(/\bcase\s+['"]([^'"]+)['"]\s*:/g)].map((m) => m[1]!).sort();
}

describe('① il testo della rotta: la marcatura non sta prima dello smistamento', () => {
  it('nessuna marcatura «lavorato» prima dello switch, in nessuna forma', () => {
    const { smistamento, marcature, primaDelloSmistamento } = marcatureFuoriPosto(readFileSync(ROTTA, 'utf8'));
    expect(smistamento).toBeGreaterThan(0);
    expect(marcature).toBeGreaterThan(0);
    expect(primaDelloSmistamento, 'l evento si segna come lavorato prima del gestore').toBe(0);
  });

  it('la prova si controlla da sola: senza spazio, con le virgolette o in un commento', () => {
    const rotta = readFileSync(ROTTA, 'utf8');
    const oggi = marcatureFuoriPosto(rotta).primaDelloSmistamento;
    const davanti = (riga: string) => rotta.replace(/switch\s*\(\s*event\.type\s*\)/, `${riga}\n    switch (event.type)`);
    expect(marcatureFuoriPosto(davanti('const marca = { processed:true };')).primaDelloSmistamento, 'senza spazio non si vede').toBe(oggi + 1);
    expect(marcatureFuoriPosto(davanti("const marca = { 'processed' : true };")).primaDelloSmistamento, 'con le virgolette non si vede').toBe(oggi + 1);
    expect(marcatureFuoriPosto(davanti('// processed: true')).primaDelloSmistamento, 'un commento non è una marcatura').toBe(oggi);
    expect(marcatureFuoriPosto(davanti('/* processed: true */')).primaDelloSmistamento).toBe(oggi);
  });

  it('su una rotta finta: conta tutte le marcature, non la prima trovata', () => {
    const finta = [
      'export async function POST() {',
      "  await admin.from('stripe_event_log').update({processed:true}).eq('event_id', id);",
      '  switch (event.type) {',
      "    case 'charge.refunded': await gestore(); break;",
      '  }',
      "  await admin.from('stripe_event_log').update({ processed: true }).eq('event_id', id);",
      '}',
    ].join('\n');
    expect(marcatureFuoriPosto(finta)).toMatchObject({ marcature: 2, primaDelloSmistamento: 1 });
    expect(ramiDelloSmistamento(finta)).toEqual(['charge.refunded']);
  });
});

// ② — Il comportamento, ramo per ramo.

process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

const stato = vi.hoisted(() => ({
  db: null as unknown as { client: unknown },
  evento: { id: 'evt_x', type: 'noop', data: { object: {} } } as { id: string; type: string; account?: string; data: { object: Record<string, unknown> } },
  diario: [] as string[],
  gestoreCade: false,
}));

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => stato.db.client }));
vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({ webhooks: { constructEvent: () => stato.evento } }),
  isStripeConfigured: () => true,
}));

/** Ogni gestore finto annota quando lavora, e cade se la prova lo chiede. */
const { gestore } = vi.hoisted(() => ({
  gestore: (nome: string) => async () => {
    stato.diario.push(`gestore:${nome}`);
    if (stato.gestoreCade) throw new Error(`${nome}: il database non risponde`);
  },
}));
vi.mock('@/lib/stripe/webhook/ordini', () => ({
  handleCheckoutCompleted: gestore('handleCheckoutCompleted'), handleCheckoutExpired: gestore('handleCheckoutExpired'),
}));
vi.mock('@/lib/stripe/webhook/giftcard', () => ({ handleGiftCardPurchase: gestore('handleGiftCardPurchase') }));
vi.mock('@/lib/stripe/webhook/sponsorizzati', () => ({ handleSponsoredPurchase: gestore('handleSponsoredPurchase') }));
vi.mock('@/lib/stripe/webhook/abbonamenti', () => ({
  handleSellerSubscription: gestore('handleSellerSubscription'),
  handleSubscriptionChanged: gestore('handleSubscriptionChanged'),
  handleInvoicePaymentFailed: gestore('handleInvoicePaymentFailed'),
}));
vi.mock('@/lib/stripe/webhook/rimborsi', () => ({
  handleChargeRefunded: gestore('handleChargeRefunded'), handleRefundUpdated: gestore('handleRefundUpdated'),
}));
vi.mock('@/lib/stripe/webhook/dispute', () => ({
  handleDisputeCreated: gestore('handleDisputeCreated'), handleDisputeClosed: gestore('handleDisputeClosed'),
}));
vi.mock('@/lib/stripe/webhook/trasferimenti', () => ({
  handleTransferReversed: gestore('handleTransferReversed'),
  handlePayoutFailed: gestore('handlePayoutFailed'),
  handleAccountUpdated: gestore('handleAccountUpdated'),
}));
vi.mock('@/lib/stripe/webhook/pagamenti', () => ({
  handlePaymentIntentFailed: gestore('handlePaymentIntentFailed'),
  handlePaymentIntentSucceeded: gestore('handlePaymentIntentSucceeded'),
}));

import { POST } from '@/app/api/stripe/webhook/route';

const pagata = (kind?: string) => ({ id: 'cs_1', payment_status: 'paid', status: 'complete', metadata: kind ? { kind } : {} });

/** Ogni ramo dello smistamento: l'avviso che lo apre e il gestore che deve lavorarlo. */
const RAMI: Array<{ tipo: string; oggetto: Record<string, unknown>; gestore: string; account?: string }> = [
  { tipo: 'checkout.session.completed', oggetto: pagata(), gestore: 'handleCheckoutCompleted' },
  { tipo: 'checkout.session.completed', oggetto: pagata('gift_card'), gestore: 'handleGiftCardPurchase' },
  { tipo: 'checkout.session.completed', oggetto: pagata('sponsored'), gestore: 'handleSponsoredPurchase' },
  { tipo: 'checkout.session.completed', oggetto: pagata('seller_subscription'), gestore: 'handleSellerSubscription' },
  { tipo: 'checkout.session.async_payment_succeeded', oggetto: pagata(), gestore: 'handleCheckoutCompleted' },
  { tipo: 'charge.refunded', oggetto: { id: 'ch_1' }, gestore: 'handleChargeRefunded' },
  { tipo: 'charge.dispute.created', oggetto: { id: 'dp_1' }, gestore: 'handleDisputeCreated' },
  { tipo: 'charge.dispute.funds_withdrawn', oggetto: { id: 'dp_1' }, gestore: 'handleDisputeCreated' },
  { tipo: 'charge.dispute.closed', oggetto: { id: 'dp_1' }, gestore: 'handleDisputeClosed' },
  { tipo: 'account.updated', oggetto: { id: 'acct_1' }, gestore: 'handleAccountUpdated' },
  { tipo: 'customer.subscription.updated', oggetto: { id: 'sub_1' }, gestore: 'handleSubscriptionChanged' },
  { tipo: 'customer.subscription.deleted', oggetto: { id: 'sub_1' }, gestore: 'handleSubscriptionChanged' },
  { tipo: 'invoice.payment_failed', oggetto: { id: 'in_1' }, gestore: 'handleInvoicePaymentFailed' },
  { tipo: 'transfer.reversed', oggetto: { id: 'tr_1' }, gestore: 'handleTransferReversed' },
  { tipo: 'checkout.session.async_payment_failed', oggetto: { id: 'cs_1' }, gestore: 'handleCheckoutExpired' },
  { tipo: 'checkout.session.expired', oggetto: { id: 'cs_1' }, gestore: 'handleCheckoutExpired' },
  { tipo: 'payout.failed', oggetto: { id: 'po_1' }, gestore: 'handlePayoutFailed' },
  { tipo: 'payment_intent.payment_failed', oggetto: { id: 'pi_1' }, gestore: 'handlePaymentIntentFailed' },
  { tipo: 'payment_intent.succeeded', oggetto: { id: 'pi_1' }, gestore: 'handlePaymentIntentSucceeded' },
  { tipo: 'charge.refund.updated', oggetto: { id: 're_1' }, gestore: 'handleRefundUpdated' },
];

let db: FintoDatabase;

async function consegna(ramo: (typeof RAMI)[number]): Promise<number> {
  stato.evento = { id: `evt_${ramo.tipo}`, type: ramo.tipo, data: { object: ramo.oggetto } };
  const r = await POST(
    new Request('http://localhost/api/stripe/webhook', {
      method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=ok' }, body: '{}',
    }) as never,
  );
  return r.status;
}

beforeEach(() => {
  stato.diario = [];
  stato.gestoreCade = false;
  db = fintoDatabase({ stripe_event_log: [] });
  db.predefiniti.stripe_event_log = { processed: false, processed_at: null };
  db.unici.stripe_event_log = [['event_id']];
  db.guasto = (s: Scrittura) => {
    const valori = s.valori as Record<string, unknown> | undefined;
    if (s.tabella === 'stripe_event_log' && s.operazione === 'update' && valori && valori.processed === true) {
      stato.diario.push('marcatura');
    }
    return null;
  };
  stato.db = db;
});

const avviso = () => db.tabelle.stripe_event_log!.find((r) => r.event_id === stato.evento.id);
const nome = (r: (typeof RAMI)[number]) => `${r.tipo}${(r.oggetto.metadata as { kind?: string } | undefined)?.kind ? ` (${(r.oggetto.metadata as { kind: string }).kind})` : ''}`;

describe('② il comportamento, ramo per ramo: la marcatura arriva dopo il gestore, e solo se riesce', () => {
  it('ogni ramo dello switch della rotta ha qui il suo caso', () => {
    const provati = [...new Set(RAMI.map((r) => r.tipo))].sort();
    expect(provati, 'un ramo nuovo nella rotta va provato anche qui').toEqual(ramiDelloSmistamento(readFileSync(ROTTA, 'utf8')));
  });

  it.each(RAMI.map((r) => [nome(r), r] as const))('%s — gestore riuscito: prima il gestore, poi la marcatura', async (_n, ramo) => {
    expect(await consegna(ramo)).toBe(200);
    expect(stato.diario).toEqual([`gestore:${ramo.gestore}`, 'marcatura']);
    expect(avviso()?.processed).toBe(true);
  });

  it.each(RAMI.map((r) => [nome(r), r] as const))('%s — gestore caduto: nessuna marcatura, 500, turno libero', async (_n, ramo) => {
    stato.gestoreCade = true;
    expect(await consegna(ramo)).toBe(500);
    expect(stato.diario, 'segnato come lavorato prima del gestore: Stripe non riproverebbe mai').toEqual([`gestore:${ramo.gestore}`]);
    expect(avviso()?.processed).toBe(false);
    expect(avviso()?.claimed_at ?? null).toBeNull();
  });
});
