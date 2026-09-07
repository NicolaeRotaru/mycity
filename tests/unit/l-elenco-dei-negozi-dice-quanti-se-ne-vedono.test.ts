/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { monta } from './aiuti/monta-componente';
import { accendi, clicca } from './aiuti/schermo';

/**
 * 6/9/2026 — LA PAGINA «TUTTI I NEGOZI» DICEVA UN NUMERO E NE MOSTRAVA UN ALTRO.
 *
 * Tre difetti nello stesso punto, tutti e tre visibili a schermo:
 *
 * ① La riga sotto il titolo stampava il TOTALE dei negozi letti, mentre la griglia
 *    sotto mostrava quelli rimasti dopo i filtri. Con «Aperti ora» acceso di sera la
 *    pagina continuava a dichiarare «12 negozi» sopra una griglia vuota.
 *
 * ② Era l'unica vetrina senza briciolo di pane: «Novita'», «Piu' venduti», «Vicino a
 *    te» e le categorie hanno tutte la scaletta «Home › …» per risalire; qui
 *    l'intestazione era scritta a mano e non offriva nessuna via d'uscita.
 *
 * ③ Il filtro «Aperti ora», da acceso, era testo bianco su olive-500: 3,69 contro il
 *    4,5 che WCAG 2.1 (1.4.3, livello AA) chiede a un testo.
 *
 * Queste prove montano la pagina vera e la usano come la userebbe una persona: leggono
 * la riga del conteggio, premono il filtro, e guardano cosa cambia.
 */

const negozio = (id: string, nome: string) => ({
  id,
  store_name: nome,
  store_phone: null,
  store_address: 'Via Roma 1',
  store_lat: null,
  store_lng: null,
  store_logo: null,
  // Orari vuoti = nessun negozio risulta aperto: premendo «Aperti ora» la griglia si svuota.
  store_hours: {},
  store_media: null,
  is_approved: true,
  stripe_charges_enabled: true,
  stripe_payouts_enabled: true,
});

const TRE_NEGOZI = {
  stores: [negozio('n1', 'Pane Quotidiano'), negozio('n2', 'Fiori di Piazza'), negozio('n3', 'Bottega Verde')],
  productsByStore: {},
  reviewsByStore: {},
  countByStore: { n1: 3, n2: 1, n3: 2 },
  categoriesByStore: {},
  categories: [],
};

/** La riga del conteggio: il paragrafo subito sotto l'intestazione della vetrina. */
function conteggio(radice: HTMLElement): string {
  return (radice.querySelector('header + p')?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Il pulsante «Aperti ora», cercato per il testo che si legge. */
function filtroApertiOra(radice: HTMLElement): HTMLElement {
  const b = Array.from(radice.querySelectorAll('button')).find((x) =>
    (x.textContent ?? '').includes('Aperti ora'),
  );
  if (!b) throw new Error('il filtro «Aperti ora» non c e piu');
  return b as HTMLElement;
}

/** Contrasto WCAG fra due colori esadecimali. */
function contrasto(a: string, b: string): number {
  const lum = (hex: string) => {
    const canali = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * canali[0] + 0.7152 * canali[1] + 0.0722 * canali[2];
  };
  const [alto, basso] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (alto + 0.05) / (basso + 0.05);
}

const RADICE = path.resolve(__dirname, '../..');
const SORGENTE_PAGINA = readFileSync(path.join(RADICE, 'app/stores/page.tsx'), 'utf8');

/** Il verde `olive-N` come sta scritto nella tavolozza del brand. */
function oliveDaTavolozza(tono: string): string {
  const config = readFileSync(path.join(RADICE, 'tailwind.config.ts'), 'utf8');
  const blocco = config.match(/olive:\s*\{([^}]*)\}/)?.[1] ?? '';
  const colore = blocco.match(new RegExp(`${tono}:\\s*'(#[0-9A-Fa-f]{6})'`))?.[1];
  if (!colore) throw new Error(`olive-${tono} non e nella tavolozza`);
  return colore;
}

describe('la pagina «Tutti i negozi»', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).__DATI_QUERY__ = TRE_NEGOZI;
  });

  it('IL CASO CHE ROMPEVA — col filtro acceso il conteggio segue i negozi che si vedono', async () => {
    const mod = await monta('app/stores/page.tsx');
    const s = accendi(mod.default, {});

    expect(conteggio(s.radice), 'senza filtri la riga dice quanti negozi ci sono').toBe(
      '3 negozi locali pronti a consegnarti a casa',
    );

    s.agisci(() => clicca(filtroApertiOra(s.radice)));

    const dopo = conteggio(s.radice);
    const schede = s.radice.querySelectorAll('a[href^="/store/"], article').length;
    expect(
      dopo,
      `a schermo restano ${schede} negozi ma la riga dice «${dopo}»: la pagina dichiara un numero e ne mostra un altro`,
    ).toBe('0 negozi su 3');

    s.smonta();
  });

  it('c e la scaletta per tornare indietro, come sulle altre vetrine', async () => {
    const mod = await monta('app/stores/page.tsx');
    const s = accendi(mod.default, {});

    const scaletta = s.radice.querySelector('nav[aria-label="Breadcrumb"]');
    expect(scaletta, 'la pagina dei negozi non offre nessuna scala per risalire alla home').not.toBeNull();

    const casa = scaletta?.querySelector('a[href="/"]');
    expect(casa?.textContent).toBe('Home');
    expect(scaletta?.querySelector('[aria-current="page"]')?.textContent).toBe('Negozi');

    s.smonta();
  });

  it('il filtro «Aperti ora», da acceso, si legge: bianco su verde con contrasto da testo', async () => {
    const mod = await monta('app/stores/page.tsx');
    const s = accendi(mod.default, {});

    const bottone = filtroApertiOra(s.radice);
    s.agisci(() => clicca(bottone));

    expect(bottone.getAttribute('aria-pressed'), 'il filtro non risulta acceso').toBe('true');
    expect(bottone.className, 'da acceso il filtro deve essere testo bianco').toContain('text-white');

    const tono = bottone.className.match(/bg-olive-(\d+)/)?.[1];
    expect(tono, 'lo sfondo del filtro acceso non e piu un verde della tavolozza').toBeTruthy();

    const rapporto = contrasto(oliveDaTavolozza(tono as string), '#FFFFFF');
    expect(
      Number(rapporto.toFixed(2)),
      `bianco su olive-${tono} misura ${rapporto.toFixed(2)}:1, sotto il 4,5:1 che WCAG chiede a un testo`,
    ).toBeGreaterThanOrEqual(4.5);

    s.smonta();
  });

  it('l elenco dei negozi ha un tetto scritto, non quello a sorpresa di PostgREST', () => {
    // Prova sul sorgente: la lettura vera parte solo dentro react-query, che in queste
    // prove e' sostituita dai dati finti qui sopra. Quello che si puo' provare da qui e'
    // che nessuna delle due letture della vista dei negozi parta senza un tetto.
    expect(SORGENTE_PAGINA).toMatch(/const TETTO_NEGOZI = \d+;/);
    const letture = SORGENTE_PAGINA.match(/from\('seller_public_profiles'\)[\s\S]{0,320}?\)[,;]/g) ?? [];
    expect(letture.length, 'le letture della vista dei negozi non sono piu due').toBe(2);
    for (const lettura of letture) {
      expect(lettura, `una lettura dei negozi non ha nessun tetto: ${lettura}`).toContain('.limit(TETTO_NEGOZI)');
    }
  });
});
