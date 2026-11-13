/**
 * R13-012 — Le rotte accettavano una consegna a domicilio senza fascia: l'ordine nasceva senza
 * orario (`delivery_slot` vuoto), mentre la cassa del sito ne manda sempre una. Il bar riceveva
 * alle 22:30 un ordine a domicilio e non sapeva se portarlo stasera o domattina.
 *
 * Si mandano alle due rotte vere (contanti e carta) richieste scritte a mano. Il magazzino è finto
 * e vuoto: una richiesta che passa la soglia si ferma più avanti per altro, mai «per la fascia».
 */
import { describe, expect, it, vi } from 'vitest';
import { FASCE_DI_DOMANI } from '@/lib/quando-arriva';
import { RITIRO_IN_NEGOZIO_ATTIVO } from '@/lib/constants';

vi.mock('@/lib/funzioni-al-lancio', async (originale) => ({
  ...((await originale()) as Record<string, unknown>),
  CARTA_ACCESA: true,
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/api/middleware', async (importOriginal) => {
  const vero = await importOriginal<typeof import('@/lib/api/middleware')>();
  return {
    ...vero,
    withAuthRateLimit:
      (_opzioni: unknown, gestore: (ctx: Record<string, unknown>) => unknown) =>
      (req: Request) =>
        gestore({
          user: { id: 'cliente-1', email: 'maria@test.it', email_confirmed_at: '2026-01-01T00:00:00Z' },
          profile: { id: 'cliente-1', role: 'buyer', is_approved: true },
          req,
        }),
  };
});
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  createMultiSellerCheckoutSession: vi.fn(),
  getStripe: () => ({ checkout: { sessions: { retrieve: vi.fn(), expire: vi.fn() } } }),
}));
vi.mock('@/lib/geocodifica', () => ({ coordinateDiUnIndirizzo: vi.fn(async () => null) }));
vi.mock('@/lib/supabase/server', () => {
  const risposta = { data: [], error: null };
  const catena: Record<string, unknown> = new Proxy(
    {},
    {
      get(_b, nome) {
        if (nome === 'then') return (ok: (v: unknown) => unknown) => ok(risposta);
        return () => catena;
      },
    },
  );
  const client = { from: () => catena, rpc: () => Promise.resolve(risposta), auth: { getUser: async () => ({ data: { user: null } }) } };
  return { getServerSupabase: async () => client, getAdminSupabase: () => client };
});

import { POST as contanti } from '@/app/api/orders/cod/route';
import { POST as carta } from '@/app/api/stripe/checkout/route';

function richiesta(url: string, extra: Record<string, unknown>): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': `r13-012-${Math.random()}` },
    body: JSON.stringify({
      groups: [{ sellerId: '22222222-2222-2222-2222-222222222222', items: [{ productId: '11111111-1111-1111-1111-111111111111', quantity: 1 }] }],
      delivery: { fullName: 'Maria', address: 'Via Calzolai 5', city: 'Piacenza', zip: '29121', phone: '3331111111' },
      pickupInStore: false,
      ...extra,
    }),
  });
}

const ROTTE = [
  ['contanti', contanti, 'https://mycity.test/api/orders/cod'],
  ['carta', carta, 'https://mycity.test/api/stripe/checkout'],
] as const;

describe('R13-012 · una consegna a domicilio senza fascia non nasce', () => {
  for (const [nome, rotta, url] of ROTTE) {
    it(`${nome}: senza fascia è un 400 che chiede quando ricevere l'ordine`, async () => {
      for (const extra of [{}, { deliverySlot: null }]) {
        const res = await (rotta as unknown as (r: Request) => Promise<Response>)(richiesta(url, extra));
        expect(res.status, JSON.stringify(extra)).toBe(400);
        expect(JSON.stringify(await res.json())).toContain('quando vuoi ricevere');
      }
    });

    it(`${nome}: un «ritiro in negozio» chiesto col ritiro spento diventa consegna, e senza fascia non passa`, async () => {
      const res = await (rotta as unknown as (r: Request) => Promise<Response>)(richiesta(url, { pickupInStore: true }));
      const corpo = JSON.stringify(await res.json());
      // Col ritiro acceso il ritiro resta ritiro, e la fascia non serve.
      if (RITIRO_IN_NEGOZIO_ATTIVO) expect(corpo).not.toContain('quando vuoi ricevere');
      else expect(corpo).toContain('quando vuoi ricevere');
    });

    it(`${nome}: con una fascia vera non si ferma per la fascia`, async () => {
      const res = await (rotta as unknown as (r: Request) => Promise<Response>)(richiesta(url, { deliverySlot: FASCE_DI_DOMANI[0] }));
      expect(JSON.stringify(await res.json())).not.toContain('quando vuoi ricevere');
    });
  }
});
