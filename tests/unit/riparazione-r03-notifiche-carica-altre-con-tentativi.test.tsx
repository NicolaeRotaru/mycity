/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { monta } from './aiuti/monta-componente';
import { accendi, clicca } from './aiuti/schermo';

/**
 * R03-021 — Nelle notifiche «Carica altre» non sparisce mentre carica, e una lettura che cade
 * DOPO i nuovi tentativi di produzione non cancella l'elenco già letto.
 *
 * Qui i tentativi sono quelli veri: si monta il QueryProvider del sito (retry 1, attesa 1 secondo)
 * e l'orologio è finto, così il ritardo dei tentativi passa a comando.
 */

const globali = globalThis as Record<string, unknown>;
const ora = Date.parse('2026-11-19T10:00:00Z');
const veri = { veri: ['@tanstack/react-query'] };

type Riga = { id: string; user_id: string; title: string; body: null; link: null; is_read: boolean; created_at: string };
const righe = (quante: number): Riga[] =>
  Array.from({ length: quante }, (_, i) => ({
    id: `n${i}`, user_id: 'u1', title: `avviso-${i}`, body: null, link: null, is_read: true,
    created_at: new Date(ora - i * 3_600_000).toISOString(),
  }));

const mondo = { tutte: [] as Riga[], cade: false, letture: 0 };

function database() {
  return {
    from: () => {
      let limite = Infinity;
      const c: Record<string, unknown> = {};
      c.select = () => c;
      for (const m of ['eq', 'or', 'in', 'order']) c[m] = () => c;
      c.limit = (n: number) => { limite = n; return c; };
      c.then = (ok: (x: unknown) => unknown, ko?: (e: unknown) => unknown) => {
        mondo.letture++;
        const esito = mondo.cade
          ? { data: null, count: null, error: { message: 'TypeError: fetch failed' } }
          : { data: mondo.tutte.slice(0, limite).map((r) => ({ ...r })), error: null };
        return Promise.resolve(esito).then(ok, ko);
      };
      return c;
    },
  };
}

async function passa(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

const pulsante = (radice: HTMLElement, testo: RegExp) =>
  Array.from(radice.querySelectorAll('button')).find((b) => testo.test((b.textContent ?? '').trim())) ?? null;
const aVideo = (radice: HTMLElement) => radice.querySelectorAll('ul.flex-col > li').length;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(ora);
  mondo.tutte = []; mondo.cade = false; mondo.letture = 0;
  globali.__UTENTE__ = { id: 'u1' };
  globali.__CLIENT_SUPABASE__ = database();
  globali.__ASCOLTI_AUTH__ = [];
  globali.__PERCORSO_FINTO__ = '/notifications';
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
  for (const k of ['__UTENTE__', '__CLIENT_SUPABASE__', '__ASCOLTI_AUTH__', '__PERCORSO_FINTO__']) delete globali[k];
});

describe('R03-021 · «Carica altre» con i tentativi ripetuti di produzione', () => {
  it('durante i tentativi il tasto resta; a tentativi finiti l’elenco già letto resta con un messaggio d’errore', async () => {
    mondo.tutte = righe(60);
    const fornitore = await monta('components/providers/QueryProvider.tsx', veri);
    const pagina = await monta('app/notifications/page.tsx', veri);
    const Fornitore = fornitore.default as (p: { children: unknown }) => unknown;
    const Pagina = pagina.default as () => unknown;
    const s = accendi(() => createElement(Fornitore as never, null, createElement(Pagina as never)));
    await passa(50); await passa(50); await passa(50);
    expect(aVideo(s.radice), 'controprova: le prime 50 devono essere a video').toBe(50);

    mondo.cade = true;
    const prima = mondo.letture;
    s.agisci(() => clicca(pulsante(s.radice, /^Carica altre$/)!));
    await passa(50); await passa(50); await passa(50);
    // Primo tentativo caduto, il secondo aspetta un secondo: si sta ancora caricando.
    expect(mondo.letture, 'la lettura doveva essere partita').toBeGreaterThan(prima);
    const tasto = pulsante(s.radice, /Caricamento…|Carica altre/);
    expect(tasto, 'durante i tentativi il tasto è sparito').not.toBeNull();
    expect(tasto!.disabled).toBe(true);
    expect(aVideo(s.radice), 'durante i tentativi l’elenco già letto è sparito').toBe(50);

    await passa(1500);
    expect(mondo.letture - prima, 'i tentativi di produzione dovevano essere due').toBe(2);
    expect(aVideo(s.radice), 'dopo i tentativi l’errore ha cancellato l’elenco già letto').toBe(50);
    expect(s.radice.querySelector('[role="alert"]')?.textContent ?? '', 'manca il messaggio d’errore accanto all’elenco')
      .toContain('Non riusciamo a caricare altre notifiche');
    expect(s.radice.textContent).not.toContain('Non riusciamo a caricare le notifiche');
    s.smonta();
  }, 60000);
});
