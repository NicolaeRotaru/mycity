import { describe, it, expect, vi, beforeEach } from 'vitest';
import { segnateIn, tabellaNotifiche, type RigaNotifica } from './aiuti/finte-notifiche-push';

/**
 * R03-016 (onda 2) — LE NOTIFICHE PUSH PARTIVANO DUE VOLTE SE DUE GIRI DEL CRON SI SOVRAPPONEVANO.
 *
 * Il giro (app/api/cron/send-push) leggeva le notifiche con `pushed_at` vuoto, mandava le push e solo
 * alla fine scriveva `pushed_at`: la presa in carico non era atomica. Un secondo giro partito prima
 * della fine del primo leggeva le stesse righe e le mandava di nuovo. Adesso il giro le prende prima di
 * mandarle, con una scrittura condizionata (`pushed_at` da vuoto all'ora della presa): un secondo giro
 * non le trova più. Database in memoria (aiuti/finte-notifiche-push.ts), servizio push finto.
 */

const mondo = vi.hoisted(() => ({
  righe: [] as Array<Record<string, unknown> & { id: string }>,
  /** Cosa succede mentre il primo giro legge le preferenze (dopo aver letto le notifiche). */
  intanto: null as null | (() => Promise<unknown>),
  /** La lettura delle preferenze si rompe con un'eccezione (non con `{ error }`). */
  preferenzeCheLanciano: false,
  consegne: [] as string[],
}));

vi.mock('@/lib/api/middleware', () => ({ withCronAuth: (h: (req: unknown) => unknown) => (req: unknown) => h(req) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/push/send', () => ({
  isPushConfigured: () => true,
  iscrizioniPerUtenti: async (_s: unknown, utenti: string[]) => new Map(utenti.map((u) => [u, [{ id: `s-${u}` }]])),
  sendPushToUser: async (_s: unknown, userId: string, payload: { tag?: string }) => {
    mondo.consegne.push(payload.tag ?? userId);
    return { delivered: 1, total: 1 };
  },
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    rpc: async () => {
      if (mondo.preferenzeCheLanciano) throw new Error('fetch failed');
      const f = mondo.intanto;
      mondo.intanto = null;
      if (f) await f();
      return { data: true, error: null };
    },
    from: () => tabellaNotifiche(() => mondo.righe as RigaNotifica[]),
  }),
}));

import { POST } from '@/app/api/cron/send-push/route';

const giro = () => (POST as unknown as (req: Request) => Promise<Response>)(new Request('http://x', { method: 'POST' }));

const ORDINE_1 = '/seller/orders/3f9a12bc-1111-4222-8333-444455556661';
const ORDINE_2 = '/seller/orders/3f9a12bc-1111-4222-8333-444455556662';

beforeEach(() => {
  mondo.consegne = [];
  mondo.intanto = null;
  mondo.preferenzeCheLanciano = false;
  mondo.righe = [
    { id: 'n1', user_id: 'negozio-1', title: 'Nuovo ordine ricevuto', body: null, link: ORDINE_1, category: 'order', pushed_at: null },
    { id: 'n2', user_id: 'negozio-2', title: 'Nuovo ordine ricevuto', body: null, link: ORDINE_2, category: 'order', pushed_at: null },
  ];
});

describe('R03-016 · il giro delle push prende le notifiche con una scrittura condizionata', () => {
  it('IL CASO CHE ROMPEVA — un secondo giro parte mentre il primo legge le preferenze: ogni push parte una volta', async () => {
    let secondo: Response | null = null;
    mondo.intanto = async () => { secondo = await giro(); };

    const primo = await giro();

    expect(primo.status).toBe(200);
    expect(secondo, 'il secondo giro non è partito: la prova non prova niente').not.toBeNull();
    expect(
      [...mondo.consegne].sort(),
      'due giri sovrapposti hanno mandato la stessa push due volte al telefono del negozio',
    ).toEqual([ORDINE_1, ORDINE_2]);
    expect(segnateIn(mondo.righe as RigaNotifica[]).sort()).toEqual(['n1', 'n2']);
  });

  it('se qualcosa lancia a metà, le notifiche prese tornano al giro dopo (non restano prese e mute)', async () => {
    mondo.preferenzeCheLanciano = true;
    await expect(giro()).rejects.toThrow();
    expect(mondo.consegne).toEqual([]);
    expect(segnateIn(mondo.righe as RigaNotifica[]), 'prese e mai mandate: non partirebbero più').toEqual([]);

    mondo.preferenzeCheLanciano = false;
    await giro();
    expect([...mondo.consegne].sort(), 'il giro dopo le manda').toEqual([ORDINE_1, ORDINE_2]);
  });
});
