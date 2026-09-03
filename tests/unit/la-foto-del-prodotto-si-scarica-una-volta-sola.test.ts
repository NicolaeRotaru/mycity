/**
 * 3/9/2026 — LA FOTO GRANDE DELLA SCHEDA PRODOTTO SI SCARICAVA DUE VOLTE.
 *
 * ── Cosa succedeva ──────────────────────────────────────────────────────────────────────────
 * Il guscio della rotta gira sul server e scrive nell'HTML un precarico della foto principale, per
 * far partire il download insieme al JavaScript invece che dopo. Buona idea: la scheda è una
 * pagina del browser, e senza quella riga la foto parte per ultima.
 *
 * Ma il precarico chiedeva `sizedImage(foto, 'detail')`, cioè 800 pixel — e 800 non è una delle
 * larghezze che Next chiede. Con un `loader`, la larghezza la sceglie Next da una lista fissa
 * (640, 750, 828, 1080, …). Quindi il telefono scaricava il file da 800 del precarico e poi il
 * candidato vero del `srcSet`: due foto di prodotto, nel momento che decide se la pagina sembra
 * veloce. Su rete mobile è la voce che pesa di più sull'abbandono.
 *
 * ── Cosa prova questo file ──────────────────────────────────────────────────────────────────
 * Che l'indirizzo precaricato sia UNO DEI CANDIDATI che la pagina può davvero chiedere. Il conto
 * non è riscritto qui: si esegue lo stesso caricatore che usa l'immagine in pagina, con la stessa
 * stringa `sizes`, e si guarda se l'indirizzo del precarico compare fra i risultati.
 *
 * ⚠️ Cosa NON prova: che nel browser parta davvero una richiesta sola. Serve un giro con gli
 * strumenti di rete aperti su un telefono vero, e da qui non si può fare.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import caricatoreFotoRemote from '@/lib/image-loader';
import { sizedImage } from '@/lib/image-url';
import {
  LARGHEZZE_SCHERMO,
  SIZES_FOTO_PRODOTTO,
  larghezzeCandidate,
  precaricoFoto,
} from '@/lib/preload-foto';

/** Una foto di prodotto come quelle vere: un file dello storage Supabase. */
const FOTO = 'https://abcdefgh.supabase.co/storage/v1/object/public/products/pane-1.jpg';
const BASE = sizedImage(FOTO, 'detail');

/** Gli indirizzi che l'immagine in pagina può chiedere, con la sua stessa stringa `sizes`. */
const CANDIDATI = larghezzeCandidate(SIZES_FOTO_PRODOTTO).map((w) =>
  caricatoreFotoRemote({ src: BASE, width: w }),
);

describe('l’indirizzo precaricato è uno di quelli che la pagina chiede davvero', () => {
  const precarico = precaricoFoto(BASE);

  it('i candidati esistono (se no la prova non misura niente)', () => {
    expect(CANDIDATI.length).toBeGreaterThan(3);
    expect(CANDIDATI[0]).toMatch(/^https:\/\//);
  });

  it('800 pixel non è fra le larghezze che Next chiede: era quella del vecchio precarico', () => {
    expect(larghezzeCandidate(SIZES_FOTO_PRODOTTO)).not.toContain(800);
    expect(BASE, 'la misura «detail» vale 800: è l’indirizzo che veniva precaricato').toMatch(/800/);
    expect(
      CANDIDATI,
      'il vecchio precarico puntava a un indirizzo che nessuna richiesta della pagina produce',
    ).not.toContain(BASE);
  });

  it('l’indirizzo del precarico è un candidato vero', () => {
    expect(
      CANDIDATI,
      'il precarico punta a una misura che la pagina non chiederà: due file scaricati invece di uno',
    ).toContain(precarico.href);
  });

  it('e porta con sé lo stesso elenco di candidati e lo stesso riquadro', () => {
    expect(precarico.imageSizes).toBe(SIZES_FOTO_PRODOTTO);
    const nelSet = precarico.imageSrcSet.split(', ').map((v) => v.slice(0, v.lastIndexOf(' ')));
    expect(nelSet).toEqual(CANDIDATI);
  });

  it('ogni voce del set dichiara la larghezza che chiede davvero', () => {
    for (const voce of precarico.imageSrcSet.split(', ')) {
      const dichiarata = voce.slice(voce.lastIndexOf(' ') + 1);
      const chiesta = new URL(voce.slice(0, voce.lastIndexOf(' '))).searchParams.get('width');
      expect(`${chiesta}w`, `la voce «${voce}» promette una larghezza e ne chiede un'altra`).toBe(
        dichiarata,
      );
    }
  });
});

describe('le due parti leggono la stessa stringa, invece di riscriverla', () => {
  it('la pagina non riscrive più il riquadro a mano', () => {
    const src = readFileSync('app/product/[id]/page.tsx', 'utf8');
    expect(src).toContain('SIZES_FOTO_PRODOTTO');
    expect(
      src.match(/sizes="\(min-width/),
      'la pagina si è riscritta il proprio `sizes`: fra un mese sarà diverso da quello del precarico',
    ).toBeNull();
  });

  it('il guscio costruisce il precarico invece di indovinarlo', () => {
    const src = readFileSync('app/product/[id]/layout.tsx', 'utf8');
    // Il punto non e' che la parola compaia da qualche parte: e' che il valore passato al
    // `<link>` NASCA dalla funzione. Scritto a mano, l'indirizzo torna a essere un'ipotesi.
    const assegnazione = src.slice(src.indexOf('const primaFoto ='));
    const corpo = assegnazione.slice(0, assegnazione.indexOf(';') + 1);
    expect(corpo, 'l’indirizzo del precarico si trova più nel sorgente: la prova va riscritta').toBeTruthy();
    expect(corpo, 'l’indirizzo del precarico è tornato a essere costruito a mano').toContain(
      'precaricoFoto(',
    );
    expect(
      corpo,
      'un indirizzo scritto a mano è come si era rotto la prima volta: due file invece di uno',
    ).not.toMatch(/href\s*:/);
    // E il `<link>` prende TUTTI gli attributi da lì, non solo quelli che uno si ricorda.
    expect(
      src,
      'senza imagesrcset il browser sceglie un candidato diverso dall’immagine in pagina',
    ).toMatch(/<link rel="preload" as="image" \{\.\.\.primaFoto\}/);
  });
});

describe('la copia delle larghezze di Next non può invecchiare in silenzio', () => {
  it('next.config.js non dichiara le proprie: se lo facesse, la copia sarebbe vecchia', () => {
    const config = readFileSync('next.config.js', 'utf8');
    for (const chiave of ['deviceSizes', 'imageSizes']) {
      expect(
        new RegExp(`^\\s*${chiave}\\s*:`, 'm').test(config),
        `next.config.js ora dichiara ${chiave}: aggiorna lib/preload-foto.ts, o il precarico ` +
          'ricomincia a puntare a una misura che nessuno chiede',
      ).toBe(false);
    }
  });

  it('e la lista parte dalle misure predefinite di Next', () => {
    expect(LARGHEZZE_SCHERMO).toEqual([640, 750, 828, 1080, 1200, 1920, 2048, 3840]);
  });
});
