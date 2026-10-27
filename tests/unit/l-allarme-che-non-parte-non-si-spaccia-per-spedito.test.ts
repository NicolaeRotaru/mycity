import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';

/**
 * 27/10/2026 — SE L'EMAIL D'ALLARME NON PARTIVA, IL SORVEGLIANTE DICEVA «TUTTO BENE».
 *
 * Il sorvegliante (operational-alerts) spediva l'allarme dentro un try/catch,
 * ma `sendEmail` non lancia: quando Resend rifiuta (dominio non verificato) o la
 * posta non e' configurata restituisce {ok:false}. Nessuno leggeva l'esito: il
 * giro scriveva l'attesa di sei ore per quegli allarmi e rispondeva ok:true.
 * Nicola non riceveva niente e lo stesso allarme non tornava prima di sei ore.
 *
 * Qui il caso vero: una richiesta di cancellazione ferma da venti giorni fa
 * suonare un allarme, e la posta lo rifiuta.
 */

let esitoInvio: Record<string, unknown> = { ok: true, id: 'finta' };
const scritte: Array<{ tabella: string; metodo: string }> = [];

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
        }
        const p = Promise.resolve({ data, error: null });
        return p.then.bind(p);
      }
      if (typeof k === 'symbol') return undefined;
      return (...a: unknown[]) => {
        chiamate.push({ m: String(k), a });
        if (k === 'insert' || k === 'upsert') scritte.push({ tabella: nome, metodo: String(k) });
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

async function faiUnGiro() {
  const res = await sorvegliante({
    url: 'http://localhost/api/cron/operational-alerts',
    headers: new Headers(),
  } as unknown as NextRequest);
  return { http: res.status, corpo: await res.json() };
}
const attesaScritta = () => scritte.some((s) => s.tabella === 'operational_alert_log');

describe('il sorvegliante legge l esito della email d allarme', () => {
  const salvato = { ...process.env };
  beforeEach(() => {
    scritte.length = 0;
    esitoInvio = { ok: true, id: 'finta' };
    process.env.SUPPORT_EMAIL = 'nicola@mycity.test';
    process.env.NEXT_PUBLIC_APP_URL = 'https://mycity.test';
  });
  afterEach(() => { process.env = { ...salvato }; });

  it('Resend rifiuta (dominio non verificato): il giro risponde errore, non ok', async () => {
    esitoInvio = { ok: false, error: 'domain is not verified' };
    const { http, corpo } = await faiUnGiro();
    expect(http, 'allarme non recapitato ma giro dichiarato riuscito').toBe(500);
    expect(corpo.ok).toBe(false);
  });

  it('e quegli allarmi NON vanno in attesa di sei ore: il giro dopo li ritenta', async () => {
    esitoInvio = { ok: false, error: 'domain is not verified' };
    await faiUnGiro();
    expect(attesaScritta(), 'attesa di sei ore scritta per un allarme mai partito').toBe(false);
  });

  it('anche la posta non configurata (saltata) e un allarme non recapitato', async () => {
    esitoInvio = { ok: false, skipped: true, reason: 'RESEND_FROM non configurata' };
    const { http } = await faiUnGiro();
    expect(http).toBe(500);
    expect(attesaScritta()).toBe(false);
  });

  it('controprova: recapitato, il giro e verde e l attesa si scrive', async () => {
    const { http, corpo } = await faiUnGiro();
    expect(http).toBe(200);
    expect(corpo.fresh).toBeGreaterThan(0);
    expect(attesaScritta()).toBe(true);
  });
});
