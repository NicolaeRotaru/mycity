/**
 * @vitest-environment jsdom
 */
/**
 * R22-018 (13/11/2026) — LE NON LETTE PIÙ VECCHIE DELLE ULTIME CINQUANTA RESTAVANO SUL CAMPANELLO.
 *
 * Il caso C della palestra del 7/11: le 50 notifiche più recenti lette, le 10 più vecchie no (succede
 * a chi le apre una per una). Il campanello dice «10 non letti»; /notifications mostrava 50 righe
 * tutte lette, nessun «Segna tutte come lette» (deciso guardando solo le 50 caricate), nessun
 * «Carica altre». Le 10 non si vedevano, non si potevano segnare, e il numero restava per sempre.
 *
 * Qui si monta la pagina vera: la lista di 50 lette e il conteggio vero di 10 li dà la prova; la
 * scrittura di «Segna tutte» e la lettura di «Carica altre» girano davvero contro un database finto
 * con tutte e 60 le notifiche.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { monta } from './aiuti/monta-componente';
import { accendi, attendi, clicca } from './aiuti/schermo';

const globali = globalThis as Record<string, unknown>;
type Riga = Record<string, unknown>;

/** Un PostgREST in miniatura: eq, neq, order, limit, update, applicati davvero alle righe. */
function databaseFinto(tabelle: Record<string, Riga[]>) {
  return {
    from(tavola: string) {
      const filtri: Array<(r: Riga) => boolean> = [];
      let tetto = Infinity;
      let ordine: [string, boolean] | null = null;
      let modifica: Riga | null = null;
      const righe = () => {
        const tutte = (tabelle[tavola] ?? []).filter((r) => filtri.every((f) => f(r)));
        if (ordine) {
          const [col, su] = ordine;
          tutte.sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * (su ? 1 : -1));
        }
        return tutte.slice(0, tetto);
      };
      const c: Record<string, unknown> = {
        select: () => c,
        update: (v: Riga) => { modifica = v; return c; },
        eq: (col: string, v: unknown) => { filtri.push((r) => r[col] === v); return c; },
        neq: (col: string, v: unknown) => { filtri.push((r) => r[col] !== v); return c; },
        order: (col: string, o?: { ascending?: boolean }) => { ordine = [col, o?.ascending ?? true]; return c; },
        limit: (n: number) => { tetto = n; return c; },
        maybeSingle: async () => ({ data: righe()[0] ?? null, error: null }),
        then: (ok: (x: unknown) => unknown, ko?: (e: unknown) => unknown) => {
          if (modifica) { const m = modifica; righe().forEach((r) => Object.assign(r, m)); return Promise.resolve({ data: null, error: null }).then(ok, ko); }
          return Promise.resolve({ data: righe(), error: null }).then(ok, ko);
        },
      };
      return c;
    },
  };
}

const ora = Date.parse('2026-11-13T10:00:00Z');
/** 60 notifiche: le 50 più recenti lette, le 10 più vecchie non lette (una su un rimborso). */
const sessanta = (): Riga[] =>
  Array.from({ length: 60 }, (_, i) => ({
    id: `n${i}`,
    user_id: 'u1',
    category: 'order',
    title: i === 55 ? 'Rimborso approvato' : `Aggiornamento ${i}`,
    body: null,
    link: null,
    is_read: i < 50,
    created_at: new Date(ora - i * 3_600_000).toISOString(),
  }));

let db: Record<string, Riga[]>;

type Opzioni = { queryKey: unknown[]; queryFn?: () => Promise<unknown> };
const opzioniLista = () =>
  (globali.__OPZIONI_QUERY__ as Opzioni[]).filter((o) => o.queryKey[0] === 'notifications' && o.queryKey[1] === 'list').at(-1);

const pulsante = (radice: HTMLElement, testo: string) =>
  Array.from(radice.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim() === testo) ?? null;

async function apriLaPagina() {
  const mod = await monta('app/notifications/page.tsx');
  const s = accendi(mod.default);
  await attendi();
  return s;
}

beforeEach(() => {
  db = { profiles: [{ id: 'u1', notif_promos: true }], notifications: sessanta() };
  globali.__UTENTE__ = { id: 'u1' };
  globali.__CLIENT_SUPABASE__ = databaseFinto(db);
  globali.__OPZIONI_QUERY__ = [];
  globali.__MUTAZIONI_VERE__ = true;
  globali.__MUTAZIONI_IN_VOLO__ = [];
  globali.__DATI_QUERY__ = (o: { queryKey: unknown[] }) => {
    if (o.queryKey[0] === 'auth') return { id: 'u1' };
    // Il campanello: le non lette, tutte.
    if (o.queryKey[1] === 'count') return db.notifications.filter((n) => n.is_read === false).length;
    // La lista caricata: le 50 più recenti, tutte lette.
    if (o.queryKey[1] === 'list') return db.notifications.slice(0, 50);
    return undefined;
  };
});

afterEach(() => {
  for (const k of ['__UTENTE__', '__CLIENT_SUPABASE__', '__OPZIONI_QUERY__', '__MUTAZIONI_VERE__', '__MUTAZIONI_IN_VOLO__', '__DATI_QUERY__']) {
    globali[k] = undefined;
  }
});

describe('R22-018 · le non lette oltre le ultime cinquanta si vedono e si segnano', () => {
  it('con 50 righe lette e 10 non lette più vecchie, «Segna tutte come lette» c\'è e le segna tutte e 60', async () => {
    const s = await apriLaPagina();
    const segna = pulsante(s.radice, 'Segna tutte come lette');
    expect(segna, 'il campanello dice 10 non lette e la pagina non offre «Segna tutte come lette»').not.toBeNull();

    s.agisci(() => clicca(segna!));
    await act(async () => { await Promise.all(globali.__MUTAZIONI_IN_VOLO__ as Promise<unknown>[]); });
    expect(db.notifications.filter((n) => n.is_read === false).map((n) => n.id), 'restano non lette dopo «Segna tutte»').toEqual([]);
    s.smonta();
  }, 60000);

  it('«Carica altre» porta alle notifiche più vecchie, comprese le 10 non lette', async () => {
    const s = await apriLaPagina();
    const altre = pulsante(s.radice, 'Carica altre');
    expect(altre, 'dopo le ultime 50 non c\'è modo di vedere le più vecchie').not.toBeNull();

    s.agisci(() => clicca(altre!));
    await attendi();
    const o = opzioniLista();
    expect(o?.queryFn).toBeTypeOf('function');
    const lista = (await o!.queryFn!()) as Riga[];
    const nonLette = lista.filter((n) => n.is_read === false).map((n) => n.title);
    expect(nonLette, 'le non lette più vecchie non si raggiungono').toHaveLength(10);
    expect(nonLette).toContain('Rimborso approvato');
    s.smonta();
  }, 60000);

  it('niente da leggere e meno di 50 notifiche: né «Segna tutte» né «Carica altre» (il verde di controllo)', async () => {
    db.notifications = sessanta().slice(0, 20);
    const s = await apriLaPagina();
    expect(pulsante(s.radice, 'Segna tutte come lette')).toBeNull();
    expect(pulsante(s.radice, 'Carica altre')).toBeNull();
    s.smonta();
  }, 60000);
});
