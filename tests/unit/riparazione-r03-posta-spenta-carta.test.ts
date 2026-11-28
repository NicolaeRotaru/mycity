import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FintoDatabase } from './aiuti/finto-database-dei-rimborsi';
import { creaFintoDatabase } from './aiuti/finto-database-dei-rimborsi';

/**
 * R03-003 — Sul sito vero, con la chiave della posta mancante, un ordine con la carta non nasce in silenzio.
 *
 * Senza RESEND_API_KEY (o RESEND_FROM) `sendEmail` risponde «skipped»: il negozio non riceve «Nuovo
 * ordine», il cliente nessuna conferma, e l'avviso della posta rifiutata salta apposta questi casi. La
 * cassa in contanti suonava già la campanella agli amministratori; adesso anche la strada della carta,
 * una volta per ordine e solo in produzione. La cura vera resta la variabile su Vercel.
 */

const finto = vi.hoisted(() => ({ db: null as unknown as FintoDatabase }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => finto.db.client }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));

import { provaAMandare } from '@/lib/stripe/webhook/comune';

const ORDINE = 'c3d4e5f6-8888-4888-8888-888888888888';
const SPENTA = { ok: false, skipped: true, reason: 'RESEND_API_KEY non configurata' };
const avvisi = () => (finto.db.tabelle.notifications ?? []).filter((n) => n.user_id === 'admin-1');

beforeEach(() => {
  finto.db = creaFintoDatabase({ profiles: [{ id: 'admin-1', role: 'admin' }], notifications: [] });
  vi.stubEnv('VERCEL_ENV', 'production');
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('R03-003 — carta con la posta spenta: gli amministratori lo sanno', () => {
  it('sul sito vero, negozio e cliente senza email: una campanella agli amministratori per l ordine', async () => {
    await provaAMandare('conferma al cliente', { orderId: ORDINE }, async () => SPENTA);
    await provaAMandare('avviso al negozio', { orderId: ORDINE, sellerId: 'pane' }, async () => SPENTA);
    expect(avvisi(), 'l ordine e nato senza email e nessuno lo sa').toHaveLength(1);
    expect(String(avvisi()[0].body)).toContain(ORDINE.slice(0, 8));
    expect(String(avvisi()[0].body)).toContain('RESEND_API_KEY');
  });

  it('controprova: fuori produzione, email partita o saltata per un altro motivo: nessuna campanella', async () => {
    await provaAMandare('avviso al negozio', { orderId: ORDINE }, async () => ({ ok: true, id: 'em_1' }));
    await provaAMandare('avviso al negozio', { orderId: ORDINE }, async () => ({ ok: false, skipped: true, reason: 'link di disiscrizione non firmabile' }));
    vi.stubEnv('VERCEL_ENV', 'preview');
    await provaAMandare('avviso al negozio', { orderId: ORDINE }, async () => SPENTA);
    await provaAMandare('avviso di bonifico rifiutato al negozio', { payoutId: 'po_1' }, async () => SPENTA);
    expect(avvisi()).toHaveLength(0);
  });

  it('fuori da un ordine (bonifico rifiutato), con la posta spenta sul sito vero: una campanella sola (come R11-002)', async () => {
    await provaAMandare('avviso di bonifico rifiutato al negozio', { payoutId: 'po_1' }, async () => SPENTA);
    await provaAMandare('avviso di bonifico rifiutato al negozio', { payoutId: 'po_1' }, async () => SPENTA);
    expect(avvisi()).toHaveLength(1);
    expect(String(avvisi()[0].body)).toContain('RESEND_API_KEY');
  });
});
