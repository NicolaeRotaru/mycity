import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FintoDatabase } from './aiuti/finto-database-dei-rimborsi';
import { creaFintoDatabase } from './aiuti/finto-database-dei-rimborsi';

/**
 * R03-003 — Se l'email «Nuovo ordine» al negozio non parte, qualcuno se ne accorge.
 *
 * `sendEmail` non lancia: su un rifiuto di Resend (quota superata, chiave revocata, dominio
 * non verificato) risponde `{ ok: false, error }`. Il riparo degli invii guardava solo le
 * eccezioni, quindi l'ordine restava senza avviso e nessuno lo sapeva. Ora l'esito si legge e
 * parte un avviso agli amministratori con il numero d'ordine, una volta per invio.
 */

const finto = vi.hoisted(() => ({ db: null as unknown as FintoDatabase }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => finto.db.client }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));

import { provaAMandare } from '@/lib/stripe/webhook/comune';

const ORDINE = 'c3d4e5f6-8888-4888-8888-888888888888';
const avvisi = () => (finto.db.tabelle.notifications ?? []).filter((n) => n.user_id === 'admin-1');

beforeEach(() => {
  finto.db = creaFintoDatabase({ profiles: [{ id: 'admin-1', role: 'admin' }], notifications: [] });
});

describe('R03-003 — una email rifiutata non passa in silenzio', () => {
  it('Resend rifiuta l email «Nuovo ordine»: parte un avviso agli amministratori con l ordine', async () => {
    await provaAMandare('avviso al negozio', { orderId: ORDINE, sellerId: 'pane' }, async () => ({ ok: false, error: 'You have reached your daily email quota' }));
    expect(avvisi(), 'nessuno sa che il negozio non è stato avvisato').toHaveLength(1);
    expect(String(avvisi()[0].body)).toContain(ORDINE.slice(0, 8));
    expect(String(avvisi()[0].body)).toContain('quota');
  });

  it('lo stesso invio ripetuto (Stripe riconsegna) non manda un secondo avviso', async () => {
    const rifiuto = async () => ({ ok: false, error: 'domain not verified' });
    await provaAMandare('avviso al negozio', { orderId: ORDINE }, rifiuto);
    await provaAMandare('avviso al negozio', { orderId: ORDINE }, rifiuto);
    expect(avvisi()).toHaveLength(1);
  });

  it('posta spenta per configurazione (skipped) o email partita: nessun avviso', async () => {
    await provaAMandare('avviso al negozio', { orderId: ORDINE }, async () => ({ ok: false, skipped: true, reason: 'RESEND_API_KEY non configurata' }));
    await provaAMandare('conferma al cliente', { orderId: ORDINE }, async () => ({ ok: true, id: 'em_1' }));
    expect(avvisi()).toHaveLength(0);
  });

  it('collaudo: il rimborso automatico (carrello, senza ordine) avvisa una volta per carrello, non una volta per sempre', async () => {
    const rifiuto = async () => ({ ok: false, error: 'quota' });
    await provaAMandare('email di rimborso automatico al cliente', { pendingCheckoutId: 'pc_1' }, rifiuto);
    await provaAMandare('email di rimborso automatico al cliente', { pendingCheckoutId: 'pc_2' }, rifiuto);
    expect(avvisi()).toHaveLength(2);
  });
});
