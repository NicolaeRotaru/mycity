/**
 * @vitest-environment jsdom
 */
/**
 * R10-012 — NELLE NOTIFICHE IL TASTO «CARICA ALTRE» SPARIVA MENTRE CARICAVA, E UN ERRORE CANCELLAVA
 * DALLA PAGINA L'ELENCO GIÀ LETTO.
 *
 * Premuto «Carica altre», la domanda nuova (100 invece di 50) mostra l'elenco di prima come
 * segnaposto: 50 righe su 100 chieste, e il tasto si nascondeva («ne sono arrivate meno di quante ne
 * ho chieste»). Se poi la lettura cadeva, la pagina intera diventava l'errore e le 50 notifiche già a
 * video sparivano.
 *
 * Qui si monta la pagina vera; react-query è quello finto delle prove: la prova dice cosa risponde
 * la domanda da 50 (letta) e quella da 100 (in corso, oppure caduta), come fa react-query 5.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, createElement, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { monta } from './aiuti/monta-componente';
import { accendi, attendi, clicca } from './aiuti/schermo';

const globali = globalThis as Record<string, unknown>;

const ora = Date.parse('2026-11-13T10:00:00Z');
const cinquanta = Array.from({ length: 50 }, (_, i) => ({
  id: `n${i}`,
  user_id: 'u1',
  title: `Aggiornamento ${i}`,
  body: null,
  link: null,
  is_read: true,
  created_at: new Date(ora - i * 3_600_000).toISOString(),
}));

type Opzioni = { queryKey: unknown[] };
const eLista = (o: Opzioni, quante: number) =>
  o.queryKey[0] === 'notifications' && o.queryKey[1] === 'list' && o.queryKey[2] === quante;

const pulsante = (radice: HTMLElement, testo: RegExp) =>
  Array.from(radice.querySelectorAll('button')).find((b) => testo.test((b.textContent ?? '').trim())) ?? null;

/** Apre la pagina con le prime 50 lette e preme «Carica altre»: la domanda da 100 risponde `cento`. */
async function premiCaricaAltre(cento: Record<string, unknown>) {
  globali.__DATI_QUERY__ = (o: Opzioni) => {
    if (o.queryKey[0] === 'auth') return { id: 'u1' };
    if (o.queryKey[1] === 'count') return 0;
    if (eLista(o, 50)) return cinquanta;
    if (eLista(o, 100)) return cento.data;
    return undefined;
  };
  globali.__ESITO_QUERY__ = (o: Opzioni) => (eLista(o, 100) ? cento : undefined);
  const mod = await monta('app/notifications/page.tsx');
  const s = accendi(mod.default);
  await attendi();
  const altre = pulsante(s.radice, /^Carica altre$/);
  expect(altre, 'con 50 notifiche su 50 chieste il tasto «Carica altre» c’è').not.toBeNull();
  s.agisci(() => clicca(altre!));
  await attendi();
  return s;
}

beforeEach(() => {
  globali.__UTENTE__ = { id: 'u1' };
});

afterEach(() => {
  document.body.innerHTML = '';
  for (const k of ['__UTENTE__', '__DATI_QUERY__', '__ESITO_QUERY__']) globali[k] = undefined;
});

describe('R10-012 · «Carica altre» resta al suo posto e un errore non cancella l’elenco', () => {
  it('mentre carica, il tasto resta visibile, disattivato, e dice che sta caricando', async () => {
    // react-query 5 con keepPreviousData: i dati di prima come segnaposto, lettura in corso.
    const s = await premiCaricaAltre({ data: cinquanta, isPlaceholderData: true, isFetching: true });
    const tasto = pulsante(s.radice, /Caricamento|Carica altre/);
    expect(tasto, 'mentre carica le altre, il tasto è sparito').not.toBeNull();
    expect(tasto!.disabled, 'mentre carica, il tasto si può premere di nuovo').toBe(true);
    expect(tasto!.textContent).toMatch(/Caricamento/);
    expect(s.radice.textContent).toContain('Aggiornamento 49');
    s.smonta();
  }, 60000);

  it('se «Carica altre» cade, le 50 già lette restano e l’errore si dice accanto, con «Riprova»', async () => {
    // react-query 5: la domanda nuova non ha dati suoi, e il segnaposto finisce con l'errore.
    const s = await premiCaricaAltre({
      data: undefined, isPlaceholderData: false, isFetching: false,
      isError: true, isSuccess: false, error: new Error('rete caduta'),
    });
    const testo = s.radice.textContent ?? '';
    expect(testo, 'l’errore ha cancellato le notifiche già lette').toContain('Aggiornamento 0');
    expect(testo).toContain('Aggiornamento 49');
    expect(testo).toContain('Non riusciamo a caricare altre notifiche');
    expect(pulsante(s.radice, /^Riprova$/), 'accanto all’errore manca «Riprova»').not.toBeNull();
    s.smonta();
  }, 60000);
});

/*
 * Seconda passata (revisore, con il react-query vero). L'elenco tenuto da parte deve rinnovarsi con
 * ogni lettura riuscita e dire l'errore giusto:
 *  - vale solo per la sessione che l'ha letto: se la sessione cambia o finisce, una lettura caduta dà
 *    la pagina d'errore di prima, non l'elenco tenuto (sia quando se ne accorge la lettura, sia quando
 *    lo dice l'avviso di sessione con la rete giù);
 *  - dopo «Segna tutte come lette» riuscito, se la rilettura cade, l'elenco tenuto risulta letto;
 *  - «Non riusciamo a caricare altre notifiche» solo se a cadere è proprio «Carica altre»: se cade
 *    una rilettura dell'elenco già a video, la frase dice che non si è riusciti ad aggiornarlo.
 * Qui react-query è quello vero, e il database un finto che risponde, o cade, a comando.
 */
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

const mondo = { righe: [] as Riga[], lettureCadute: false };
const RETE_GIU = { message: 'TypeError: fetch failed' };

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
      c.limit = (n: number) => { limite = n; return c; };
      c.update = (v: Partial<Riga>) => { valori = v; return c; };
      c.then = (ok: (x: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(risposta()).then(ok, ko);
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

/** Monta la pagina col react-query vero; `ridisegna` la ridisegna come farebbe un genitore. */
async function apriDavvero() {
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
  /** Come fa QueryProvider quando cambia l'accesso: la memoria si svuota, e la pagina rilegge. */
  const svuotaLaMemoria = async () => {
    await act(async () => {
      qc.clear();
      ridisegna();
    });
    await lascia();
  };
  return { s, qc, svuotaLaMemoria };
}

const nonLette = (radice: HTMLElement) =>
  Array.from(radice.querySelectorAll('.sr-only')).filter((x) => x.textContent === 'Non letta').length;

describe('R10-012 · l’elenco tenuto si rinnova con ogni lettura riuscita e dice l’errore giusto', () => {
  beforeEach(() => {
    mondo.righe = [];
    mondo.lettureCadute = false;
    globali.__CLIENT_SUPABASE__ = database();
    globali.__ASCOLTI_AUTH__ = [];
  });
  afterEach(() => {
    delete globali.__CLIENT_SUPABASE__;
    delete globali.__ASCOLTI_AUTH__;
  });

  it('se cade una rilettura dell’elenco a video (non «Carica altre»), la frase dice che non si è riusciti ad aggiornarlo', async () => {
    mondo.righe = righeDi('u1', 3, true);
    const { s, qc } = await apriDavvero();
    expect(s.radice.textContent, 'la prima lettura deve riuscire: la prova girerebbe a vuoto').toContain('u1-avviso-2');

    mondo.lettureCadute = true;
    await act(async () => {
      await qc.refetchQueries({ queryKey: ['notifications', 'list'] });
    });
    await lascia();
    const testo = s.radice.textContent ?? '';
    expect(testo, 'la rilettura caduta ha tolto l’elenco già letto').toContain('u1-avviso-0');
    expect(testo, '«Carica altre» non è stato premuto: la frase non può dire che non arrivano le altre').not.toContain('Non riusciamo a caricare altre notifiche');
    expect(testo).toContain('Non riusciamo ad aggiornare le notifiche');
    expect(pulsante(s.radice, /^Riprova$/), 'accanto all’errore manca «Riprova»').not.toBeNull();
    s.smonta();
  }, 60000);

  it('dopo «Carica altre» caduto, «Segna tutte come lette» riuscito e rilettura caduta: l’elenco tenuto risulta letto', async () => {
    mondo.righe = righeDi('u1', 50, false);
    const { s } = await apriDavvero();
    expect(nonLette(s.radice), 'le 50 non lette devono essere a video: la prova girerebbe a vuoto').toBe(50);

    mondo.lettureCadute = true;
    s.agisci(() => clicca(pulsante(s.radice, /^Carica altre$/)!));
    await lascia();
    expect(s.radice.textContent, 'qui a cadere è proprio «Carica altre»').toContain('Non riusciamo a caricare altre notifiche');

    s.agisci(() => clicca(pulsante(s.radice, /Segna tutte come lette/)!));
    await lascia();
    expect(mondo.righe.every((r) => r.is_read), 'la scrittura doveva riuscire').toBe(true);
    expect(s.radice.textContent, 'l’elenco tenuto è sparito').toContain('u1-avviso-49');
    expect(nonLette(s.radice), 'scritte lette sul database, l’elenco tenuto le mostra ancora non lette').toBe(0);
    s.smonta();
  }, 60000);

  it('se la sessione cambia e la lettura cade, esce la pagina d’errore di prima, non l’elenco tenuto', async () => {
    mondo.righe = [...righeDi('u1', 3, true), ...righeDi('u2', 2, true)];
    const { s, svuotaLaMemoria } = await apriDavvero();
    expect(s.radice.textContent, 'la prima lettura deve riuscire: la prova girerebbe a vuoto').toContain('u1-avviso-2');

    globali.__UTENTE__ = { id: 'u2' };
    mondo.lettureCadute = true;
    await svuotaLaMemoria();
    const testo = s.radice.textContent ?? '';
    expect(testo, 'dopo il cambio di sessione la pagina mostra ancora l’elenco tenuto').not.toContain('u1-avviso');
    expect(testo).toContain('Non riusciamo a caricare le notifiche');
    s.smonta();
  }, 60000);

  it('anche con l’elenco vuoto: dopo il cambio di sessione una lettura caduta non dice «Nessuna notifica»', async () => {
    mondo.righe = righeDi('u2', 2, true);
    const { s, svuotaLaMemoria } = await apriDavvero();
    expect(s.radice.textContent, 'la prima lettura deve dare l’elenco vuoto: la prova girerebbe a vuoto').toContain('Nessuna notifica');

    globali.__UTENTE__ = { id: 'u2' };
    mondo.lettureCadute = true;
    await svuotaLaMemoria();
    const testo = s.radice.textContent ?? '';
    expect(testo, 'la lettura è caduta: dire «Nessuna notifica» a chi ne ha è dire il falso').not.toContain('Nessuna notifica');
    expect(testo).toContain('Non riusciamo a caricare le notifiche');
    s.smonta();
  }, 60000);

  it('anche se la sessione cambia con la rete giù, prima di sapere chi è collegato', async () => {
    mondo.righe = righeDi('u1', 3, true);
    const { s, svuotaLaMemoria } = await apriDavvero();
    expect(s.radice.textContent, 'la prima lettura deve riuscire: la prova girerebbe a vuoto').toContain('u1-avviso-2');

    // Arriva l'avviso di una sessione nuova, poi la rete cade: chiedere chi è collegato non riesce più.
    act(() => {
      for (const ascolto of globali.__ASCOLTI_AUTH__ as Array<(e: string, s: unknown) => void>) ascolto('SIGNED_IN', { user: { id: 'u2' } });
    });
    Object.defineProperty(globali, '__UTENTE__', { configurable: true, get: () => { throw new TypeError('fetch failed'); } });
    mondo.lettureCadute = true;
    try {
      await svuotaLaMemoria();
      const testo = s.radice.textContent ?? '';
      expect(testo, 'dopo il cambio di sessione la pagina mostra ancora l’elenco tenuto').not.toContain('u1-avviso');
      expect(testo).toContain('Non riusciamo a caricare le notifiche');
    } finally {
      delete globali.__UTENTE__;
      s.smonta();
    }
  }, 60000);
});
