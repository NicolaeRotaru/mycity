// @ts-nocheck
// Prove del collaudo indipendente del 28/11/2026 sulla scheda del venditore (sito e social): chi le ha scritte non ha costruito.
import { vi, it, expect } from 'vitest';
const rete = vi.hoisted(() => ({ pagine: {} as Record<string, any>, chieste: [] as string[] }));
vi.mock('@/lib/agenti/rete', async (o) => ({ ...(await o()), leggiPagina: async (url: string) => { rete.chieste.push(url);
  const p = rete.pagine[url]; return p ? { ok: true, stato: 200, url, html: p, errore: null, ms: 1 } : { ok: false, stato: null, url, html: '', errore: 'non si apre', ms: 1 }; } }));
const { sitoIndicato } = await import('@/lib/agenti/sito');
const pag = (t: string, c: string) => `<html><head><title>${t}</title></head><body>${c}</body></html>`;
it('M1 articoli di giornale (in lista e fuori lista) non diventano il sito; un link interno del sito vero si', async () => {
  const ind = 'Piazza Duomo, 23, 29121 Piacenza PC';
  rete.pagine['https://www.ilpiacenza.it/cronaca/raquel-cafe-apre.html'] = pag('Raquel Cafè apre', 'Il Raquel Cafè in Piazza Duomo 23 a Piacenza');
  expect(await sitoIndicato('https://www.ilpiacenza.it/cronaca/raquel-cafe-apre.html', 'Raquel 💗 Cafè', 'Piacenza', { indirizzo: ind })).toBeNull();
  rete.pagine['https://www.ilnuovogiornale.it/'] = pag('Il Nuovo Giornale - settimanale di Piacenza', 'notizie');
  rete.pagine['https://www.ilnuovogiornale.it/2026/raquel-cafe/'] = pag('Raquel Caffè', 'Piazza Duomo 23 Piacenza');
  expect(await sitoIndicato('https://www.ilnuovogiornale.it/2026/raquel-cafe/', 'Raquel 💗 Cafè', 'Piacenza', { indirizzo: ind })).toBeNull();
  rete.pagine['https://raquelcafe.it/'] = pag('Raquel Caffè', 'Piazza Duomo 23 Piacenza');
  expect((await sitoIndicato('https://raquelcafe.it/menu/colazioni', 'Raquel 💗 Cafè', 'Piacenza', { indirizzo: ind }))?.url).toBe('https://raquelcafe.it/');
  console.log('M1 chieste', rete.chieste);
});
