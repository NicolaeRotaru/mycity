/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { monta } from './aiuti/monta-componente';
import { accendi, attendi } from './aiuti/schermo';

/**
 * 17/11/2026 — Senza rete, e senza il dato già in memoria, la domanda «il negozio offre la consegna
 * veloce?» resta ferma: react-query la mette in pausa finché la rete non torna. Non è «in lettura»
 * e non è «caduta», e l'aggancio rispondeva `offre: undefined, nonLetta: false`: il modulo prodotto
 * la prendeva per «non offre» e al salvataggio scriveva quel «no» come una scelta del negoziante.
 * Qui la si monta con il react-query vero e la rete spenta davvero.
 */
type Stato = { offre: boolean | undefined; inLettura: boolean; nonLetta: boolean };

const g = globalThis as Record<string, unknown>;
const NEGOZIANTE = { id: 'seller-1', email: 'negozio@mycity.test' };

async function aggancio(): Promise<() => Stato> {
  const mod = await monta('lib/queries/consegna-veloce-del-negozio.ts', { veri: ['@tanstack/react-query'] });
  return mod.useConsegnaVeloceDelNegozio as () => Stato;
}

/** Monta l'aggancio dentro un QueryClient vero e restituisce come leggere quello che dice. */
async function montaLaDomanda(qc: QueryClient) {
  const usa = await aggancio();
  const Vista = () => {
    const s = usa();
    return createElement('output', null, JSON.stringify({ offre: s.offre ?? 'non si sa', inLettura: s.inLettura, nonLetta: s.nonLetta }));
  };
  const schermo = accendi(() => createElement(QueryClientProvider, { client: qc }, createElement(Vista)));
  await attendi();
  const leggi = () => JSON.parse(schermo.radice.querySelector('output')?.textContent ?? '{}');
  return { schermo, leggi };
}

/** Lascia girare la lettura (getUser, poi il profilo) finché lo stato non smette di essere «in lettura». */
async function finche(prova: () => boolean) {
  for (let i = 0; i < 50 && !prova(); i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

const nuovoClient = () => new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });

afterEach(() => {
  act(() => onlineManager.setOnline(true));
  delete g.__UTENTE__;
  delete g.__RISPOSTA_SUPABASE__;
  document.body.innerHTML = '';
});

describe('la consegna veloce del negozio, senza rete', () => {
  it('senza rete e senza dato in memoria non dice «non offre»: dice che non è riuscita a leggere', async () => {
    g.__UTENTE__ = NEGOZIANTE;
    g.__RISPOSTA_SUPABASE__ = { data: [{ offers_express: true }], error: null };
    onlineManager.setOnline(false);
    const { schermo, leggi } = await montaLaDomanda(nuovoClient());
    expect(leggi()).toEqual({ offre: 'non si sa', inLettura: false, nonLetta: true });
    schermo.smonta();
  });

  it('quando la rete torna la lettura riparte e la risposta è quella vera', async () => {
    g.__UTENTE__ = NEGOZIANTE;
    g.__RISPOSTA_SUPABASE__ = { data: [{ offers_express: true }], error: null };
    onlineManager.setOnline(false);
    const { schermo, leggi } = await montaLaDomanda(nuovoClient());
    expect(leggi().nonLetta).toBe(true);
    act(() => onlineManager.setOnline(true));
    await finche(() => leggi().offre !== 'non si sa');
    expect(leggi()).toEqual({ offre: true, inLettura: false, nonLetta: false });
    schermo.smonta();
  });

  it('con la rete, una lettura riuscita risponde come prima (sì e no)', async () => {
    g.__UTENTE__ = NEGOZIANTE;
    for (const offre of [true, false]) {
      g.__RISPOSTA_SUPABASE__ = { data: [{ offers_express: offre }], error: null };
      const { schermo, leggi } = await montaLaDomanda(nuovoClient());
      await finche(() => leggi().offre !== 'non si sa');
      expect(leggi()).toEqual({ offre, inLettura: false, nonLetta: false });
      schermo.smonta();
    }
  });

  it('con la rete, una lettura caduta del database resta «non letta», come prima', async () => {
    g.__UTENTE__ = NEGOZIANTE;
    g.__RISPOSTA_SUPABASE__ = { data: null, error: { message: 'connessione rifiutata' } };
    const { schermo, leggi } = await montaLaDomanda(nuovoClient());
    await finche(() => leggi().inLettura === false);
    expect(leggi()).toEqual({ offre: 'non si sa', inLettura: false, nonLetta: true });
    schermo.smonta();
  });

  it('senza rete ma col dato già in memoria risponde col dato: non è una lettura mancata', async () => {
    g.__UTENTE__ = NEGOZIANTE;
    const qc = nuovoClient();
    const mod = await monta('lib/queries/consegna-veloce-del-negozio.ts', { veri: ['@tanstack/react-query'] });
    qc.setQueryData(mod.chiaveConsegnaVeloceDelNegozio as readonly unknown[], true);
    onlineManager.setOnline(false);
    const { schermo, leggi } = await montaLaDomanda(qc);
    expect(leggi()).toEqual({ offre: true, inLettura: false, nonLetta: false });
    schermo.smonta();
  });
});
