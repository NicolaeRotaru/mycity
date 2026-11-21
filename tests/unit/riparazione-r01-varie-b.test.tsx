// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * R01-varie — Le bozze del modulo di reclamo e la fine della sessione.
 *
 * Le bozze stanno nella scheda (sessionStorage) sotto `mycity:bozza-reclamo:<ordine>`, con l'id di
 * chi le ha scritte; quella col segno `perIlRientro` aspetta il rientro dopo una sessione scaduta.
 * All'uscita voluta (`supabase.auth.signOut()`, ogni tasto «Esci») si tolgono tutte; alla sessione
 * scaduta resta solo quella col segno; quando entra un altro account si tolgono quelle non sue.
 * Le altre chiavi della scheda restano.
 *
 * Si monta QueryProvider vero (dentro StrictMode, come in sviluppo) col client Supabase finto delle
 * prove: lo stesso oggetto che usa il fornitore, come nel sito dove il client del browser è uno solo.
 * Il finto `signOut` avvisa gli ascolti prima di finire, come fa il client vero.
 */

vi.mock('@/lib/supabase/client', async () => await import('./aiuti/finti/supabase-client.mjs'));

import QueryProvider from '@/components/providers/QueryProvider';
import { supabase } from '@/lib/supabase/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const globali = globalThis as Record<string, unknown>;
type Ascolto = (evento: string, sessione: { user: { id: string } } | null) => void;
const ascolti = () => [...((globali.__ASCOLTI_AUTH__ as Ascolto[] | undefined) ?? [])];
const chiave = (ordine: string) => `mycity:bozza-reclamo:${ordine}`;

let radice: Root | null = null;
let contenitore: HTMLDivElement | null = null;
let uscite = 0;

async function apri() {
  contenitore = document.createElement('div');
  document.body.appendChild(contenitore);
  radice = createRoot(contenitore);
  await act(async () => {
    radice!.render(createElement(StrictMode, null, createElement(QueryProvider, null, null)));
  });
}

async function avvisa(evento: string, utente: string | null) {
  await act(async () => {
    for (const a of ascolti()) a(evento, utente ? { user: { id: utente } } : null);
  });
}

async function esci() {
  await act(async () => {
    await supabase.auth.signOut();
  });
}

function mettiBozze() {
  window.sessionStorage.setItem(
    chiave('o-1'),
    JSON.stringify({ utente: 'u1', reason: 'damaged', description: 'Il vaso è arrivato in pezzi', perIlRientro: true }),
  );
  window.sessionStorage.setItem(
    chiave('o-2'),
    JSON.stringify({ utente: 'u1', reason: 'other', description: 'Il pacco era aperto' }),
  );
  window.sessionStorage.setItem('mycity:ultima-ricerca', 'pane');
  window.sessionStorage.setItem('carrello-ospite', '[1]');
}

const estranee = () => [window.sessionStorage.getItem('mycity:ultima-ricerca'), window.sessionStorage.getItem('carrello-ospite')];

beforeEach(() => {
  window.sessionStorage.clear();
  globali.__ASCOLTI_AUTH__ = [];
  globali.__UTENTE__ = { id: 'u1' };
  uscite = 0;
  globali.__AUTH_FINTA__ = {
    signOut: async () => {
      uscite += 1;
      for (const a of ascolti()) a('SIGNED_OUT', null);
      return { error: null };
    },
  };
});

afterEach(async () => {
  if (radice) await act(async () => radice!.unmount());
  radice = null;
  contenitore?.remove();
  contenitore = null;
  window.sessionStorage.clear();
  for (const k of ['__ASCOLTI_AUTH__', '__UTENTE__', '__AUTH_FINTA__']) delete globali[k];
});

describe('R01-varie · bozze del modulo di reclamo alla fine della sessione', () => {
  it('alla sessione scaduta resta solo la bozza tenuta per il rientro, e le altre chiavi della scheda restano', async () => {
    await apri();
    await avvisa('INITIAL_SESSION', 'u1');
    mettiBozze();

    await avvisa('SIGNED_OUT', null);
    expect(window.sessionStorage.getItem(chiave('o-2')), 'alla sessione scaduta la bozza senza segno resta nella scheda').toBeNull();
    expect(window.sessionStorage.getItem(chiave('o-1')), 'alla sessione scaduta la bozza per il rientro è sparita').not.toBeNull();
    expect(estranee()).toEqual(['pane', '[1]']);
  });

  it('all’uscita voluta le bozze del modulo si tolgono tutte, anche quella per il rientro; le altre chiavi restano', async () => {
    await apri();
    await avvisa('INITIAL_SESSION', 'u1');
    mettiBozze();

    await esci();
    expect(uscite, 'controprova: l’uscita deve arrivare al client').toBe(1);
    expect(window.sessionStorage.getItem(chiave('o-2')), 'dopo «Esci» la bozza resta nella scheda').toBeNull();
    expect(window.sessionStorage.getItem(chiave('o-1')), 'dopo «Esci» la bozza per il rientro resta nella scheda').toBeNull();
    expect(estranee()).toEqual(['pane', '[1]']);
  });

  it('se l’uscita voluta non riesce, la sessione scaduta dopo tiene la bozza per il rientro', async () => {
    globali.__AUTH_FINTA__ = { signOut: async () => ({ error: { message: 'rete giù' } }) };
    await apri();
    await avvisa('INITIAL_SESSION', 'u1');
    mettiBozze();

    await esci();
    await avvisa('SIGNED_OUT', null);
    expect(window.sessionStorage.getItem(chiave('o-1')), 'il segno dell’uscita fallita vale anche per la sessione scaduta dopo').not.toBeNull();
    expect(window.sessionStorage.getItem(chiave('o-2'))).toBeNull();
  });

  for (const evento of ['SIGNED_IN', 'INITIAL_SESSION'] as const) {
    it(`entra un altro account (${evento}): la bozza per il rientro sparisce; chi l’ha scritta, rientrando, la ritrova`, async () => {
      await apri();
      await avvisa('INITIAL_SESSION', 'u1');
      mettiBozze();
      await avvisa('SIGNED_OUT', null);
      expect(window.sessionStorage.getItem(chiave('o-1')), 'controprova: dopo la sessione scaduta la bozza per il rientro c’è').not.toBeNull();

      await avvisa('SIGNED_IN', 'u1');
      expect(window.sessionStorage.getItem(chiave('o-1')), 'chi l’ha scritta, rientrando, non ritrova la bozza').not.toBeNull();

      await avvisa('SIGNED_OUT', null);
      await avvisa(evento, 'u2');
      expect(window.sessionStorage.getItem(chiave('o-1')), 'entrato un altro account, la bozza di u1 resta nella scheda').toBeNull();
      expect(estranee()).toEqual(['pane', '[1]']);
    });
  }

  it('smontato il fornitore, `signOut` del client torna quello di prima', async () => {
    const prima = supabase.auth.signOut;
    await apri();
    await act(async () => radice!.unmount());
    radice = null;
    expect(supabase.auth.signOut).toBe(prima);
  });
});
