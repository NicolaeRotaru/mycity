import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * UNA SOLA FABBRICA DI CLIENT AMMINISTRATIVI.
 *
 * 27/8/2026 (R009) — `lib/supabase/server.ts` tiene da parte UN client
 * amministrativo e spiega perché (#245: ogni client porta con sé la sua coda di
 * connessioni e i suoi timer). Cinque rotte se lo rifacevano a mano con
 * `createClient(url, key, …)`. La peggiore era la cancellazione di un account —
 * l'operazione meno reversibile del sito — che leggeva
 * `process.env.NEXT_PUBLIC_SUPABASE_URL` e
 * `process.env.SUPABASE_SERVICE_ROLE_KEY` grezze, saltando sia
 * `getAdminSupabase()` sia il punto unico di `lib/env.ts`.
 *
 * Il danno non era di comportamento — le cinque copie leggevano gli stessi
 * valori — ma di manutenzione: cinque posti da ricordare il giorno in cui la
 * chiave di servizio va ruotata o le opzioni del client cambiano (per esempio
 * per mettere un tetto di tempo). Dimenticarne uno significa una rotta che
 * smette di funzionare in silenzio, e nel caso peggiore è quella che cancella
 * gli account.
 *
 * Questa prova non cerca una parola in un file: sostituisce la fabbrica unica e
 * verifica che la rotta usi QUELLA. Chi se ne costruisce uno per conto suo non
 * la vede, e la prova diventa rossa.
 */

const CHIAMANTE = { id: '99999999-9999-9999-9999-999999999999' };

const stato: { fabbricaUsata: boolean; profiloTarget: Record<string, unknown> | null } = {
  fabbricaUsata: false,
  profiloTarget: { id: 'u-2', role: 'buyer', full_name: 'Mario Rossi', store_name: null },
};

vi.mock('@/lib/api/middleware', () => ({
  withAdminAuthRateLimit:
    (_opts: unknown, handler: (ctx: { user: typeof CHIAMANTE }) => unknown) => () => handler({ user: CHIAMANTE }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(async () => {}) }));
vi.mock('@/lib/account/cancellazione', () => ({ cancellaAccount: vi.fn(async () => ({ ok: true })) }));

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => {
    stato.fabbricaUsata = true;
    return {
      from: () => ({
        select: () => ({ eq: () => ({ single: async () => ({ data: stato.profiloTarget, error: null }) }) }),
      }),
    };
  },
}));

import { DELETE } from '@/app/api/admin/users/[id]/delete/route';

function cancella(id: string) {
  const req = new Request(`http://localhost/api/admin/users/${id}/delete`, { method: 'DELETE' });
  return DELETE(req as never, { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  stato.fabbricaUsata = false;
  stato.profiloTarget = { id: 'u-2', role: 'buyer', full_name: 'Mario Rossi', store_name: null };
});

describe('la cancellazione di un account da parte di un amministratore', () => {
  it('IL CASO CHE ROMPEVA — passa dalla fabbrica unica, non da un client fatto in casa', async () => {
    const res = await cancella('11111111-1111-1111-1111-111111111111');

    expect(
      stato.fabbricaUsata,
      'la rotta si costruisce un client per conto suo: la chiave di servizio si legge in un posto in piu',
    ).toBe(true);
    expect(res.status).toBe(200);
  });

  it('un amministratore non può cancellare se stesso da qui', async () => {
    // Anti lock-out: se si cancellasse da solo non resterebbe nessuno a entrare.
    const res = await cancella(CHIAMANTE.id);
    expect(res.status).toBe(400);
  });

  it('un identificativo troppo corto non arriva nemmeno al database', async () => {
    const res = await cancella('x');
    expect(res.status).toBe(400);
    expect(stato.fabbricaUsata, 'si apre una connessione per un id che non puo esistere').toBe(false);
  });
});
