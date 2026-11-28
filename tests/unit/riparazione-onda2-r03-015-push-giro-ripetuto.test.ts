import { describe, it, expect, vi, beforeEach } from 'vitest';
import { segnateIn, tabellaNotifiche, type RigaNotifica } from './aiuti/finte-notifiche-push';

/**
 * R03-015 (onda 2) — IL GIRO DELLE PUSH RIPETUTO (RITENTATIVO DI VERCEL O CHIAMATA A MANO) MANDAVA DUE VOLTE.
 *
 * Il caso più comune della sovrapposizione: il giro è lento a mandare (il servizio push risponde piano,
 * cento notifiche a gruppi di dieci), e intanto arriva un secondo giro — il ritentativo della
 * piattaforma o qualcuno che lo chiama a mano col curl in testa alla rotta. Il primo segnava `pushed_at`
 * solo alla fine: il secondo rileggeva le stesse righe, anche quelle già consegnate, e le rimandava.
 * Adesso le righe si prendono all'inizio (R03-016, scrittura condizionata): il secondo giro non trova
 * niente. Qui il secondo giro parte mentre il primo sta consegnando la prima push.
 */

const mondo = vi.hoisted(() => ({
  righe: [] as Array<Record<string, unknown> & { id: string }>,
  /** Cosa succede mentre il primo giro consegna la prima push. */
  intanto: null as null | (() => Promise<unknown>),
  consegne: [] as string[],
}));

vi.mock('@/lib/api/middleware', () => ({ withCronAuth: (h: (req: unknown) => unknown) => (req: unknown) => h(req) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/push/send', () => ({
  isPushConfigured: () => true,
  iscrizioniPerUtenti: async (_s: unknown, utenti: string[]) => new Map(utenti.map((u) => [u, [{ id: `s-${u}` }]])),
  sendPushToUser: async (_s: unknown, userId: string, payload: { tag?: string }) => {
    mondo.consegne.push(payload.tag ?? userId);
    const f = mondo.intanto;
    mondo.intanto = null;
    if (f) await f();
    return { delivered: 1, total: 1 };
  },
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    rpc: async () => ({ data: true, error: null }),
    from: () => tabellaNotifiche(() => mondo.righe as RigaNotifica[]),
  }),
}));

import { POST } from '@/app/api/cron/send-push/route';

const giro = () => (POST as unknown as (req: Request) => Promise<Response>)(new Request('http://x', { method: 'POST' }));

beforeEach(() => {
  mondo.consegne = [];
  mondo.intanto = null;
  mondo.righe = Array.from({ length: 3 }, (_, i) => ({
    id: `n${i + 1}`,
    user_id: `cliente-${i + 1}`,
    title: 'Il tuo ordine è pronto',
    body: null,
    link: `/orders/3f9a12bc-1111-4222-8333-44445555666${i + 1}`,
    category: 'order',
    pushed_at: null,
  }));
});

describe('R03-015 · il giro ripetuto mentre il primo sta mandando non rimanda niente', () => {
  it('IL CASO CHE ROMPEVA — il ritentativo arriva durante la prima consegna: tre notifiche, tre push', async () => {
    let secondo: { sent?: number } | null = null;
    mondo.intanto = async () => { secondo = (await (await giro()).json()) as { sent?: number }; };

    const primo = (await (await giro()).json()) as { sent?: number };

    expect(secondo, 'il secondo giro non è partito: la prova non prova niente').not.toBeNull();
    expect(mondo.consegne, 'il giro ripetuto ha rimandato push già consegnate o in consegna').toHaveLength(3);
    expect(new Set(mondo.consegne).size).toBe(3);
    expect((primo.sent ?? 0) + (secondo!.sent ?? 0)).toBe(3);
    expect(segnateIn(mondo.righe as RigaNotifica[]).sort()).toEqual(['n1', 'n2', 'n3']);
  });

  it('controprova: due giri uno dopo l altro, il secondo non trova niente da mandare', async () => {
    await giro();
    const secondo = (await (await giro()).json()) as { sent?: number; processed?: number };
    expect(mondo.consegne).toHaveLength(3);
    expect(secondo.sent).toBe(0);
  });
});
