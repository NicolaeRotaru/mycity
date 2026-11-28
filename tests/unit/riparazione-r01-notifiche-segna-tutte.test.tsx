/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { monta } from './aiuti/monta-componente';
import { accendi, clicca } from './aiuti/schermo';

/**
 * R01-001 — Dopo «Segna tutte come lette» riuscito le notifiche restano lette a video anche mentre
 * la pagina rilegge, anche se la rilettura cade, e anche se «Carica altre» era in volo.
 *
 * Giro di correzione. Con le impostazioni del sito (QueryProvider vero: un nuovo tentativo dopo una
 * lettura caduta, con l'attesa fra i due) la prova di prima non vedeva due casi:
 *  A. «Carica altre» cade, «Segna tutte» riesce, la rilettura cade: durante l'attesa del nuovo
 *     tentativo a video tornava il segnaposto (l'elenco delle prime 50, mai segnato letto), con 50
 *     «Non letta» e il pulsante;
 *  B. «Carica altre» in volo e «Segna tutte» riuscito: la lettura partita prima della scrittura
 *     arrivava dopo e lasciava 60 «Non letta».
 *  C. Resta: le scritture in memoria toccano solo le chiavi di chi ha premuto; il campanello e la
 *     memoria di un altro account restano com'erano.
 *
 * React-query è quello vero, dentro QueryProvider vero, col guscio dell'account (chip «Notifiche») e
 * la pagina vera. L'orologio è finto: l'attesa fra i tentativi la fa passare la prova. Il database è
 * un finto con la stessa regola del vero (ognuno legge e scrive solo le sue notifiche,
 * migrations/008_notifications.sql): una richiesta legge il database quando parte, e la risposta può
 * tardare a comando; le letture possono cadere. Nessuna data entra nelle verifiche.
 */

const globali = globalThis as Record<string, unknown>;
const ora = Date.parse('2026-11-19T10:00:00Z');

type Riga = { id: string; user_id: string; title: string; body: null; link: null; is_read: boolean; created_at: string };
const righeDi = (utente: string, quante: number, letta: boolean, da = 0): Riga[] =>
  Array.from({ length: quante }, (_, j) => {
    const i = da + j;
    return {
      id: `${utente}-n${i}`,
      user_id: utente,
      title: `${utente}-avviso-${i}`,
      body: null,
      link: null,
      is_read: letta,
      created_at: new Date(ora - i * 3_600_000).toISOString(),
    };
  });

const RETE_GIU = { message: 'TypeError: fetch failed' };

const mondo = {
  righe: [] as Riga[],
  lettureCadute: false,
  attesaLetture: null as Promise<void> | null,
};

function database() {
  return {
    from: (tavola: string) => {
      const filtri: Record<string, unknown> = {};
      let limite = Number.POSITIVE_INFINITY;
      let conta = false;
      let valori: Partial<Riga> | null = null;
      const esegui = () => {
        if (tavola !== 'notifications') return { data: [], error: null };
        const chi = (globali.__UTENTE__ as { id: string } | null | undefined)?.id ?? null;
        const scelte = mondo.righe
          .filter((r) => r.user_id === chi)
          .filter((r) => Object.entries(filtri).every(([k, v]) => (r as Record<string, unknown>)[k] === v));
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
      c.update = (v: Partial<Riga>) => { valori = v; return c; };
      for (const m of ['or', 'in', 'order']) c[m] = () => c;
      c.limit = (n: number) => { limite = n; return c; };
      c.then = (ok: (x: unknown) => unknown, ko?: (e: unknown) => unknown) => {
        // La richiesta legge il database adesso, con la sessione di adesso; la risposta può tardare.
        const esito = esegui();
        const attesa = (valori ? null : mondo.attesaLetture) ?? Promise.resolve();
        return attesa.then(() => esito).then(ok, ko);
      };
      return c;
    },
  };
}

/** Fa passare `ms` millisecondi dell'orologio finto, poi lascia finire quello che è pronto. */
async function passa(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  for (let i = 0; i < 25; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
}

/** Una promessa che si scioglie a comando. */
function cancello() {
  let apri = () => {};
  const promessa = new Promise<void>((r) => { apri = r; });
  return { promessa, apri };
}

const veri = { veri: ['@tanstack/react-query'] };

/** Come nel sito: QueryProvider vero (con le sue impostazioni), il guscio dell'account e la pagina. */
async function apriComeNelSito() {
  const fornitore = await monta('components/providers/QueryProvider.tsx', veri);
  const guscio = await monta('components/account/AccountShell.tsx', veri);
  const pagina = await monta('app/notifications/page.tsx', veri);
  const Fornitore = fornitore.default as (p: { children: unknown }) => unknown;
  const Guscio = guscio.default as (p: { children: unknown }) => unknown;
  const Pagina = pagina.default as () => unknown;
  // L'orologio finto parte qui, a componenti compilati: l'attesa fra i tentativi la decide la prova.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'], now: ora });
  let client: QueryClient | null = null;
  const Presa = () => {
    client = useQueryClient();
    return null;
  };
  const s = accendi(() =>
    createElement(Fornitore as never, null,
      createElement(Presa),
      createElement(Guscio as never, null, createElement(Pagina as never))),
  );
  await passa();
  const avviso = async (evento: string, utente: string | null) => {
    globali.__UTENTE__ = utente ? { id: utente } : null;
    await act(async () => {
      for (const ascolto of [...(globali.__ASCOLTI_AUTH__ as Array<(e: string, s: unknown) => void>)]) {
        ascolto(evento, utente ? { user: { id: utente } } : null);
      }
    });
    await passa();
  };
  return { s, avviso, client: () => client! };
}

const pulsante = (radice: HTMLElement, testo: RegExp) =>
  Array.from(radice.querySelectorAll('button')).find((b) => testo.test((b.textContent ?? '').trim())) ?? null;

const nonLette = (radice: HTMLElement) =>
  Array.from(radice.querySelectorAll('.sr-only')).filter((x) => x.textContent === 'Non letta').length;

const righeAVideo = (radice: HTMLElement) => radice.querySelectorAll('ul.flex-col.gap-2\\.5 > li').length;

/**
 * Il numero delle notifiche nel menu account del telefono; null se non ne mostra.
 * 28/11/2026 — La striscia di pillole del telefono è diventata un menu (components/ui/MenuSezioni.tsx): il numero di
 * ogni voce si legge nel pannello che si apre dal riquadro «Il tuo account». Se è chiuso lo si apre; la domanda resta
 * la stessa: quante non lette dice la voce «Notifiche» a chi guarda adesso.
 */
function numeroSulChip(radice: HTMLElement): string | null {
  const pulsante = Array.from(radice.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="dialog"]'))
    .find((b) => !b.closest('aside') && (b.textContent ?? '').includes('Il tuo account'));
  if (!pulsante) throw new Error('nel menu account del telefono manca il riquadro «Il tuo account»');
  if (pulsante.getAttribute('aria-expanded') !== 'true') act(() => { pulsante.click(); });
  const pannello = radice.querySelector('[role="dialog"][aria-label="Menu account"]');
  const voce = Array.from(pannello?.querySelectorAll('a') ?? []).find((a) => a.getAttribute('href') === '/notifications');
  if (!voce) throw new Error('nel menu account manca la voce «Notifiche»');
  const numero = /,\s*(\d+\+?) da leggere/.exec(voce.textContent ?? '');
  return numero ? numero[1] : null;
}

beforeEach(() => {
  mondo.righe = [];
  mondo.lettureCadute = false;
  mondo.attesaLetture = null;
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

describe('R01-001 · con le impostazioni del sito, dopo «Segna tutte come lette» le notifiche restano lette', () => {
  it('A · «Carica altre» cade, «Segna tutte» riesce, la rilettura cade: mai di nuovo «Non letta», nemmeno durante il nuovo tentativo', async () => {
    mondo.righe = righeDi('u1', 60, false);
    const { s, avviso } = await apriComeNelSito();
    await avviso('INITIAL_SESSION', 'u1');
    expect(nonLette(s.radice), 'controprova: le prime 50 non lette devono essere a video').toBe(50);

    mondo.lettureCadute = true;
    s.agisci(() => clicca(pulsante(s.radice, /^Carica altre$/)!));
    await passa(10_000);
    expect(s.radice.textContent, 'controprova: qui a cadere è «Carica altre», dopo il nuovo tentativo').toContain('Non riusciamo a caricare altre notifiche');
    expect(righeAVideo(s.radice), 'controprova: le notifiche già lette restano').toBe(50);

    s.agisci(() => clicca(pulsante(s.radice, /Segna tutte come lette/)!));
    await passa();
    expect(mondo.righe.every((r) => r.is_read), 'controprova: la scrittura doveva riuscire').toBe(true);
    // Adesso la rilettura è caduta una volta e aspetta il nuovo tentativo.
    expect(righeAVideo(s.radice), 'durante il nuovo tentativo l’elenco è sparito').toBe(50);
    expect(nonLette(s.radice), 'durante il nuovo tentativo tornano «Non letta»').toBe(0);
    expect(pulsante(s.radice, /Segna tutte come lette/), 'durante il nuovo tentativo torna il pulsante').toBeNull();

    await passa(10_000);
    expect(nonLette(s.radice), 'caduto anche il nuovo tentativo, tornano «Non letta»').toBe(0);
    expect(pulsante(s.radice, /Segna tutte come lette/), 'caduto anche il nuovo tentativo, torna il pulsante').toBeNull();
    expect(numeroSulChip(s.radice), 'il chip «Notifiche» mostra ancora le non lette').toBeNull();
    s.smonta();
  }, 60000);

  it('A · come A, ma l’elenco delle prime 50 è già uscito dalla memoria (minuti dopo): il segnaposto non rimette «Non letta»', async () => {
    mondo.righe = righeDi('u1', 60, false);
    const { s, avviso, client } = await apriComeNelSito();
    await avviso('INITIAL_SESSION', 'u1');
    expect(nonLette(s.radice), 'controprova: le prime 50 non lette devono essere a video').toBe(50);

    mondo.lettureCadute = true;
    s.agisci(() => clicca(pulsante(s.radice, /^Carica altre$/)!));
    await passa(10_000);
    expect(s.radice.textContent, 'controprova: qui a cadere è «Carica altre»').toContain('Non riusciamo a caricare altre notifiche');

    // Passano sei minuti: l'elenco delle prime 50, che nessuno guarda più, esce dalla memoria.
    await passa(6 * 60_000);
    expect(client().getQueryData(['notifications', 'list', 50, 'u1']), 'controprova: l’elenco delle prime 50 doveva uscire dalla memoria').toBeUndefined();
    expect(righeAVideo(s.radice), 'controprova: le notifiche già lette restano a video').toBe(50);

    s.agisci(() => clicca(pulsante(s.radice, /Segna tutte come lette/)!));
    await passa();
    expect(mondo.righe.every((r) => r.is_read), 'controprova: la scrittura doveva riuscire').toBe(true);
    expect(nonLette(s.radice), 'durante il nuovo tentativo tornano «Non letta» dall’elenco uscito dalla memoria').toBe(0);
    expect(pulsante(s.radice, /Segna tutte come lette/), 'durante il nuovo tentativo torna il pulsante').toBeNull();

    await passa(10_000);
    expect(nonLette(s.radice)).toBe(0);
    expect(pulsante(s.radice, /Segna tutte come lette/)).toBeNull();
    s.smonta();
  }, 60000);

  it('B · «Carica altre» in volo e «Segna tutte» riuscito: la lettura partita prima non rimette «Non letta»', async () => {
    mondo.righe = righeDi('u1', 60, false);
    const { s, avviso } = await apriComeNelSito();
    await avviso('INITIAL_SESSION', 'u1');
    expect(nonLette(s.radice), 'controprova: le prime 50 non lette devono essere a video').toBe(50);

    // «Carica altre» parte e legge il database adesso (60 non lette); la risposta tarda.
    const lente = cancello();
    mondo.attesaLetture = lente.promessa;
    s.agisci(() => clicca(pulsante(s.radice, /^Carica altre$/)!));
    await passa();
    expect(pulsante(s.radice, /Caricamento…/), 'controprova: «Carica altre» deve essere in volo').not.toBeNull();

    s.agisci(() => clicca(pulsante(s.radice, /Segna tutte come lette/)!));
    await passa();
    expect(mondo.righe.every((r) => r.is_read), 'controprova: la scrittura doveva riuscire').toBe(true);
    expect(nonLette(s.radice), 'scritte lette, mentre si rilegge a video restano «Non letta»').toBe(0);
    expect(pulsante(s.radice, /Segna tutte come lette/), 'scritte lette, mentre si rilegge resta il pulsante').toBeNull();

    // Arrivano le risposte: quella partita prima della scrittura e la rilettura dopo.
    await act(async () => { lente.apri(); });
    mondo.attesaLetture = null;
    await passa(10_000);
    expect(righeAVideo(s.radice), '«Carica altre» non ha portato le altre').toBe(60);
    expect(nonLette(s.radice), 'la lettura partita prima della scrittura ha rimesso «Non letta»').toBe(0);
    expect(pulsante(s.radice, /Segna tutte come lette/), 'la lettura partita prima della scrittura ha rimesso il pulsante').toBeNull();
    expect(numeroSulChip(s.radice)).toBeNull();
    s.smonta();
  }, 60000);
});

describe('R01-001 · le scritture in memoria di «Segna tutte come lette» restano di chi l’ha premuto', () => {
  it('C · tutti gli elenchi e i conti di u1 risultano letti; il campanello, gli elenchi e il database di u2 restano com’erano', async () => {
    mondo.righe = [...righeDi('u1', 60, false), ...righeDi('u2', 2, false), ...righeDi('u2', 1, true, 2)];
    const { s, avviso, client } = await apriComeNelSito();
    await avviso('INITIAL_SESSION', 'u1');
    expect(numeroSulChip(s.radice), 'controprova: u1 ha 60 non lette sul chip').toBe('60');

    s.agisci(() => clicca(pulsante(s.radice, /^Carica altre$/)!));
    await passa();
    expect(righeAVideo(s.radice), 'controprova: «Carica altre» porta le altre').toBe(60);

    // In memoria c'è anche quello che resta di u2 (era entrato prima su questo telefono) e il
    // campanello del negozio di u1.
    const qc = client();
    const elencoU2 = righeDi('u2', 2, false);
    qc.setQueryData(['notifications', 'list', 50, 'u2'], elencoU2);
    qc.setQueryData(['notifications', 'list', 100, 'u2'], elencoU2);
    qc.setQueryData(['notifications', 'count', 'u2'], 2);
    qc.setQueryData(['notifications', 'count', 'seller-bell', 'u2'], 2);
    qc.setQueryData(['notifications', 'count', 'seller-bell', 'u1'], 60);

    // Le riletture dopo la scrittura tardano: si vede cosa ha scritto la pagina in memoria.
    const lente = cancello();
    mondo.attesaLetture = lente.promessa;
    s.agisci(() => clicca(pulsante(s.radice, /Segna tutte come lette/)!));
    await passa();
    expect(mondo.righe.filter((r) => r.user_id === 'u1' && !r.is_read), 'controprova: sul database le notifiche di u1 sono lette').toHaveLength(0);
    expect(mondo.righe.filter((r) => r.user_id === 'u2' && !r.is_read), 'il clic di u1 ha segnato lette sul database le notifiche di u2').toHaveLength(2);

    for (const quante of [50, 100]) {
      const elenco = qc.getQueryData<Riga[]>(['notifications', 'list', quante, 'u1']);
      expect(elenco?.length, `controprova: l’elenco da ${quante} di u1 deve essere in memoria`).toBeGreaterThan(0);
      expect(elenco!.filter((n) => !n.is_read), `l’elenco da ${quante} di u1 resta non letto in memoria`).toHaveLength(0);
    }
    expect(qc.getQueryData(['notifications', 'count', 'u1']), 'il conto di u1 resta quello di prima').toBe(0);
    expect(qc.getQueryData(['notifications', 'count', 'seller-bell', 'u1']), 'il campanello del negozio di u1 resta quello di prima').toBe(0);

    expect(qc.getQueryData(['notifications', 'list', 50, 'u2']), 'il clic di u1 ha toccato l’elenco di u2').toEqual(elencoU2);
    expect(qc.getQueryData(['notifications', 'list', 100, 'u2']), 'il clic di u1 ha toccato l’elenco di u2').toEqual(elencoU2);
    expect(qc.getQueryData(['notifications', 'count', 'u2']), 'il clic di u1 ha toccato il conto di u2').toBe(2);
    expect(qc.getQueryData(['notifications', 'count', 'seller-bell', 'u2']), 'il clic di u1 ha toccato il campanello di u2').toBe(2);

    await act(async () => { lente.apri(); });
    mondo.attesaLetture = null;
    await passa(10_000);
    expect(nonLette(s.radice)).toBe(0);
    expect(numeroSulChip(s.radice)).toBeNull();
    expect(qc.getQueryData(['notifications', 'count', 'u2'])).toBe(2);
    s.smonta();
  }, 60000);
});
