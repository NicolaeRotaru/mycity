/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { act, createElement, Suspense } from 'react';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi, attendi, clicca } from './aiuti/schermo';
import { databaseDellaVetrina, OGGI, DOPO, type Dati, type MondoVetrina } from './aiuti/database-della-vetrina';

/**
 * 18/10/2026 — STORIE, DROP DEL GIORNO ED EVENTI, MONTATI DAVVERO, CON LA TABELLA DEI PROFILI CHIUSA.
 *
 * Le migrazioni 110, 112 e 161 (fra le 48 che mancano in produzione) chiudono la lettura di
 * `profiles`: dopo, ognuno legge solo la propria riga. Quattro pezzi della vetrina ci agganciavano
 * il negozio:
 *  · le storie in home: bolle senza logo e senza nome, il visualizzatore senza «di chi»;
 *  · le storie dalla pagina del negozio: il visualizzatore senza insegna e senza link;
 *  · il Drop del giorno: sparito «· da [negozio]»;
 *  · gli eventi: sparito il nome dello sponsor.
 *
 * Qui ogni pezzo si MONTA. Le letture scritte dentro il componente girano contro un database
 * finto che applica le regole di chi guarda, nei due mondi (oggi e dopo le migrazioni), per un
 * visitatore, un cliente e un negoziante; poi il componente si ridisegna con quelle risposte e si
 * guarda il testo a schermo. Se un pezzo torna ad agganciare il negozio a `profiles`, nel mondo
 * «dopo» il nome del negozio sparisce e la prova diventa rossa.
 *
 * E si prova la regola nuova delle storie e del drop: quello di un negozio che la vista pubblica
 * non restituisce (non approvato, senza insegna) non si mostra — prima compariva con «?» e «—».
 */

const PANE = 'n-pane';
const FIORI = 'n-fiori';
const SEGRETA = 'n-segreta';
const SENZA_INSEGNA = 'n-senza-insegna';
const MARIA = 'u-maria';

const DOMANI = new Date(Date.now() + 86_400_000).toISOString();
const IERI = new Date(Date.now() - 86_400_000).toISOString();
const OGGI_DATA = new Date().toISOString().slice(0, 10);

function dati(dropDi: string = PANE): Dati {
  const prodottoDelDrop: Record<string, string> = { [PANE]: 'p-focaccia', [SENZA_INSEGNA]: 'p-anonimo', [SEGRETA]: 'p-segreto' };
  return {
    profiles: [
      { id: PANE, role: 'seller', is_approved: true, store_name: 'Pane Quotidiano', store_logo: 'logo-pane.png' },
      { id: FIORI, role: 'seller', is_approved: true, store_name: 'Fiori di Ada', store_logo: null },
      { id: SEGRETA, role: 'seller', is_approved: false, store_name: 'Bottega Segreta', store_logo: 'logo-segreta.png' },
      { id: SENZA_INSEGNA, role: 'seller', is_approved: true, store_name: null },
      { id: MARIA, role: 'buyer', is_approved: false, store_name: null, full_name: 'Maria Rossi' },
    ],
    products: [
      { id: 'p-focaccia', name: 'Focaccia al rosmarino', description: 'Lievitata 24 ore', price: 4.5, images: ['f.jpg'], seller_id: PANE, status: 'available' },
      { id: 'p-anonimo', name: 'Biscotti senza insegna', description: null, price: 3, images: null, seller_id: SENZA_INSEGNA, status: 'available' },
      { id: 'p-segreto', name: 'Panettone segreto', description: null, price: 19.9, images: null, seller_id: SEGRETA, status: 'available' },
    ],
    seller_stories: [
      { id: 's-pane', seller_id: PANE, image_url: 'storia-pane.jpg', caption: 'Pane appena sfornato', link_url: null, view_count: 3, expires_at: DOMANI, created_at: '2026-10-18T08:00:00Z' },
      { id: 's-fiori', seller_id: FIORI, image_url: 'storia-fiori.jpg', caption: null, link_url: null, view_count: 0, expires_at: DOMANI, created_at: '2026-10-18T07:00:00Z' },
      { id: 's-segreta', seller_id: SEGRETA, image_url: 'storia-segreta.jpg', caption: null, link_url: null, view_count: 0, expires_at: DOMANI, created_at: '2026-10-18T09:00:00Z' },
      { id: 's-senza', seller_id: SENZA_INSEGNA, image_url: 'storia-senza.jpg', caption: null, link_url: null, view_count: 0, expires_at: DOMANI, created_at: '2026-10-18T06:00:00Z' },
      { id: 's-vecchia', seller_id: PANE, image_url: 'vecchia.jpg', caption: 'Scaduta', link_url: null, view_count: 0, expires_at: IERI, created_at: '2026-10-16T08:00:00Z' },
    ],
    daily_drops: [
      { id: 'd-1', drop_date: OGGI_DATA, discount_percent: 30, original_price: 10, drop_price: 7, headline: 'Il drop di oggi', product_id: prodottoDelDrop[dropDi] },
    ],
    marketplace_events: [
      { id: 'e-pane', title: 'Mercatino del sabato', description: 'In piazza Cavalli', cover_image_url: null, starts_at: DOMANI, ends_at: DOMANI, discount_percent: null, cta_label: 'Partecipa', cta_url: null, status: 'scheduled', sponsor_seller_id: PANE },
      { id: 'e-segreta', title: 'Notte dei dolci', description: 'Assaggi', cover_image_url: null, starts_at: DOMANI, ends_at: DOMANI, discount_percent: null, cta_label: 'Partecipa', cta_url: null, status: 'scheduled', sponsor_seller_id: SEGRETA },
      { id: 'e-libero', title: 'Flash sale di città', description: 'Tutti i negozi', cover_image_url: null, starts_at: DOMANI, ends_at: DOMANI, discount_percent: 10, cta_label: 'Partecipa', cta_url: null, status: 'scheduled', sponsor_seller_id: null },
    ],
  };
}

const MONDI: Array<[string, MondoVetrina]> = [[OGGI.nome, OGGI], [DOPO.nome, DOPO]];
const CHI: Array<[string, string | null]> = [['visitatore', null], ['cliente', MARIA], ['negoziante non approvato', SEGRETA]];
const CASI = MONDI.flatMap(([m, mondo]) => CHI.map(([c, chi]) => [`${m} · ${c}`, mondo, chi] as const));
const CASI_DOPO = CHI.map(([c, chi]) => [`${DOPO.nome} · ${c}`, chi] as const);

const globale = globalThis as Record<string, unknown>;
type Opzioni = { queryKey: readonly unknown[]; queryFn?: (c: unknown) => Promise<unknown>; enabled?: boolean };

/**
 * Monta il componente, esegue le letture che il componente stesso chiede, lo ridisegna con le
 * risposte e lo restituisce acceso. Le letture sono quelle scritte DENTRO il componente.
 */
async function acceso(
  file: string,
  props: Record<string, unknown>,
  mondo: MondoVetrina,
  chi: string | null,
  d: Dati = dati(),
  tabellaGuasta?: string,
) {
  const componente = (await monta(file)).default;
  globale.__CLIENT_SUPABASE__ = databaseDellaVetrina(d, mondo, chi, { tabellaGuasta }).client;
  globale.__UTENTE__ = chi ? { id: chi } : null;

  const risposte = new Map<string, unknown>();
  const chieste = new Map<string, Opzioni>();
  globale.__DATI_QUERY__ = (o: Opzioni) => {
    const k = JSON.stringify(o.queryKey);
    if (!risposte.has(k)) chieste.set(k, o);
    return risposte.get(k);
  };
  const disegna = () => accendi(() => createElement(Suspense, { fallback: null }, createElement(componente as never, props)));

  for (let giro = 0; giro < 4; giro += 1) {
    const s = disegna();
    await attendi();
    s.smonta();
    const nuove = [...chieste.entries()].filter(([k]) => !risposte.has(k));
    if (nuove.length === 0) break;
    for (const [k, o] of nuove) {
      risposte.set(k, o.enabled === false || !o.queryFn ? undefined : await o.queryFn({ queryKey: o.queryKey, meta: undefined }));
    }
  }
  const s = disegna();
  await attendi();
  return s;
}

afterEach(() => {
  for (const k of ['__CLIENT_SUPABASE__', '__UTENTE__', '__DATI_QUERY__']) delete globale[k];
  document.body.innerHTML = '';
});

describe('le storie dei negozi in home', () => {
  it.each(CASI)('si vedono col nome del negozio, e solo quelle dei negozi in vetrina — %s', async (_n, mondo, chi) => {
    const s = await acceso('components/home/StoriesCarousel.tsx', {}, mondo, chi);
    const bolle = Array.from(s.radice.querySelectorAll('button')).map((b) => testoVisibile(b));
    s.smonta();

    // «F» è l'iniziale disegnata al posto del logo, per il negozio che il logo non ce l'ha.
    expect(bolle, 'le bolle delle storie hanno perso il nome del negozio').toEqual(['Pane Quotidiano', 'F Fiori di Ada']);
  });

  it.each(CASI_DOPO)('aperta una storia, il visualizzatore dice di chi è e porta al negozio — %s', async (_n, chi) => {
    const s = await acceso('components/home/StoriesCarousel.tsx', {}, DOPO, chi);
    const prima = s.radice.querySelector('button');
    expect(prima, 'nessuna storia a schermo').toBeTruthy();
    await act(async () => { clicca(prima as Element); });

    const link = Array.from(document.querySelectorAll('a')).find((a) => a.getAttribute('href') === `/store/${PANE}`);
    expect(link, 'il visualizzatore non porta al negozio').toBeTruthy();
    expect(testoVisibile(link as Element)).toBe('Pane Quotidiano');
    s.smonta();
  });
});

describe('le storie aperte dalla pagina del negozio', () => {
  it.each(CASI)('il visualizzatore ha insegna e link del negozio — %s', async (_n, mondo, chi) => {
    const props = { sellerId: PANE, logoUrl: 'logo-pane.png', storeName: 'Pane Quotidiano' };
    const s = await acceso('components/StoreStoryRing.tsx', props, mondo, chi);
    const anello = s.radice.querySelector('button[aria-label="Guarda le storie di Pane Quotidiano"]');
    expect(anello, 'l\'anello delle storie non c\'è: la storia del negozio non è stata letta').toBeTruthy();
    await act(async () => { clicca(anello as Element); });

    const link = Array.from(document.querySelectorAll('a')).find((a) => a.getAttribute('href') === `/store/${PANE}`);
    expect(link, 'il visualizzatore non dice di chi è la storia').toBeTruthy();
    expect(testoVisibile(link as Element)).toBe('Pane Quotidiano');
    s.smonta();
  });
});

describe('il Drop del giorno', () => {
  it.each(CASI)('dice da quale negozio arriva — %s', async (_n, mondo, chi) => {
    const s = await acceso('components/home/DropOfDay.tsx', {}, mondo, chi);
    const testo = testoVisibile(s.radice);
    s.smonta();

    expect(testo).toContain('Il drop di oggi');
    expect(testo, 'il drop ha perso il nome del negozio').toContain('da Pane Quotidiano');
  });

  it.each(MONDI)('un drop di un negozio che la vetrina non mostra non si vede — %s', async (_n, mondo) => {
    const s = await acceso('components/home/DropOfDay.tsx', {}, mondo, null, dati(SENZA_INSEGNA));
    const testo = testoVisibile(s.radice);
    s.smonta();

    expect(testo, 'il drop di un negozio senza insegna è in vetrina').not.toContain('Il drop di oggi');
  });
});

describe('la pagina Eventi', () => {
  it.each(CASI)('nomina lo sponsor, e tiene gli eventi senza uno sponsor in vetrina — %s', async (_n, mondo, chi) => {
    const s = await acceso('app/events/page.tsx', {}, mondo, chi);
    const testo = testoVisibile(s.radice);
    s.smonta();

    expect(testo, 'l\'evento ha perso il nome dello sponsor').toContain('Sponsor: Pane Quotidiano');
    expect(testo).toContain('Notte dei dolci');
    expect(testo).toContain('Flash sale di città');
    expect(testo, 'compare uno sponsor che la vetrina non mostra').not.toContain('Bottega Segreta');
  });

  it('se la vista dei negozi non risponde, gli eventi si vedono lo stesso, senza sponsor', async () => {
    const s = await acceso('app/events/page.tsx', {}, DOPO, null, dati(), 'seller_public_profiles');
    const testo = testoVisibile(s.radice);
    s.smonta();

    expect(testo, 'un guasto sul nome dello sponsor ha svuotato la pagina Eventi').toContain('Mercatino del sabato');
    expect(testo).toContain('Flash sale di città');
    expect(testo).not.toContain('Sponsor:');
  });
});
