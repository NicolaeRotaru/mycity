/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { monta } from './aiuti/monta-componente';
import { accendi, clicca } from './aiuti/schermo';

/**
 * R01-001 — Nelle notifiche il tasto «Carica altre» non sparisce mentre carica, un errore non
 * cancella dalla pagina l'elenco già letto, e «Segna tutte come lette» tocca solo chi l'ha premuto.
 *
 * Terzo giro. Cosa deve valere:
 *  1. mentre «Carica altre» carica, il tasto resta, fermo, e dice «Caricamento…»;
 *  2. se «Carica altre» cade, le notifiche già lette restano, l'errore si dice in linea e «Riprova»
 *     le porta;
 *  3. dopo «Segna tutte come lette» riuscito, se la rilettura cade, le notifiche risultano lette e il
 *     pulsante sparisce (prima restavano «Non letta» col pulsante a video: react-query tiene i dati
 *     di prima, e il conto del campanello pure);
 *  4. le scritture in memoria di «Segna tutte come lette» toccano solo le chiavi di chi l'ha premuto:
 *     se nel frattempo è entrato un altro account, il suo campanello e il suo elenco restano com'erano.
 *
 * React-query è quello vero. Il database è un finto con la stessa regola del vero (ognuno legge e
 * scrive solo le sue notifiche, migrations/008_notifications.sql): una scrittura arriva al database
 * con la sessione del momento in cui parte, e la risposta può tardare; le letture possono cadere o
 * aspettare a comando. Nessuna data entra nelle verifiche: i titoli sono fissi.
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
  attesaScrittura: null as Promise<void> | null,
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
        // La richiesta parte adesso, con la sessione di adesso; la risposta può tardare.
        const esito = esegui();
        const attesa = (valori ? mondo.attesaScrittura : mondo.attesaLetture) ?? Promise.resolve();
        return attesa.then(() => esito).then(ok, ko);
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

/** Una promessa che si scioglie a comando. */
function cancello() {
  let apri = () => {};
  const promessa = new Promise<void>((r) => { apri = r; });
  return { promessa, apri };
}

const veri = { veri: ['@tanstack/react-query'] };

/** La pagina vera con un QueryClient senza nuovi tentativi (una lettura caduta resta caduta). */
async function apriLaPagina() {
  const pagina = await monta('app/notifications/page.tsx', veri);
  const Pagina = pagina.default as () => unknown;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  const s = accendi(() => createElement(QueryClientProvider, { client: qc }, createElement(Pagina as never)));
  await lascia();
  return { s, qc };
}

/** Come nel sito: QueryProvider vero, il guscio dell'account (col chip «Notifiche») e la pagina. */
async function apriComeNelSito() {
  const fornitore = await monta('components/providers/QueryProvider.tsx', veri);
  const guscio = await monta('components/account/AccountShell.tsx', veri);
  const pagina = await monta('app/notifications/page.tsx', veri);
  const Fornitore = fornitore.default as (p: { children: unknown }) => unknown;
  const Guscio = guscio.default as (p: { children: unknown }) => unknown;
  const Pagina = pagina.default as () => unknown;
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
  await lascia();
  const avviso = async (evento: string, utente: string | null) => {
    globali.__UTENTE__ = utente ? { id: utente } : null;
    await act(async () => {
      for (const ascolto of [...(globali.__ASCOLTI_AUTH__ as Array<(e: string, s: unknown) => void>)]) {
        ascolto(evento, utente ? { user: { id: utente } } : null);
      }
    });
    await lascia();
  };
  return { s, avviso, client: () => client! };
}

const pulsante = (radice: HTMLElement, testo: RegExp) =>
  Array.from(radice.querySelectorAll('button')).find((b) => testo.test((b.textContent ?? '').trim())) ?? null;

const nonLette = (radice: HTMLElement) =>
  Array.from(radice.querySelectorAll('.sr-only')).filter((x) => x.textContent === 'Non letta').length;

const righeAVideo = (radice: HTMLElement) => radice.querySelectorAll('ul.flex-col > li').length;

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
  mondo.attesaScrittura = null;
  globali.__UTENTE__ = { id: 'u1' };
  globali.__CLIENT_SUPABASE__ = database();
  globali.__ASCOLTI_AUTH__ = [];
  globali.__PERCORSO_FINTO__ = '/notifications';
});

afterEach(() => {
  document.body.innerHTML = '';
  for (const k of ['__UTENTE__', '__CLIENT_SUPABASE__', '__ASCOLTI_AUTH__', '__PERCORSO_FINTO__']) delete globali[k];
});

describe('R01-001 · «Carica altre» resta al suo posto e un errore non cancella l’elenco', () => {
  it('1 · mentre carica le altre, il tasto resta visibile, disattivato, e dice «Caricamento…»', async () => {
    mondo.righe = righeDi('u1', 60, true);
    const { s } = await apriLaPagina();
    expect(righeAVideo(s.radice), 'controprova: le prime 50 devono essere a video').toBe(50);

    const lente = cancello();
    mondo.attesaLetture = lente.promessa;
    s.agisci(() => clicca(pulsante(s.radice, /^Carica altre$/)!));
    await lascia();
    const tasto = pulsante(s.radice, /Caricamento…|Carica altre/);
    expect(tasto, 'mentre carica le altre, il tasto è sparito').not.toBeNull();
    expect(tasto!.textContent).toMatch(/Caricamento…/);
    expect(tasto!.disabled, 'mentre carica, il tasto si può premere di nuovo').toBe(true);
    expect(righeAVideo(s.radice), 'mentre carica, l’elenco già letto è sparito').toBe(50);

    await act(async () => { lente.apri(); });
    mondo.attesaLetture = null;
    await lascia();
    expect(righeAVideo(s.radice)).toBe(60);
    expect(pulsante(s.radice, /Caricamento…/)).toBeNull();
    s.smonta();
  }, 60000);

  it('2 · se «Carica altre» cade, le già lette restano, l’errore si dice in linea e «Riprova» porta le altre', async () => {
    mondo.righe = righeDi('u1', 60, true);
    const { s } = await apriLaPagina();
    expect(righeAVideo(s.radice), 'controprova: le prime 50 devono essere a video').toBe(50);

    mondo.lettureCadute = true;
    s.agisci(() => clicca(pulsante(s.radice, /^Carica altre$/)!));
    await lascia();
    expect(righeAVideo(s.radice), 'l’errore ha tolto dalla pagina le notifiche già lette').toBe(50);
    const avviso = s.radice.querySelector('[role="alert"]');
    expect(avviso?.textContent ?? '', 'l’errore non si dice accanto all’elenco').toContain('Non riusciamo a caricare altre notifiche');
    expect(s.radice.textContent, 'l’errore ha preso il posto di tutta la pagina').not.toContain('Non riusciamo a caricare le notifiche');
    const riprova = pulsante(s.radice, /^Riprova$/);
    expect(riprova, 'accanto all’errore manca «Riprova»').not.toBeNull();

    mondo.lettureCadute = false;
    s.agisci(() => clicca(riprova!));
    await lascia();
    expect(righeAVideo(s.radice), '«Riprova» non porta le altre').toBe(60);
    expect(s.radice.querySelector('[role="alert"]')).toBeNull();
    s.smonta();
  }, 60000);
});

describe('R01-001 · dopo «Segna tutte come lette» riuscito, una rilettura caduta non le rimette non lette', () => {
  it('3 · scritte lette sul database e rilettura caduta: a video risultano lette e il pulsante sparisce', async () => {
    mondo.righe = [...righeDi('u1', 3, false), ...righeDi('u1', 2, true, 3)];
    const { s, qc } = await apriLaPagina();
    expect(nonLette(s.radice), 'controprova: le 3 non lette devono essere a video').toBe(3);
    expect(pulsante(s.radice, /Segna tutte come lette/), 'controprova: il pulsante deve esserci').not.toBeNull();

    mondo.lettureCadute = true;
    s.agisci(() => clicca(pulsante(s.radice, /Segna tutte come lette/)!));
    await lascia();
    expect(mondo.righe.every((r) => r.is_read), 'controprova: la scrittura doveva riuscire').toBe(true);
    expect(righeAVideo(s.radice), 'la rilettura caduta ha tolto l’elenco').toBe(5);
    expect(nonLette(s.radice), 'scritte lette sul database, a video restano «Non letta»').toBe(0);
    expect(pulsante(s.radice, /Segna tutte come lette/), 'scritte lette sul database, il pulsante resta a video').toBeNull();
    expect(qc.getQueryData(['notifications', 'count', 'u1']), 'il conto del campanello resta quello di prima').toBe(0);
    s.smonta();
  }, 60000);

  it('3 · anche dopo «Carica altre» caduto: l’elenco tenuto risulta letto e il pulsante sparisce', async () => {
    mondo.righe = righeDi('u1', 60, false);
    const { s } = await apriLaPagina();
    expect(nonLette(s.radice), 'controprova: le 50 non lette devono essere a video').toBe(50);

    mondo.lettureCadute = true;
    s.agisci(() => clicca(pulsante(s.radice, /^Carica altre$/)!));
    await lascia();
    expect(s.radice.textContent, 'controprova: qui a cadere è «Carica altre»').toContain('Non riusciamo a caricare altre notifiche');

    s.agisci(() => clicca(pulsante(s.radice, /Segna tutte come lette/)!));
    await lascia();
    expect(mondo.righe.every((r) => r.is_read), 'controprova: la scrittura doveva riuscire').toBe(true);
    expect(righeAVideo(s.radice), 'l’elenco tenuto è sparito').toBe(50);
    expect(nonLette(s.radice), 'scritte lette sul database, l’elenco tenuto le mostra non lette').toBe(0);
    expect(pulsante(s.radice, /Segna tutte come lette/), 'scritte lette sul database, il pulsante resta a video').toBeNull();
    s.smonta();
  }, 60000);
});

describe('R01-001 · «Segna tutte come lette» tocca solo chi l’ha premuto', () => {
  it('4 · u1 preme, entra u2 prima della risposta: il campanello e l’elenco di u2 restano com’erano', async () => {
    mondo.righe = [...righeDi('u1', 3, false), ...righeDi('u2', 2, false), ...righeDi('u2', 1, true, 2)];
    const { s, avviso, client } = await apriComeNelSito();
    await avviso('INITIAL_SESSION', 'u1');
    expect(numeroSulChip(s.radice), 'controprova: u1 ha 3 non lette sul chip').toBe('3');
    expect(nonLette(s.radice), 'controprova: le 3 non lette di u1 devono essere a video').toBe(3);

    // u1 preme: la scrittura parte con la sua sessione, la risposta tarda.
    const rispostaLenta = cancello();
    mondo.attesaScrittura = rispostaLenta.promessa;
    s.agisci(() => clicca(pulsante(s.radice, /Segna tutte come lette/)!));
    await lascia();

    // Entra u2 prima della risposta.
    await avviso('SIGNED_IN', 'u2');
    expect(s.radice.textContent, 'controprova: dopo il cambio di account l’elenco è quello di u2').toContain('u2-avviso-2');
    expect(s.radice.textContent).not.toContain('u1-avviso');
    expect(numeroSulChip(s.radice), 'controprova: u2 ha 2 non lette sul chip').toBe('2');
    expect(nonLette(s.radice), 'controprova: le 2 non lette di u2 devono essere a video').toBe(2);

    // Arriva la risposta di u1; le riletture che ne seguono tardano: si vede cosa ha scritto la pagina.
    const rilettureLente = cancello();
    mondo.attesaLetture = rilettureLente.promessa;
    await act(async () => { rispostaLenta.apri(); });
    await lascia();
    expect(mondo.righe.filter((r) => r.user_id === 'u2' && !r.is_read), 'controprova: sul database u2 ha ancora 2 non lette').toHaveLength(2);
    expect(mondo.righe.filter((r) => r.user_id === 'u1' && !r.is_read), 'controprova: sul database le notifiche di u1 sono lette').toHaveLength(0);
    expect(client().getQueryData(['notifications', 'count', 'u2']), 'la risposta di u1 ha azzerato il conto di u2').toBe(2);
    expect(numeroSulChip(s.radice), 'la risposta di u1 ha toccato il campanello di u2').toBe('2');
    expect(nonLette(s.radice), 'la risposta di u1 ha segnato lette le notifiche di u2').toBe(2);
    expect(pulsante(s.radice, /Segna tutte come lette/), 'u2 ha ancora non lette: il pulsante deve restare').not.toBeNull();

    await act(async () => { rilettureLente.apri(); });
    mondo.attesaLetture = null;
    await lascia();
    expect(numeroSulChip(s.radice)).toBe('2');
    expect(nonLette(s.radice)).toBe(2);
    s.smonta();
  }, 60000);

  it('4 · u1 preme ma la sessione è già di u2 quando la scrittura parte: non si segna niente a nome di u2', async () => {
    mondo.righe = [...righeDi('u1', 3, false), ...righeDi('u2', 2, false)];
    const { s, avviso } = await apriComeNelSito();
    await avviso('INITIAL_SESSION', 'u1');
    expect(nonLette(s.radice), 'controprova: le 3 non lette di u1 devono essere a video').toBe(3);

    // Il clic è di u1; prima che la scrittura parta la sessione del client è già passata a u2
    // (l'avviso di sessione non è ancora arrivato alla pagina).
    s.agisci(() => {
      clicca(pulsante(s.radice, /Segna tutte come lette/)!);
      globali.__UTENTE__ = { id: 'u2' };
    });
    await lascia();
    expect(mondo.righe.filter((r) => r.user_id === 'u2' && !r.is_read), 'il clic di u1 ha segnato lette le notifiche di u2').toHaveLength(2);

    await avviso('SIGNED_IN', 'u2');
    expect(numeroSulChip(s.radice), 'entrato u2, il suo campanello non dice le sue non lette').toBe('2');
    expect(nonLette(s.radice), 'entrato u2, le sue notifiche risultano lette').toBe(2);
    s.smonta();
  }, 60000);
});
