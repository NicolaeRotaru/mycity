import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 15/11/2026 (R27-005) — L'EMAIL DI ANNULLO ESCE DOPO LA RISPOSTA, E SE NON PARTE RESTA UN SEGNO.
 *
 * `sendEmail` fa due tentativi da 10 s: con la posta lenta il «Rifiuta» del negozio restava appeso
 * fino a circa 20 s dopo che l'annullo era già scritto, e nel giro degli scaduti l'attesa della posta
 * mangiava i 300 s dei cento ordini. Un'email caduta restava solo nel registro.
 *
 * Qui `after()` di Next è finto come dentro una richiesta: raccoglie il lavoro, che la piattaforma
 * farebbe dopo aver risposto. L'annullo e il giro devono rispondere senza aver aspettato la posta,
 * l'email deve partire dal lavoro registrato, e una posta che la rifiuta deve lasciare un avviso agli
 * amministratori (uno per ordine), non solo una riga nel registro.
 */

const lavori: Array<() => unknown> = [];
vi.mock('next/server', async (orig) => ({
  ...(await orig<object>()),
  after: (lavoro: () => unknown) => {
    lavori.push(lavoro);
  },
}));
vi.mock('@/lib/stripe/payout', () => ({ refundOrder: vi.fn(async () => ({ refundId: 're_1' })) }));
vi.mock('@/lib/stripe/client', async (orig) => ({ ...(await orig<object>()), isStripeConfigured: () => true }));
vi.mock('@/lib/stripe/rimborsi-da-dividere', () => ({ ilCarrelloAspettaLaDivisione: async () => false }));
vi.mock('@/lib/stripe/webhook/comune', () => ({ notifyAdmins: vi.fn(async () => 'scritto') }));
let posta: () => Promise<{ ok: boolean; reason?: string }> = async () => ({ ok: true });
const spedite: Array<{ subject: string }> = [];
vi.mock('@/lib/email/client', () => ({
  sendEmail: vi.fn(async (m: { subject: string }) => {
    const r = await posta();
    if (r.ok) spedite.push(m);
    return r;
  }),
}));
vi.mock('@/lib/api/middleware', () => ({ withCronAuth: (h: unknown) => h }));
let db: ReturnType<typeof finto>;
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => db }));

import { annullaERimborsa } from '@/lib/ordini/annulla';
import { notifyAdmins } from '@/lib/stripe/webhook/comune';
import { finto, carrello } from './carrello-finto';

const dopoLaRisposta = async () => {
  while (lavori.length) await lavori.shift()!();
};
const avvisi = () => vi.mocked(notifyAdmins).mock.calls.map((c) => [c[0], c[3]]);

beforeEach(() => {
  lavori.length = 0;
  spedite.length = 0;
  posta = async () => ({ ok: true });
  vi.mocked(notifyAdmins).mockClear();
});

describe('R27-005 — email di annullo dopo la risposta', () => {
  it('il negozio rifiuta un ordine in contanti: l annullo risponde prima della posta, poi l email parte', async () => {
    const ordini = carrello(['pane'], [1500], 'cod');
    db = finto({ orders: ordini });
    const esito = await annullaERimborsa(db as never, { ...ordini[0] } as never, { reason: 'Rifiutato dal negozio' });
    expect(esito.ok).toBe(true);
    expect(spedite).toHaveLength(0);
    expect(lavori).toHaveLength(1);
    await dopoLaRisposta();
    expect(spedite.map((m) => m.subject)).toHaveLength(1);
    expect(avvisi()).toEqual([]);
  });

  it('la posta rifiuta l email: resta un avviso agli amministratori con l ordine, una volta per ordine', async () => {
    posta = async () => ({ ok: false, reason: 'resend giù' });
    const ordini = carrello(['pane'], [1500], 'cod');
    db = finto({ orders: ordini });
    await annullaERimborsa(db as never, { ...ordini[0] } as never, { reason: 'Rifiutato dal negozio' });
    await dopoLaRisposta();
    expect(spedite).toHaveLength(0);
    expect(avvisi()).toEqual([['⚠️ Email di annullo non partita', { unaVoltaPer: 'email-annullo-pane' }]]);
    expect(String(vi.mocked(notifyAdmins).mock.calls[0][1])).toMatch(/#PANE.*non è partita/);
  });

  it('il giro degli scaduti risponde senza aspettare la posta: l email parte dal lavoro registrato', async () => {
    db = finto({ orders: carrello(['pane'], [1500], 'cod', { creati: ['2026-10-20T08:00:00Z'] }) });
    const { POST } = await import('@/app/api/cron/expire-stale-orders/route');
    const j = await (await (POST as unknown as () => Promise<Response>)()).json();
    expect(j).toMatchObject({ canceled: 1 });
    expect(spedite).toHaveLength(0);
    await dopoLaRisposta();
    expect(spedite).toHaveLength(1);
  });
});
