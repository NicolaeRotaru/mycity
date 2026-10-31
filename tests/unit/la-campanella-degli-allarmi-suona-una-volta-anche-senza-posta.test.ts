import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';

/**
 * 31/10/2026 — LA CAMPANELLA DEGLI AMMINISTRATORI E LA POSTA SONO DUE CANALI.
 *
 * Il sorvegliante (operational-alerts) gira ogni 15 minuti e avvisa in due modi:
 * la campanella nel pannello e l'email a SUPPORT_EMAIL. Due difetti, uno per verso:
 *
 *  1. Senza SUPPORT_EMAIL la rotta usciva con 500 PRIMA di suonare la campanella:
 *     nessun allarme, da nessuna parte.
 *  2. Con la posta giu', l'attesa di sei ore non si scrive (giusto: l'email va
 *     ritentata), ma la campanella si ripeteva a ogni giro — 96 avvisi al giorno.
 *
 * Qui un finto database CON MEMORIA: quello che il giro scrive nell'attesa, il
 * giro dopo lo rilegge. Il caso vero: una cancellazione d'account ferma da venti
 * giorni fa suonare un allarme.
 */

let esitoInvio: Record<string, unknown> = { ok: true, id: 'finta' };
/** operational_alert_log: chiave -> ultimo invio (ISO). */
const memoria = new Map<string, string>();
let campanelle = 0;

function tabella(nome: string): unknown {
  const chiamate: Array<{ m: string; a: unknown[] }> = [];
  const c: unknown = new Proxy({}, {
    get(_b, k) {
      if (k === 'then') {
        let data: unknown[] = [];
        if (nome === 'profiles' && chiamate.some((x) => x.m === 'not' && x.a[0] === 'deletion_requested_at')) {
          data = [{ deletion_requested_at: new Date(Date.now() - 20 * 86_400_000).toISOString() }];
        } else if (nome === 'profiles' && chiamate.some((x) => x.m === 'eq' && x.a[0] === 'role' && x.a[1] === 'admin')) {
          data = [{ id: 'admin-1' }];
        } else if (nome === 'operational_alert_log' && chiamate.some((x) => x.m === 'select')) {
          const chieste = (chiamate.find((x) => x.m === 'in')?.a[1] ?? []) as string[];
          const soglia = String(chiamate.find((x) => x.m === 'gte')?.a[1] ?? '');
          data = chieste
            .filter((k2) => memoria.has(k2) && String(memoria.get(k2)) >= soglia)
            .map((k2) => ({ alert_key: k2 }));
        }
        const p = Promise.resolve({ data, error: null });
        return p.then.bind(p);
      }
      if (typeof k === 'symbol') return undefined;
      return (...a: unknown[]) => {
        chiamate.push({ m: String(k), a });
        if (nome === 'notifications' && k === 'insert') campanelle++;
        if (nome === 'operational_alert_log' && k === 'upsert') {
          for (const r of ([] as Array<{ alert_key: string; last_sent_at: string }>).concat(a[0] as never)) {
            memoria.set(r.alert_key, r.last_sent_at);
          }
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
  getAdminSupabase: () => ({ from: (t: string) => tabella(t) }),
}));
vi.mock('@/lib/email/client', () => ({
  sendEmail: vi.fn(async () => esitoInvio),
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() },
}));

import { POST as sorvegliante } from '@/app/api/cron/operational-alerts/route';
import { sendEmail } from '@/lib/email/client';

async function faiUnGiro() {
  const res = await sorvegliante({
    url: 'http://localhost/api/cron/operational-alerts',
    headers: new Headers(),
  } as unknown as NextRequest);
  return { http: res.status, corpo: await res.json() };
}

describe('la campanella degli amministratori non dipende dalla posta', () => {
  const salvato = { ...process.env };
  beforeEach(() => {
    memoria.clear();
    campanelle = 0;
    vi.mocked(sendEmail).mockClear();
    esitoInvio = { ok: true, id: 'finta' };
    process.env.SUPPORT_EMAIL = 'nicola@mycity.test';
    process.env.NEXT_PUBLIC_APP_URL = 'https://mycity.test';
  });
  afterEach(() => { process.env = { ...salvato }; });

  it('IL CASO CHE ROMPEVA — senza SUPPORT_EMAIL la campanella suona lo stesso', async () => {
    delete process.env.SUPPORT_EMAIL;
    const { http, corpo } = await faiUnGiro();
    expect(http, 'la casella mancante deve restare un errore visibile').toBe(500);
    expect(corpo.ok).toBe(false);
    expect(campanelle, 'nessun allarme ne in email ne nel pannello').toBe(1);
  });

  it('IL CASO CHE ROMPEVA — posta giu per due giri: la campanella suona una volta sola', async () => {
    esitoInvio = { ok: false, skipped: true, reason: 'RESEND_FROM non configurata' };
    await faiUnGiro();
    await faiUnGiro();
    expect(campanelle, 'la campanella si ripete ogni 15 minuti mentre la posta e giu').toBe(1);
  });

  it('e intanto l email, che non e partita, si ritenta a ogni giro', async () => {
    esitoInvio = { ok: false, error: 'domain is not verified' };
    const primo = await faiUnGiro();
    const secondo = await faiUnGiro();
    expect(primo.http).toBe(500);
    expect(secondo.http, 'il secondo giro non deve dichiararsi sano').toBe(500);
    expect(vi.mocked(sendEmail)).toHaveBeenCalledTimes(2);
  });

  it('senza SUPPORT_EMAIL per due giri: una campanella, non due', async () => {
    delete process.env.SUPPORT_EMAIL;
    await faiUnGiro();
    await faiUnGiro();
    expect(campanelle).toBe(1);
  });

  it('controprova: posta che va, una campanella e una email, poi silenzio per sei ore', async () => {
    const primo = await faiUnGiro();
    const secondo = await faiUnGiro();
    expect(primo.http).toBe(200);
    expect(secondo.corpo.fresh).toBe(0);
    expect(campanelle).toBe(1);
    expect(vi.mocked(sendEmail)).toHaveBeenCalledTimes(1);
  });
});
