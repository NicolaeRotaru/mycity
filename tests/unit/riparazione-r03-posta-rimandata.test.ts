import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FintoDatabase } from './aiuti/finto-database-dei-rimborsi';
import { creaFintoDatabase } from './aiuti/finto-database-dei-rimborsi';

/**
 * R03-002 — Se l'email al negozio (o il rimborso che chiede l'IBAN) non parte, qualcuno la rimanda.
 *
 * `sendEmail` fa due tentativi in pochi secondi e poi rinuncia con `{ ok: false, error }`. Da quel
 * momento l'email era persa: l'avviso agli amministratori diceva «avvisa tu il destinatario», e
 * nessuno la rimandava. Adesso chi spedisce dice di chi è l'account (`rimandaA`): su un rifiuto il
 * messaggio già pronto entra in `email_queue` e il giro send-emails lo spedisce, con i suoi
 * tentativi a attesa crescente. Nessun invio vero: Resend è finto.
 */

const stato = vi.hoisted(() => ({
  db: null as unknown as FintoDatabase,
  resend: 'rifiuta' as 'rifiuta' | 'spedisce' | 'appeso',
  spedite: [] as Array<Record<string, unknown>>,
  appesi: 0,
}));

vi.mock('resend', () => ({
  Resend: class {
    emails = {
      send: async (payload: Record<string, unknown>) => {
        // Giro 2 — Resend che non risponde mai: scatta il tetto dei dieci secondi.
        if (stato.resend === 'appeso') { stato.appesi++; return new Promise(() => {}); }
        if (stato.resend === 'rifiuta') {
          return { data: null, error: { name: 'daily_quota_exceeded', message: 'You have reached your daily email quota' } };
        }
        stato.spedite.push(payload);
        return { data: { id: `em_${stato.spedite.length}` }, error: null };
      },
    };
  },
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => stato.db.client }));
vi.mock('@/lib/stripe/client', () => ({ isStripeConfigured: () => true, getStripe: () => ({}) }));
vi.mock('@/lib/api/middleware', () => ({
  withCronAuth: (h: (req: unknown) => unknown) => (req: unknown) => h(req),
}));

/** La coda vista dal giro send-emails: una presa, gli indirizzi degli account, le scritture sulle righe. */
const giro = vi.hoisted(() => ({
  presa: [] as Array<Record<string, unknown>>,
  segni: [] as Array<Record<string, unknown>>,
  indirizzi: { 'negozio-1': 'forno@negozio.test' } as Record<string, string>,
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => {
    const scrittura = (valori: Record<string, unknown>) => {
      const q: Record<string, unknown> = {
        eq: async (_c: string, id: string) => { giro.segni.push({ id, ...valori }); return { error: null }; },
        is: () => q, lt: () => q, lte: () => q, not: () => q, neq: () => q,
        select: async () => ({ data: [], error: null }),
      };
      return q;
    };
    return {
      rpc: async () => ({ data: giro.presa, error: null }),
      auth: { admin: { getUserById: async (id: string) => ({ data: { user: { email: giro.indirizzi[id] ?? null } }, error: null }) } },
      from: (tabella: string) => {
        if (tabella === 'profiles') {
          // Il negozio ha detto no alle promozioni: un messaggio di servizio deve partire lo stesso.
          return { select: () => ({ in: async () => ({ data: [{ id: 'negozio-1', full_name: 'Forno', email_marketing: false }], error: null }) }) };
        }
        if (tabella === 'orders') {
          const conta = { not: () => conta, gte: () => conta, lte: async () => ({ count: 0, error: null }) };
          return { select: () => conta };
        }
        return { update: scrittura };
      },
    };
  },
}));

const ADESSO = new Date('2026-11-27T10:00:00Z');
const MESSAGGIO = {
  to: 'forno@negozio.test',
  subject: 'Nuovo ordine #c3d4e5f6',
  html: '<p>Hai un nuovo ordine</p>',
  text: 'Hai un nuovo ordine',
  tipo: 'transazionale' as const,
};
const inCoda = () => (stato.db.tabelle.email_queue ?? []) as Array<Record<string, unknown>>;

async function posta() {
  return (await import('@/lib/email/client')).sendEmail;
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(ADESSO);
  stato.resend = 'rifiuta';
  stato.spedite.length = 0;
  stato.appesi = 0;
  giro.presa = [];
  giro.segni.length = 0;
  stato.db = creaFintoDatabase({ profiles: [{ id: 'nicola', role: 'admin' }], notifications: [], email_queue: [] });
  vi.stubEnv('RESEND_API_KEY', 're_prova');
  vi.stubEnv('RESEND_FROM', 'MyCity <ordini@mycity.example>');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://mycity.example');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('R03-002 — un rifiuto di Resend non perde l email', () => {
  it('Resend rifiuta «Nuovo ordine»: il messaggio entra in email_queue per l account del negozio', async () => {
    const sendEmail = await posta();
    const esito = await sendEmail({ ...MESSAGGIO, rimandaA: 'negozio-1' });
    expect(esito.ok).toBe(false);
    expect(inCoda(), 'l email rifiutata non e entrata in coda: nessuno la rimanda').toHaveLength(1);
    const riga = inCoda()[0];
    expect(riga.user_id).toBe('negozio-1');
    expect(riga.template).toBe('posta_rimandata');
    expect(riga.sent_at ?? null).toBeNull();
    expect(Date.parse(String(riga.send_at))).toBeLessThanOrEqual(ADESSO.getTime());
    const dati = riga.metadata as Record<string, unknown>;
    expect(dati.subject).toBe(MESSAGGIO.subject);
    expect(dati.html).toBe(MESSAGGIO.html);
    expect(dati.text).toBe(MESSAGGIO.text);
  });

  it('controprova: email partita, posta spenta (skipped) o senza account da rimandare: niente in coda', async () => {
    stato.resend = 'spedisce';
    let sendEmail = await posta();
    expect((await sendEmail({ ...MESSAGGIO, rimandaA: 'negozio-1' })).ok).toBe(true);
    stato.resend = 'rifiuta';
    expect((await sendEmail({ ...MESSAGGIO })).ok).toBe(false);
    vi.resetModules();
    vi.stubEnv('RESEND_API_KEY', '');
    sendEmail = await posta();
    const spenta = await sendEmail({ ...MESSAGGIO, rimandaA: 'negozio-1' });
    expect('skipped' in spenta && spenta.skipped).toBe(true);
    expect(inCoda()).toHaveLength(0);
  });

  it('il giro della coda spedisce il messaggio rimandato all indirizzo dell account, anche senza consenso alle promozioni', async () => {
    giro.presa = [{
      id: 'q1', user_id: 'negozio-1', template: 'posta_rimandata', attempts: 0,
      scade_at: '2026-11-30T10:00:00Z',
      metadata: { subject: MESSAGGIO.subject, html: MESSAGGIO.html, text: MESSAGGIO.text, replyTo: 'info@mycity.example' },
    }];
    stato.resend = 'spedisce';
    const { POST } = await import('@/app/api/cron/send-emails/route');
    const res = await (POST as unknown as (req: Request) => Promise<Response>)(
      new Request('http://localhost/api/cron/send-emails', { method: 'POST' }),
    );
    const corpo = await res.json();
    expect(stato.spedite, 'la riga rimandata non e partita dal giro della coda').toHaveLength(1);
    const p = stato.spedite[0];
    expect(p.to).toBe('forno@negozio.test');
    expect(p.subject).toBe(MESSAGGIO.subject);
    expect(String(p.html)).toContain('Hai un nuovo ordine');
    expect(String(p.html), 'un avviso di servizio non porta il tasto per smettere').not.toContain('/api/unsubscribe');
    expect(p.reply_to).toBe('info@mycity.example');
    expect(corpo.sent).toBe(1);
    expect(giro.segni.some((s) => s.id === 'q1' && typeof s.sent_at === 'string')).toBe(true);
  });

  it('una riga rimandata senza corpo si chiude, non spedisce un messaggio vuoto', async () => {
    giro.presa = [{ id: 'q2', user_id: 'negozio-1', template: 'posta_rimandata', attempts: 0, scade_at: '2026-11-30T10:00:00Z', metadata: { subject: 'x' } }];
    stato.resend = 'spedisce';
    const { POST } = await import('@/app/api/cron/send-emails/route');
    await (POST as unknown as (req: Request) => Promise<Response>)(new Request('http://localhost/api/cron/send-emails', { method: 'POST' }));
    expect(stato.spedite).toHaveLength(0);
    expect(giro.segni.some((s) => s.id === 'q2' && typeof s.cancelled_at === 'string')).toBe(true);
  });

  it('il rimborso in contanti che chiede l IBAN, rifiutato da Resend, entra in coda per il cliente con la risposta ai contatti', async () => {
    stato.db = creaFintoDatabase({
      orders: [{
        id: 'o1', user_id: 'cliente', seller_id: 'negozio', total_price: 24, gross_total_cents: 2400, wallet_applied_cents: 0,
        seller_payout_cents: 2160, seller_payout_reversed_cents: 0, payout_status: 'HELD', stripe_payment_intent: null,
        stripe_transfer_id: null, stripe_reversal_id: null, refunded_amount_cents: 0, payment_method: 'cod',
        rider_id: null, rider_transfer_id: null, rider_payout_status: null, rider_payout_reversed_cents: 0, rider_fee_cents: 0,
        shipping_cost: 0, delivery_status: 'DELIVERED', payment_status: 'PAID', cash_confirmed_at: '2026-11-01T10:00:00Z',
      }],
      profiles: [{ id: 'nicola', role: 'admin' }],
      notifications: [],
      email_queue: [],
    });
    const { refundOrder } = await import('@/lib/stripe/payout');
    const esito = await refundOrder({ orderId: 'o1', amountCents: 2400, idempotencyKey: 'return_r1', notifyBuyer: true });
    expect(esito.bonificoCents, 'il caso da provare e quello col bonifico').toBeGreaterThan(0);
    const alCliente = inCoda().filter((r) => r.user_id === 'cliente');
    expect(alCliente, 'la richiesta dell IBAN rifiutata non e entrata in coda: il cliente non la ricevera mai').toHaveLength(1);
    expect(alCliente[0].template).toBe('posta_rimandata');
    const dati = alCliente[0].metadata as Record<string, unknown>;
    expect(typeof dati.html).toBe('string');
    expect(String(dati.replyTo ?? ''), 'la risposta con l IBAN deve arrivare alla casella dei contatti').toContain('@');
  });
});

describe('R03-002 (giro 2) — niente doppioni, niente annulli muti', () => {
  it('Resend non risponde e passa il tetto dei 10 secondi: esito ignoto, il messaggio NON entra in coda', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout'] });
    vi.setSystemTime(ADESSO);
    stato.resend = 'appeso';
    const sendEmail = await posta();
    const invio = sendEmail({ ...MESSAGGIO, rimandaA: 'negozio-1' });
    await vi.waitFor(() => expect(stato.appesi).toBe(1));
    await vi.advanceTimersByTimeAsync(11_000);
    const esito = await invio;
    expect(esito.ok).toBe(false);
    expect('error' in esito && esito.error).toBe('invio email oltre i 10 secondi');
    expect(stato.appesi, 'dopo il timeout non si ritenta').toBe(1);
    expect(inCoda(), 'dopo un timeout Resend puo averla gia spedita: in coda sarebbe un doppione').toHaveLength(0);
  });

  it('una riga posta_rimandata presa senza metadata si annulla scrivendo il motivo e lo dice nel registro', async () => {
    giro.presa = [{ id: 'q9', user_id: 'negozio-1', template: 'posta_rimandata', attempts: 0 }];
    stato.resend = 'spedisce';
    const { POST } = await import('@/app/api/cron/send-emails/route');
    const { logger } = await import('@/lib/logger');
    await (POST as unknown as (req: Request) => Promise<Response>)(new Request('http://localhost/api/cron/send-emails', { method: 'POST' }));
    expect(stato.spedite).toHaveLength(0);
    const segno = giro.segni.find((s) => s.id === 'q9' && typeof s.cancelled_at === 'string');
    expect(segno, 'la riga senza messaggio non e stata annullata').toBeTruthy();
    expect(String(segno?.last_error ?? ''), 'annullata senza motivo: nessuno sa che un email e andata persa').toMatch(/posta rimandata/);
    expect(vi.mocked(logger.error).mock.calls.some(([m]) => String(m).includes('posta rimandata annullata'))).toBe(true);
  });
});
