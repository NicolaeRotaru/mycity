import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 28/11/2026 — Nicola, verso le 14:10, sul test di Raquel Cafè: al sì del titolare «non mi è uscito il sito … deve
 * essere già su Vercel il sito del cliente che ha accettato». Prima usciva l'elenco dei testi con «da confermare».
 * Queste prove guardano il sito vero: pagine intere col menu, nessuna frase da bozza, i dati veri del negozio, la
 * firma dell'armonia, l'indirizzo che si trova, e la rotta che lo serve (e che non mostra chi non deve).
 */

// I testi veri che l'AD ha scritto per Raquel Cafè il 28/11 alle 13:29 (ordine 61b0a947, colonna `sito`).
const PAGINE_RAQUEL = [
  { titolo: 'Home', percorso: '/', sezioni: [
    { titolo: 'Benvenuti da Raquel Cafè', testo: 'Un bar rosa nel cuore di Piacenza, in Piazza Duomo. Qui trovate colazione, pranzo veloce e aperitivo, in un locale curato e facile da riconoscere.', stato: 'da_confermare' as const },
    { titolo: "Dalla colazione all'aperitivo", testo: "La giornata comincia con caffè e brioche. A pranzo c'è qualcosa di veloce. Verso sera arriva l'aperitivo, da gustare guardando la piazza.", stato: 'da_confermare' as const },
    { titolo: 'Passate a trovarci', testo: 'Siete in giro per il centro o in visita a Piacenza? Fermatevi da noi per una pausa. Orari: da confermare col titolare.', stato: 'da_confermare' as const },
  ] },
  { titolo: 'Chi siamo e cosa offriamo', percorso: '/chi-siamo', sezioni: [
    { titolo: 'Colazione e brioche', testo: "Al mattino trovate caffè e brioche per iniziare bene la giornata. L'elenco dei prodotti sarà confermato dal titolare prima della pubblicazione.", stato: 'da_confermare' as const },
    { titolo: 'Pranzo veloce', testo: 'Per chi ha poco tempo, proponiamo piatti semplici da gustare con calma o in fretta. Il menu del pranzo sarà inserito dopo la conferma col titolare.', stato: 'da_confermare' as const },
  ] },
  { titolo: 'Dove siamo e contatti', percorso: '/dove-siamo', sezioni: [
    { titolo: 'Come raggiungerci', testo: 'Siamo in Piazza Duomo, 23, a Piacenza. Il locale è proprio sulla piazza, a pochi passi dalla cattedrale, facile da trovare a piedi dal centro.', stato: 'da_confermare' as const },
    { titolo: 'Orari e contatti', testo: 'Orari di apertura: da confermare col titolare. Telefono: da confermare col titolare. Email e profili social: da confermare col titolare.', stato: 'da_confermare' as const },
  ] },
];

const SELLER = 'ffb27af9-ad17-42a5-8215-a7ad3dfe0224';

const { paginaDelSito, testoPubblico, paginePubbliche, fotoDalNegozio } = await import('@/lib/agenzia/sito-finito/costruisci');
const { percorsoDelSito, leggiIndirizzo, intervalloDelPrefisso } = await import('@/lib/agenzia/sito-finito/indirizzo');

const dati = (piu: Record<string, unknown> = {}) => ({
  nome: 'Raquel 💗 Cafè',
  sottotitolo: 'Caffetteria rosa in Piazza Duomo a Piacenza: colazione, pranzo veloce e aperitivo con vista sulla piazza.',
  citta: 'Piacenza',
  indirizzo: 'Piazza Duomo, 23, 29121 Piacenza PC',
  telefono: null,
  orari: null,
  social: [],
  logo: null,
  foto: [],
  colore: '#C0492C',
  vetrina: null,
  nascita: '2026-11-28',
  pagine: PAGINE_RAQUEL,
  base: '/sito/raquel-cafe-ffb27af9',
  ...piu,
});

describe('il sito finito: niente frasi da bozza', () => {
  it('toglie solo le frasi da bozza e tiene le altre', () => {
    expect(testoPubblico('Siete in giro per il centro o in visita a Piacenza? Fermatevi da noi per una pausa. Orari: da confermare col titolare.'))
      .toBe('Siete in giro per il centro o in visita a Piacenza? Fermatevi da noi per una pausa.');
    expect(testoPubblico("Il menu propone cocktail e aperitivo. Qui metteremo l'elenco dei drink e di cosa li accompagna, appena il titolare ce lo conferma.")).toBe('Il menu propone cocktail e aperitivo.');
    expect(testoPubblico('Un bar rosa nel cuore di Piacenza.')).toBe('Un bar rosa nel cuore di Piacenza.');
  });
  it('una sezione fatta solo di «da confermare» sparisce', () => {
    const p = paginePubbliche(PAGINE_RAQUEL);
    expect(p[2].sezioni.map((s) => s.titolo)).toEqual(['Come raggiungerci']);
  });
  it('nessuna pagina del sito di Raquel Cafè dice «da confermare», «titolare» o «pubblicazione»', () => {
    for (const percorso of ['/', '/chi-siamo', '/dove-siamo']) {
      const html = paginaDelSito(dati(), percorso)!;
      expect(html).toBeTruthy();
      expect(html).not.toMatch(/confermar|titolare|pubblicazion|metteremo/i);
    }
  });
});

describe('il sito finito: una pagina vera', () => {
  const casa = paginaDelSito(dati(), '/', Date.UTC(2026, 10, 28, 13))!;
  it('è un documento intero, in italiano, senza script, che Google non indicizza su questo indirizzo', () => {
    expect(casa.startsWith('<!doctype html>')).toBe(true);
    expect(casa).toContain('<html lang="it">');
    expect(casa).not.toMatch(/<script/i);
    expect(casa).toContain('<meta name="robots" content="noindex">');
  });
  it('ha il nome, la frase sotto, il menu con le tre pagine e la home senza la barra finale', () => {
    expect(casa).toContain('<h1>Raquel 💗 Cafè</h1>');
    expect(casa).toContain('Caffetteria rosa in Piazza Duomo');
    expect(casa).toContain('href="/sito/raquel-cafe-ffb27af9" aria-current="page"');
    expect(casa).toContain('href="/sito/raquel-cafe-ffb27af9/chi-siamo"');
    expect(casa).toContain('href="/sito/raquel-cafe-ffb27af9/dove-siamo"');
    expect(casa).not.toContain('href="/sito/raquel-cafe-ffb27af9/"');
  });
  it('porta a Maps dall’indirizzo vero; il telefono non c’è, quindi niente «Chiama»', () => {
    expect(casa).toContain('https://www.google.com/maps/search/?api=1&amp;query=');
    expect(casa).not.toContain('Chiama');
    const dove = paginaDelSito(dati(), '/dove-siamo')!;
    expect(dove).toContain('Come trovarci');
    expect(dove).toContain('Piazza Duomo, 23, 29121 Piacenza PC');
  });
  it('col telefono, gli orari e la vetrina del negozio, li mostra: dati veri, non inventati', () => {
    const dove = paginaDelSito(dati({ telefono: '0523 123456', orari: { mon: [['07:30', '19:30']], sun: [] }, vetrina: 'https://www.mycity-marketplace.com/store/x' }), '/dove-siamo')!;
    expect(dove).toContain('href="tel:0523123456"');
    expect(dove).toContain('<th scope="row">Lunedì</th><td>07:30–19:30</td>');
    expect(dove).toContain('<th scope="row">Domenica</th><td>Chiuso</td>');
    expect(dove).toContain('Ordina su MyCity');
  });
  it('l’armonia c’è: i token della firma, la trama muta al 6% nei margini, la luna', () => {
    expect(casa).toMatch(/--armonia-tono:hsl\(/);
    expect(casa).toMatch(/<svg class="trama" aria-hidden="true"/);
    expect(casa).toMatch(/\.trama\{[^}]*opacity:\.06/);
    expect(casa).toMatch(/mask-image:radial-gradient\(ellipse at center,transparent 38%/);
    expect(casa).toMatch(/<svg class="luna" aria-hidden="true"/);
    expect(casa).toContain('@media (prefers-reduced-motion:reduce){.sezione{animation:none}}');
  });
  it('un nome o un testo con codice dentro si scrive come testo, mai come codice', () => {
    const h = paginaDelSito(dati({ nome: 'Bar <script>alert(1)</script>', sottotitolo: '"><img src=x onerror=1>' }), '/')!;
    expect(h).not.toContain('<script>alert(1)</script>');
    expect(h).not.toContain('<img src=x');
    expect(h).toContain('&lt;script&gt;');
  });
  it('un logo o una foto che non è https non entra', () => {
    const h = paginaDelSito(dati({ logo: 'javascript:alert(1)', foto: fotoDalNegozio(['http://a.it/x.jpg', { url: 'https://a.it/y.jpg' }, 'https://a.it/v.mp4']) }), '/')!;
    expect(h).not.toContain('javascript:');
    expect(h).not.toContain('http://a.it/x.jpg');
    expect(h).toContain('https://a.it/y.jpg');
    expect(h).not.toContain('v.mp4');
  });
  it('una pagina che non c’è → null (la rotta risponde 404)', () => {
    expect(paginaDelSito(dati(), '/menu')).toBeNull();
  });
  it('col Base (una pagina sola) i contatti stanno nella home', () => {
    const h = paginaDelSito(dati({ pagine: [PAGINE_RAQUEL[0]] }), '/')!;
    expect(h).toContain('Come trovarci');
    expect(h).not.toContain('<nav');
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
const { leggiSitoDelCliente } = await import('@/lib/agenzia/sito-finito/leggi');

const ordine = (piu: Record<string, unknown> = {}) => ({ seller_id: SELLER, nome_attivita: 'Raquel 💗 Cafè', dati_attivita: { servizi: ['sito_web', 'social'], citta: 'Piacenza' }, sito: { sottotitolo: 'Caffetteria rosa', pagine: PAGINE_RAQUEL }, ...piu });
const profilo = (piu: Record<string, unknown> = {}) => ({ id: SELLER, store_phone: null, store_address: 'Piazza Duomo, 23, 29121 Piacenza PC', store_logo: null, store_media: [], store_hours: null, store_customization: {}, is_approved: true, approval_status: 'approved', created_at: '2026-11-28T09:19:08Z', ...piu });

describe('leggiSitoDelCliente', () => {
  beforeEach(() => { db.ordini = { data: [ordine()], error: null }; db.profilo = { data: profilo(), error: null }; db.filtri = []; });
  it('ordine col sito pronto e il sito fra i servizi → online, coi dati del negozio', async () => {
    const r = await leggiSitoDelCliente('raquel-cafe-ffb27af9');
    expect(r.stato).toBe('online');
    if (r.stato !== 'online') return;
    expect(r.dati.indirizzo).toBe('Piazza Duomo, 23, 29121 Piacenza PC');
    expect(r.dati.nascita).toBe('2026-11-28');
    expect(r.dati.base).toBe('/sito/raquel-cafe-ffb27af9');
    expect(db.filtri).toContain('ordini_sdg.eq(sito_stato,pronto)');
  });
  it('il sito non è fra i servizi scelti → nessun sito', async () => {
    db.ordini = { data: [ordine({ dati_attivita: { servizi: ['social'] } })], error: null };
    expect((await leggiSitoDelCliente('raquel-cafe-ffb27af9')).stato).toBe('nessuno');
  });
  it('il negozio è sospeso → nessun sito', async () => {
    db.profilo = { data: profilo({ approval_status: 'suspended' }), error: null };
    expect((await leggiSitoDelCliente('raquel-cafe-ffb27af9')).stato).toBe('nessuno');
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
  it('la home: 200, HTML, noindex, la vetrina MyCity perché il negozio è approvato', async () => {
    const r = await chiedi('raquel-cafe-ffb27af9');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/html');
    expect(r.headers.get('x-robots-tag')).toBe('noindex');
    const html = await r.text();
    expect(html).toContain('Raquel 💗 Cafè');
  });
  it('un’altra pagina: 200; una pagina che non c’è o due livelli: 404', async () => {
    expect((await chiedi('raquel-cafe-ffb27af9', ['dove-siamo'])).status).toBe(200);
    expect((await chiedi('raquel-cafe-ffb27af9', ['menu'])).status).toBe(404);
    expect((await chiedi('raquel-cafe-ffb27af9', ['a', 'b'])).status).toBe(404);
  });
  it('il nome vecchio rimanda (308) alla stessa pagina col nome giusto', async () => {
    const r = await chiedi('caffe-rosa-ffb27af9', ['chi-siamo']);
    expect(r.status).toBe(308);
    expect(r.headers.get('location')).toBe('https://www.mycity-marketplace.com/sito/raquel-cafe-ffb27af9/chi-siamo');
  });
  it('senza sito: 404 che non resta in cache', async () => {
    db.ordini = { data: [], error: null };
    const r = await chiedi('raquel-cafe-ffb27af9');
    expect(r.status).toBe(404);
    expect(r.headers.get('cache-control')).toBe('no-store');
  });
});
