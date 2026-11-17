/**
 * R31-016 — Un cliente coi Termini 2.0 e la cassa già aperta ordinava lo stesso: il cancello dei
 * Termini in vigore stava solo nel portiere di /checkout (middleware.ts), e le rotte che creano
 * l'ordine non guardavano la versione accettata. Qui si mandano alle due rotte vere (contanti e
 * carta) le richieste di un cliente la cui ultima riga `privacy_terms` del verbale è di una versione
 * vecchia: la rotta risponde 403 prima di fare qualsiasi cosa. Con la versione in vigore, o quando
 * il verbale non si legge (stesso dubbio del portiere), non si ferma per i Termini.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { FASCE_DI_DOMANI } from '@/lib/quando-arriva';
import { VERSIONE_TESTI_LEGALI } from '@/lib/legal/versione';

const verbale = vi.hoisted(() => ({ versione: null as string | null, rotto: false }));

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
  // Il profilo del cliente c'è (ha una data di accettazione); il verbale porta la versione del caso.
  const catena = (tabella: string): Record<string, unknown> => {
    const risposta = () => {
      if (tabella === 'profiles') return { data: { tos_accepted_at: '2026-09-01T10:00:00Z' }, error: null };
      if (tabella === 'consent_log') {
        if (verbale.rotto) return { data: null, error: { message: 'verbale non leggibile' } };
        return { data: verbale.versione ? { versione_testo: verbale.versione } : null, error: null };
      }
      return { data: [], error: null };
    };
    const c: Record<string, unknown> = new Proxy(
      {},
      {
        get(_b, nome) {
          if (nome === 'then') return (ok: (v: unknown) => unknown) => ok(risposta());
          if (nome === 'maybeSingle' || nome === 'single') return async () => risposta();
          return () => c;
        },
      },
    );
    return c;
  };
  const client = {
    from: (t: string) => catena(t),
    rpc: () => Promise.resolve({ data: [], error: null }),
    auth: { getUser: async () => ({ data: { user: null } }) },
  };
  return { getServerSupabase: async () => client, getAdminSupabase: () => client };
});

import { POST as contanti } from '@/app/api/orders/cod/route';
import { POST as carta } from '@/app/api/stripe/checkout/route';

function richiesta(url: string): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': `r31-016-${Math.random()}` },
    body: JSON.stringify({
      groups: [{ sellerId: '22222222-2222-2222-2222-222222222222', items: [{ productId: '11111111-1111-1111-1111-111111111111', quantity: 1 }] }],
      delivery: { fullName: 'Maria', address: 'Via Calzolai 5', city: 'Piacenza', zip: '29121', phone: '3331111111' },
      pickupInStore: false,
      deliverySlot: FASCE_DI_DOMANI[0],
    }),
  });
}

const ROTTE = [
  ['contanti', contanti, 'https://mycity.test/api/orders/cod'],
  ['carta', carta, 'https://mycity.test/api/stripe/checkout'],
] as const;

const chiama = (rotta: unknown, url: string) => (rotta as (r: Request) => Promise<Response>)(richiesta(url));

beforeEach(() => {
  verbale.versione = null;
  verbale.rotto = false;
});

describe('R31-016 · le rotte d’ordine guardano la versione dei Termini accettata', () => {
  for (const [nome, rotta, url] of ROTTE) {
    it(`${nome}: coi Termini 2.0 a verbale è un 403 che chiede di accettare i Termini nuovi`, async () => {
      verbale.versione = 'privacy-1.0+terms-2.0';
      const res = await chiama(rotta, url);
      expect(res.status).toBe(403);
      expect(JSON.stringify(await res.json())).toContain('Termini di MyCity sono cambiati');
    });

    it(`${nome}: con la data nel profilo ma nessuna riga a verbale si chiede anche qui, come nel portiere`, async () => {
      const res = await chiama(rotta, url);
      expect(res.status).toBe(403);
    });

    it(`${nome}: coi Termini in vigore non si ferma per i Termini`, async () => {
      verbale.versione = VERSIONE_TESTI_LEGALI;
      const res = await chiama(rotta, url);
      expect(JSON.stringify(await res.json())).not.toContain('Termini di MyCity sono cambiati');
    });

    it(`${nome}: se il verbale non si legge si passa, come nel portiere`, async () => {
      verbale.rotto = true;
      const res = await chiama(rotta, url);
      expect(JSON.stringify(await res.json())).not.toContain('Termini di MyCity sono cambiati');
    });
  }
});
