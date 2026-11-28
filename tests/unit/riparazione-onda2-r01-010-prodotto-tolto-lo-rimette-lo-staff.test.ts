import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fintoDatabase, type FintoDatabase } from './aiuti/finto-database-dei-pagamenti';
import { erroreDiSalvataggio } from '@/lib/products/prontoPerLaVendita';

/**
 * R01-010 (onda 2) — Il venditore poteva rimettere in vendita da solo un prodotto tolto dopo una
 * segnalazione accolta: «Accolta» metteva solo status 'draft', e «Attiva» lo riportava in vetrina.
 *
 * Qui la parte del codice: «Accolta» scrive il segno `tolto_dallo_staff_at`, la rotta admin dei
 * prodotti lo svuota quando lo staff rimette in vendita, e il rifiuto del database (23514, scritto
 * dal grilletto della migrazione 999k) arriva al venditore col suo motivo. Il grilletto è
 * provato su un Postgres vero col file della migrazione (vedi il rapporto dell'onda 2).
 */

const stato = vi.hoisted(() => ({ db: null as unknown as FintoDatabase }));

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(async () => {}) }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => stato.db.client }));
vi.mock('@/lib/api/middleware', () => ({
  withAdminAuth: (h: (c: { user: { id: string }; req: Request }) => unknown) => (req: Request) =>
    h({ user: { id: 'admin-1' }, req }),
}));

const { POST: accogli } = await import('@/app/api/admin/segnalazioni/accogli/route');
const { PATCH: modificaProdotto } = await import('@/app/api/admin/products/route');

const SEGNALAZIONE = '00000000-0000-4000-8000-000000000042';
const PRODOTTO = '00000000-0000-4000-8000-0000000000aa';

const richiesta = (url: string, metodo: string, corpo: unknown) =>
  new Request(`http://x${url}`, { method: metodo, headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });

beforeEach(() => {
  stato.db = fintoDatabase({
    segnalazioni: [{ id: SEGNALAZIONE, tipo: 'prodotto', oggetto_id: PRODOTTO }],
    products: [{ id: PRODOTTO, status: 'available', name: 'Borsa', tolto_dallo_staff_at: null }],
  });
});

describe('R01-010 · il prodotto tolto dopo una segnalazione accolta', () => {
  it('«Accolta» lo mette in bozza col segno «tolto dallo staff»', async () => {
    const r = await (accogli as unknown as (q: Request) => Promise<Response>)(
      richiesta('/api/admin/segnalazioni/accogli', 'POST', { id: SEGNALAZIONE }),
    );
    expect(r.status).toBe(200);
    const p = stato.db.tabelle.products[0];
    expect(p.status).toBe('draft');
    expect(typeof p.tolto_dallo_staff_at).toBe('string');
  });

  it('senza la migrazione (colonna assente) il prodotto si toglie lo stesso', async () => {
    stato.db.colonneMancanti = { products: ['tolto_dallo_staff_at'] };
    const r = await (accogli as unknown as (q: Request) => Promise<Response>)(
      richiesta('/api/admin/segnalazioni/accogli', 'POST', { id: SEGNALAZIONE }),
    );
    expect(r.status).toBe(200);
    expect(stato.db.tabelle.products[0].status).toBe('draft');
  });

  it('lo staff che lo rimette in vendita dalla rotta admin svuota il segno nella stessa scrittura', async () => {
    stato.db.tabelle.products[0] = { ...stato.db.tabelle.products[0], status: 'draft', tolto_dallo_staff_at: '2026-11-20T10:00:00Z' };
    const r = await (modificaProdotto as unknown as (q: Request) => Promise<Response>)(
      richiesta('/api/admin/products', 'PATCH', { id: PRODOTTO, status: 'available' }),
    );
    expect(r.status, await r.clone().text()).toBe(200);
    const scrittura = stato.db.scritture.find((s) => s.tabella === 'products' && s.operazione === 'update');
    expect(scrittura?.valori).toMatchObject({ status: 'available', tolto_dallo_staff_at: null });
  });

  it('senza la migrazione la rotta admin rimette in vendita come prima', async () => {
    stato.db.colonneMancanti = { products: ['tolto_dallo_staff_at'] };
    stato.db.tabelle.products[0] = { id: PRODOTTO, status: 'draft', name: 'Borsa' };
    const r = await (modificaProdotto as unknown as (q: Request) => Promise<Response>)(
      richiesta('/api/admin/products', 'PATCH', { id: PRODOTTO, status: 'available' }),
    );
    expect(r.status, await r.clone().text()).toBe(200);
    expect(stato.db.tabelle.products[0].status).toBe('available');
  });

  it('il rifiuto del database arriva al venditore col suo motivo, non come «Riprova»', () => {
    const esito = erroreDiSalvataggio({
      code: '23514',
      message: 'Questo prodotto è stato tolto dalla vetrina dopo una segnalazione accolta: può rimetterlo in vendita solo lo staff di MyCity.',
    });
    expect(esito).toEqual({ tipo: 'regola', messaggio: expect.stringMatching(/solo lo staff di MyCity/) });
  });
});
