/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, createElement, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { monta } from './aiuti/monta-componente';
import { accendi, clicca } from './aiuti/schermo';

/**
 * R01-varie — Le notifiche si rileggono da capo quando cambia chi le guarda.
 *
 * Con la pagina aperta cambia la sessione: come fa QueryProvider, la memoria si svuota e la pagina
 * rilegge da capo, con la sua attesa. «Carica altre» nella stessa sessione invece tiene l'elenco a
 * video mentre carica.
 * Qui react-query è quello vero e il database un finto che risponde o aspetta a comando.
 */

const globali = globalThis as Record<string, unknown>;
const ora = Date.parse('2026-11-19T10:00:00Z');

type Riga = { id: string; user_id: string; title: string; body: null; link: null; is_read: boolean; created_at: string };
const righeDi = (utente: string, quante: number): Riga[] =>
  Array.from({ length: quante }, (_, i) => ({
    id: `${utente}-n${i}`,
    user_id: utente,
    title: `${utente}-avviso-${i}`,
    body: null,
    link: null,
    is_read: true,
    created_at: new Date(ora - i * 3_600_000).toISOString(),
  }));

const mondo = { righe: [] as Riga[], attesa: null as Promise<void> | null };

function database() {
  return {
    from: () => {
      const filtri: Record<string, unknown> = {};
      let limite = Number.POSITIVE_INFINITY;
      let conta = false;
      const risposta = () => {
        const scelte = mondo.righe.filter((r) => Object.entries(filtri).every(([k, v]) => (r as Record<string, unknown>)[k] === v));
        if (conta) return { data: null, count: scelte.length, error: null };
        return { data: scelte.slice(0, limite).map((r) => ({ ...r })), error: null };
      };
      const c: Record<string, unknown> = {};
      c.select = (_colonne: string, opzioni?: { head?: boolean }) => { conta = !!opzioni?.head; return c; };
      c.eq = (colonna: string, valore: unknown) => { filtri[colonna] = valore; return c; };
      c.order = () => c;
      c.limit = (n: number) => { limite = n; return c; };
      c.then = (ok: (x: unknown) => unknown, ko?: (e: unknown) => unknown) => {
        const prima = !conta && mondo.attesa ? mondo.attesa : Promise.resolve();
        return prima.then(() => risposta()).then(ok, ko);
      };
      return c;
    },
  };
}

async function lascia(volte = 20) {
  for (let i = 0; i < volte; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function apri() {
  const mod = await monta('app/notifications/page.tsx', { veri: ['@tanstack/react-query'] });
  const Pagina = mod.default as () => unknown;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  let ridisegna = () => {};
  function Involucro() {
    const [, setGiro] = useState(0);
    ridisegna = () => setGiro((g) => g + 1);
    return createElement(QueryClientProvider, { client: qc }, createElement(Pagina as never));
  }
  const s = accendi(Involucro);
  await lascia();
  /** Come quando cambia la sessione: l'avviso, la memoria svuotata, la pagina che rilegge. */
  const entra = async (utente: string) => {
    globali.__UTENTE__ = { id: utente };
    await act(async () => {
      for (const ascolto of globali.__ASCOLTI_AUTH__ as Array<(e: string, s: unknown) => void>) ascolto('SIGNED_IN', { user: { id: utente } });
      qc.clear();
      ridisegna();
    });
    await lascia();
  };
  return { s, entra };
}

const pulsante = (radice: HTMLElement, testo: RegExp) =>
  Array.from(radice.querySelectorAll('button')).find((b) => testo.test((b.textContent ?? '').trim())) ?? null;

beforeEach(() => {
  mondo.righe = [];
  mondo.attesa = null;
  globali.__UTENTE__ = { id: 'u1' };
  globali.__CLIENT_SUPABASE__ = database();
  globali.__ASCOLTI_AUTH__ = [];
});

afterEach(() => {
  document.body.innerHTML = '';
  for (const k of ['__UTENTE__', '__CLIENT_SUPABASE__', '__ASCOLTI_AUTH__']) delete globali[k];
});

describe('R01-varie · le notifiche si rileggono da capo quando cambia chi le guarda', () => {
  it('cambiata la sessione, l’elenco si rilegge da capo', async () => {
    mondo.righe = [...righeDi('u1', 3), ...righeDi('u2', 2)];
    const { s, entra } = await apri();
    expect(s.radice.textContent, 'controprova: la prima lettura deve riuscire').toContain('u1-avviso-2');

    let lascialaArrivare = () => {};
    mondo.attesa = new Promise<void>((r) => { lascialaArrivare = r; });
    await entra('u2');
    expect(s.radice.textContent, 'l’elenco non si è riletto da capo').not.toContain('u1-avviso');

    await act(async () => { lascialaArrivare(); });
    mondo.attesa = null;
    await lascia();
    const testo = s.radice.textContent ?? '';
    expect(testo).toContain('u2-avviso-1');
    expect(testo).not.toContain('u1-avviso');
    s.smonta();
  }, 60000);

  it('nella stessa sessione «Carica altre» tiene a video l’elenco già letto mentre carica', async () => {
    mondo.righe = righeDi('u1', 60);
    const { s } = await apri();
    expect(s.radice.querySelectorAll('li'), 'controprova: le prime 50 devono essere a video').toHaveLength(50);

    let lascialeArrivare = () => {};
    mondo.attesa = new Promise<void>((r) => { lascialeArrivare = r; });
    s.agisci(() => clicca(pulsante(s.radice, /^Carica altre$/)!));
    await lascia();
    expect(s.radice.querySelectorAll('li'), 'mentre carica, l’elenco già letto è sparito').toHaveLength(50);
    expect(pulsante(s.radice, /Caricamento…/)).not.toBeNull();

    await act(async () => { lascialeArrivare(); });
    mondo.attesa = null;
    await lascia();
    expect(s.radice.querySelectorAll('li')).toHaveLength(60);
    s.smonta();
  }, 60000);
});
