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

const rete = vi.hoisted(() => ({ pagine: {} as Record<string, string>, chieste: [] as string[], finale: {} as Record<string, string> }));
vi.mock('@/lib/agenti/rete', async (originale) => ({
  ...(await originale<typeof import('@/lib/agenti/rete')>()),
  leggiPagina: async (url: string) => {
    rete.chieste.push(url);
    const html = rete.pagine[url];
    // `finale`: dove la pagina finisce dopo i rinvii (come la restituisce la vera leggiPagina).
    return html ? { ok: true, stato: 200, url: rete.finale[url] ?? url, html, errore: null, ms: 1 } : { ok: false, stato: null, url, html: '', errore: 'non si apre', ms: 1 };
  },
}));

const { candidatiDominio, eIlSitoDi, sitoIndicato, portaIlNome, indirizzoNellaPagina, radiceDelSito, misuraSito, indovinaSito, NON_E_UN_SITO } = await import('@/lib/agenti/sito');
const { maiLetta } = await import('@/lib/agenti/mai-lette');
const reteVera = await vi.importActual<typeof import('@/lib/agenti/rete')>('@/lib/agenti/rete');
const { leggiCanaleDelVenditore } = await import('@/lib/agenti/canale-venditore');
const { primaScheda, unisci, pulisci, normalizza } = await import('@/lib/agenti/scheda');
const { confermaQuelloCheHaTrovatoLAd, instagramPerIlFlusso, collegamentiDellaPagina } = await import('@/lib/agenti/conferma-ad');
const { attivitaDallaScheda } = await import('@/lib/agenti/aggiungi');

const RAQUEL = 'Raquel 💗 Cafè';
const pagina = (titolo: string, corpo = 'Piazza Duomo 23, 29121 Piacenza') => `<html><head><title>${titolo}</title></head><body><h1>${titolo}</h1><p>${corpo}</p>
<a href="https://www.instagram.com/raquel_cafe23/">Instagram</a></body></html>`;
const letto = { nome: RAQUEL, indirizzo: 'Piazza Duomo, 23, 29121 Piacenza PC', lat: 45.05, lon: 9.69, idLuogo: null, link: 'https://www.google.com/maps/place/Raquel' };

beforeEach(() => { rete.pagine = {}; rete.chieste = []; rete.finale = {}; });

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

  it('una pagina «Raquel Cafè» o «Raquel Caffè» è sua, se c’è la città: il nome intero sta nel titolo', () => {
    for (const t of ['Raquel Cafè', 'Raquel Caffè', 'Raquel Café Piacenza']) expect(eIlSitoDi(pagina(t), RAQUEL, 'Piacenza'), t).toBe(true);
  });

  it('con una parola distintiva sola, «Raquel – caffetteria», «Raquel Coffee» o «Raquel» valgono solo con la via e il numero del locale', () => {
    const indirizzo = 'Piazza Duomo, 23, 29121 Piacenza PC';
    for (const t of ['Raquel - caffetteria', 'Raquel Coffee', 'Raquel']) {
      expect(eIlSitoDi(pagina(t), RAQUEL, 'Piacenza', { indirizzo }), t).toBe(true);
      expect(eIlSitoDi(pagina(t, 'Via Roma 5, Piacenza'), RAQUEL, 'Piacenza', { indirizzo }), `${t} con un altro indirizzo`).toBe(false);
    }
  });

  it('il «Bar del Duomo» non prende il sito del Duomo né quello di un altro locale della piazza (collaudo del 28/11)', () => {
    const indirizzo = 'Piazza Duomo, 12, 29121 Piacenza PC';
    expect(eIlSitoDi('<title>Duomo di Piacenza</title><body>Piazza Duomo 33, Piacenza</body>', 'Bar del Duomo', 'Piacenza', { indirizzo })).toBe(false);
    expect(eIlSitoDi('<title>Gelateria del Duomo</title><body>Piazza Duomo 4, Piacenza</body>', 'Bar del Duomo', 'Piacenza', { indirizzo })).toBe(false);
    expect(eIlSitoDi('<title>Bar del Duomo</title><body>Piazza Duomo 12, Piacenza</body>', 'Bar del Duomo', 'Piacenza', { indirizzo })).toBe(true);
    expect(indirizzoNellaPagina('Siamo in piazza Duomo, n. 12 a Piacenza', indirizzo)).toBe(true);
    expect(indirizzoNellaPagina('Piazza Duomo 120, Piacenza', indirizzo)).toBe(false);
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

  it('un nome di profilo o un dominio è del locale solo con tutte le parole che lo distinguono, e senza un altro tipo di locale', () => {
    expect(portaIlNome('raquel_cafe23', RAQUEL)).toBe(true);
    expect(portaIlNome('cafeteria_raquel_', RAQUEL)).toBe(true);
    expect(portaIlNome('caffe_piacenza', RAQUEL)).toBe(false);
    expect(portaIlNome('gelateriadelduomo.it', 'Bar del Duomo')).toBe(false);
    expect(portaIlNome('gelateria_del_duomo_pc', 'Bar del Duomo')).toBe(false);
    expect(portaIlNome('bardelduomo.it', 'Bar del Duomo')).toBe(true);
    expect(portaIlNome('rossi_gomme_piacenza', 'Pasticceria Fratelli Rossi')).toBe(false);
    expect(portaIlNome('fratellirossi_pasticceria', 'Pasticceria Fratelli Rossi')).toBe(true);
    // I casi del collaudo: una parola in comune non basta, e un altro tipo di locale non passa.
    expect(portaIlNome('pasticceria_duomo_pc', 'Caffè del Duomo')).toBe(false);
    expect(portaIlNome('antica_trattoria_pc', 'Antica Pasticceria Galli')).toBe(false);
    expect(portaIlNome('antica_osteria_pc', 'Antica Pasticceria Galli')).toBe(false);
    expect(portaIlNome('pizzeria_alla_stazione', 'Trattoria alla Pesa')).toBe(false);
  });

  it('ricollaudo: la città non è una parola del nome, un indirizzo diverso è un omonimo, un altro tipo di attività non passa', () => {
    const casa = { indirizzo: 'Via Emilia Pavese, 10, 29121 Piacenza PC' };
    expect(eIlSitoDi('<title>Bar Sport Piacenza</title><body>Bar Sport, Via Colombo 50, Piacenza</body>', 'Bar Sport', 'Piacenza', casa)).toBe(false);
    expect(eIlSitoDi('<title>Bar Sport Piacenza</title><body>Bar Sport, Via Emilia Pavese 10, Piacenza</body>', 'Bar Sport', 'Piacenza', casa)).toBe(true);
    expect(portaIlNome('gelateria_del_duomo_pc', 'Bar Duomo Piacenza')).toBe(false);
    expect(portaIlNome('bar_duomo_pc', 'Bar Duomo Piacenza')).toBe(true);
    expect(eIlSitoDi('<title>Fratelli Rossi Gomme</title><body>Piacenza</body>', 'Pasticceria Fratelli Rossi', 'Piacenza')).toBe(false);
    expect(eIlSitoDi('<title>Pasticceria Fratelli Rossi</title><body>Piacenza</body>', 'Pasticceria Fratelli Rossi', 'Piacenza')).toBe(true);
  });

  it('il civico si legge anche «23A», «nr. 23», «23/A»; «Raquel Caffetteria» vale come «Raquel Cafè»', () => {
    const indirizzo = 'Piazza Duomo, 23, 29121 Piacenza PC';
    for (const civico of ['23A', 'nr. 23', '23/A', 'n° 23']) expect(indirizzoNellaPagina(`Piazza Duomo ${civico}, Piacenza`, indirizzo), civico).toBe(true);
    expect(indirizzoNellaPagina('Piazza Duomo 230, Piacenza', indirizzo)).toBe(false);
    expect(eIlSitoDi('<title>Raquel Caffetteria</title><body>Piacenza</body>', RAQUEL, 'Piacenza')).toBe(true);
  });

  it('fra due siti indovinati vince quello che porta il nostro indirizzo', async () => {
    rete.pagine['https://raquelcafe.it/'] = '<title>Raquel Cafè</title><body>Piacenza</body>';
    rete.pagine['https://raquel.it/'] = '<title>Raquel</title><body>Piazza Duomo 23, Piacenza</body>';
    const m = await indovinaSito(RAQUEL, 'Piacenza', 3500, [], 'Piazza Duomo, 23, 29121 Piacenza PC');
    expect(m).toMatchObject({ url: 'https://raquel.it/', prova: 'indirizzo' });
  });

  it('un sito fatto con Google Sites è un sito, non un elenco', async () => {
    expect(NON_E_UN_SITO.test('sites.google.com')).toBe(false);
    expect(NON_E_UN_SITO.test('www.google.com')).toBe(true);
    rete.pagine['https://sites.google.com/view/raquelcafe/'] = '<title>Raquel Cafè</title><body>Piazza Duomo 23, Piacenza</body>';
    expect((await sitoIndicato('https://sites.google.com/view/raquelcafe/home', RAQUEL, 'Piacenza', { fidato: true }))?.url).toBe('https://sites.google.com/view/raquelcafe/');
  });

  it('il venditore può dare un sito fatto con Google Sites; un link di Google Maps no', () => {
    expect(leggiCanaleDelVenditore('https://sites.google.com/view/raquelcafe/home')?.sito).toBe('https://sites.google.com/view/raquelcafe/home');
    expect(leggiCanaleDelVenditore('https://www.google.com/maps/place/x')).toBeNull();
  });

  it('un sito riconosciuto solo dal nome non manda al flusso 16 l’Instagram che collega', async () => {
    rete.pagine['https://www.raquelcafe.it/'] = '<title>Raquel Caffè</title><body>Piacenza <a href="https://www.instagram.com/raquel_cafe23/">IG</a></body>';
    const p = primaScheda({ letto, osm: null, misura: null, citta: 'Piacenza', data: 'x' });
    const s = unisci(p, pulisci({ sito: { url: 'https://www.raquelcafe.it/', livello: 'medio', giudizio: 'x', fonte: null } }));
    await confermaQuelloCheHaTrovatoLAd(s, { sitoUrl: 'https://www.raquelcafe.it/', pagine: [] });
    expect(s.sito.misura?.prova).toBe('nome');
    expect(instagramPerIlFlusso(s)).toBeNull();
  });

  it('un nome fatto solo di parole comuni si riconosce lo stesso («Caffè Bistrot», «Coffee Lounge»)', () => {
    for (const nome of ['Caffè Bistrot', 'Coffee Lounge', 'Lounge Bar', 'Bistrot Pub']) {
      const html = `<title>${nome} Piacenza</title><body>Via Roma 1, Piacenza</body>`;
      expect(eIlSitoDi(html, nome, 'Piacenza'), nome).toBe(true);
      expect(eIlSitoDi(html, nome, 'Piacenza', { largo: true }), `${nome} largo`).toBe(true);
    }
    expect(candidatiDominio('Caffè Bistrot', 'Piacenza')).toContain('caffebistrot.it');
  });

  it('Meta, Google e i portali non si aprono mai, nemmeno dopo un rinvio; Google Sites sì', async () => {
    for (const h of ['www.facebook.com', 'instagram.com', 'www.google.com', 'maps.google.it', 'share.google', 'www.tripadvisor.it', 'l.facebook.com']) expect(maiLetta(h), h).toBe(true);
    for (const h of ['sites.google.com', 'raquelcafe.it', 'wanderlog.com']) expect(maiLetta(h), h).toBe(false);
    // Si ferma prima di collegarsi, col suo motivo (senza il controllo fallirebbe per la rete, che qui è chiusa).
    expect((await reteVera.leggiPagina('https://www.facebook.com/raquel')).errore).toMatch(/Meta, Google o di un portale/);
    expect(reteVera.rinvioAmmesso('https://www.facebook.com/RaquelCafe', new URL('https://raquelcafe.it/'))).toHaveProperty('errore');
    expect(reteVera.rinvioAmmesso('https://m.facebook.com/x', new URL('https://raquelcafe.it/'))).toHaveProperty('errore');
    expect(reteVera.rinvioAmmesso('/menu', new URL('https://raquelcafe.it/'))).toHaveProperty('url');
  });

  it('un sito si giudica dalla sua home: un articolo del giornale non diventa il sito del locale', async () => {
    expect(radiceDelSito(new URL('https://www.liberta.it/news/2026/raquel-cafe'))).toBe('https://www.liberta.it/');
    expect(radiceDelSito(new URL('https://sites.google.com/view/raquelcafe/menu'))).toBe('https://sites.google.com/view/raquelcafe/');
    rete.pagine['https://www.giornale-locale.example.org/'] = '<title>Il giornale di Piacenza</title><body>Notizie da Piacenza</body>';
    rete.pagine['https://www.giornale-locale.example.org/articolo-raquel'] = pagina('Raquel Cafè, il bar rosa');
    expect(await sitoIndicato('https://www.giornale-locale.example.org/articolo-raquel', RAQUEL, 'Piacenza', { indirizzo: 'Piazza Duomo, 23' })).toBeNull();
  });

  it('un sito che dopo i rinvii finisce su un elenco o un profilo non vale', async () => {
    rete.pagine['https://raquelcafe.it/'] = pagina('Raquel Cafè');
    expect((await sitoIndicato('raquelcafe.it', RAQUEL, 'Piacenza'))?.aperto).toBe(true);
    rete.finale['https://raquelcafe.it/'] = 'https://www.paginegialle.it/raquel-cafe';
    expect(await sitoIndicato('raquelcafe.it', RAQUEL, 'Piacenza', { fidato: true })).toBeNull();
  });

  it('anche il sito scritto sulla mappa libera non vale se rinvia a un profilo; e un profilo non entra mai nel negozio', async () => {
    rete.pagine['https://raquelcafe.it/'] = pagina('Raquel Cafè');
    rete.finale['https://raquelcafe.it/'] = 'https://www.instagram.com/raquel_cafe23/';
    expect((await misuraSito('raquelcafe.it')).aperto).toBe(false);
    const s = primaScheda({ letto, osm: null, misura: null, citta: 'Piacenza', data: 'x' });
    s.sito.misura = { url: 'https://www.facebook.com/raquel', aperto: true, https: true, titolo: null, descrizione: null, telefonino: true, pagine: 1, funzioni: [], social: {}, piattaforma: null, anno: null, stima: 'semplice', errore: null };
    expect(attivitaDallaScheda(s)?.sito).toBeUndefined();
  });

  it('le preposizioni articolate non contano come parole del nome («Trattoria alla Pesa»)', () => {
    expect(eIlSitoDi('<title>Pesa · trattoria</title><body>Via Roma 10, Piacenza</body>', 'Trattoria alla Pesa', 'Piacenza', { indirizzo: 'Via Roma, 10, Piacenza' })).toBe(true);
  });

  it('il sito visto dall’AD si giudica stretto: il nome solo nel testo, senza indirizzo, non basta', async () => {
    rete.pagine['https://www.raquel-omonimo.it/'] = '<title>Home</title><body>Benvenuti da Raquel, Piacenza</body>';
    const p = primaScheda({ letto, osm: null, misura: null, citta: 'Piacenza', data: 'x' });
    const s = unisci(p, pulisci({ sito: { url: 'https://www.raquel-omonimo.it/', livello: 'medio', giudizio: 'x', fonte: null } }));
    await confermaQuelloCheHaTrovatoLAd(s, { sitoUrl: 'https://www.raquel-omonimo.it/', pagine: [] });
    expect(s.sito.misura?.aperto).toBeFalsy();
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
    expect(leggiCanaleDelVenditore('pane.quotidiano')).toMatchObject({ instagram: 'pane.quotidiano', sito: null });
  });

  it('un link di Google, un campo vuoto o un indirizzo con utente e password non valgono', () => {
    expect(leggiCanaleDelVenditore('https://maps.app.goo.gl/abc123')).toBeNull();
    expect(leggiCanaleDelVenditore('https://www.google.com/maps/place/Raquel')).toBeNull();
    expect(leggiCanaleDelVenditore('   ')).toBeNull();
    expect(leggiCanaleDelVenditore('https://utente:segreto@raquelcafe.it')).toBeNull();
  });

  it('il sito scritto dal venditore vale solo se si apre e porta il nome e la città', async () => {
    rete.pagine['https://raquelcafe.it/'] = pagina('Home', 'Raquel, caffetteria in Piazza Duomo 23 a Piacenza');
    const m = await sitoIndicato('raquelcafe.it', RAQUEL, 'Piacenza', { fidato: true });
    expect(m?.aperto).toBe(true);
    expect(await sitoIndicato('raquelcafe.it', RAQUEL, 'Piacenza'), 'senza fidato serve il nome nel titolo o l’indirizzo').toBeNull();
    expect(m?.social.instagram).toBe('https://www.instagram.com/raquel_cafe23/');
    rete.pagine['https://altrobar.it/'] = pagina('Bar Sport', 'Via Emilia 3, Piacenza');
    expect(await sitoIndicato('altrobar.it', RAQUEL, 'Piacenza', { fidato: true })).toBeNull();
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

  it('al flusso 16 va solo un profilo sicuro (dal sito, dal venditore, dalla mappa), mai uno visto solo dall’AD', async () => {
    const soloAd = schedaDopoLAd({ social: [{ canale: 'Instagram', stato: 'trovato', fonte: 'https://www.instagram.com/raquel_cafe23/' }] }).scheda;
    expect(instagramPerIlFlusso(soloAd)).toBeNull();
    rete.pagine['https://www.raquelcafe.it/'] = pagina('Raquel Caffè');
    const { scheda, ad } = schedaDopoLAd({ sito: { url: 'https://www.raquelcafe.it/', livello: 'medio', giudizio: 'x', fonte: null } });
    await confermaQuelloCheHaTrovatoLAd(scheda, { sitoUrl: ad.sito?.url ?? null, pagine: ad.pagine });
    expect(instagramPerIlFlusso(scheda)).toBe('raquel_cafe23');
    const p = primaScheda({ letto, osm: null, misura: null, citta: 'Piacenza', data: 'x', venditore: { canale: { sito: null, instagram: 'raquel_cafe23', facebook: null, tiktok: null } } });
    expect(instagramPerIlFlusso(p)).toBe('raquel_cafe23');
  });
});
