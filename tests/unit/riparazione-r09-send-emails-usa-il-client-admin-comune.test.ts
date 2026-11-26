/**
 * R09-002 — La rotta delle email a orario usa il client admin comune (getAdminSupabase),
 * non se ne crea uno suo con createClient.
 */
import { describe, it, expect, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const stato = vi.hoisted(() => ({ adminChiesto: 0, createClientChiamato: 0, rpc: [] as string[] }));

vi.mock('@/lib/api/middleware', () => ({
  withCronAuth: (g: (req: unknown) => unknown) => (req: unknown) => g(req),
}));
vi.mock('@/lib/cron/fermo-dei-lavori', () => ({
  chiamataDelCalendarioFerma: () => false,
  rispostaDelFermo: () => new Response('fermo'),
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => {
    stato.adminChiesto++;
    return {
      rpc: (nome: string) => {
        stato.rpc.push(nome);
        return Promise.resolve({ data: [], error: null });
      },
      from: () => new Proxy({}, { get: (_t, k) => (k === 'then' ? undefined : () => new Proxy({}, { get: (_t2, k2) => (k2 === 'then' ? (r: (v: unknown) => void) => r({ data: [], error: null, count: 0 }) : () => ({}) ) })) }),
    };
  },
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => {
    stato.createClientChiamato++;
    throw new Error('createClient non va chiamato dalla rotta');
  },
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));

import { GET } from '@/app/api/cron/send-emails/route';

describe('R09-002 — send-emails usa il client admin comune', () => {
  it('prende il client da getAdminSupabase e non crea un suo createClient', async () => {
    try {
      await GET(new Request('https://mycity.test/api/cron/send-emails') as unknown as NextRequest);
    } catch {
      /* il giro può fallire sulle finte: conta da dove ha preso il client */
    }
    expect(stato.adminChiesto).toBeGreaterThan(0);
    expect(stato.createClientChiamato).toBe(0);
  });
});
