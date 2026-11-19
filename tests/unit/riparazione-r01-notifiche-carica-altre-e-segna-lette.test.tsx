/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { monta } from './aiuti/monta-componente';
import { accendi, clicca } from './aiuti/schermo';

/**
 * R01-002 — NELLE NOTIFICHE IL TASTO «CARICA ALTRE» SPARIVA MENTRE CARICAVA, E UN ERRORE CANCELLAVA
 * DALLA PAGINA L'ELENCO GIÀ LETTO.
 *
 * Qui react-query è quello vero e il database un finto che risponde, aspetta o cade a comando:
 *  - mentre carica le altre, «Carica altre» resta, spento, e dice «Caricamento…»; premuto più volte
 *    non parte due volte e le righe non si doppiano;
 *  - se «Carica altre» cade, le notifiche già lette restano a video, con «Riprova».
 *
 * Il resto del giro di prima: dopo «Segna tutte come lette» riuscito, se la rilettura cade (senza
 * un «Carica altre» prima), react-query tiene i dati di prima della domanda caduta, e la pagina
 * mostrava ancora le notifiche «Non letta» col pulsante al suo posto. Ora la scrittura riuscita
 * segna lette anche le righe in memoria, e il conto del campanello va a zero.
 */

const globali = globalThis as Record<string, unknown>;
const ora = Date.parse('2026-11-19T10:00:00Z');

type Riga = { id: string; user_id: string; title: string; body: null; link: null; is_read: boolean; created_at: string };
const righeDi = (utente: string, quante: number, letta: boolean): Riga[] =>
  Array.from({ length: quante }, (_, i) => ({
    id: `${utente}-n${i}`,
    user_id: utente,
    title: `${utente}-avviso-${i}`,
    body: null,
    link: null,
    is_read: letta,
    created_at: new Date(ora - i * 3_600_000).toISOString(),
  }));

const RETE_GIU = { message: 'TypeError: fetch failed' };
const mondo = {
  righe: [] as Riga[],
  lettureCadute: false,
  /** Se c'è, le letture dell'elenco aspettano che la prova la risolva. */
  attesa: null as Promise<void> | null,
  /** Le letture dell'elenco partite, col loro tetto. */
  letture: [] as number[],
};

function database() {
  return {
    from: () => {
      const filtri: Record<string, unknown> = {};
      let limite = Number.POSITIVE_INFINITY;
      let conta = false;
      let valori: Partial<Riga> | null = null;
      const risposta = () => {
        const scelte = mondo.righe.filter((r) => Object.entries(filtri).every(([k, v]) => (r as Record<string, unknown>)[k] === v));
        if (valori) {
          for (const r of scelte) Object.assign(r, valori);
          return { data: null, error: null };
        }
        if (mondo.lettureCadute) return { data: null, count: null, error: RETE_GIU };
        if (conta) return { data: null, count: scelte.length, error: null };
        return { data: scelte.slice(0, limite).map((r) => ({ ...r })), error: null };
      };
      const c: Record<string, unknown> = {};
      c.select = (_colonne: string, opzioni?: { head?: boolean }) => { conta = !!opzioni?.head; return c; };
      c.eq = (colonna: string, valore: unknown) => { filtri[colonna] = valore; return c; };
      c.order = () => c;
      c.limit = (n: number) => { limite = n; mondo.letture.push(n); return c; };
      c.update = (v: Partial<Riga>) => { valori = v; return c; };
      c.then = (ok: (x: unknown) => unknown, ko?: (e: unknown) => unknown) => {
        const prima = !valori && !conta && mondo.attesa ? mondo.attesa : Promise.resolve();
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
  const s = accendi(() => createElement(QueryClientProvider, { client: qc }, createElement(Pagina as never)));
  await lascia();
  return { s, qc };
}

const pulsante = (radice: HTMLElement, testo: RegExp) =>
  Array.from(radice.querySelectorAll('button')).find((b) => testo.test((b.textContent ?? '').trim())) ?? null;
const nonLette = (radice: HTMLElement) =>
  Array.from(radice.querySelectorAll('.sr-only')).filter((x) => x.textContent === 'Non letta').length;
const idARighe = (radice: HTMLElement) => Array.from(radice.querySelectorAll('li')).map((li) => li.textContent ?? '');

beforeEach(() => {
  mondo.righe = [];
  mondo.lettureCadute = false;
  mondo.attesa = null;
  mondo.letture = [];
  globali.__UTENTE__ = { id: 'u1' };
  globali.__CLIENT_SUPABASE__ = database();
  globali.__ASCOLTI_AUTH__ = [];
});

afterEach(() => {
  document.body.innerHTML = '';
  for (const k of ['__UTENTE__', '__CLIENT_SUPABASE__', '__ASCOLTI_AUTH__']) delete globali[k];
});

describe('R01-002 · «Carica altre» resta mentre carica e un errore non cancella l’elenco', () => {
  it('mentre carica le altre il tasto resta, spento, dice «Caricamento…»; premuto ancora non parte due volte e le righe non si doppiano', async () => {
    mondo.righe = righeDi('u1', 60, true);
    const { s } = await apri();
    expect(idARighe(s.radice), 'controprova: le prime 50 devono essere a video').toHaveLength(50);
    const altre = pulsante(s.radice, /^Carica altre$/);
    expect(altre, 'con 50 notifiche su 50 chieste il tasto «Carica altre» c’è').not.toBeNull();

    let lascialeArrivare = () => {};
    mondo.attesa = new Promise<void>((r) => { lascialeArrivare = r; });
    s.agisci(() => clicca(altre!));
    await lascia();

    const tasto = pulsante(s.radice, /Caricamento|Carica altre/);
    expect(tasto, 'mentre carica le altre, il tasto è sparito').not.toBeNull();
    expect(tasto!.disabled, 'mentre carica, il tasto si può premere di nuovo').toBe(true);
    expect(tasto!.textContent).toMatch(/Caricamento…/);
    expect(idARighe(s.radice), 'mentre carica, l’elenco di prima è sparito').toHaveLength(50);

    s.agisci(() => { clicca(tasto!); clicca(tasto!); });
    await lascia();
    expect(mondo.letture.filter((n) => n > 50), 'premuto più volte, «Carica altre» è partito più volte').toEqual([100]);

    await act(async () => { lascialeArrivare(); });
    mondo.attesa = null;
    await lascia();
    const righe = idARighe(s.radice);
    expect(righe).toHaveLength(60);
    expect(new Set(righe).size, 'le righe si sono doppiate').toBe(60);
    s.smonta();
  }, 60000);

  it('se «Carica altre» cade, le notifiche già lette restano a video, con «Riprova»', async () => {
    mondo.righe = righeDi('u1', 60, true);
    const { s } = await apri();
    expect(idARighe(s.radice), 'controprova: le prime 50 devono essere a video').toHaveLength(50);

    mondo.lettureCadute = true;
    s.agisci(() => clicca(pulsante(s.radice, /^Carica altre$/)!));
    await lascia();
    const testo = s.radice.textContent ?? '';
    expect(testo, 'l’errore ha cancellato le notifiche già lette').toContain('u1-avviso-0');
    expect(testo).toContain('u1-avviso-49');
    expect(testo).toContain('Non riusciamo a caricare altre notifiche');
    expect(pulsante(s.radice, /^Riprova$/), 'accanto all’errore manca «Riprova»').not.toBeNull();
    s.smonta();
  }, 60000);

  it('«Segna tutte come lette» riuscito e rilettura caduta: nessuna «Non letta» e il pulsante sparisce', async () => {
    mondo.righe = righeDi('u1', 3, false);
    const { s } = await apri();
    expect(nonLette(s.radice), 'controprova: le 3 non lette devono essere a video').toBe(3);
    const segna = pulsante(s.radice, /Segna tutte come lette/);
    expect(segna, 'controprova: con 3 non lette il pulsante c’è').not.toBeNull();

    // La scrittura riesce, le riletture (elenco e campanello) cadono.
    mondo.lettureCadute = true;
    s.agisci(() => clicca(segna!));
    await lascia();
    expect(mondo.righe.every((r) => r.is_read), 'controprova: la scrittura doveva riuscire').toBe(true);
    expect(s.radice.textContent, 'la rilettura caduta ha tolto l’elenco').toContain('u1-avviso-2');
    expect(nonLette(s.radice), 'scritte lette sul database, la pagina le mostra ancora «Non letta»').toBe(0);
    expect(pulsante(s.radice, /Segna tutte come lette/), 'scritte lette sul database, «Segna tutte come lette» resta').toBeNull();
    s.smonta();
  }, 60000);

  // Seconda passata (collaudo): con più di 50 righe a video (dopo «Carica altre») e quando la prima
  // lettura di chi è collegato non l'aveva trovato, le righe in memoria restavano «Non letta».
  it('dopo «Carica altre» (100 chieste, 60 a video), «Segna tutte» riuscito e rilettura caduta: nessuna «Non letta»', async () => {
    mondo.righe = righeDi('u1', 60, false);
    const { s } = await apri();
    s.agisci(() => clicca(pulsante(s.radice, /^Carica altre$/)!));
    await lascia();
    expect(idARighe(s.radice), 'controprova: dopo «Carica altre» le 60 devono essere a video').toHaveLength(60);
    expect(nonLette(s.radice), 'controprova: le 60 non lette devono essere a video').toBe(60);

    mondo.lettureCadute = true;
    s.agisci(() => clicca(pulsante(s.radice, /Segna tutte come lette/)!));
    await lascia();
    expect(mondo.righe.every((r) => r.is_read), 'controprova: la scrittura doveva riuscire').toBe(true);
    expect(idARighe(s.radice), 'la rilettura caduta ha tolto l’elenco').toHaveLength(60);
    expect(nonLette(s.radice), 'scritte lette sul database, oltre le prime 50 la pagina le mostra ancora «Non letta»').toBe(0);
    expect(pulsante(s.radice, /Segna tutte come lette/)).toBeNull();
    s.smonta();
  }, 60000);

  it('la prima lettura di chi è collegato non l’aveva trovato: «Segna tutte» riuscito e rilettura caduta, nessuna «Non letta»', async () => {
    // La prima domanda «chi è collegato» (quella condivisa dalla pagina) risponde nessuno, come
    // con la rete storta; quelle dopo trovano u1.
    let domande = 0;
    Object.defineProperty(globali, '__UTENTE__', {
      configurable: true,
      enumerable: true,
      get: () => (++domande === 1 ? null : { id: 'u1' }),
    });
    mondo.righe = righeDi('u1', 3, false);
    const { s } = await apri();
    expect(nonLette(s.radice), 'controprova: le 3 non lette devono essere a video').toBe(3);

    mondo.lettureCadute = true;
    s.agisci(() => clicca(pulsante(s.radice, /Segna tutte come lette/)!));
    await lascia();
    expect(mondo.righe.every((r) => r.is_read), 'controprova: la scrittura doveva riuscire').toBe(true);
    expect(s.radice.textContent, 'la rilettura caduta ha tolto l’elenco').toContain('u1-avviso-2');
    expect(nonLette(s.radice), 'scritte lette sul database, l’elenco a video le mostra ancora «Non letta»').toBe(0);
    expect(pulsante(s.radice, /Segna tutte come lette/)).toBeNull();
    s.smonta();
  }, 60000);
});
