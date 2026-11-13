// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * R21-008 — CHI SEGNALA UN CONTENUTO ILLECITO LASCIANDO L'EMAIL NON RICEVEVA NESSUNA CONFERMA.
 *
 * Dopo l'inserimento la rotta avvisava solo gli amministratori e rispondeva 201: chi aveva segnalato
 * vedeva un avviso a schermo che spariva, e restava senza prova né numero della segnalazione. Il
 * regolamento europeo sui servizi digitali (art. 16.4) chiede la conferma di ricezione al recapito
 * elettronico lasciato.
 *
 * La prova esegue la rotta vera con un database finto e un postino finto, a un'ora finta, e guarda
 * che cosa riceve chi ha segnalato; poi apre il modulo e guarda che cosa legge dopo l'invio.
 */

const stato = vi.hoisted(() => ({
  email: [] as Array<{ to: string | string[]; subject: string; html: string; text?: string; tipo?: string }>,
  postino: 'va' as 'va' | 'rifiuta',
  inserite: [] as Array<Record<string, unknown>>,
}));
const successi = vi.hoisted(() => [] as string[]);
const errori = vi.hoisted(() => [] as string[]);

vi.mock('sonner', () => ({ toast: { success: (m: string) => successi.push(m), error: (m: string) => errori.push(m) } }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/rate-limit', () => ({ getClientIp: () => '1.2.3.4', rateLimitAsync: async () => ({ allowed: true, retryAfterSec: 0 }) }));
vi.mock('@/lib/email/client', () => ({
  sendEmail: async (e: { to: string; subject: string; html: string; text?: string; tipo?: string }) => {
    stato.email.push(e);
    return stato.postino === 'va' ? { ok: true, id: 'm1' } : { ok: false, error: 'rifiutata' };
  },
}));
vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
  getAdminSupabase: () => ({
    from: (t: string) => {
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        select: () => b,
        eq: async () => ({ data: t === 'profiles' ? [{ id: 'capo-1' }] : [], error: null }),
        maybeSingle: async () => ({ data: { id: 'esiste' }, error: null }),
        insert: (r: Record<string, unknown>) => {
          if (t === 'notifications') return Promise.resolve({ error: null });
          stato.inserite.push(r);
          return { select: () => ({ single: async () => ({ data: { id: 'seg-42', created_at: new Date().toISOString() }, error: null }) }) };
        },
      });
      // `products` e `seller_public_profiles`: select → eq → maybeSingle
      if (t === 'products' || t === 'seller_public_profiles') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'esiste' }, error: null }) }) }) };
      }
      return b;
    },
  }),
}));

import { POST } from '@/app/api/segnalazioni/route';
import { logger } from '@/lib/logger';

function segnala(extra: Record<string, unknown> = {}) {
  return POST(new Request('http://x/api/segnalazioni', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      tipo: 'prodotto',
      oggettoId: '11111111-1111-4111-8111-111111111111',
      motivo: 'contraffatto',
      dettaglio: 'Compra da noi <a href="http://truffa.example">qui</a>',
      ...extra,
    }),
  }) as never);
}

beforeEach(() => {
  stato.email.length = 0;
  stato.inserite.length = 0;
  stato.postino = 'va';
  successi.length = 0;
  errori.length = 0;
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-13T10:30:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('R21-008 · la rotta conferma la ricezione a chi ha lasciato l email', () => {
  it('IL CASO CHE ROMPEVA — parte una email di servizio con numero, oggetto, motivo e data', async () => {
    const res = await segnala({ emailContatto: 'titolare@marchio.example' });
    expect(res.status).toBe(201);
    expect(stato.email, 'nessuna conferma a chi ha segnalato lasciando l email').toHaveLength(1);
    const [m] = stato.email;
    expect(m.to).toBe('titolare@marchio.example');
    expect(m.tipo ?? 'transazionale').toBe('transazionale');
    expect(m.subject).toMatch(/ricevuto/i);
    const testo = String(m.text);
    expect(testo).toContain('seg-42');
    expect(testo).toContain('un prodotto');
    expect(testo).toContain('prodotto contraffatto');
    // L'ora di Roma, non quella del server.
    expect(testo).toMatch(/13 novembre 2026/);
    expect(testo).toMatch(/11:30/);
    expect(await res.json()).toMatchObject({ ok: true, id: 'seg-42', conferma: 'inviata' });
  });

  it('la conferma non porta il testo libero di chi segnala: l indirizzo lo può scrivere chiunque', async () => {
    await segnala({ emailContatto: 'qualcuno@example.com' });
    expect(stato.email).toHaveLength(1);
    expect(stato.email[0].html).not.toContain('truffa.example');
    expect(String(stato.email[0].text)).not.toContain('truffa.example');
  });

  it('se la email non parte la segnalazione resta registrata, e la risposta e i registri lo dicono', async () => {
    stato.postino = 'rifiuta';
    const res = await segnala({ emailContatto: 'titolare@marchio.example' });
    expect(res.status).toBe(201);
    expect(stato.inserite).toHaveLength(1);
    expect(await res.json()).toMatchObject({ conferma: 'fallita' });
    expect(logger.error).toHaveBeenCalled();
  });

  it('senza email non parte niente', async () => {
    const res = await segnala();
    expect(res.status).toBe(201);
    expect(stato.email).toHaveLength(0);
    expect(await res.json()).toMatchObject({ conferma: 'nessun_recapito' });
  });
});

describe('R21-008 · il modulo dice se la conferma è partita', () => {
  let root: Root | null = null;
  let box: HTMLDivElement;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    box = document.createElement('div');
    document.body.appendChild(box);
  });
  afterEach(async () => {
    await act(async () => { root?.unmount(); });
    box.remove();
    vi.unstubAllGlobals();
  });

  async function inviaConRisposta(risposta: Record<string, unknown>) {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(risposta), { status: 201 })));
    const { Segnala } = await import('@/components/Segnala');
    root = createRoot(box);
    await act(async () => { root!.render(createElement(Segnala, { tipo: 'prodotto', oggettoId: '11111111-1111-4111-8111-111111111111' })); });
    const apri = [...box.querySelectorAll('button')].find((b) => b.textContent?.includes('Segnala questo contenuto'))!;
    await act(async () => { apri.click(); });
    const invia = [...document.body.querySelectorAll('button')].find((b) => b.textContent?.includes('Invia segnalazione'))!;
    await act(async () => { invia.click(); });
  }

  it('conferma partita: lo dice', async () => {
    await inviaConRisposta({ ok: true, id: 'seg-42', conferma: 'inviata' });
    expect(successi).toHaveLength(1);
    expect(successi[0]).toMatch(/conferma per email/);
  });

  it('conferma non partita: dà il numero della segnalazione', async () => {
    await inviaConRisposta({ ok: true, id: 'seg-42', conferma: 'fallita' });
    expect(successi).toHaveLength(1);
    expect(successi[0]).toContain('seg-42');
  });
});
