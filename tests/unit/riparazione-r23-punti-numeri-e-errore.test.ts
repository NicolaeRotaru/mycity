/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { monta } from './aiuti/monta-componente';
import { accendi, attendi } from './aiuti/schermo';

/**
 * R23-018 — nella pagina dei punti i numeri hanno il punto delle migliaia (12.345),
 * e se la lettura del conto o dei movimenti non riesce la pagina lo dice, non scrive «0 punti».
 */
const globali = globalThis as Record<string, unknown>;
const rete = () => ({ isError: true, error: new Error('rete caduta'), data: undefined, isSuccess: false });
const eIlConto = (o: { queryKey: unknown[] }) => Array.isArray(o.queryKey) && o.queryKey[0] === 'loyalty' && o.queryKey[1] === 'account';
const eiMovimenti = (o: { queryKey: unknown[] }) => Array.isArray(o.queryKey) && o.queryKey[0] === 'loyalty' && o.queryKey[1] === 'txs';

beforeEach(() => {
  globali.__UTENTE__ = { id: 'u1', email: 'chi@prova.it' };
  globali.__DATI_QUERY__ = (o: { queryKey: unknown[] }) => {
    if (eIlConto(o)) return { points_balance: 12345, tier: 'silver', lifetime_earned: 1200, streak_days: 1, longest_streak: 1 };
    if (eiMovimenti(o)) return [{ id: 't1', delta: 15000, reason: 'order', created_at: '2026-10-01T10:00:00Z' }];
    return 0;
  };
  globali.__ESITO_QUERY__ = undefined;
});
afterEach(() => {
  document.body.innerHTML = '';
  globali.__UTENTE__ = undefined;
  globali.__DATI_QUERY__ = undefined;
  globali.__ESITO_QUERY__ = undefined;
});

async function apri() {
  const mod = await monta('app/profile/loyalty/page.tsx');
  const s = accendi(mod.default);
  await attendi();
  await attendi();
  return s;
}

describe('R23-018 — i numeri dei punti', () => {
  it('saldo e movimenti hanno il punto delle migliaia, e il livello dice «All\'Oro»', async () => {
    const s = await apri();
    const t = s.radice.textContent ?? '';
    expect(t).toContain('12.345');
    expect(t).not.toContain('12345');
    expect(t).toContain('+15.000 pt');
    expect(t).toContain("All'Oro");
    s.smonta();
  }, 60000);
});

describe('R23-018 — la lettura che cade', () => {
  it('conto non letto: non esce «0 punti», esce che non si riesce a leggere', async () => {
    globali.__ESITO_QUERY__ = (o: { queryKey: unknown[] }) => (eIlConto(o) ? rete() : undefined);
    globali.__DATI_QUERY__ = (o: { queryKey: unknown[] }) => (eIlConto(o) ? undefined : []);
    const s = await apri();
    const t = s.radice.textContent ?? '';
    expect(t).toContain('Non riusciamo a leggere i tuoi punti');
    expect(t).not.toContain('punti MyCity');
    s.smonta();
  }, 60000);

  it('movimenti non letti: non esce «Nessun movimento»', async () => {
    globali.__ESITO_QUERY__ = (o: { queryKey: unknown[] }) => (eiMovimenti(o) ? rete() : undefined);
    globali.__DATI_QUERY__ = (o: { queryKey: unknown[] }) => (eIlConto(o) ? { points_balance: 120, tier: 'bronze', lifetime_earned: 120 } : eiMovimenti(o) ? undefined : 0);
    const s = await apri();
    const t = s.radice.textContent ?? '';
    expect(t).toContain('Non riusciamo a leggere i movimenti');
    expect(t).not.toContain('Nessun movimento');
    s.smonta();
  }, 60000);
});

describe('R23-018 — fetchLoyaltyAccount', () => {
  afterEach(() => { vi.resetModules(); vi.doUnmock('@/lib/supabase/client'); });
  it('una lettura caduta è un errore, non «nessun conto»', async () => {
    vi.doMock('@/lib/supabase/client', () => ({
      supabase: {
        auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
        from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'rete caduta' } }) }) }) }),
      },
    }));
    const { fetchLoyaltyAccount } = await import('@/lib/loyalty');
    await expect(fetchLoyaltyAccount()).rejects.toBeTruthy();
  });
});

/**
 * R23-018 correzione (14/11/2026) — Il caso esatto della radiografia: 1250 punti, movimenti da 1000 e
 * da 250. Con la sola regola italiana di Intl il punto delle migliaia compare da cinque cifre in su, e
 * a video usciva ancora «1250 punti», «+1000 pt» (la prova di prima usava 12345 e non lo vedeva).
 */
describe('R23-018 correzione — anche i numeri a quattro cifre hanno il punto', () => {
  it('1250 punti escono «1.250», e i movimenti «+1.000 pt» e «+250 pt»', async () => {
    globali.__DATI_QUERY__ = (o: { queryKey: unknown[] }) => {
      if (eIlConto(o)) return { points_balance: 1250, tier: 'silver', lifetime_earned: 1250, streak_days: 1, longest_streak: 1 };
      if (eiMovimenti(o)) {
        return [
          { id: 't1', delta: 1000, reason: 'order_completed', created_at: '2026-10-01T10:00:00Z' },
          { id: 't2', delta: 250, reason: 'order_completed', created_at: '2026-10-02T10:00:00Z' },
        ];
      }
      return 0;
    };
    const s = await apri();
    const t = s.radice.textContent ?? '';
    expect(t, 'il saldo a quattro cifre è senza punto').toContain('1.250');
    expect(t).not.toContain('1250');
    expect(t, 'il movimento a quattro cifre è senza punto').toContain('+1.000 pt');
    expect(t).not.toContain('+1000 pt');
    expect(t).toContain('+250 pt');
    s.smonta();
  }, 60000);
});

/**
 * R23-018 correzione — Con la rete caduta `supabase.auth.getUser()` non lancia: torna
 * `{ data: { user: null }, error }`. fetchLoyaltyAccount lo leggeva come «nessun utente», rendeva null
 * e la pagina scriveva «0 punti, Bronzo».
 */
describe('R23-018 correzione — fetchLoyaltyAccount quando cade il controllo di chi sei', () => {
  afterEach(() => { vi.resetModules(); vi.doUnmock('@/lib/supabase/client'); });

  function conGetUser(risposta: { data: { user: { id: string } | null }; error: Error | null }) {
    const lettura = vi.fn(async () => ({ data: { user_id: 'u1', points_balance: 1250 }, error: null }));
    vi.doMock('@/lib/supabase/client', () => ({
      supabase: {
        auth: { getUser: async () => risposta },
        from: () => ({ select: () => ({ eq: () => ({ maybeSingle: lettura }) }) }),
      },
    }));
    return lettura;
  }

  it('getUser con la rete caduta è un errore, non «nessun conto» (che diventerebbe 0 punti)', async () => {
    conGetUser({ data: { user: null }, error: new Error('Failed to fetch') });
    const { fetchLoyaltyAccount } = await import('@/lib/loyalty');
    await expect(fetchLoyaltyAccount(), 'il guasto diventa null, cioè «0 punti, Bronzo»').rejects.toThrow('Failed to fetch');
  });

  it('senza guasto e senza utente resta null, come prima', async () => {
    const lettura = conGetUser({ data: { user: null }, error: null });
    const { fetchLoyaltyAccount } = await import('@/lib/loyalty');
    await expect(fetchLoyaltyAccount()).resolves.toBeNull();
    expect(lettura).not.toHaveBeenCalled();
  });

  it("con l'utente il conto si legge come prima", async () => {
    conGetUser({ data: { user: { id: 'u1' } }, error: null });
    const { fetchLoyaltyAccount } = await import('@/lib/loyalty');
    await expect(fetchLoyaltyAccount()).resolves.toMatchObject({ points_balance: 1250 });
  });
});
