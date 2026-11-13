// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * R21-008 (correzione) — QUANDO PARTE LA CONFERMA DI RICEZIONE, E CHE COSA RESTA A CHI SEGNALA.
 *
 * Dopo la prima riparazione la conferma partiva a ogni segnalazione con un'email, e se non partiva
 * il numero della segnalazione compariva solo in un avviso a schermo che spariva da solo.
 *
 * Adesso:
 * - la conferma arriva al massimo una volta ogni 10 minuti e tre volte al giorno allo stesso
 *   indirizzo; il contatore usa un'impronta dell'indirizzo, non l'indirizzo in chiaro;
 * - parte solo con il controllo anti-robot del modulo superato, come nei contatti e nella newsletter;
 * - quando non parte la segnalazione si salva lo stesso, e il modulo resta aperto con il numero;
 * - l'email dice che, se non hai fatto tu la segnalazione, puoi ignorarla.
 *
 * La prova esegue la rotta vera con il freno vero (in memoria), un database finto, un postino finto e
 * un controllo anti-robot finto, a un'ora finta; poi apre il modulo e guarda che cosa resta scritto.
 */

const stato = vi.hoisted(() => {
  // Il freno conta in memoria: niente servizio esterno nella prova.
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  return {
    email: [] as Array<{ to: string; subject: string; html: string; text?: string }>,
    inserite: [] as Array<Record<string, unknown>>,
    antiRobot: 'passa' as 'passa' | 'non_passa',
    gettoniControllati: [] as Array<string | null | undefined>,
    chiaviDelFreno: [] as string[],
    rispostaDelRiquadro: true,
  };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/rate-limit', async (importOriginal) => {
  const vero = await importOriginal<typeof import('@/lib/rate-limit')>();
  return {
    ...vero,
    rateLimitAsync: async (o: { key: string; max: number; windowMs: number }) => {
      stato.chiaviDelFreno.push(o.key);
      return vero.rateLimitAsync(o);
    },
  };
});
vi.mock('@/lib/captcha', () => ({
  verifyTurnstileToken: async (gettone?: string | null) => {
    stato.gettoniControllati.push(gettone);
    return stato.antiRobot === 'passa' ? { ok: true } : { ok: false, reason: 'CAPTCHA non valido' };
  },
}));
vi.mock('@/lib/email/client', () => ({
  sendEmail: async (e: { to: string; subject: string; html: string; text?: string }) => {
    stato.email.push(e);
    return { ok: true, id: `m${stato.email.length}` };
  },
}));
vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
  getAdminSupabase: () => ({
    from: (t: string) => {
      if (t === 'products' || t === 'seller_public_profiles') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'esiste' }, error: null }) }) }) };
      }
      if (t === 'profiles') return { select: () => ({ eq: async () => ({ data: [{ id: 'capo-1' }], error: null }) }) };
      return {
        insert: (r: Record<string, unknown>) => {
          if (t === 'notifications') return Promise.resolve({ error: null });
          stato.inserite.push(r);
          const id = `seg-${stato.inserite.length}`;
          return { select: () => ({ single: async () => ({ data: { id, created_at: new Date().toISOString() }, error: null }) }) };
        },
      };
    },
  }),
}));
// Il riquadro anti-robot vero carica uno script di Cloudflare: qui risponde subito con un gettone.
vi.mock('@/components/Turnstile', async () => {
  const React = await import('react');
  const Finto = React.forwardRef(function FintoAntiRobot(p: { onVerify: (t: string) => void }, _ref: unknown) {
    React.useEffect(() => {
      if (stato.rispostaDelRiquadro) p.onVerify('gettone-buono');
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return React.createElement('div', { 'data-prova': 'anti-robot' });
  });
  return { default: Finto };
});

import { POST } from '@/app/api/segnalazioni/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

const ORA = new Date('2026-11-13T10:30:00Z').getTime();
const MINUTO = 60_000;

function segnala(extra: Record<string, unknown> = {}) {
  return POST(new Request('http://x/api/segnalazioni', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      tipo: 'prodotto',
      oggettoId: '11111111-1111-4111-8111-111111111111',
      motivo: 'contraffatto',
      captchaToken: 'gettone-buono',
      ...extra,
    }),
  }) as never);
}

async function esito(extra: Record<string, unknown>) {
  const res = await segnala(extra);
  expect(res.status).toBe(201);
  return (await res.json()) as { ok: boolean; id: string; conferma: string };
}

beforeEach(() => {
  stato.email.length = 0;
  stato.inserite.length = 0;
  stato.gettoniControllati.length = 0;
  stato.chiaviDelFreno.length = 0;
  stato.antiRobot = 'passa';
  stato.rispostaDelRiquadro = true;
  __resetRateLimitBuckets();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(ORA);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('R21-008 · la conferma parte con misura', () => {
  it('IL CASO CHE ROMPEVA — allo stesso indirizzo la conferma arriva al massimo una volta ogni 10 minuti, e la segnalazione si salva lo stesso', async () => {
    expect(await esito({ emailContatto: 'titolare@marchio.example' })).toMatchObject({ conferma: 'inviata' });
    const seconda = await esito({ emailContatto: 'Titolare@Marchio.example' });
    expect(stato.inserite, 'la seconda segnalazione non è stata salvata').toHaveLength(2);
    expect(stato.email, 'la conferma è partita due volte in pochi minuti allo stesso indirizzo').toHaveLength(1);
    expect(seconda).toMatchObject({ ok: true, id: 'seg-2', conferma: 'non_inviata' });

    vi.setSystemTime(ORA + 10 * MINUTO + 1000);
    expect(await esito({ emailContatto: 'titolare@marchio.example' })).toMatchObject({ conferma: 'inviata' });
    expect(stato.email).toHaveLength(2);
  });

  it('allo stesso indirizzo al massimo tre conferme al giorno', async () => {
    const conferme: string[] = [];
    for (let i = 0; i < 4; i++) {
      vi.setSystemTime(ORA + i * 11 * MINUTO);
      conferme.push((await esito({ emailContatto: 'titolare@marchio.example' })).conferma);
    }
    expect(conferme).toEqual(['inviata', 'inviata', 'inviata', 'non_inviata']);
    expect(stato.inserite).toHaveLength(4);
    expect(stato.email).toHaveLength(3);

    vi.setSystemTime(ORA + 24 * 60 * MINUTO + MINUTO);
    expect(await esito({ emailContatto: 'titolare@marchio.example' })).toMatchObject({ conferma: 'inviata' });
  });

  it('un altro indirizzo non aspetta', async () => {
    expect(await esito({ emailContatto: 'uno@example.com' })).toMatchObject({ conferma: 'inviata' });
    expect(await esito({ emailContatto: 'due@example.com' })).toMatchObject({ conferma: 'inviata' });
    expect(stato.email.map((m) => m.to)).toEqual(['uno@example.com', 'due@example.com']);
  });

  it('il contatore non tiene l indirizzo in chiaro', async () => {
    await esito({ emailContatto: 'Titolare@Marchio.example' });
    await esito({ emailContatto: 'titolare@marchio.example' });
    expect(stato.chiaviDelFreno.length).toBeGreaterThan(0);
    for (const k of stato.chiaviDelFreno) {
      expect(k.toLowerCase()).not.toContain('titolare');
      expect(k.toLowerCase()).not.toContain('marchio.example');
    }
  });

  it('senza il controllo anti-robot superato la conferma non parte, la segnalazione si salva e il conto dell indirizzo resta intero', async () => {
    stato.antiRobot = 'non_passa';
    const r = await esito({ emailContatto: 'titolare@marchio.example', captchaToken: 'gettone-scaduto' });
    expect(r).toMatchObject({ ok: true, id: 'seg-1', conferma: 'non_inviata' });
    expect(stato.inserite).toHaveLength(1);
    expect(stato.email, 'la conferma è partita senza il controllo anti-robot').toHaveLength(0);
    expect(stato.gettoniControllati).toContain('gettone-scaduto');

    stato.antiRobot = 'passa';
    expect(await esito({ emailContatto: 'titolare@marchio.example' })).toMatchObject({ conferma: 'inviata' });
    expect(stato.email).toHaveLength(1);
  });

  it('senza email la segnalazione arriva come prima, anche senza controllo anti-robot', async () => {
    stato.antiRobot = 'non_passa';
    expect(await esito({ captchaToken: undefined })).toMatchObject({ ok: true, conferma: 'nessun_recapito' });
    expect(stato.inserite).toHaveLength(1);
  });

  it('l email dice che, se non hai fatto tu la segnalazione, puoi ignorarla', async () => {
    await esito({ emailContatto: 'titolare@marchio.example' });
    expect(stato.email).toHaveLength(1);
    const riga = 'Se non hai fatto tu questa segnalazione, ignora questa email.';
    expect(String(stato.email[0].text)).toContain(riga);
    expect(stato.email[0].html).toContain(riga);
  });
});

describe('R21-008 · il modulo tiene il numero quando la conferma non parte', () => {
  let root: Root | null = null;
  let box: HTMLDivElement;
  let fetchFinto: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    box = document.createElement('div');
    document.body.appendChild(box);
  });
  afterEach(async () => {
    await act(async () => { root?.unmount(); });
    root = null;
    box.remove();
    vi.unstubAllGlobals();
    delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  });

  async function apriModulo(risposta: Record<string, unknown>) {
    fetchFinto = vi.fn(async (_u: string, _i?: RequestInit) => new Response(JSON.stringify(risposta), { status: 201 }));
    vi.stubGlobal('fetch', fetchFinto);
    const { Segnala } = await import('@/components/Segnala');
    root = createRoot(box);
    await act(async () => { root!.render(createElement(Segnala, { tipo: 'prodotto', oggettoId: '11111111-1111-4111-8111-111111111111' })); });
    const apri = [...box.querySelectorAll('button')].find((b) => b.textContent?.includes('Segnala questo contenuto'))!;
    await act(async () => { apri.click(); });
  }
  async function scriviEmail(valore: string) {
    const campo = document.getElementById('segnala-email') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => { setter.call(campo, valore); campo.dispatchEvent(new Event('input', { bubbles: true })); });
  }
  async function premi(testo: string) {
    const b = [...document.body.querySelectorAll('button')].find((x) => x.textContent?.trim() === testo || x.textContent?.includes(testo))!;
    expect(b, `manca il pulsante «${testo}»`).toBeTruthy();
    await act(async () => { b.click(); });
  }
  const finestra = () => document.body.querySelector('[role="dialog"]');

  it.each(['fallita', 'non_inviata'])('IL CASO CHE ROMPEVA — conferma %s: il numero resta scritto nel modulo, non solo in un avviso che sparisce', async (conferma) => {
    await apriModulo({ ok: true, id: 'seg-42', conferma });
    await scriviEmail('titolare@marchio.example');
    await premi('Invia segnalazione');
    expect(finestra(), 'il modulo si è chiuso e il numero è sparito').toBeTruthy();
    const riquadro = finestra()!.querySelector('[role="status"]');
    expect(riquadro?.textContent ?? '', 'nel modulo non c è il numero della segnalazione').toContain('seg-42');

    // Si chiude quando lo decide chi ha segnalato; riaperto, il modulo è di nuovo quello di prima.
    await premi('Chiudi');
    expect(finestra()).toBeNull();
    const apri = [...box.querySelectorAll('button')].find((b) => b.textContent?.includes('Segnala questo contenuto'))!;
    await act(async () => { apri.click(); });
    expect(document.getElementById('segnala-dettaglio')).toBeTruthy();
    expect(finestra()!.textContent).not.toContain('seg-42');
  });

  it('conferma partita: il modulo si chiude come prima', async () => {
    await apriModulo({ ok: true, id: 'seg-42', conferma: 'inviata' });
    await scriviEmail('titolare@marchio.example');
    await premi('Invia segnalazione');
    expect(finestra()).toBeNull();
  });

  it('con il controllo anti-robot attivo, il gettone parte con la segnalazione quando c è l email', async () => {
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = 'chiave-pubblica-di-prova';
    await apriModulo({ ok: true, id: 'seg-42', conferma: 'inviata' });
    await scriviEmail('titolare@marchio.example');
    await premi('Invia segnalazione');
    expect(fetchFinto).toHaveBeenCalledTimes(1);
    const corpo = JSON.parse(String(fetchFinto.mock.calls[0][1]?.body));
    expect(corpo.captchaToken, 'il gettone anti-robot non parte con la segnalazione').toBe('gettone-buono');
  });

  it('con il controllo anti-robot attivo e l email scritta, finché il riquadro non risponde la segnalazione non parte', async () => {
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = 'chiave-pubblica-di-prova';
    stato.rispostaDelRiquadro = false;
    await apriModulo({ ok: true, id: 'seg-42', conferma: 'inviata' });
    await scriviEmail('titolare@marchio.example');
    await premi('Invia segnalazione');
    expect(fetchFinto).not.toHaveBeenCalled();
    expect(finestra()).toBeTruthy();
  });
});
