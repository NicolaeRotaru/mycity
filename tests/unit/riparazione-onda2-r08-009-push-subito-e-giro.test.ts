import { describe, it, expect, vi, beforeEach } from 'vitest';
import { segnateIn, tabellaNotifiche, type RigaNotifica } from './aiuti/finte-notifiche-push';

/**
 * R08-009 (onda 2) — L'INVIO SUBITO DELLA PUSH E IL GIRO DEL CRON CHE CORRONO INSIEME.
 *
 * L'invio subito della push «Nuovo ordine» (`mandaSubitoLaPushDelNuovoOrdine`, lib/push/subito.ts)
 * prende la campanella guardando solo `pushed_at` (da vuoto all'ora della presa). Ma il giro a orario
 * (app/api/cron/send-push) leggeva le campanelle e le segnava solo dopo averle mandate: fra la sua
 * lettura e il suo segno `pushed_at` era ancora vuoto, l'invio subito la prendeva e la mandava, e poi
 * la mandava anche il giro. Il negozio sentiva «Nuovo ordine» due volte per lo stesso ordine. Adesso
 * anche il giro prende le righe con la stessa scrittura condizionata, prima di mandarle (R03-016): chi
 * arriva secondo non trova niente da prendere. Qui l'invio subito corre mentre il giro legge le
 * preferenze, cioè dopo la sua lettura delle campanelle. Database in memoria, servizio push finto.
 */

const mondo = vi.hoisted(() => ({
  righe: [] as Array<Record<string, unknown> & { id: string }>,
  /** Cosa succede mentre il giro legge le preferenze (dopo aver letto le campanelle). */
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
    return { delivered: 1, total: 1 };
  },
}));

const client = vi.hoisted(() => ({
  rpc: async () => {
    const f = mondo.intanto;
    mondo.intanto = null;
    if (f) await f();
    return { data: true, error: null };
  },
  from: (_t: string): unknown => null,
}));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => client }));

import { POST } from '@/app/api/cron/send-push/route';
import { mandaSubitoLaPushDelNuovoOrdine, linkDelNuovoOrdineAlNegozio, type EsitoPushSubito } from '@/lib/push/subito';

client.from = () => tabellaNotifiche(() => mondo.righe as RigaNotifica[]);

const giro = () => (POST as unknown as (req: Request) => Promise<Response>)(new Request('http://x', { method: 'POST' }));
const ORDINE = '7a1b2c3d-0000-4000-8000-000000000009';

beforeEach(() => {
  mondo.consegne = [];
  mondo.intanto = null;
  mondo.righe = [{
    id: 'n-negozio', user_id: 'negozio-1', title: 'Nuovo ordine ricevuto', body: 'Ordine #7A1B2C',
    link: linkDelNuovoOrdineAlNegozio(ORDINE), category: 'order', created_at: new Date().toISOString(), pushed_at: null,
  }];
});

describe('R08-009 · invio subito e giro del cron: la push del nuovo ordine parte una volta', () => {
  it('IL CASO CHE ROMPEVA — l invio subito corre dopo la lettura del giro: una push sola', async () => {
    let subito: EsitoPushSubito | null = null;
    mondo.intanto = async () => { subito = await mandaSubitoLaPushDelNuovoOrdine(client as never, [ORDINE]); };

    await giro();

    expect(subito, 'l invio subito non è partito: la prova non prova niente').not.toBeNull();
    expect(mondo.consegne, '«Nuovo ordine» due volte sul telefono del negozio').toEqual([linkDelNuovoOrdineAlNegozio(ORDINE)]);
    expect(segnateIn(mondo.righe as RigaNotifica[])).toEqual(['n-negozio']);
  });

  it('controprova: l invio subito arriva prima del giro, il giro non la rimanda', async () => {
    const esito = await mandaSubitoLaPushDelNuovoOrdine(client as never, [ORDINE]);
    await giro();
    expect(esito.prese).toBe(1);
    expect(mondo.consegne).toHaveLength(1);
  });
});
