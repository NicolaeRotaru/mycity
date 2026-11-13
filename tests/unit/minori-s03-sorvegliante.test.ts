import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { readFileSync } from 'node:fs';

/**
 * S03 — il sorvegliante degli allarmi (operational-alerts).
 * Schede 7, 12, 16, 17, 1585, 1637, 1638, 2046, 2047, 2417, 2435, 2441.
 *
 * Il finto database registra ogni catena di chiamate e risponde con `risposta(tabella, chiamate)`.
 */
type Chiamata = { m: string; a: unknown[] };
type Esito = { data?: unknown; error?: { message: string } | null; count?: number | null };
let risposta: (t: string, c: Chiamata[]) => Esito | undefined = () => undefined;
const memoria = new Map<string, string>();
const catene: Array<{ t: string; c: Chiamata[] }> = [];
let campanelle: Array<Record<string, unknown>> = [];
let erroreInsert: string | null = null;
let erroreUpsert: string | null = null;

function tabella(nome: string): unknown {
  const chiamate: Chiamata[] = [];
  catene.push({ t: nome, c: chiamate });
  const c: unknown = new Proxy({}, {
    get(_b, k) {
      if (k === 'then') {
        let esito: Esito = { data: [], error: null };
        const su = (m: string) => chiamate.some((x) => x.m === m);
        if (nome === 'operational_alert_log' && su('upsert')) {
          esito = { data: null, error: erroreUpsert ? { message: erroreUpsert } : null };
          if (!erroreUpsert) {
            for (const r of ([] as Array<{ alert_key: string; last_sent_at: string }>).concat(chiamate.find((x) => x.m === 'upsert')!.a[0] as never)) {
              memoria.set(r.alert_key, r.last_sent_at);
            }
          }
        } else if (nome === 'notifications' && su('insert')) {
          esito = { data: null, error: erroreInsert ? { message: erroreInsert } : null };
          if (!erroreInsert) campanelle.push(...([] as Array<Record<string, unknown>>).concat(chiamate.find((x) => x.m === 'insert')!.a[0] as never));
        } else if (nome === 'operational_alert_log' && su('select')) {
          const chieste = (chiamate.find((x) => x.m === 'in')?.a[1] ?? []) as string[];
          esito = { data: chieste.filter((k2) => memoria.has(k2)).map((k2) => ({ alert_key: k2 })), error: null };
        } else if (nome === 'profiles' && chiamate.some((x) => x.m === 'eq' && x.a[1] === 'admin')) {
          esito = { data: [{ id: 'admin-1' }], error: null };
        }
        esito = risposta(nome, chiamate) ?? esito;
        const p = Promise.resolve(esito);
        return p.then.bind(p);
      }
      if (typeof k === 'symbol') return undefined;
      return (...a: unknown[]) => { chiamate.push({ m: String(k), a }); return c; };
    },
  });
  return c;
}

vi.mock('@/lib/api/middleware', () => ({ withCronAuth: (g: (r: unknown) => unknown) => (r: unknown) => g(r) }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => ({ from: (t: string) => tabella(t) }) }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true, id: 'x' })) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));

import { POST as sorvegliante } from '@/app/api/cron/operational-alerts/route';
import { sendEmail } from '@/lib/email/client';

async function giro(aMano = false) {
  const url = `http://localhost/api/cron/operational-alerts${aMano ? '?a_mano=1' : ''}`;
  const res = await sorvegliante({ url, headers: new Headers() } as unknown as NextRequest);
  return { http: res.status, corpo: await res.json() };
}
const emailHtml = () => String((vi.mocked(sendEmail).mock.calls.at(-1)?.[0] as { html?: string } | undefined)?.html ?? '');
const ordineFermo = (o: Record<string, unknown>) => (t: string, c: Chiamata[]): Esito | undefined =>
  t === 'orders' && c.some((x) => x.m === 'eq' && x.a[0] === 'delivery_status' && x.a[1] === 'NEW') ? { data: [o], error: null } : undefined;

const salvato = { ...process.env };
beforeEach(() => {
  memoria.clear(); catene.length = 0; campanelle = []; erroreInsert = null; erroreUpsert = null;
  risposta = () => undefined;
  vi.mocked(sendEmail).mockClear();
  process.env.SUPPORT_EMAIL = 'nicola@mycity.test';
  process.env.NEXT_PUBLIC_APP_URL = '';
  process.env.LAVORI_A_ORARIO = 'accesi';
});
afterEach(() => { process.env = { ...salvato }; });

const vecchio = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

describe('il sorvegliante', () => {
  it('7 — l ordine della sera per domani non è «bloccato» un ora dopo', async () => {
    // Nato 65 minuti fa per «Domani 9:00-12:00»: in regola fino a domattina.
    risposta = ordineFermo({ id: 'aaaaaaaa-1', created_at: vecchio(65), delivery_slot: 'Domani 9:00-12:00', profiles: { store_name: 'Forno' } });
    const { corpo } = await giro();
    // R14-003 — Ogni ordine che il negozio non accetta entro 5 minuti avvisa Nicola, una volta sola
    // («ordine nuovo da accettare»): è l'unico allarme che questo ordine porta. Il «bloccato»
    // (ORDER_STUCK_NEW) resta escluso fino a domattina.
    const dettagli = (corpo.details ?? []) as Array<{ type: string; detail: string }>;
    expect(dettagli.map((d) => d.type)).toEqual(['ORDINE_DA_ACCETTARE']);
    expect(dettagli.some((d) => /bloccato/i.test(d.detail))).toBe(false);
  });

  it('7 — l ordine ormai alla scadenza invece suona', async () => {
    risposta = ordineFermo({ id: 'aaaaaaaa-2', created_at: vecchio(200), delivery_slot: null, profiles: { store_name: 'Forno' } });
    const { corpo } = await giro();
    expect(corpo.details.map((d: { type: string }) => d.type)).toContain('ORDER_STUCK_NEW');
  });

  it('1637 — i contanti non confermati si cercano per consegna, non per giorno di nascita', async () => {
    await giro();
    const cod = catene.find((x) => x.t === 'orders' && x.c.some((y) => y.m === 'eq' && y.a[1] === 'cod'))!;
    const filtro = String(cod.c.find((y) => y.m === 'or')?.a[0] ?? '');
    expect(filtro).toMatch(/^delivered_at\.lt\./);
    expect(cod.c.some((y) => y.m === 'gte' && y.a[0] === 'created_at')).toBe(false);
  });

  it('1638 — la coda email che non si legge non è «nessuna anomalia»', async () => {
    risposta = (t) => (t === 'email_queue' ? { count: null, error: { message: 'statement timeout' } } : undefined);
    const { http, corpo } = await giro();
    expect(http).toBe(500);
    expect(String(corpo.controlliSaltati)).toContain('coda email');
  });

  it('17 — la chiave dell allarme della coda email è fissa, così l attesa di sei ore aggancia', async () => {
    risposta = (t) => (t === 'email_queue' ? { count: 80, error: null } : undefined);
    const { corpo } = await giro();
    expect(corpo.details.find((d: { type: string }) => d.type === 'EMAIL_BACKLOG').key).toBe('EMAIL_BACKLOG');
  });

  it('12 — un controllo saltato non butta via gli allarmi veri trovati dagli altri', async () => {
    const fermo = ordineFermo({ id: 'aaaaaaaa-3', created_at: vecchio(200), delivery_slot: null, profiles: { store_name: 'Forno' } });
    risposta = (t, c) => (t === 'email_queue' ? { count: null, error: { message: 'giù' } } : fermo(t, c));
    const { http } = await giro();
    expect(http).toBe(500);
    expect(emailHtml()).toMatch(/ORDER_STUCK_NEW/);
    expect(emailHtml()).toMatch(/SORVEGLIANTE_INCOMPLETO/);
    expect(campanelle.length).toBeGreaterThan(0);
  });

  it('2417 — email partita e campanella no: al giro dopo la campanella si ritenta', async () => {
    risposta = ordineFermo({ id: 'aaaaaaaa-4', created_at: vecchio(200), delivery_slot: null, profiles: { store_name: 'Forno' } });
    erroreInsert = 'rifiutata';
    await giro();
    expect(campanelle).toHaveLength(0);
    erroreInsert = null;
    await giro();
    expect(campanelle.length).toBeGreaterThan(0);
  });

  it('2046 — attesa di sei ore non scritta: il giro non si dichiara sano', async () => {
    risposta = ordineFermo({ id: 'aaaaaaaa-5', created_at: vecchio(200), delivery_slot: null, profiles: { store_name: 'Forno' } });
    erroreUpsert = 'permesso negato';
    const { http, corpo } = await giro();
    expect(http).toBe(500);
    expect(String(corpo.problemi)).toMatch(/attesa non registrata/);
  });

  it('2046 — amministratori non letti: lo dice la risposta', async () => {
    const fermo = ordineFermo({ id: 'aaaaaaaa-6', created_at: vecchio(200), delivery_slot: null, profiles: { store_name: 'Forno' } });
    risposta = (t, c) =>
      t === 'profiles' && c.some((x) => x.m === 'eq' && x.a[1] === 'admin') ? { data: null, error: { message: 'timeout' } } : fermo(t, c);
    const { http, corpo } = await giro();
    expect(http).toBe(500);
    expect(String(corpo.problemi)).toMatch(/amministratori non letti/);
  });

  it('16 e 2047 — link dal vero indirizzo del sito e nomi filtrati nell HTML', async () => {
    risposta = ordineFermo({ id: 'aaaaaaaa-7', created_at: vecchio(200), delivery_slot: null, profiles: { store_name: '<a href="https://x.it">Apri</a>' } });
    await giro();
    const html = emailHtml();
    expect(html).not.toContain('<a href="https://x.it">');
    expect(html).toContain('&lt;a href=');
    expect(html).not.toContain('href="undefined');
    expect(html).not.toMatch(/href="\/admin/);
  });

  it('2435 — col fermo acceso l allarme del lavoro fermo lo dice', async () => {
    process.env.LAVORI_A_ORARIO = '';
    risposta = (t) => (t === 'cron_heartbeats' ? { data: [{ name: 'send-emails', last_run_at: vecchio(60 * 24 * 3) }], error: null } : undefined);
    // Col fermo acceso il sorvegliante gira solo a mano.
    const { corpo } = await giro(true);
    const stale = corpo.details.find((d: { type: string }) => d.type === 'CRON_STALE');
    expect(stale.detail).toMatch(/LAVORI_A_ORARIO non è «accesi»/);
  });

  it('1585 e 2441 — la lettura della cassa ha un tetto, e il commento sul dettaglio ordine non mente', () => {
    const src = readFileSync('app/api/cron/operational-alerts/route.ts', 'utf8');
    expect(src).toMatch(/\.from\('cod_reconciliations'\)\s*\.select\('rider_id, remitted_at, collected_cents, status'\)[\s\S]{0,200}\.limit\(/);
    expect(src).not.toMatch(/\/admin\/orders\/<id> non esiste/);
  });
});
