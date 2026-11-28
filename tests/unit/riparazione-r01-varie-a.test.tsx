/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { monta } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

/**
 * R01-varie — Il fornitore delle domande (QueryProvider) e il cambio di sessione.
 *
 * Quando la sessione cambia o finisce, chi sta guardando una domanda riceve i dati della sessione
 * nuova senza aspettare un ridisegno. Qui si monta QueryProvider vero intorno al guscio dell'account
 * vero (react-query vero), e si guarda il chip «Notifiche» del menu account del telefono. Il database
 * è un finto con la stessa regola di lettura del vero: ognuno legge solo le sue notifiche
 * (migrations/008_notifications.sql). Gli avvisi di sessione arrivano come li manda il client, a
 * tutti quelli in ascolto, nei due ordini possibili.
 */

const globali = globalThis as Record<string, unknown>;

type Riga = { id: string; user_id: string; is_read: boolean };
const righeDi = (utente: string, nonLette: number, lette = 0): Riga[] => [
  ...Array.from({ length: nonLette }, (_, i) => ({ id: `${utente}-nl${i}`, user_id: utente, is_read: false })),
  ...Array.from({ length: lette }, (_, i) => ({ id: `${utente}-l${i}`, user_id: utente, is_read: true })),
];

const mondo = { righe: [] as Riga[] };

function database() {
  return {
    from: (tavola: string) => {
      const filtri: Record<string, unknown> = {};
      let conta = false;
      const risposta = () => {
        if (tavola !== 'notifications') return { data: [], error: null };
        const chi = (globali.__UTENTE__ as { id: string } | null | undefined)?.id ?? null;
        const scelte = mondo.righe
          .filter((r) => r.user_id === chi)
          .filter((r) => Object.entries(filtri).every(([k, v]) => (r as Record<string, unknown>)[k] === v));
        if (conta) return { data: null, count: scelte.length, error: null };
        return { data: scelte.map((r) => ({ ...r })), error: null };
      };
      const c: Record<string, unknown> = {};
      c.select = (_colonne: string, opzioni?: { head?: boolean }) => { conta = !!opzioni?.head; return c; };
      c.eq = (colonna: string, valore: unknown) => { filtri[colonna] = valore; return c; };
      for (const m of ['or', 'in', 'order', 'limit']) c[m] = () => c;
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

type Ordine = 'fornitore in ascolto per ultimo' | 'fornitore in ascolto per primo';

async function apri(ordine: Ordine) {
  const fornitore = await monta('components/providers/QueryProvider.tsx', { veri: ['@tanstack/react-query'] });
  const guscio = await monta('components/account/AccountShell.tsx', { veri: ['@tanstack/react-query'] });
  const Fornitore = fornitore.default as (p: { children: unknown }) => unknown;
  const Guscio = guscio.default as (p: { children: unknown }) => unknown;
  let client: QueryClient | null = null;
  const Presa = () => {
    client = useQueryClient();
    return null;
  };
  const s = accendi(() =>
    createElement(Fornitore as never, null, createElement(Guscio as never, null, createElement(Presa))),
  );
  await lascia();
  const avviso = async (evento: string, utente: string | null) => {
    globali.__UTENTE__ = utente ? { id: utente } : null;
    const ascolti = [...(globali.__ASCOLTI_AUTH__ as Array<(e: string, s: unknown) => void>)];
    if (ordine === 'fornitore in ascolto per primo') ascolti.reverse();
    await act(async () => {
      for (const ascolto of ascolti) ascolto(evento, utente ? { user: { id: utente } } : null);
    });
    await lascia();
  };
  return { s, avviso, client: () => client! };
}

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
  mondo.righe = [...righeDi('u1', 3, 2), ...righeDi('u2', 1, 4)];
  globali.__UTENTE__ = { id: 'u1' };
  globali.__CLIENT_SUPABASE__ = database();
  globali.__ASCOLTI_AUTH__ = [];
  globali.__PERCORSO_FINTO__ = '/profile';
});

afterEach(() => {
  document.body.innerHTML = '';
  for (const k of ['__UTENTE__', '__CLIENT_SUPABASE__', '__ASCOLTI_AUTH__', '__PERCORSO_FINTO__']) delete globali[k];
});

describe('R01-varie · al cambio di sessione chi guarda riceve i dati della sessione nuova', () => {
  for (const ordine of ['fornitore in ascolto per ultimo', 'fornitore in ascolto per primo'] as const) {
    it(`al cambio di account il chip «Notifiche» del menu account mostra il numero del nuovo account (${ordine})`, async () => {
      const { s, avviso, client } = await apri(ordine);
      expect(numeroSulChip(s.radice), 'controprova: il primo account ha 3 notifiche non lette').toBe('3');
      await avviso('INITIAL_SESSION', 'u1');
      expect(numeroSulChip(s.radice), 'controprova: la stessa sessione non cambia il numero').toBe('3');

      await avviso('SIGNED_IN', 'u2');
      expect(numeroSulChip(s.radice), 'cambiato account, il chip mostra ancora il numero del primo').not.toBe('3');
      expect(numeroSulChip(s.radice), 'cambiato account, il chip non mostra il numero del nuovo').toBe('1');
      const conti = client().getQueriesData({ queryKey: ['notifications', 'count'] }).map(([, v]) => v);
      expect(conti, 'in memoria resta il numero del primo account').not.toContain(3);
      s.smonta();
    }, 60000);

    it(`all’uscita il chip «Notifiche» del menu account non mostra più un numero (${ordine})`, async () => {
      const { s, avviso, client } = await apri(ordine);
      expect(numeroSulChip(s.radice), 'controprova: l’account ha 3 notifiche non lette').toBe('3');
      await avviso('INITIAL_SESSION', 'u1');

      await avviso('SIGNED_OUT', null);
      expect(numeroSulChip(s.radice), 'dopo l’uscita il chip mostra ancora il numero di prima').toBeNull();
      const conti = client().getQueriesData({ queryKey: ['notifications', 'count'] }).map(([, v]) => v);
      expect(conti, 'dopo l’uscita in memoria resta il numero di prima').not.toContain(3);

      await avviso('SIGNED_IN', 'u2');
      expect(numeroSulChip(s.radice), 'entrato un altro account, il chip non mostra il suo numero').toBe('1');
      s.smonta();
    }, 60000);
  }
});
