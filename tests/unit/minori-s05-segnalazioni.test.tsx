// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { motivoLeggibile, oggettoConArticolo } from '@/lib/admin/segnalazioni-testi';

/**
 * S05 · schede 339, 88, 2626, 97, 188, 656, 243 — segnalazioni e assistenza.
 */

const stato = vi.hoisted(() => ({
  segnalazione: null as Record<string, unknown> | null,
  prodotto: null as Record<string, unknown> | null,
  notifiche: [] as Array<Record<string, unknown>>,
  email: [] as Array<{ text?: string; html: string }>,
  inserite: 0,
}));
const errori = vi.hoisted(() => [] as string[]);
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: (m: string) => errori.push(m) } }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: async (e: { text?: string; html: string }) => { stato.email.push(e); return { ok: true, id: 'm' }; } }));
vi.mock('@/lib/rate-limit', () => ({ getClientIp: () => '1.2.3.4', rateLimitAsync: async () => ({ allowed: true, retryAfterSec: 0 }) }));
vi.mock('@/lib/api/middleware', () => ({ withAdminAuth: (h: (c: unknown) => unknown) => (req: Request) => h({ req, user: { id: 'a' } }) }));
vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
  getAdminSupabase: () => ({
    from: (t: string) => {
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        select: () => b, eq: () => b,
        maybeSingle: async () => ({ data: t === 'segnalazioni' ? stato.segnalazione : stato.prodotto, error: null }),
        insert: (r: Record<string, unknown>) => {
          if (t === 'notifications') { stato.notifiche.push(r); return Promise.resolve({ error: null }); }
          stato.inserite += 1;
          return { select: () => ({ single: async () => ({ data: { id: 'seg-1' }, error: null }) }) };
        },
      });
      return b;
    },
  }),
}));

beforeEach(() => { stato.notifiche = []; stato.email = []; stato.inserite = 0; errori.length = 0; });

describe('testi delle segnalazioni', () => {
  it('339: niente codici interni e articolo giusto', () => {
    expect(motivoLeggibile('proprieta_intellettuale')).toBe('violazione di marchio o diritto d’autore');
    expect(oggettoConArticolo('recensione')).toBe('una recensione');
  });

  it('339/88: l’esito al venditore usa le parole e dice come contestare; 2626: prodotto cancellato non è un guasto', async () => {
    const { comunicaEsito } = await import('@/app/api/segnalazioni/esito/comunica');
    const { getAdminSupabase } = await import('@/lib/supabase/server');
    stato.segnalazione = { id: 's1', tipo: 'prodotto', oggetto_id: 'p1', motivo: 'odio_o_molestie', segnalante_id: null,
      email_contatto: 'chi@example.com', stato: 'accolta', esito_motivato: 'La descrizione conteneva insulti espliciti.' };
    stato.prodotto = { seller_id: 'forno' };
    const r = await comunicaEsito(getAdminSupabase() as never, 's1');
    expect(r.ok).toBe(true);
    const alVenditore = String(stato.notifiche.find((n) => n.user_id === 'forno')?.body);
    expect(alVenditore).not.toContain('odio_o_molestie');
    expect(alVenditore).toMatch(/contestarla/);
    expect(stato.email[0].text).toMatch(/contestarla/);
    expect(stato.email[0].html).not.toContain('odio_o_molestie');

    stato.prodotto = null; // il prodotto è stato cancellato
    stato.notifiche = [];
    const r2 = await comunicaEsito(getAdminSupabase() as never, 's1');
    expect(r2.ok && r2.venditore).toBe('nessun_recapito');
  });

  it('97: segnalare un prodotto che non esiste risponde 404 e non scrive niente', async () => {
    stato.prodotto = null;
    const { POST } = await import('@/app/api/segnalazioni/route');
    const r = await POST(new Request('http://x', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tipo: 'prodotto', oggettoId: '00000000-0000-4000-8000-000000000000', motivo: 'altro' }),
    }) as never);
    expect(r.status).toBe(404);
    expect(stato.inserite).toBe(0);
    expect(stato.notifiche).toEqual([]);
  });
});

describe('il modulo Segnala', () => {
  let root: Root | null = null;
  let box: HTMLDivElement;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    box = document.createElement('div');
    document.body.appendChild(box);
  });
  afterEach(async () => { await act(async () => { root?.unmount(); }); box.remove(); vi.unstubAllGlobals(); });

  async function apri() {
    const { Segnala } = await import('@/components/Segnala');
    root = createRoot(box);
    await act(async () => { root!.render(createElement(Segnala, { tipo: 'prodotto', oggettoId: '00000000-0000-4000-8000-000000000001' })); });
    const pulsante = [...box.querySelectorAll('button')].find((b) => b.textContent?.includes('Segnala questo contenuto'))!;
    await act(async () => { pulsante.click(); });
    return pulsante;
  }

  it('656: il pulsante resta nella pagina e Esc chiude il dialogo', async () => {
    const pulsante = await apri();
    expect(document.body.contains(pulsante)).toBe(true);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('188: un’email scritta male si dice sotto il campo, senza chiamare il server', async () => {
    const fetchFinto = vi.fn(async () => new Response('{}', { status: 400 }));
    vi.stubGlobal('fetch', fetchFinto);
    await apri();
    const campo = document.getElementById('segnala-email') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => { setter.call(campo, 'mario@'); campo.dispatchEvent(new Event('input', { bubbles: true })); });
    const invia = [...document.body.querySelectorAll('button')].find((b) => b.textContent?.includes('Invia segnalazione'))!;
    await act(async () => { invia.click(); });
    expect(fetchFinto).not.toHaveBeenCalled();
    expect(document.getElementById('segnala-email-errore')?.textContent).toMatch(/email/);
  });

  it('188: il 429 dice di aspettare, non «riprova» generico', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 429 })));
    await apri();
    const invia = [...document.body.querySelectorAll('button')].find((b) => b.textContent?.includes('Invia segnalazione'))!;
    await act(async () => { invia.click(); });
    expect(errori.at(-1)).toMatch(/molte segnalazioni/);
  });
});

describe('243: la casella dell’assistenza ha un nome', () => {
  it('la textarea ha aria-label', () => {
    const src = readFileSync('components/SupportChatModal.tsx', 'utf8');
    expect(src).toMatch(/placeholder="Scrivi qui la tua richiesta…"\s*\n\s*aria-label="[^"]+"/);
  });
});
