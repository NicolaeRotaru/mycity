import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 28/11/2026 — Il sito del cliente, online al sì del titolare.
 *  - verso le 14:10, Nicola: «non mi è uscito il sito … deve essere già su Vercel il sito del cliente che ha
 *    accettato». Prima usciva l'elenco dei testi con «da confermare».
 *  - verso le 15:30: il primo sito automatico «non è bello … anche la versione base è molto meglio … crea qualcosa che
 *    spiega come deve essere strutturato un sito in base all'abbonamento e segui quella linea». Da qui lo standard
 *    (lib/agenzia/sito-finito/standard.ts) e queste prove: ogni abbonamento ha le sue pagine, ogni sito ha tutto
 *    quello che ha il sito Business del Caffè di Piacenza, nessuna frase da bozza, i dati veri del negozio, la firma
 *    dell'armonia, l'indirizzo che si trova e la rotta che lo serve (e che non mostra chi non deve).
 */

// I testi veri che l'AD ha scritto per Raquel Cafè il 28/11 alle 13:29 (ordine 61b0a947, colonna `sito`).
const PAGINE_RAQUEL = [
  { titolo: 'Home', percorso: '/', sezioni: [
    { titolo: 'Benvenuti da Raquel Cafè', testo: 'Un bar rosa nel cuore di Piacenza, in Piazza Duomo. Qui trovate colazione, pranzo veloce e aperitivo, in un locale curato e facile da riconoscere.', stato: 'da_confermare' as const },
    { titolo: "Dalla colazione all'aperitivo", testo: "La giornata comincia con caffè e brioche. A pranzo c'è qualcosa di veloce. Verso sera arriva l'aperitivo, da gustare guardando la piazza.", stato: 'da_confermare' as const },
    { titolo: 'Passate a trovarci', testo: 'Siete in giro per il centro o in visita a Piacenza? Fermatevi da noi per una pausa. Orari: da confermare col titolare.', stato: 'da_confermare' as const },
  ] },
  { titolo: 'Chi siamo e cosa offriamo', percorso: '/chi-siamo', sezioni: [
    { titolo: 'Il nostro locale', testo: 'Raquel Cafè è una caffetteria dal colore rosa, accogliente e ben tenuta. Ci piace accogliere chi entra con gentilezza.', stato: 'da_confermare' as const },
    { titolo: 'Colazione e brioche', testo: "Al mattino trovate caffè e brioche per iniziare bene la giornata. L'elenco dei prodotti sarà confermato dal titolare prima della pubblicazione.", stato: 'da_confermare' as const },
    { titolo: 'Pranzo veloce', testo: 'Per chi ha poco tempo, proponiamo piatti semplici da gustare con calma o in fretta. Il menu del pranzo sarà inserito dopo la conferma col titolare.', stato: 'da_confermare' as const },
    { titolo: 'Aperitivo in piazza', testo: "A fine giornata l'aperitivo è il momento giusto per trovarsi con gli amici. Le proposte e le eventuali offerte: da confermare col titolare.", stato: 'da_confermare' as const },
  ] },
  { titolo: 'Dove siamo e contatti', percorso: '/dove-siamo', sezioni: [
    { titolo: 'Come raggiungerci', testo: 'Siamo in Piazza Duomo, 23, a Piacenza. Il locale è proprio sulla piazza, a pochi passi dalla cattedrale.', stato: 'da_confermare' as const },
    { titolo: 'Orari e contatti', testo: 'Orari di apertura: da confermare col titolare. Telefono: da confermare col titolare. Email e profili social: da confermare col titolare.', stato: 'da_confermare' as const },
  ] },
];

// Un contenuto nella forma nuova, come lo scrive l'AD col compito del 28/11 pomeriggio.
const CONTENUTO = {
  occhiello: 'colazioni · pranzi veloci · aperitivi',
  titolo: 'Il bar rosa di Piazza Duomo',
  sottotitolo: 'Caffè e brioche al mattino, un pranzo veloce a mezzogiorno e l’aperitivo la sera.',
  momentiTitolo: 'Dalla colazione all’aperitivo',
  momentiIntro: 'Tre momenti della giornata, sempre nello stesso posto.',
  momenti: [
    { titolo: 'Colazione', testo: 'Il caffè e una brioche per cominciare bene.', disegno: 'cornetto' as const },
    { titolo: 'Pranzo veloce', testo: 'Piatti semplici per chi ha poco tempo.', disegno: 'panino' as const },
    { titolo: 'Aperitivo', testo: 'Un aperitivo con gli amici guardando la piazza.', disegno: 'calice' as const },
  ],
  perche: [
    { titolo: 'Proprio sulla piazza', testo: 'Siamo in Piazza Duomo, a pochi passi dalla cattedrale.' },
    { titolo: 'Dalla mattina alla sera', testo: 'Colazione, pranzo e aperitivo in un posto solo.' },
    { titolo: 'Un bar che si riconosce', testo: 'Il rosa del locale lo vedi da lontano.' },
  ],
  locale: { titolo: 'Il nostro locale', paragrafi: ['Una caffetteria rosa, accogliente e ben tenuta, nel cuore di Piacenza.'] },
  offerta: [
    { categoria: 'Colazione', descrizione: 'Caffè, cappuccino e brioche.', voci: [], disegno: 'cornetto' as const },
    { categoria: 'Aperitivo', descrizione: 'Il momento per trovarsi la sera.', voci: [], disegno: 'calice' as const },
  ],
  citta: { titolo: 'In Piazza Duomo', paragrafi: ['Il locale è sulla piazza della cattedrale, nel centro storico.'], vicino: ['Duomo di Piacenza', 'Piazza Cavalli'] },
  comeArrivare: 'Siamo in Piazza Duomo 23, proprio sulla piazza.',
  novita: { titolo: 'Dicembre in centro', paragrafi: ['A dicembre il centro si riempie di luci: il periodo giusto per una cioccolata calda.'] },
  domande: [{ domanda: 'Dove siete?', risposta: 'In Piazza Duomo 23, a Piacenza.' }],
  palette: 'rosa' as const,
};

const SELLER = 'ffb27af9-ad17-42a5-8215-a7ad3dfe0224';
const ORARI = { mon: [['07:00', '20:00']], tue: [['07:00', '20:00']], wed: [['07:00', '20:00']], thu: [['07:00', '20:00']], fri: [['07:00', '20:00']], sat: [['07:30', '20:00']], sun: [] };
// Sabato 28/11/2026 alle 15:00 di Piacenza: aperto, «oggi» è sabato.
const SABATO_POMERIGGIO = Date.UTC(2026, 10, 28, 14);

const { paginaDelSito, pagineDelSito, testoPubblico, paginePubbliche, fotoDalNegozio } = await import('@/lib/agenzia/sito-finito/costruisci');
const { STANDARD, OGNI_SITO_HA } = await import('@/lib/agenzia/sito-finito/standard');
const { percorsoDelSito, leggiIndirizzo, intervalloDelPrefisso } = await import('@/lib/agenzia/sito-finito/indirizzo');
const { sitoDallaRisposta } = await import('@/lib/agenzia/sito-dell-ordine-ad');

type Dati = Parameters<typeof paginaDelSito>[0];
const dati = (piu: Partial<Dati> = {}): Dati => ({
  nome: 'Raquel 💗 Cafè',
  sottotitolo: 'Caffetteria rosa in Piazza Duomo a Piacenza: colazione, pranzo veloce e aperitivo.',
  fascia: 'business',
  contenuto: null,
  citta: 'Piacenza',
  indirizzo: 'Piazza Duomo, 23, 29121 Piacenza PC',
  telefono: null,
  orari: null,
  social: [],
  logo: null,
  foto: [],
  colore: null,
  vetrina: null,
  nascita: '2026-11-28',
  pagine: PAGINE_RAQUEL,
  eventi: [],
  base: '/sito/raquel-cafe-ffb27af9',
  ...piu,
});

describe('lo standard: ogni abbonamento ha le sue pagine', () => {
  it('Base una pagina, Business cinque, Premium sette, con le facoltative solo se hanno qualcosa di vero', () => {
    const pieno = { contenuto: CONTENUTO, eventi: [{ data: '2026-12-06', testo: 'Mercati di Natale in Piazza Duomo' }] };
    expect(pagineDelSito(dati({ ...pieno, fascia: 'base' })).map((p) => p.titolo)).toEqual(['Home']);
    expect(pagineDelSito(dati({ ...pieno, fascia: 'business' })).map((p) => p.titolo)).toEqual(['Home', 'Il locale', 'Cosa offriamo', 'In città', 'Contatti']);
    expect(pagineDelSito(dati({ ...pieno, fascia: 'premium' })).map((p) => p.titolo)).toEqual(['Home', 'Il locale', 'Cosa offriamo', 'Novità', 'In città', 'Domande', 'Contatti']);
    // Senza città, novità, domande ed eventi le pagine facoltative non nascono vuote.
    const scarno = { ...CONTENUTO, citta: null, novita: null, domande: [] };
    expect(pagineDelSito(dati({ contenuto: scarno, fascia: 'premium' })).map((p) => p.titolo)).toEqual(['Home', 'Il locale', 'Cosa offriamo', 'Contatti']);
    expect(STANDARD.base).toHaveLength(1);
  });

  for (const fascia of ['base', 'business', 'premium'] as const) {
    it(`${fascia}: la home ha tutto il minimo di ogni sito (${OGNI_SITO_HA.length} punti)`, () => {
      const h = paginaDelSito(dati({ fascia, contenuto: CONTENUTO, telefono: '0523 123456', orari: ORARI }), '/', SABATO_POMERIGGIO)!;
      expect(h).toMatch(/<header class="testata">[\s\S]*Raquel 💗 Cafè[\s\S]*href="tel:0523123456">Chiama<\/a>/);
      expect(h).toContain('<p class="occhiello">colazioni · pranzi veloci · aperitivi</p>');
      expect(h).toContain('<h1>Il bar rosa di Piazza Duomo</h1>');
      expect(h).toContain('Guarda cosa offriamo');
      expect(h.match(/<article class="scheda entra"/g)).toHaveLength(3);
      expect(h).toContain('/siti/disegni/cornetto.png');
      expect(h).toMatch(/<section class="striscia"/);
      expect(h).toContain('Indicazioni');
      expect(h).toContain('<p class="stato aperto">');
      expect(h).toContain('Aperto ora · chiude alle 20:00');
      expect(h).toContain('<tr class="oggi"><th scope="row">Sabato <span>(oggi)</span></th><td>07:30–20:00</td></tr>');
      expect(h).toMatch(/<div class="barra-telefono"><a class="pulsante" href="tel:0523123456">Chiama<\/a><a class="pulsante chiaro"[^>]*>Indicazioni<\/a><\/div>/);
      expect(h).toContain('<footer class="piede">');
      expect(h).toMatch(/<title>Raquel 💗 Cafè · Piacenza<\/title>/);
      expect(h).toContain('<meta name="description"');
      expect(h).toContain('<script type="application/ld+json">{"@context":"https://schema.org","@type":"LocalBusiness"');
    });
  }

  it('Business: il menu porta alle cinque pagine, e ognuna risponde', () => {
    const d = dati({ contenuto: CONTENUTO, eventi: [{ data: '2026-12-06', testo: 'Mercati di Natale in Piazza Duomo' }] });
    const casa = paginaDelSito(d, '/')!;
    for (const p of ['/il-locale', '/cosa-offriamo', '/in-citta', '/contatti']) {
      expect(casa).toContain(`href="/sito/raquel-cafe-ffb27af9${p}"`);
      expect(paginaDelSito(d, p)).toBeTruthy();
    }
    expect(paginaDelSito(d, '/in-citta')).toContain('Mercati di Natale in Piazza Duomo');
    expect(paginaDelSito(d, '/novita')).toBeNull();
  });
});

describe('i siti scritti la mattina, coi soli testi a pagine (Raquel Cafè oggi)', () => {
  const d = dati();
  it('diventano un sito Business vero: momenti dalla colazione all’aperitivo, il locale, l’offerta, i contatti', () => {
    expect(pagineDelSito(d).map((p) => p.titolo)).toEqual(['Home', 'Il locale', 'Cosa offriamo', 'Contatti']);
    const casa = paginaDelSito(d, '/')!;
    expect(casa).toContain('<h2 id="momenti">Dalla colazione all&#39;aperitivo</h2>');
    expect(casa.match(/<article class="scheda entra"/g)).toHaveLength(3);
    expect(casa).toContain('colazioni · pranzi · aperitivi');
    // «un bar rosa»: la tavolozza rosa.
    expect(casa).toContain('--marchio:#A63D57');
  });
  it('nessuna pagina dice «da confermare», «titolare» o «pubblicazione»', () => {
    for (const p of pagineDelSito(d)) expect(paginaDelSito(d, p.percorso)).not.toMatch(/confermar|titolare|pubblicazion|metteremo/i);
  });
});

describe('niente frasi da bozza', () => {
  it('toglie solo le frasi da bozza e tiene le altre', () => {
    expect(testoPubblico('Fermatevi da noi per una pausa. Orari: da confermare col titolare.')).toBe('Fermatevi da noi per una pausa.');
    for (const buona of ['Il titolare vi accoglie ogni mattina.', 'Prenotazione confermata in pochi minuti.', 'La pubblicazione dei nostri libri preferiti.']) expect(testoPubblico(buona)).toBe(buona);
    for (const bozza of ['Il menu verrà aggiunto a breve.', 'Prezzi: [da inserire].', 'Il menu è in arrivo.', 'Presto potrete prenotare online.', 'Orari da definire.', 'Le foto arriveranno dopo la visita.']) expect(testoPubblico(bozza)).toBe('');
  });
  it('una sezione fatta solo di «da confermare» sparisce', () => {
    expect(paginePubbliche(PAGINE_RAQUEL)[2].sezioni.map((s) => s.titolo)).toEqual(['Come raggiungerci']);
  });
  it('anche i contenuti nella forma nuova passano dal filtro', () => {
    const h = paginaDelSito(dati({ contenuto: { ...CONTENUTO, sottotitolo: 'Testi da confermare col titolare.' } }), '/')!;
    expect(h).not.toMatch(/confermar/i);
  });
});

describe('sicurezza e dati veri', () => {
  it('un nome o un testo con codice dentro si scrive come testo, anche nei dati per Google', () => {
    const h = paginaDelSito(dati({ nome: 'Bar </script><script>alert(1)</script>', contenuto: CONTENUTO }), '/')!;
    expect(h).not.toContain('<script>alert(1)');
    expect(h.match(/<script/g)).toHaveLength(1);
    expect(h).toContain('\\u003c/script>');
  });
  it('logo e foto solo https; con le foto vere la copertina le usa', () => {
    const foto = fotoDalNegozio(['http://a.it/x.jpg', { url: 'https://a.it/y.jpg' }, 'https://a.it/v.mp4']);
    expect(foto).toEqual(['https://a.it/y.jpg']);
    const h = paginaDelSito(dati({ logo: 'javascript:alert(1)', foto, contenuto: CONTENUTO }), '/')!;
    expect(h).not.toContain('javascript:');
    expect(h).toContain('<div class="vista con-foto"><img class="grande" src="https://a.it/y.jpg"');
  });
  it('senza telefono: niente «Chiama», in alto «Come arrivare»; senza orari niente «Aperto ora»', () => {
    const h = paginaDelSito(dati({ contenuto: CONTENUTO }), '/')!;
    expect(h).not.toContain('>Chiama<');
    expect(h).toMatch(/<header class="testata">[\s\S]*>Come arrivare<\/a>/);
    expect(h).not.toContain('class="stato');
  });
  it('l’armonia c’è: i token della firma, la trama muta al 6% solo sui bordi, la luna, ferma per chi chiede meno movimento', () => {
    const h = paginaDelSito(dati({ contenuto: CONTENUTO }), '/')!;
    expect(h).toMatch(/--armonia-tono:hsl\(/);
    expect(h).toMatch(/<svg class="trama" aria-hidden="true"/);
    expect(h).toMatch(/\.trama\{[^}]*opacity:\.06/);
    expect(h).toMatch(/mask-image:linear-gradient\(90deg,#000,transparent 8%,transparent 92%,#000\)/);
    expect(h).toMatch(/<svg class="luna" aria-hidden="true"/);
    expect(h).toContain('@media (prefers-reduced-motion:reduce){.entra{animation:none}');
  });
  it('il colore del marchio scelto dal negozio comanda sulla tavolozza', () => {
    expect(paginaDelSito(dati({ contenuto: CONTENUTO, colore: '#456236' }), '/')).toContain('--marchio:#456236');
  });
});

describe('la risposta dell’AD nella forma nuova', () => {
  const risposta = (contenuto: Record<string, unknown>) => ({
    sottotitolo: 'Bar rosa in Piazza Duomo',
    contenuto: {
      occhiello: CONTENUTO.occhiello, titolo: CONTENUTO.titolo, sottotitolo: CONTENUTO.sottotitolo, momenti_titolo: CONTENUTO.momentiTitolo, momenti_intro: CONTENUTO.momentiIntro,
      momenti: CONTENUTO.momenti, perche: CONTENUTO.perche, locale: CONTENUTO.locale, offerta: CONTENUTO.offerta, citta: CONTENUTO.citta,
      come_arrivare: CONTENUTO.comeArrivare, novita: CONTENUTO.novita, domande: CONTENUTO.domande, palette: 'rosa', ...contenuto,
    },
    da_confermare: [{ voce: 'Orari', perche: 'non li abbiamo' }], fonti: [], note: [],
  });
  it('passa, si salva col contenuto e con le pagine dello standard; novità e domande solo nel Premium', () => {
    const e = sitoDallaRisposta(risposta({}), 'business', 'Raquel 💗 Cafè');
    if (!e.ok) throw new Error(e.motivo);
    expect(e.sito.contenuto?.titolo).toBe('Il bar rosa di Piazza Duomo');
    expect(e.sito.contenuto?.novita).toBeNull();
    expect(e.sito.contenuto?.domande).toEqual([]);
    expect(e.sito.pagine.map((p) => p.percorso)).toEqual(['/', '/il-locale', '/cosa-offriamo', '/in-citta', '/contatti']);
    const p = sitoDallaRisposta(risposta({}), 'premium', 'Raquel 💗 Cafè');
    if (!p.ok) throw new Error(p.motivo);
    expect(p.sito.contenuto?.domande).toHaveLength(1);
  });
  it('un prezzo, un orario o un nome di persona nel contenuto: scartata intera', () => {
    expect(sitoDallaRisposta(risposta({ perche: [{ titolo: 'Prezzi bassi', testo: 'Il cappuccino costa 1,50 €.' }] }), 'business', 'Raquel').ok).toBe(false);
    expect(sitoDallaRisposta(risposta({ come_arrivare: 'Aperti dalle 7:00 alle 20:00 in Piazza Duomo.' }), 'business', 'Raquel').ok).toBe(false);
  });
  it('un disegno fuori lista diventa quello che va col titolo; una tavolozza sconosciuta diventa crema', () => {
    const e = sitoDallaRisposta(risposta({ momenti: [{ titolo: 'Colazione', testo: 'Caffè e brioche per cominciare.', disegno: 'astronave' }], palette: 'fucsia' }), 'base', 'Raquel');
    if (!e.ok) throw new Error(e.motivo);
    expect(e.sito.contenuto?.momenti[0].disegno).toBe('cornetto');
    expect(e.sito.contenuto?.palette).toBe('crema');
  });
});

describe('l’indirizzo del sito', () => {
  it('nome leggibile + le prime 8 cifre del negozio, emoji e accenti tolti', () => {
    expect(percorsoDelSito(SELLER, 'Raquel 💗 Cafè')).toBe('/sito/raquel-cafe-ffb27af9');
    expect(percorsoDelSito('non-un-uuid', 'Bar')).toBeNull();
    expect(leggiIndirizzo('raquel-cafe-ffb27af9')).toEqual({ nome: 'raquel-cafe', prefisso: 'ffb27af9' });
    expect(leggiIndirizzo('ffb27af9')).toEqual({ nome: '', prefisso: 'ffb27af9' });
    expect(leggiIndirizzo('raquel-cafe')).toBeNull();
    expect(leggiIndirizzo("x';drop")).toBeNull();
  });
  it('l’intervallo del prefisso contiene il negozio e solo i suoi vicini di prefisso', () => {
    const { da, a } = intervalloDelPrefisso('ffb27af9');
    expect(da <= SELLER && SELLER <= a).toBe(true);
    expect('ffb27afa-0000-0000-0000-000000000000' > a).toBe(true);
  });
});

// ———————————————————————————————— chi ha un sito online: la lettura dal database

type Risposta = { data: unknown; error: null | { message: string } };
const db: { ordini: Risposta; profilo: Risposta; filtri: string[] } = { ordini: { data: [], error: null }, profilo: { data: null, error: null }, filtri: [] };
const catena = (tabella: string) => {
  const c: Record<string, unknown> = {};
  const fine = () => (tabella === 'ordini_sdg' ? db.ordini : db.profilo);
  for (const m of ['select', 'gte', 'lte', 'eq', 'limit']) c[m] = (...a: unknown[]) => { db.filtri.push(`${tabella}.${m}(${a.join(',')})`); return c; };
  c.maybeSingle = async () => fine();
  c.then = (ok: (r: Risposta) => unknown) => Promise.resolve(fine()).then(ok);
  return c;
};
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => ({ from: (t: string) => catena(t) }) }));
const { leggiSitoDelCliente, eventiDelPiano } = await import('@/lib/agenzia/sito-finito/leggi');

const PIANO = { origine: 'ad', contenuti: [
  { data: '2026-12-13', inCitta: 'Manufatto in Piazza Duomo', fonteEvento: 'https://www.comune.piacenza.it/natale' },
  { data: '2026-12-06', inCitta: 'Mercati di Natale in Piazza Duomo', fonteEvento: 'https://www.comune.piacenza.it/natale' },
  { data: '2026-12-08', inCitta: 'Un evento senza fonte', fonteEvento: null },
] };
const ordine = (piu: Record<string, unknown> = {}) => ({ seller_id: SELLER, nome_attivita: 'Raquel 💗 Cafè', fascia: 'business', dati_attivita: { servizi: ['sito_web', 'social'], citta: 'Piacenza' }, sito: { fascia: 'business', sottotitolo: 'Caffetteria rosa', pagine: PAGINE_RAQUEL }, piano: PIANO, piano_origine: 'ad', ...piu });
const profilo = (piu: Record<string, unknown> = {}) => ({ id: SELLER, store_phone: null, store_address: 'Piazza Duomo, 23, 29121 Piacenza PC', store_logo: null, store_media: [], store_hours: null, store_customization: {}, is_approved: true, approval_status: 'approved', created_at: '2026-11-28T09:19:08Z', ...piu });

describe('leggiSitoDelCliente', () => {
  beforeEach(() => { db.ordini = { data: [ordine()], error: null }; db.profilo = { data: profilo(), error: null }; db.filtri = []; });
  it('ordine col sito pronto e il sito fra i servizi → online, con fascia, appuntamenti con la fonte e nessun colore imposto', async () => {
    const r = await leggiSitoDelCliente('raquel-cafe-ffb27af9');
    expect(r.stato).toBe('online');
    if (r.stato !== 'online') return;
    expect(r.dati.indirizzo).toBe('Piazza Duomo, 23, 29121 Piacenza PC');
    expect(r.dati.nascita).toBe('2026-11-28');
    expect(r.dati.base).toBe('/sito/raquel-cafe-ffb27af9');
    expect(r.dati.fascia).toBe('business');
    expect(r.dati.colore).toBeNull();
    expect(r.dati.eventi).toEqual([{ data: '2026-12-06', testo: 'Mercati di Natale in Piazza Duomo' }, { data: '2026-12-13', testo: 'Manufatto in Piazza Duomo' }]);
    expect(db.filtri).toContain('ordini_sdg.eq(sito_stato,pronto)');
  });
  it('il piano fatto dal sito (non dall’AD) non porta appuntamenti', () => {
    expect(eventiDelPiano(PIANO as never, 'sito')).toEqual([]);
  });
  it('il sito non è fra i servizi scelti → nessun sito', async () => {
    db.ordini = { data: [ordine({ dati_attivita: { servizi: ['social'] } })], error: null };
    expect((await leggiSitoDelCliente('raquel-cafe-ffb27af9')).stato).toBe('nessuno');
  });
  it('il negozio è sospeso o respinto → nessun sito (collaudo 28/11: il respinto restava online)', async () => {
    db.profilo = { data: profilo({ approval_status: 'suspended' }), error: null };
    expect((await leggiSitoDelCliente('raquel-cafe-ffb27af9')).stato).toBe('nessuno');
    db.profilo = { data: profilo({ approval_status: 'rejected' }), error: null };
    expect((await leggiSitoDelCliente('raquel-cafe-ffb27af9')).stato).toBe('nessuno');
  });
  it('logo e foto entrano solo dal nostro archivio Supabase, gli unici che la sicurezza del sito lascia vedere', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abc.supabase.co');
    db.profilo = { data: profilo({ store_logo: 'https://altro.it/logo.png', store_media: ['https://abc.supabase.co/storage/v1/object/public/a.jpg', 'https://altro.it/b.jpg'] }), error: null };
    const r = await leggiSitoDelCliente('raquel-cafe-ffb27af9');
    vi.unstubAllEnvs();
    if (r.stato !== 'online') throw new Error(r.stato);
    expect(r.dati.logo).toBeNull();
    expect(r.dati.foto).toEqual(['https://abc.supabase.co/storage/v1/object/public/a.jpg']);
  });
  it('nome vecchio nell’indirizzo → rimanda a quello giusto', async () => {
    expect(await leggiSitoDelCliente('caffe-rosa-ffb27af9')).toEqual({ stato: 'altrove', percorso: '/sito/raquel-cafe-ffb27af9' });
  });
  it('nessun ordine pronto, o il database che non risponde → nessun sito, mai un errore', async () => {
    db.ordini = { data: [], error: null };
    expect((await leggiSitoDelCliente('raquel-cafe-ffb27af9')).stato).toBe('nessuno');
    db.ordini = { data: null, error: { message: 'guasto' } };
    expect((await leggiSitoDelCliente('raquel-cafe-ffb27af9')).stato).toBe('nessuno');
  });
});

const { GET } = await import('@/app/sito/[indirizzo]/[[...pagina]]/route');
describe('la rotta /sito', () => {
  const chiedi = (indirizzo: string, pagina?: string[]) => GET(new Request(`https://www.mycity-marketplace.com/sito/${indirizzo}${pagina ? `/${pagina.join('/')}` : ''}`), { params: Promise.resolve({ indirizzo, pagina }) });
  beforeEach(() => { db.ordini = { data: [ordine()], error: null }; db.profilo = { data: profilo(), error: null }; });
  it('la home: 200, HTML, noindex', async () => {
    const r = await chiedi('raquel-cafe-ffb27af9');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/html');
    expect(r.headers.get('x-robots-tag')).toBe('noindex');
    expect(await r.text()).toContain('Raquel 💗 Cafè');
  });
  it('le pagine dello standard: 200; una pagina che non c’è o due livelli: 404', async () => {
    expect((await chiedi('raquel-cafe-ffb27af9', ['il-locale'])).status).toBe(200);
    expect((await chiedi('raquel-cafe-ffb27af9', ['contatti'])).status).toBe(200);
    expect((await chiedi('raquel-cafe-ffb27af9', ['menu'])).status).toBe(404);
    expect((await chiedi('raquel-cafe-ffb27af9', ['a', 'b'])).status).toBe(404);
  });
  it('le pagine del primo sito portano (308) a quelle nuove; il nome vecchio anche', async () => {
    const r = await chiedi('raquel-cafe-ffb27af9', ['chi-siamo']);
    expect(r.status).toBe(308);
    expect(r.headers.get('location')).toBe('https://www.mycity-marketplace.com/sito/raquel-cafe-ffb27af9/il-locale');
    const v = await chiedi('caffe-rosa-ffb27af9', ['dove-siamo']);
    expect(v.headers.get('location')).toBe('https://www.mycity-marketplace.com/sito/raquel-cafe-ffb27af9/contatti');
    const n = await chiedi('caffe-rosa-ffb27af9', ['cosa-offriamo']);
    expect(n.headers.get('location')).toBe('https://www.mycity-marketplace.com/sito/raquel-cafe-ffb27af9/cosa-offriamo');
  });
  it('senza sito: 404 che non resta in cache', async () => {
    db.ordini = { data: [], error: null };
    const r = await chiedi('raquel-cafe-ffb27af9');
    expect(r.status).toBe(404);
    expect(r.headers.get('cache-control')).toBe('no-store');
  });
});
