// La rotta GET /api/seller/lavoro-consegnato dà a ogni venditore solo il SUO lavoro (collaudo del 27/11/2026, portato nel repo).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const SDG = '11111111-1111-1111-1111-5d9000000001';
const stato = vi.hoisted(() => ({
  utente: null as null | { id: string },
  profilo: null as null | Record<string, unknown>,
  approval: { approval_status: null as string | null, approval_requested_at: null as string | null },
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/supabase/server', () => ({
  getCurrentUser: vi.fn(async () => stato.utente),
  getServerSupabase: vi.fn(async () => ({ from: vi.fn() })),
  getAdminSupabase: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn((col: string) => ({
        eq: vi.fn(() => ({
          single: vi.fn(async () => col.includes('approval_requested_at')
            ? { data: stato.approval, error: null }
            : stato.profilo ? { data: stato.profilo, error: null } : { data: null, error: { code: 'PGRST116' } }),
        })),
      })),
    })),
  })),
}));

import { GET } from '@/app/api/seller/lavoro-consegnato/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

function req(qs = '', headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost/api/seller/lavoro-consegnato${qs}`, { method: 'GET', headers: { 'x-forwarded-for': '9.9.9.9', ...headers } });
}
async function chiama(r: NextRequest) {
  const res = await (GET as unknown as (r: NextRequest, c?: unknown) => Promise<Response>)(r, { params: Promise.resolve({}) });
  const corpo = await res.json().catch(() => null);
  return { status: res.status, cc: res.headers.get('cache-control'), corpo, testo: JSON.stringify(corpo) };
}

beforeEach(() => {
  __resetRateLimitBuckets();
  delete process.env.UPSTASH_REDIS_REST_URL;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'srv';
  stato.utente = null; stato.profilo = null; stato.approval = { approval_status: null, approval_requested_at: null };
});

describe('rotta lavoro-consegnato', () => {
  it('anonimo -> 401 senza dati', async () => {
    const r = await chiama(req(`?id=${SDG}&negozioId=${SDG}`));
    expect(r.status).toBe(401);
    expect(r.testo).not.toContain('Meteora');
  });
  it('cliente (buyer) -> 403', async () => {
    stato.utente = { id: 'b1' }; stato.profilo = { id: 'b1', role: 'buyer', is_approved: false };
    const r = await chiama(req());
    expect(r.status).toBe(403);
  });
  it('rider -> 403', async () => {
    stato.utente = { id: 'r1' }; stato.profilo = { id: 'r1', role: 'rider', is_approved: true };
    expect((await chiama(req())).status).toBe(403);
  });
  it('venditore rifiutato/sospeso -> 403', async () => {
    stato.utente = { id: 's9' }; stato.profilo = { id: 's9', role: 'seller', is_approved: false };
    stato.approval = { approval_status: 'suspended', approval_requested_at: '2026-11-01' };
    expect((await chiama(req())).status).toBe(403);
  });
  it('altro venditore approvato che chiede SDG da query/header -> lavoro null', async () => {
    stato.utente = { id: '0de1905e-7000-4000-8000-000000000001' }; stato.profilo = { id: stato.utente.id, role: 'seller', is_approved: true };
    const r = await chiama(req(`?id=${SDG}&seller_id=${SDG}&negozioId=${SDG}`, { 'x-seller-id': SDG, 'x-user-id': SDG }));
    expect(r.status).toBe(200);
    expect(r.corpo).toEqual({ ok: true, data: { lavoro: null } });
    expect(r.cc).toBe('no-store');
  });
  it('venditore in attesa -> 200 lavoro null', async () => {
    stato.utente = { id: 'p1' }; stato.profilo = { id: 'p1', role: 'seller', is_approved: false };
    stato.approval = { approval_status: 'pending', approval_requested_at: '2026-11-01' };
    const r = await chiama(req());
    expect(r.status).toBe(200); expect(r.corpo.data.lavoro).toBeNull();
  });
  it('admin -> 200 lavoro null (non vede SDG)', async () => {
    stato.utente = { id: 'a1' }; stato.profilo = { id: 'a1', role: 'admin', is_approved: true };
    const r = await chiama(req(`?id=${SDG}`));
    expect(r.status).toBe(200); expect(r.corpo.data.lavoro).toBeNull();
  });
  it('SDG -> 200 con le tre parti e no-store', async () => {
    stato.utente = { id: SDG }; stato.profilo = { id: SDG, role: 'seller', is_approved: true };
    const r = await chiama(req());
    expect(r.status).toBe(200); expect(r.cc).toBe('no-store');
    expect(r.corpo.data.lavoro.sito && r.corpo.data.lavoro.social && r.corpo.data.lavoro.analisi).toBeTruthy();
    expect(r.testo).toContain('Meteora');
  });
  it('id SDG in maiuscolo da sessione (non realistico) resta SDG -- solo informativo', async () => {
    stato.utente = { id: SDG.toUpperCase() }; stato.profilo = { id: SDG.toUpperCase(), role: 'seller', is_approved: true };
    const r = await chiama(req());
    console.log('[COLLAUDO maiuscolo] lavoro presente =', !!r.corpo?.data?.lavoro);
  });
});
