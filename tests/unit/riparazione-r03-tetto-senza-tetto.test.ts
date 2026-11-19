import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';

/**
 * R03-006 (giro di correzione) — SENZA TETTO DI SPESA IL SORVEGLIANTE NON
 * INTERROGA IL CONTO.
 *
 * Da quando il cron operational-alerts chiama `allarmiTettoSpesaAiPerIlCron`
 * (lib/ai/tettoSpesa.ts) ogni 5 minuti, la funzione sondava il conto condiviso
 * (rpc `spesa_ai_di_oggi`) e scriveva in `operational_alert_log` anche senza
 * AI_GLOBAL_DAILY_BUDGET_EUR, e con la funzione del database assente scriveva un
 * errore nel registro: tutto per niente, perche' senza tetto l'allarme non puo'
 * partire (`allarmiTettoSpesaAi` risponde sempre []). Come `controllaTettoSpesaAi`
 * (run.ts), senza tetto niente giro di rete.
 *
 * Controprova: con il tetto a 20 € e la funzione assente l'allarme parte ancora.
 */

const CHIAVE_RIPIEGO_DA = 'ai-tetto-condiviso:ripiego-da';
const ADESSO = new Date('2026-11-19T12:00:00.000Z');
const SCRITTURE = new Set(['insert', 'upsert', 'update', 'delete']);

const stato = vi.hoisted(() => ({
  /** operational_alert_log finta: alert_key → last_sent_at. */
  registro: new Map<string, string>(),
  /** Ogni scrittura su operational_alert_log: metodo e argomenti. */
  scrittureRegistro: [] as Array<{ m: string; a: unknown[] }>,
  rpcChiamate: [] as string[],
  rpc: { data: null as unknown, error: null as null | { code?: string; message?: string } },
}));

function tabella(nome: string): unknown {
  const chiamate: Array<{ m: string; a: unknown[] }> = [];
  const c: unknown = new Proxy({}, {
    get(_b, k) {
      if (k === 'then') {
        let data: unknown = [];
        if (nome === 'operational_alert_log' && chiamate.some((x) => x.m === 'maybeSingle')) {
          const eq = chiamate.find((x) => x.m === 'eq');
          const chiave = String(eq?.a[1] ?? '');
          data = stato.registro.has(chiave) ? { last_sent_at: stato.registro.get(chiave) } : null;
        } else if (nome === 'profiles' && chiamate.some((x) => x.m === 'eq' && x.a[0] === 'role' && x.a[1] === 'admin')) {
          data = [{ id: 'admin-1' }];
        }
        const p = Promise.resolve({ data, error: null });
        return p.then.bind(p);
      }
      if (typeof k === 'symbol') return undefined;
      return (...a: unknown[]) => {
        chiamate.push({ m: String(k), a });
        if (nome === 'operational_alert_log' && SCRITTURE.has(String(k))) stato.scrittureRegistro.push({ m: String(k), a });
        if (nome === 'operational_alert_log' && k === 'upsert') {
          const righe = ([] as Array<{ alert_key: string; last_sent_at: string }>).concat(a[0] as never);
          const ignora = (a[1] as { ignoreDuplicates?: boolean } | undefined)?.ignoreDuplicates;
          for (const r of righe) {
            if (!(ignora && stato.registro.has(r.alert_key))) stato.registro.set(r.alert_key, r.last_sent_at);
          }
        }
        if (nome === 'operational_alert_log' && k === 'eq' && chiamate.some((x) => x.m === 'delete')) {
          stato.registro.delete(String(a[1]));
        }
        return c;
      };
    },
  });
  return c;
}

vi.mock('@/lib/api/middleware', () => ({
  withCronAuth: (g: (req: unknown) => unknown) => (req: unknown) => g(req),
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (t: string) => tabella(t),
    rpc: async (nome: string) => {
      stato.rpcChiamate.push(nome);
      return { data: stato.rpc.data, error: stato.rpc.error };
    },
  }),
}));
const sendEmail = vi.hoisted(() => vi.fn(async (_m: { html: string }) => ({ ok: true, id: 'finta' })));
vi.mock('@/lib/email/client', () => ({ sendEmail }));
const logger = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger }));

import { POST as sorvegliante } from '@/app/api/cron/operational-alerts/route';
import { __azzeraRipiegoSpesaAi } from '@/lib/ai/tettoSpesa';

async function faiUnGiro() {
  const res = await sorvegliante({
    url: 'http://localhost/api/cron/operational-alerts',
    headers: new Headers(),
  } as unknown as NextRequest);
  return { http: res.status, corpo: (await res.json()) as { alerts?: number; details?: Array<{ type: string; detail: string }> } };
}

const allarmeTettoNellaRisposta = (corpo: { details?: Array<{ type: string }> }) =>
  (corpo.details ?? []).some((d) => d.type === 'AI_TETTO_NON_CONDIVISO');
const allarmeTettoNelleEmail = () =>
  sendEmail.mock.calls.some(([m]) => String(m.html).includes('[AI_TETTO_NON_CONDIVISO]'));

describe('R03-006 — senza tetto di spesa il sorvegliante non interroga il conto', () => {
  const salvato = { ...process.env };
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(ADESSO);
    __azzeraRipiegoSpesaAi();
    stato.registro.clear();
    stato.scrittureRegistro.length = 0;
    stato.rpcChiamate.length = 0;
    // La funzione del conto condiviso non esiste in questo database.
    stato.rpc = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.spesa_ai_di_oggi' } };
    sendEmail.mockClear();
    logger.error.mockClear();
    process.env.SUPPORT_EMAIL = 'nicola@mycity.test';
    process.env.NEXT_PUBLIC_APP_URL = 'https://mycity.test';
    delete process.env.AI_GLOBAL_DAILY_BUDGET_EUR;
  });
  afterEach(() => {
    vi.useRealTimers();
    process.env = { ...salvato };
  });

  it('senza tetto e con la funzione assente: nessuna rpc, nessuna scrittura in operational_alert_log, nessun errore nel registro', async () => {
    const { corpo } = await faiUnGiro();
    expect(corpo.alerts).toBe(0);
    expect(stato.rpcChiamate, 'il cron ha interrogato il conto senza tetto').toEqual([]);
    expect(stato.scrittureRegistro, 'il cron ha scritto in operational_alert_log senza tetto').toEqual([]);
    expect(stato.registro.has(CHIAVE_RIPIEGO_DA)).toBe(false);
    expect(logger.error, 'il cron ha scritto un errore senza tetto').not.toHaveBeenCalled();
  });

  it('tetto a zero (spento): lo stesso, nessun giro', async () => {
    process.env.AI_GLOBAL_DAILY_BUDGET_EUR = '0';
    await faiUnGiro();
    expect(stato.rpcChiamate).toEqual([]);
    expect(stato.scrittureRegistro).toEqual([]);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('controprova: con il tetto a 20 € e la funzione assente l allarme parte ancora', async () => {
    process.env.AI_GLOBAL_DAILY_BUDGET_EUR = '20';
    const { corpo } = await faiUnGiro();
    expect(stato.rpcChiamate).toContain('spesa_ai_di_oggi');
    expect(allarmeTettoNellaRisposta(corpo)).toBe(true);
    expect(allarmeTettoNelleEmail()).toBe(true);
  });
});
