// @ts-nocheck — collaudo 28/11: ogni prova è ROSSA finché il difetto c'è.
import { it, expect, vi, beforeEach } from 'vitest';
const rete = vi.hoisted(() => ({ pagine: {} as Record<string, any> }));
vi.mock('@/lib/agenti/rete', async (o) => ({ ...(await o()), leggiPagina: async (url: string) => {
  const p = rete.pagine[url]; if (!p) return { ok: false, stato: null, url, html: '', errore: 'non si apre', ms: 1 };
  const f = typeof p === 'string' ? { url, html: p } : p; return { ok: true, stato: 200, url: f.url, html: f.html, errore: null, ms: 1 };
} }));
const S = await import('@/lib/agenti/sito');
const { primaScheda, unisci, pulisci } = await import('@/lib/agenti/scheda');
const { confermaQuelloCheHaTrovatoLAd, instagramPerIlFlusso } = await import('@/lib/agenti/conferma-ad');
const { attivitaDallaScheda } = await import('@/lib/agenti/aggiungi');
const letto = (nome) => ({ nome, indirizzo: 'Piazza Duomo, 23, 29121 Piacenza PC', lat: 45.05, lon: 9.69, idLuogo: null, link: 'https://maps.app.goo.gl/x' });
const dopoAd = (nome, r) => { const p = primaScheda({ letto: letto(nome), osm: null, misura: null, citta: 'Piacenza', data: 'x' }); const ad = pulisci(r); return { scheda: unisci(p, ad), ad }; };
beforeEach(() => { rete.pagine = {}; });
it('D1 una guida con piu locali: l omonimo che condivide una parola non va al flusso 16', async () => {
  rete.pagine['https://guida.esempio.it/colazione'] = '<a href="https://www.instagram.com/pasticceria_duomo_pc/">P</a><a href="https://www.instagram.com/caffedelduomo.piacenza/">C</a>';
  const { scheda, ad } = dopoAd('Caffè del Duomo', { pagine_viste: ['https://guida.esempio.it/colazione'] });
  await confermaQuelloCheHaTrovatoLAd(scheda, { sitoUrl: null, pagine: ad.pagine });
  expect(instagramPerIlFlusso(scheda)).not.toBe('pasticceria_duomo_pc');
  expect(S.portaIlNome('pizzeria_alla_stazione', 'Trattoria alla Pesa')).toBe(false);
});
it('D2 un dominio che rinvia a Instagram/Facebook non diventa il sito del negozio', async () => {
  rete.pagine['https://raquelcafe.it/'] = { url: 'https://www.instagram.com/raquel_cafe23/', html: '<title>Raquel Cafè (@raquel_cafe23) • Instagram</title><meta name="description" content="Piazza Duomo 23, Piacenza">' };
  const { scheda, ad } = dopoAd('Raquel 💗 Cafè', { sito: { url: 'https://raquelcafe.it/', livello: 'medio', giudizio: 'x', fonte: null } });
  await confermaQuelloCheHaTrovatoLAd(scheda, { sitoUrl: ad.sito?.url ?? null, pagine: ad.pagine });
  expect(attivitaDallaScheda(scheda)?.sito ?? null).toBeNull();
});
it('D3 il sito scritto dal venditore di «Caffè Bistrot» si accetta (il vecchio codice lo trovava)', async () => {
  rete.pagine['https://caffebistrot.it/'] = '<title>Caffè Bistrot</title><body><h1>Caffè Bistrot</h1>Piazza Cavalli 1, Piacenza</body>';
  expect(await S.sitoIndicato('caffebistrot.it', 'Caffè Bistrot', 'Piacenza')).not.toBeNull();
});
