import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * R02-010 (onda 2) — IL PERMESSO DI SEI ORE SPESO PER UN TENTATIVO CHE NON E' PARTITO.
 *
 * Un prodotto importato in errore si ritenta al massimo una volta ogni sei ore
 * (`ritentoDopoErroreConsentito`, chiave `ext-sync-errore:<id>`, max 1). Il permesso
 * si prende PRIMA del tentativo. Il collaudo ha trovato che un prodotto gia' in
 * errore, ripreso dal giro quando il budget AI era finito, aveva gia' speso il suo
 * permesso: il giro si fermava (giusto, non e' colpa del prodotto) ma il prodotto
 * restava frenato sei ore anche col budget tornato. La cura e' in lib/rate-limit.ts
 * (`restituisciColpo`): il permesso torna al prodotto.
 *
 * Qui il freno e' quello vero (contatore in memoria, niente Upstash); database e
 * modello sono finti. Orologio finto.
 */
type Riga = {
  id: string; name: string; seller_id: string | null; external_marketplace: string | null; external_source_url: string;
  external_synced_at: string | null; external_sync_status: string | null; external_data: { price: number; source_title: string };
};
const stato = vi.hoisted(() => ({
  errore: null as unknown,
  righe: [] as Riga[],
  chiamate: [] as string[],
  aggiornamenti: [] as Array<Record<string, unknown>>,
}));
vi.mock('@/lib/funzioni-al-lancio', async (orig) => {
  const vero = await orig<typeof import('@/lib/funzioni-al-lancio')>();
  return { ...vero, AI_NEGOZI_ACCESA: true };
});
vi.mock('@/lib/env', async (orig) => {
  const vero = await orig<typeof import('@/lib/env')>();
  return { ...vero, env: { ...vero.env, anthropicKey: () => 'sk-test' } };
});
vi.mock('@/lib/api/middleware', () => ({
  withCronAuth: (h: (r: unknown) => unknown) => (r: unknown) => h(r),
  withAdminAuth:
    (h: (ctx: { params: Record<string, string> }) => unknown) =>
    (_req: unknown, ctx: { params: Record<string, string> }) =>
      h({ params: ctx.params }),
}));
vi.mock('@/lib/products/externalSync', async (orig) => {
  const vero = await orig<typeof import('@/lib/products/externalSync')>();
  return {
    ...vero,
    // Solo il modello e' finto: il freno di sei ore e la sua restituzione sono quelli veri.
    fetchExternalSnapshot: async (query: string) => {
      stato.chiamate.push(query);
      if (stato.errore) throw stato.errore;
      return { price: 12, external: { price: 12, availability: 'in_stock', source_title: query } };
    },
  };
});
vi.mock('@/lib/supabase/server', () => {
  const domanda = () => {
    let filtro: 'sani' | 'falliti' | null = null;
    let aggiornamento: Record<string, unknown> | null = null;
    const q: Record<string, unknown> = {};
    Object.assign(q, {
      select: () => q, not: () => q, order: () => q, limit: () => q, insert: async () => ({ error: null }),
      neq: () => q,
      or: () => { filtro = 'sani'; return q; },
      update: (v: Record<string, unknown>) => { aggiornamento = v; return q; },
      eq: (c: string, v: unknown) => {
        if (aggiornamento) {
          stato.aggiornamenti.push({ ...aggiornamento, id: v });
          const riga = stato.righe.find((r) => r.id === v);
          if (riga) Object.assign(riga, aggiornamento);
          aggiornamento = null;
          return Object.assign(Promise.resolve({ data: riga ? [{ id: riga.id }] : [], error: null }), q, {
            neq: () => ({ select: async () => ({ data: riga ? [{ id: riga.id }] : [], error: null }) }),
          });
        }
        if (c === 'external_sync_status' && v === 'error') filtro = 'falliti';
        return q;
      },
      single: async () => ({ data: stato.righe[0] ? { ...stato.righe[0] } : null, error: null }),
      then: (ok: (x: unknown) => void) => {
        const data = stato.righe.filter((r) =>
          filtro === 'falliti' ? r.external_sync_status === 'error' : filtro === 'sani' ? r.external_sync_status !== 'error' : true);
        ok({ data, error: null });
      },
    });
    return q;
  };
  return { getAdminSupabase: () => ({ from: domanda }), getServerSupabase: async () => ({ from: domanda }) };
});

import { AiCallError } from '@/lib/ai/run';
import { __resetRateLimitBuckets, rateLimitAsync, restituisciColpo } from '@/lib/rate-limit';
import { ritentoDopoErroreConsentito } from '@/lib/products/externalSync';

const ID = '22222222-2222-4222-8222-222222222222';
const inErrore = (id: string): Riga => ({
  id, name: id, seller_id: 's1', external_marketplace: 'amazon', external_source_url: 'https://amazon.it/x',
  external_synced_at: null, external_sync_status: 'error', external_data: { price: 10, source_title: id },
});

async function giro(): Promise<Record<string, unknown>> {
  const { GET } = await import('@/app/api/cron/external-price-alerts/route');
  return (await (GET as unknown as (r: Request) => Promise<Response>)(new Request('http://x'))).json();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-28T10:00:00Z'));
  __resetRateLimitBuckets();
  stato.righe = []; stato.chiamate.length = 0; stato.aggiornamenti.length = 0; stato.errore = null;
});
afterEach(() => { vi.useRealTimers(); });

describe('il freno di sei ore restituisce il permesso a chi non e stato ritentato', () => {
  it('restituisciColpo ridà il colpo appena preso, e solo quello', async () => {
    const chiave = { key: 'prova-colpo', max: 1, windowMs: 6 * 60 * 60_000 };
    expect((await rateLimitAsync(chiave)).allowed).toBe(true);
    expect((await rateLimitAsync(chiave)).allowed).toBe(false);
    await restituisciColpo(chiave);
    expect((await rateLimitAsync(chiave)).allowed, 'il colpo restituito non e tornato disponibile').toBe(true);
    // Restituire piu' colpi di quelli presi non crea permessi in piu'.
    await restituisciColpo(chiave);
    await restituisciColpo(chiave);
    expect((await rateLimitAsync(chiave)).allowed).toBe(true);
    expect((await rateLimitAsync(chiave)).allowed).toBe(false);
  });

  for (const [nome, errore] of [
    ['budget AI finito', () => AiCallError.perTettoSpesa('marketplace-import')],
    ['spesa di oggi non leggibile', () => AiCallError.perSpesaSconosciuta('marketplace-import')],
    ['modello che manca', () => new AiCallError('marketplace-import', 404)],
  ] as const) {
    it(`giro a orario, ${nome}: al giro dopo il prodotto in errore si ritenta subito`, async () => {
      stato.righe = [inErrore('p1')];
      stato.errore = errore();
      await giro();
      expect(stato.chiamate).toEqual(['p1']);

      // Il guasto passa (budget di nuovo disponibile) e il giro dopo riparte.
      stato.errore = null;
      vi.setSystemTime(new Date('2026-11-28T10:30:00Z'));
      const r = await giro();
      expect(stato.chiamate, 'il prodotto e rimasto frenato sei ore senza essere stato ritentato').toEqual(['p1', 'p1']);
      expect(r.checked).toBe(1);
    });
  }

  it('un errore vero del prodotto il permesso lo consuma: al giro dopo resta frenato', async () => {
    stato.righe = [inErrore('p1')];
    stato.errore = new AiCallError('marketplace-import', 500);
    await giro();
    stato.errore = null;
    vi.setSystemTime(new Date('2026-11-28T10:30:00Z'));
    await giro();
    expect(stato.chiamate).toEqual(['p1']);
  });

  it('dalla pagina del prodotto (GET), budget finito: il permesso torna al prodotto', async () => {
    stato.righe = [{ ...inErrore(ID), name: 'Lampada' }];
    stato.errore = AiCallError.perTettoSpesa('marketplace-import');
    const { GET } = await import('@/app/api/products/[id]/external-refresh/route');
    const chiedi = () =>
      (GET as unknown as (r: Request, c: { params: Promise<{ id: string }> }) => Promise<Response>)(
        new Request(`http://x/api/products/${ID}/external-refresh`, { headers: { 'x-forwarded-for': '1.2.3.4' } }),
        { params: Promise.resolve({ id: ID }) },
      );
    await chiedi();
    // Il tentativo parte in sottofondo: si aspetta che finisca.
    await vi.waitFor(() => expect(stato.aggiornamenti.some((a) => a.external_sync_status === 'error')).toBe(true));
    await vi.waitFor(async () => {
      // Il permesso di sei ore e' tornato: il prossimo tentativo del prodotto e' consentito.
      expect(await ritentoDopoErroreConsentito(ID)).toBe(true);
    });
  });
});

describe('con Upstash il permesso torna nel contatore condiviso, non nella memoria della copia', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('il colpo tolto in Upstash rende di nuovo disponibile il permesso a tutte le copie', async () => {
    const contatori = new Map<string, number>();
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://upstash.finto');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'gettone');
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      const comandi = JSON.parse(init.body) as string[][];
      const risultati = comandi.map(([cmd, a, , c]) => {
        if (cmd === 'INCR') {
          contatori.set(a, (contatori.get(a) ?? 0) + 1);
          return { result: contatori.get(a) };
        }
        if (cmd === 'EXPIRE') return { result: 1 };
        if (cmd === 'PTTL') return { result: 60_000 };
        if (cmd === 'EVAL') {
          // Lo script: toglie uno solo se il contatore e' sopra zero.
          const v = contatori.get(c) ?? 0;
          if (v > 0) contatori.set(c, v - 1);
          return { result: Math.max(0, v - 1) };
        }
        return { error: `comando sconosciuto ${cmd}` };
      });
      return new Response(JSON.stringify(risultati), { status: 200 });
    });
    vi.resetModules();
    const rl = await import('@/lib/rate-limit');
    const chiave = { key: 'ext-sync-errore:upstash', max: 1, windowMs: 6 * 60 * 60_000 };
    expect((await rl.rateLimitAsync(chiave)).allowed).toBe(true);
    expect((await rl.rateLimitAsync(chiave)).allowed).toBe(false);
    // Anche il secondo colpo (negato) conta in Upstash: si restituiscono tutti e due.
    await rl.restituisciColpo(chiave);
    await rl.restituisciColpo(chiave);
    expect(contatori.get('rl:ext-sync-errore:upstash')).toBe(0);
    // Una copia nuova (memoria vuota) vede il permesso tornato.
    vi.resetModules();
    const altraCopia = await import('@/lib/rate-limit');
    expect((await altraCopia.rateLimitAsync(chiave)).allowed).toBe(true);
    // Mai sotto zero.
    await altraCopia.restituisciColpo(chiave);
    await altraCopia.restituisciColpo(chiave);
    expect(contatori.get('rl:ext-sync-errore:upstash')).toBe(0);
  });
});
