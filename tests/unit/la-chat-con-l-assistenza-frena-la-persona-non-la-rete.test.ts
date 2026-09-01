import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * LA CHAT CON L'ASSISTENZA FRENA LA PERSONA, NON LA RETE.
 *
 * 27/8/2026 (R026) — La rotta è dentro `withAuth`, quindi chi chiama è già
 * identificato. Il freno però contava per INDIRIZZO DI RETE:
 * `key: 'support:start:' + getClientIp(req)`.
 *
 * Due effetti opposti, tutti e due reali. Da rete mobile o aziendale venti
 * persone escono con lo stesso indirizzo e condividono lo stesso contatore: la
 * chat con l'assistenza si chiude a chi non ha fatto niente — e chi scrive
 * all'assistenza di solito ha già un problema. Dall'altro lato, chi vuole
 * davvero inondarla cambia rete e passa.
 *
 * La correzione era già stata fatta su /api/chat/conversations, col commento
 * che spiega il perché: «chi sta su rete mobile non deve essere fermato per
 * colpa di uno sconosciuto». Qui non era arrivata.
 */

const stato: { chiavi: string[]; utente: { id: string } } = { chiavi: [], utente: { id: 'u-1' } };

vi.mock('@/lib/api/middleware', () => ({
  withAuth: (handler: (ctx: { user: { id: string }; req: Request }) => unknown) =>
    (req: Request) => handler({ user: stato.utente, req }),
}));
vi.mock('@/lib/rate-limit', () => ({
  rateLimitAsync: async ({ key }: { key: string }) => {
    stato.chiavi.push(key);
    return { allowed: true, remaining: 19, retryAfterSec: 0, limit: 20 };
  },
  getClientIp: () => '10.0.0.1',
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
      }),
    }),
  }),
}));

import { POST } from '@/app/api/support/conversation/route';

function apriChat(daIndirizzo: string) {
  return POST(new Request('http://localhost/api/support/conversation', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': daIndirizzo },
    body: JSON.stringify({ firstMessage: 'Il mio ordine non è arrivato.' }),
  }) as never);
}

beforeEach(() => {
  stato.chiavi = [];
  stato.utente = { id: 'u-1' };
});

describe('su cosa conta il freno della chat di assistenza', () => {
  it('IL CASO CHE ROMPEVA — due persone dalla stessa rete hanno due contatori diversi', async () => {
    stato.utente = { id: 'anna' };
    await apriChat('80.20.30.40');
    stato.utente = { id: 'bruno' };
    await apriChat('80.20.30.40'); // stessa rete aziendale, persona diversa

    expect(
      new Set(stato.chiavi).size,
      'venti colleghi condividono lo stesso contatore: la chat si chiude a chi non ha fatto niente',
    ).toBe(2);
  });

  it('la stessa persona da due reti diverse resta un contatore solo', async () => {
    await apriChat('80.20.30.40');
    await apriChat('93.40.10.5'); // e passata dal wifi alla rete mobile

    expect(
      new Set(stato.chiavi).size,
      'chi vuole inondare l assistenza cambia rete e riparte da zero',
    ).toBe(1);
  });

  it('la chiave porta dentro chi ha chiamato, non da dove', async () => {
    stato.utente = { id: 'carla' };
    await apriChat('80.20.30.40');
    expect(stato.chiavi[0]).toContain('carla');
    expect(stato.chiavi[0], 'la chiave e ancora l indirizzo di rete').not.toContain('80.20.30.40');
  });
});
