// @ts-nocheck — dati finti senza tipi, come le altre prove della scheda del venditore.
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * IL SITO E I SOCIAL CHE C'ERANO, E LA SCHEDA NON TROVAVA — 28/11/2026.
 *
 * Caso vero: la caffetteria di prova «Raquel 💗 Cafè», Piazza Duomo 23, Piacenza. Il 28/11 alle 10:02 e alle 10:04
 * la scheda del venditore ha scritto «sito: nessuno», «Instagram: non trovato». Il sito c'è (Nicola), e una guida di
 * viaggio cita il profilo @raquel_cafe23. Queste prove dicono:
 *  · il sito indovinato prova anche il nome senza parole comuni (raquel.it) e i nomi dei profili (raquelcafe23.it),
 *    e non scarta più una pagina intitolata «Raquel Caffè»;
 *  · il venditore può copiare il sito o il profilo dalla scheda Google, e la scheda li usa;
 *  · il sito che l'AD ha visto, o che sta in una pagina dei risultati che l'AD ha visto, si apre e arriva al negozio iscritto;
 *  · il profilo Instagram arriva al flusso 16 come indizio, ma un omonimo no.
 */

const rete = vi.hoisted(() => ({ pagine: {} as Record<string, string>, chieste: [] as string[] }));
vi.mock('@/lib/agenti/rete', async (originale) => ({
  ...(await originale<typeof import('@/lib/agenti/rete')>()),
  leggiPagina: async (url: string) => {
    rete.chieste.push(url);
    const html = rete.pagine[url];
    return html ? { ok: true, stato: 200, url, html, errore: null, ms: 1 } : { ok: false, stato: null, url, html: '', errore: 'non si apre', ms: 1 };
  },
}));

const { candidatiDominio, eIlSitoDi, sitoIndicato, portaIlNome } = await import('@/lib/agenti/sito');
const { leggiCanaleDelVenditore } = await import('@/lib/agenti/canale-venditore');
const { primaScheda, unisci, pulisci, normalizza } = await import('@/lib/agenti/scheda');
const { confermaQuelloCheHaTrovatoLAd, instagramPerIlFlusso, collegamentiDellaPagina } = await import('@/lib/agenti/conferma-ad');
const { attivitaDallaScheda } = await import('@/lib/agenti/aggiungi');

const RAQUEL = 'Raquel 💗 Cafè';
const pagina = (titolo: string, corpo = 'Piazza Duomo 23, 29121 Piacenza') => `<html><head><title>${titolo}</title></head><body><h1>${titolo}</h1><p>${corpo}</p>
<a href="https://www.instagram.com/raquel_cafe23/">Instagram</a></body></html>`;
const letto = { nome: RAQUEL, indirizzo: 'Piazza Duomo, 23, 29121 Piacenza PC', lat: 45.05, lon: 9.69, idLuogo: null, link: 'https://www.google.com/maps/place/Raquel' };

beforeEach(() => { rete.pagine = {}; rete.chieste = []; });

describe('il sito indovinato', () => {
  it('prova il nome senza le parole comuni e i nomi dei profili, al massimo 12 indirizzi', () => {
    const c = candidatiDominio(RAQUEL, 'Piacenza');
    expect(c).toContain('raquel.it');
    expect(c).toContain('raquelcafe.it');
    const conProfilo = candidatiDominio(RAQUEL, 'Piacenza', ['raquel_cafe23']);
    expect(conProfilo).toContain('raquelcafe23.it');
    expect(conProfilo.length).toBeLessThanOrEqual(12);
    expect(candidatiDominio('', 'Piacenza', ['raquel_cafe23'])).toContain('raquelcafe23.it');
  });

  it('una pagina «Raquel Caffè», «Raquel – caffetteria», «Raquel Coffee» o solo «Raquel» è sua, se c’è la città', () => {
    for (const t of ['Raquel Cafè', 'Raquel Caffè', 'Raquel - caffetteria', 'Raquel Coffee', 'Raquel']) expect(eIlSitoDi(pagina(t), RAQUEL, 'Piacenza'), t).toBe(true);
  });

  it('ma non quella di un’altra città, di un altro locale o di un dominio in vendita', () => {
    expect(eIlSitoDi(pagina('Raquel Caffè', 'Via Roma 1, Torino'), RAQUEL, 'Piacenza')).toBe(false);
    expect(eIlSitoDi(pagina('Caffè di Piacenza', 'Piazza Duomo 8, Piacenza'), RAQUEL, 'Piacenza')).toBe(false);
    expect(eIlSitoDi(pagina('raquel.it - dominio in vendita'), RAQUEL, 'Piacenza')).toBe(false);
  });

  it('largo: il nome può stare nella pagina e non nel titolo, ma come parola intera', () => {
    const html = '<title>Home</title><body>Benvenuti da Raquel, Piazza Duomo, Piacenza</body>';
    expect(eIlSitoDi(html, RAQUEL, 'Piacenza')).toBe(false);
    expect(eIlSitoDi(html, RAQUEL, 'Piacenza', { largo: true })).toBe(true);
    expect(eIlSitoDi('<title>Home</title><body>Raquelita bar, Piacenza</body>', RAQUEL, 'Piacenza', { largo: true })).toBe(false);
  });

  it('un nome di profilo porta il nome del locale solo se ha una parola che lo distingue', () => {
    expect(portaIlNome('raquel_cafe23', RAQUEL)).toBe(true);
    expect(portaIlNome('cafeteria_raquel_', RAQUEL)).toBe(true);
    expect(portaIlNome('caffe_piacenza', RAQUEL)).toBe(false);
  });
});

describe('il campo del venditore', () => {
  it('capisce il profilo Instagram, Facebook o TikTok, e il sito', () => {
    expect(leggiCanaleDelVenditore('@raquel_cafe23')).toMatchObject({ instagram: 'raquel_cafe23', sito: null });
    expect(leggiCanaleDelVenditore('https://www.instagram.com/raquel_cafe23/?igsh=abc')).toMatchObject({ instagram: 'raquel_cafe23' });
    expect(leggiCanaleDelVenditore('raquel_cafe23')).toMatchObject({ instagram: 'raquel_cafe23' });
    expect(leggiCanaleDelVenditore('https://www.facebook.com/RaquelCafe')?.facebook).toBeTruthy();
    expect(leggiCanaleDelVenditore('https://www.tiktok.com/@raquelcafe')?.tiktok).toBeTruthy();
    expect(leggiCanaleDelVenditore('www.raquelcafe.it')).toMatchObject({ sito: 'https://www.raquelcafe.it/', instagram: null });
  });

  it('un link di Google, un campo vuoto o un indirizzo con utente e password non valgono', () => {
    expect(leggiCanaleDelVenditore('https://maps.app.goo.gl/abc123')).toBeNull();
    expect(leggiCanaleDelVenditore('https://www.google.com/maps/place/Raquel')).toBeNull();
    expect(leggiCanaleDelVenditore('   ')).toBeNull();
    expect(leggiCanaleDelVenditore('https://utente:segreto@raquelcafe.it')).toBeNull();
  });

  it('il sito scritto dal venditore vale solo se si apre e porta il nome e la città', async () => {
    rete.pagine['https://raquelcafe.it/'] = pagina('Home', 'Raquel, caffetteria in Piazza Duomo 23 a Piacenza');
    const m = await sitoIndicato('raquelcafe.it', RAQUEL, 'Piacenza');
    expect(m?.aperto).toBe(true);
    expect(m?.social.instagram).toBe('https://www.instagram.com/raquel_cafe23/');
    rete.pagine['https://altrobar.it/'] = pagina('Bar Sport', 'Via Emilia 3, Piacenza');
    expect(await sitoIndicato('altrobar.it', RAQUEL, 'Piacenza')).toBeNull();
    expect(await sitoIndicato('https://www.facebook.com/raquel', RAQUEL, 'Piacenza')).toBeNull();
  });

  it('nella prima scheda: il profilo del venditore è trovato, il sito non confermato resta un indizio', () => {
    const s = primaScheda({ letto, osm: null, misura: null, citta: 'Piacenza', data: '2026-11-28 13:00',
      venditore: { canale: { sito: 'https://sbagliato.it/', instagram: 'raquel_cafe23', facebook: null, tiktok: null }, sitoNonConfermato: 'https://sbagliato.it/' } });
    expect(s.social.find((p) => p.canale === 'Instagram')).toMatchObject({ stato: 'trovato', origine: 'venditore', fonte: 'https://www.instagram.com/raquel_cafe23/' });
    expect(s.campi.find((c) => c.voce === 'Sito scritto da te')).toMatchObject({ stato: 'frammento' });
    expect(s.sito.misura).toBeNull();
  });

  it('l’AD che dice «non trovato» non cancella il profilo del venditore, e uno «trovato» non ne cambia l’indirizzo', () => {
    const p = primaScheda({ letto, osm: null, misura: null, citta: 'Piacenza', data: 'x', venditore: { canale: { sito: null, instagram: 'raquel_cafe23', facebook: null, tiktok: null } } });
    const a = unisci(p, pulisci({ social: [{ canale: 'Instagram', stato: 'non_trovato', fonte: null }] }));
    expect(a.social.find((x) => x.canale === 'Instagram')?.stato).toBe('trovato');
    const b = unisci(p, pulisci({ social: [{ canale: 'Instagram', stato: 'trovato', fonte: 'https://www.instagram.com/altro/', livello: 'attivo' }] }));
    expect(b.social.find((x) => x.canale === 'Instagram')).toMatchObject({ fonte: 'https://www.instagram.com/raquel_cafe23/', origine: 'venditore', livello: 'attivo' });
    expect(normalizza(b)?.social.find((x) => x.canale === 'Instagram')?.origine).toBe('venditore');
  });
});

describe('dopo la risposta dell’AD', () => {
  const schedaDopoLAd = (risultato: unknown) => {
    const p = primaScheda({ letto, osm: null, misura: null, citta: 'Piacenza', data: 'x' });
    const ad = pulisci(risultato);
    return { scheda: unisci(p, ad), ad };
  };

  it('il sito visto dall’AD si apre, e allora arriva al negozio iscritto', async () => {
    rete.pagine['https://www.raquelcafe.it/'] = pagina('Raquel Caffè · Piacenza');
    const { scheda, ad } = schedaDopoLAd({ sito: { url: 'https://www.raquelcafe.it/', livello: 'medio', giudizio: 'x', fonte: null } });
    expect(attivitaDallaScheda(scheda)?.sito).toBeUndefined(); // prima della conferma: è il buco del 28/11
    await confermaQuelloCheHaTrovatoLAd(scheda, { sitoUrl: ad.sito?.url ?? null, pagine: ad.pagine });
    expect(scheda.sito.misura?.aperto).toBe(true);
    expect(attivitaDallaScheda(scheda)?.sito).toBe('https://www.raquelcafe.it/');
    expect(scheda.social.find((p) => p.canale === 'Instagram')).toMatchObject({ stato: 'trovato', origine: 'sito' });
  });

  it('un sito dell’AD che non porta il nome e la città non entra', async () => {
    rete.pagine['https://omonimo.it/'] = pagina('Raquel Caffè', 'Via Roma 1, Torino');
    const { scheda, ad } = schedaDopoLAd({ sito: { url: 'https://omonimo.it/', livello: 'medio', giudizio: 'x', fonte: null } });
    await confermaQuelloCheHaTrovatoLAd(scheda, { sitoUrl: ad.sito?.url ?? null, pagine: ad.pagine });
    expect(scheda.sito.misura?.aperto).toBeFalsy();
    expect(attivitaDallaScheda(scheda)?.sito).toBeUndefined();
  });

  it('le pagine viste dall’AD si aprono: entrano il sito col nome del locale e il suo profilo, non quelli degli altri', async () => {
    // Una guida (come la pagina di viaggio che citava @raquel_cafe23): l'omonimo e la pubblicità vengono prima.
    rete.pagine['https://guida.example.org/piacenza-duomo'] = `<html><body>
      <a href="https://www.instagram.com/bar_sport_pc/">Bar Sport</a> <a href="https://pubblicita.example.net/">offerta</a>
      <a href="https://www.instagram.com/raquel_cafe23/">Raquel Cafè</a> <a href="https://www.raquel.it/">sito</a>
      <a href="https://www.instagram.com/p/ABC123/">un post</a> <a href="https://www.tripadvisor.it/Raquel">recensioni</a></body></html>`;
    rete.pagine['https://www.raquel.it/'] = pagina('Raquel');
    const { scheda, ad } = schedaDopoLAd({ pagine_viste: ['https://guida.example.org/piacenza-duomo', 'https://www.facebook.com/raquel', 'https://www.tripadvisor.it/x', 'http://in-chiaro.example.org/'] });
    expect(ad.pagine).toEqual(['https://guida.example.org/piacenza-duomo']);
    await confermaQuelloCheHaTrovatoLAd(scheda, { sitoUrl: null, pagine: ad.pagine });
    expect(rete.chieste).not.toContain('https://www.facebook.com/raquel');
    expect(scheda.sito.misura?.url).toBe('https://www.raquel.it/');
    expect(scheda.social.filter((p) => p.canale === 'Instagram' && p.stato === 'trovato').map((p) => p.fonte)).toEqual(['https://www.instagram.com/raquel_cafe23/']);
  });

  it('anche chiamata da sola, la conferma non apre mai Meta, Google o i portali, né pagine in chiaro', async () => {
    const { scheda } = schedaDopoLAd({});
    await confermaQuelloCheHaTrovatoLAd(scheda, { sitoUrl: null, pagine: ['https://www.facebook.com/raquel', 'https://www.google.com/maps/place/x', 'https://www.tripadvisor.it/x', 'http://in-chiaro.example.org/'] });
    expect(rete.chieste.filter((u) => /facebook|google|tripadvisor|in-chiaro/.test(u))).toEqual([]);
  });

  it('dai collegamenti di una pagina: niente post, condivisioni, portali o siti senza il nome del locale', () => {
    const html = `<a href="https://www.facebook.com/sharer/sharer.php?u=x">c</a><a href="https://www.instagram.com/p/X1/">p</a>
      <a href="https://www.tiktok.com/@raquelcafe">t</a><a href="/interna">i</a><a href="https://www.thefork.it/raquel">f</a>
      <a href="https://altro-bar.it/">a</a><a href="https://raquelcafe.it/menu">m</a>`;
    expect(collegamentiDellaPagina(html, 'https://guida.example.org/x', RAQUEL)).toEqual({ siti: ['https://raquelcafe.it/'], profili: ['https://www.tiktok.com/@raquelcafe'] });
  });

  it('un profilo in una pagina che non porta il nome del locale non entra (senza un sito che lo corregga)', async () => {
    rete.pagine['https://guida.example.org/altro'] = '<a href="https://www.instagram.com/bar_sport_pc/">Bar</a>';
    const { scheda, ad } = schedaDopoLAd({ pagine_viste: ['https://guida.example.org/altro'] });
    await confermaQuelloCheHaTrovatoLAd(scheda, { sitoUrl: null, pagine: ad.pagine });
    expect(scheda.social.some((p) => p.canale === 'Instagram' && p.stato === 'trovato')).toBe(false);
  });

  it('senza nessun sito, si provano gli indirizzi fatti dal nome del profilo', async () => {
    rete.pagine['https://raquelcafe23.it/'] = pagina('Raquel Cafè 23');
    const { scheda, ad } = schedaDopoLAd({ social: [{ canale: 'Instagram', stato: 'trovato', fonte: 'https://www.instagram.com/raquel_cafe23/', giudizio: 'visto solo in un estratto' }] });
    await confermaQuelloCheHaTrovatoLAd(scheda, { sitoUrl: null, pagine: ad.pagine });
    expect(rete.chieste).toContain('https://raquelcafe23.it/');
    expect(scheda.sito.misura?.url).toBe('https://raquelcafe23.it/');
  });

  it('al flusso 16 va il profilo col nome del locale, non un omonimo visto solo dall’AD', () => {
    const conNome = schedaDopoLAd({ social: [{ canale: 'Instagram', stato: 'trovato', fonte: 'https://www.instagram.com/raquel_cafe23/' }] }).scheda;
    expect(instagramPerIlFlusso(conNome)).toBe('raquel_cafe23');
    const omonimo = schedaDopoLAd({ social: [{ canale: 'Instagram', stato: 'trovato', fonte: 'https://www.instagram.com/caffe_del_duomo/' }] }).scheda;
    expect(instagramPerIlFlusso(omonimo)).toBeNull();
  });
});
