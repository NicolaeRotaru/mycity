// @ts-nocheck
// Prove del collaudo indipendente del 28/11/2026 sulla scheda del venditore (sito e social): chi le ha scritte non ha costruito.
import { vi, it, expect, beforeEach, describe } from 'vitest';
const rete = vi.hoisted(() => ({ pagine: {} as Record<string, any> }));
vi.mock('@/lib/agenti/rete', async (originale) => ({
  ...(await originale()),
  leggiPagina: async (url: string) => {
    const p = rete.pagine[url];
    if (!p) return { ok: false, stato: null, url, html: '', errore: 'non si apre', ms: 1 };
    return typeof p === 'string' ? { ok: true, stato: 200, url, html: p, errore: null, ms: 1 } : { ok: true, stato: 200, url: p.finale, html: p.html, errore: null, ms: 1 };
  },
}));
const { primaScheda, unisci, pulisci } = await import('@/lib/agenti/scheda');
const { confermaQuelloCheHaTrovatoLAd, instagramPerIlFlusso } = await import('@/lib/agenti/conferma-ad');
const { attivitaDallaScheda } = await import('@/lib/agenti/aggiungi');
const { sitoIndicato, indovinaSito, eIlSitoDi, indirizzoNellaPagina } = await import('@/lib/agenti/sito');
const { leggiCanaleDelVenditore } = await import('@/lib/agenti/canale-venditore');

const scheda = (nome: string, indirizzo: string, risultato: unknown) => {
  const letto = { nome, indirizzo, lat: 45.05, lon: 9.69, idLuogo: null, link: 'https://www.google.com/maps/place/x' };
  const p = primaScheda({ letto, osm: null, misura: null, citta: 'Piacenza', data: 'x' });
  const ad = pulisci(risultato);
  return { s: unisci(p, ad), ad };
};
const pag = (titolo: string, corpo: string, extra = '') => `<html><head><title>${titolo}</title>${extra}</head><body>${corpo}</body></html>`;
beforeEach(() => { rete.pagine = {}; });

describe('G1 varianti omonimi', () => {
  it('V1 nome con la citta («Bar Duomo Piacenza»): l AD indica il sito della Gelateria del Duomo -> NON va preso', async () => {
    rete.pagine['https://www.gelateriadelduomo.it/'] = pag('Gelateria del Duomo | Piacenza', '<h1>Gelateria del Duomo</h1><p>Piazza Duomo 10, Piacenza</p><a href="https://www.instagram.com/gelateria_del_duomo_pc/">IG</a>');
    const { s, ad } = scheda('Bar Duomo Piacenza', 'Piazza Duomo, 5, 29121 Piacenza PC', { sito: { url: 'https://www.gelateriadelduomo.it/', livello: 'semplice', giudizio: 'x', fonte: null } });
    await confermaQuelloCheHaTrovatoLAd(s, { sitoUrl: ad.sito?.url ?? null, pagine: ad.pagine });
    console.log('V1 sito =', attivitaDallaScheda(s)?.sito, '| IG al 16 =', instagramPerIlFlusso(s));
    expect(attivitaDallaScheda(s)?.sito).toBeUndefined();
    expect(instagramPerIlFlusso(s)).toBeNull();
  });
  it('V1b stesso caso dalla sola ricerca dei domini (profilo visto dall AD)', async () => {
    rete.pagine['https://gelateriadelduomopc.it/'] = pag('Gelateria del Duomo Piacenza', '<p>Piazza Duomo 10</p><a href="https://www.instagram.com/gelateria_del_duomo_pc/">IG</a>');
    rete.pagine['https://gelateriadelduomo.it/'] = rete.pagine['https://gelateriadelduomopc.it/'];
    const { s, ad } = scheda('Bar Duomo Piacenza', 'Piazza Duomo, 5, 29121 Piacenza PC', { social: [{ canale: 'Instagram', stato: 'trovato', fonte: 'https://www.instagram.com/gelateria_del_duomo_pc/' }] });
    await confermaQuelloCheHaTrovatoLAd(s, { sitoUrl: null, pagine: ad.pagine });
    console.log('V1b sito =', attivitaDallaScheda(s)?.sito, '| IG al 16 =', instagramPerIlFlusso(s));
    expect(instagramPerIlFlusso(s)).toBeNull();
  });
  it('V2 «Pasticceria Fratelli Rossi»: fratellirossi.it e il gommista -> NON va preso', async () => {
    rete.pagine['https://fratellirossi.it/'] = pag('Fratelli Rossi Gomme - Piacenza', '<p>Pneumatici, Via Emilia Parmense 100</p>');
    const m = await indovinaSito('Pasticceria Fratelli Rossi', 'Piacenza', 1000, [], 'Via Roma, 8, 29121 Piacenza PC');
    console.log('V2 indovinato =', m?.url);
    expect(m).toBeNull();
  });
  it('V3 «Bar Sport Roma» (Via Roma 10): l AD indica un altro Bar Sport in Via Roma 45 -> NON va preso', async () => {
    rete.pagine['https://barsportpiacenza.it/'] = pag('Bar Sport', '<p>Via Roma 45, Piacenza</p>', '<meta name="description" content="Bar Sport in Via Roma a Piacenza">');
    const m = await sitoIndicato('https://barsportpiacenza.it/', 'Bar Sport Roma', 'Piacenza', { indirizzo: 'Via Roma, 10, 29121 Piacenza PC' });
    // «restringi» (28/11): può comparire solo come «da controllare», mai come certo.
    expect(m === null || m.prova === 'nome').toBe(true);
  });
  it('V4 «Caffè Italia Centro» con il sito della Pizzeria Italia -> no', async () => {
    rete.pagine['https://pizzeriaitalia.it/'] = pag('Pizzeria Italia Piacenza', '<p>Via Cavour 3, Piacenza</p>');
    expect(await sitoIndicato('pizzeriaitalia.it', 'Caffè Italia Centro', 'Piacenza', { indirizzo: 'Corso Garibaldi, 7, 29121 Piacenza PC' })).toBeNull();
  });
  it('V5 stessa famiglia stessa via: «Bar del Duomo» (n.5) e «Caffè del Duomo» (n.12) -> no', async () => {
    rete.pagine['https://caffedelduomo.it/'] = pag('Caffè del Duomo', '<p>Piazza Duomo 12, Piacenza</p>');
    expect(await sitoIndicato('caffedelduomo.it', 'Bar del Duomo', 'Piacenza', { indirizzo: 'Piazza Duomo, 5, 29121 Piacenza PC' })).toBeNull();
  });
  it('V6 apostrofo: «Caffè dell Arte» vede il suo sito, non quello della Galleria dell Arte', async () => {
    rete.pagine['https://caffedellarte.it/'] = pag("Caffè dell'Arte - Piacenza", '<p>Via Sopramuro 4</p>');
    rete.pagine['https://galleriadellarte.it/'] = pag("Galleria dell'Arte Piacenza", '<p>Via Sopramuro 40</p>');
    expect((await sitoIndicato('caffedellarte.it', "Caffè dell'Arte", 'Piacenza', { indirizzo: 'Via Sopramuro, 4, 29121 Piacenza PC' }))?.aperto).toBe(true);
    expect(await sitoIndicato('galleriadellarte.it', "Caffè dell'Arte", 'Piacenza', { indirizzo: 'Via Sopramuro, 4, 29121 Piacenza PC' })).toBeNull();
    rete.pagine['https://osteriadelteatro.it/'] = pag('Osteria del Teatro', '<p>Via Verdi 16 Piacenza</p>');
    rete.pagine['https://caffedelteatro.it/'] = pag('Caffè del Teatro', '<p>Via Verdi 41 Piacenza</p>');
    expect((await sitoIndicato('osteriadelteatro.it', 'Osteria del Teatro', 'Piacenza', { indirizzo: 'Via Verdi, 16, Piacenza' }))?.aperto).toBe(true);
    expect(await sitoIndicato('caffedelteatro.it', 'Osteria del Teatro', 'Piacenza', { indirizzo: 'Via Verdi, 16, Piacenza' })).toBeNull();
  });
});

describe('civico', () => {
  const ind = 'Piazza Duomo, 23, 29121 Piacenza PC';
  for (const [t, atteso] of [['Piazza Duomo n. 23', true], ['Piazza Duomo, 23/A', true], ['P.zza Duomo n°23 - 29121', true], ['Piazza del Duomo 23', true], ['Piazza Duomo 230', false], ['Piazza Duomo 2', false], ['Piazza Duomo 23A', true], ['Piazza Duomo nr. 23', true]] as const) {
    it(`civico «${t}»`, () => { expect(indirizzoNellaPagina(t, ind)).toBe(atteso); });
  }
});

describe('Raquel, caso vero: niente falsi negativi', () => {
  const ind = 'Piazza Duomo, 23, 29121 Piacenza PC';
  it('R1 indovinato raquel.it titolo «Raquel Caffè»', async () => {
    rete.pagine['https://raquel.it/'] = pag('Raquel Caffè', '<p>Piacenza</p>');
    expect((await indovinaSito('Raquel 💗 Cafè', 'Piacenza', 1000, [], ind))?.url).toBe('https://raquel.it/');
  });
  it('R2 sito del venditore titolo «Home», nome solo nel logo (alt)', async () => {
    rete.pagine['https://raquelcafe.it/'] = pag('Home', '<header><img src="logo.png" alt="Raquel Cafè"></header><p>Colazioni e aperitivi. Piacenza</p>');
    expect((await sitoIndicato('raquelcafe.it', 'Raquel 💗 Cafè', 'Piacenza', { fidato: true }))?.aperto).toBe(true);
  });
  it('R3 indovinato titolo «Home», logo, indirizzo nel piede', async () => {
    rete.pagine['https://raquelcafe.it/'] = pag('Home', '<img src="logo.png" alt="Raquel Cafè"><footer>P.zza Duomo, 23 - 29121 Piacenza</footer>');
    // Titolo «Home»: il nome non è nel titolo, quindi un sito solo indovinato non si prende (il venditore può darlo, vedi R2).
    expect(await indovinaSito('Raquel 💗 Cafè', 'Piacenza', 1000, [], ind)).toBeNull();
  });
  it('R4 indovinato titolo «Raquel» + indirizzo nel piede', async () => {
    rete.pagine['https://raquel.it/'] = pag('Raquel', '<footer>Piazza Duomo 23, Piacenza</footer>');
    expect((await indovinaSito('Raquel 💗 Cafè', 'Piacenza', 1000, [], ind))?.url).toBe('https://raquel.it/');
  });
  it('R5 indovinato titolo «Raquel Caffetteria», senza indirizzo', async () => {
    rete.pagine['https://raquel.it/'] = pag('Raquel Caffetteria', '<p>Piacenza</p>');
    expect(await indovinaSito('Raquel 💗 Cafè', 'Piacenza', 1000, [], ind)).toMatchObject({ url: 'https://raquel.it/', prova: 'nome' });
  });
  it('R6 Instagram copiato dal venditore va al 16; sito del venditore su sites.google.com', async () => {
    const c = leggiCanaleDelVenditore('https://sites.google.com/view/raquelcafe/home');
    expect(c?.sito).toBe('https://sites.google.com/view/raquelcafe/home');
    rete.pagine['https://sites.google.com/view/raquelcafe/'] = pag('Raquel Cafè', '<p>Piazza Duomo 23 Piacenza</p>');
    expect((await sitoIndicato('https://sites.google.com/view/raquelcafe/home', 'Raquel 💗 Cafè', 'Piacenza', { fidato: true }))?.url).toBe('https://sites.google.com/view/raquelcafe/');
  });
});
