// @ts-nocheck
// Prove del collaudo indipendente del 28/11/2026 sulla scheda del venditore (sito e social): chi le ha scritte non ha costruito.
import { vi, it, expect, beforeEach } from 'vitest';
const rete = vi.hoisted(() => ({ pagine: {} as Record<string, any> }));
vi.mock('@/lib/agenti/rete', async (o) => ({ ...(await o()), leggiPagina: async (url: string) => {
  const p = rete.pagine[url]; return p ? { ok: true, stato: 200, url, html: p, errore: null, ms: 1 } : { ok: false, stato: null, url, html: '', errore: 'non si apre', ms: 1 }; } }));
const { sitoIndicato } = await import('@/lib/agenti/sito');
const pag = (t: string, c: string) => `<html><head><title>${t}</title></head><body>${c}</body></html>`;
beforeEach(() => { rete.pagine = {}; });
const casi: [string, string, string, string, string][] = [
  // nome del locale, suo indirizzo, sito dell'omonimo, titolo, corpo
  ['Caffè al Duomo', 'Piazza Duomo, 41, 29121 Piacenza PC', 'gelateriadelduomo.it', 'Gelateria del Duomo Piacenza', 'Piazza Duomo 10'],
  ['Caffè Coppini in Duomo', 'Piazza Duomo, 39, 29121 Piacenza PC', 'pasticceriacoppini.it', 'Pasticceria Coppini - Piacenza, vicino al Duomo', 'Via Roma 2'],
  ['Caffè di Piacenza', 'Piazza Duomo, 8, 29121 Piacenza PC', 'bottigliariadelduomo.it', 'Bottiglieria del Duomo - il caffè di Piacenza', 'Piazza Duomo 30'],
  ['Bar Sport', 'Via Emilia Pavese, 10, 29121 Piacenza PC', 'barsportpiacenza.it', 'Bar Sport Piacenza', 'Via Colombo 50'],
  ['Bar Italia', 'Corso Vittorio Emanuele II, 120, 29121 Piacenza PC', 'baritaliapc.it', 'Bar Italia', 'Via Roma 7, Piacenza'],
];
for (const [nome, ind, dom, t, c] of casi) it(`${nome} vs ${dom}`, async () => {
  rete.pagine[`https://${dom}/`] = pag(t, `<p>${c}, Piacenza</p>`);
  const m = await sitoIndicato(dom, nome, 'Piacenza', { indirizzo: ind });
  console.log('NOMEVERO', nome, '<-', dom, '=>', m ? 'PRESO' : 'scartato');
  expect(m).toBeNull();
});
