import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';

/**
 * R03-006 — L'ALLARME DEL TETTO DI SPESA AI ARRIVA DAL CRON, NON DALLA COPIA.
 *
 * Quando il conto della spesa AI in comune non risponde, ogni copia del sito
 * conta per sé e il tetto giornaliero non vale più per tutto il sito. L'allarme
 * stava solo nel registro della copia che serve le richieste AI, e solo se la
 * STESSA copia restava accesa per un'ora: su Vercel le copie vivono poco e
 * l'allarme poteva non arrivare mai. `allarmiTettoSpesaAiPerIlCron`
 * (lib/ai/tettoSpesa.ts) ricorda l'inizio del guasto nel database, ma nessuno
 * la chiamava: il sorvegliante (operational-alerts) non la conosceva.
 *
 * Qui il caso vero: il conto non risponde da due ore (lo ricorda la riga
 * `ai-tetto-condiviso:ripiego-da`, scritta da un giro precedente), il cron gira
 * su una copia appena nata, e l'allarme deve finire nell'email e nella risposta.
 */

const CHIAVE_RIPIEGO_DA = 'ai-tetto-condiviso:ripiego-da';
const ADESSO = new Date('2026-11-12T12:00:00.000Z');

const stato = vi.hoisted(() => ({
  /** operational_alert_log finta: alert_key → last_sent_at. */
  registro: new Map<string, string>(),
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
    rpc: async () => ({ data: stato.rpc.data, error: stato.rpc.error }),
  }),
}));
const sendEmail = vi.hoisted(() => vi.fn(async (_m: { html: string }) => ({ ok: true, id: 'finta' })));
vi.mock('@/lib/email/client', () => ({ sendEmail }));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() },
}));

import { POST as sorvegliante } from '@/app/api/cron/operational-alerts/route';
import { __azzeraRipiegoSpesaAi } from '@/lib/ai/tettoSpesa';

async function faiUnGiro() {
  const res = await sorvegliante({
    url: 'http://localhost/api/cron/operational-alerts',
    headers: new Headers(),
  } as unknown as NextRequest);
  return { http: res.status, corpo: (await res.json()) as { details?: Array<{ type: string; detail: string }> } };
}

const allarmeTettoNelleEmail = () =>
  sendEmail.mock.calls.some(([m]) => String(m.html).includes('[AI_TETTO_NON_CONDIVISO]'));
const allarmeTettoNellaRisposta = (corpo: { details?: Array<{ type: string }> }) =>
  (corpo.details ?? []).some((d) => d.type === 'AI_TETTO_NON_CONDIVISO');

describe('il sorvegliante porta l allarme del tetto di spesa AI', () => {
  const salvato = { ...process.env };
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(ADESSO);
    // Ogni giro su una copia appena nata: la memoria della copia riparte da zero.
    __azzeraRipiegoSpesaAi();
    stato.registro.clear();
    stato.rpc = { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } };
    sendEmail.mockClear();
    process.env.SUPPORT_EMAIL = 'nicola@mycity.test';
    process.env.NEXT_PUBLIC_APP_URL = 'https://mycity.test';
    process.env.AI_GLOBAL_DAILY_BUDGET_EUR = '20';
  });
  afterEach(() => {
    vi.useRealTimers();
    process.env = { ...salvato };
  });

  it('conto muto da due ore (lo ricorda il database), copia appena nata: l allarme parte per email e sta nella risposta', async () => {
    stato.registro.set(CHIAVE_RIPIEGO_DA, '2026-11-12T10:00:00.000Z');
    const { corpo } = await faiUnGiro();
    expect(allarmeTettoNellaRisposta(corpo), 'allarme del tetto assente dalla risposta del cron').toBe(true);
    expect(allarmeTettoNelleEmail(), 'allarme del tetto assente dall email al gestore').toBe(true);
    const riga = (corpo.details ?? []).find((d) => d.type === 'AI_TETTO_NON_CONDIVISO');
    expect(riga?.detail).toContain('non risponde da 120 min');
    // L'inizio del guasto non si sposta.
    expect(stato.registro.get(CHIAVE_RIPIEGO_DA)).toBe('2026-11-12T10:00:00.000Z');
  });

  it('il conto non esiste (migrazione mancante): l allarme parte al primo giro', async () => {
    stato.rpc = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.spesa_ai_di_oggi' } };
    const { corpo } = await faiUnGiro();
    expect(allarmeTettoNellaRisposta(corpo)).toBe(true);
    expect(allarmeTettoNelleEmail()).toBe(true);
  });

  it('controprova: guasto appena cominciato, niente allarme; il giro ne scrive l inizio', async () => {
    const { corpo } = await faiUnGiro();
    expect(allarmeTettoNellaRisposta(corpo)).toBe(false);
    expect(allarmeTettoNelleEmail()).toBe(false);
    expect(stato.registro.get(CHIAVE_RIPIEGO_DA)).toBe(ADESSO.toISOString());
  });

  it('controprova: il conto risponde, niente allarme e la riga del guasto si toglie', async () => {
    stato.registro.set(CHIAVE_RIPIEGO_DA, '2026-11-12T06:00:00.000Z');
    stato.rpc = { data: 150, error: null };
    const { corpo } = await faiUnGiro();
    expect(allarmeTettoNellaRisposta(corpo)).toBe(false);
    expect(allarmeTettoNelleEmail()).toBe(false);
    expect(stato.registro.has(CHIAVE_RIPIEGO_DA)).toBe(false);
  });
});
