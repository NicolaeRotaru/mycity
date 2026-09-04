/**
 * Il pannello chiedeva un'immagine 16:9 e la fascia la mostrava a tre volte e mezzo a uno.
 *
 * IL CASO. Nicola apre il Home builder, aggiunge un banner, e sotto il campo dell'immagine legge
 * «Consigliato 16:9». Carica un 1600×900 con la vetrina del negozio al centro e la scritta sopra.
 * Pubblica. Sul computer la scritta non c'è più: la fascia era alta 288 punti dentro una larghezza
 * di 1232, cioè una fessura quattro volte più larga che alta, e dell'immagine restava la striscia
 * centrale — quasi il sessanta per cento dell'altezza buttato via. Sul telefono spariva invece
 * mezza larghezza.
 *
 * LA CAUSA, e non è l'altezza sbagliata: è che un'ALTEZZA FISSA dentro una larghezza che segue la
 * finestra non è una forma. È una forma diversa per ogni schermo — 328×224 su un telefono da 360,
 * 1488×288 su un monitor largo — e nessuna immagine può andare bene per tutte. Chi carica non aveva
 * modo di accorgersene prima di pubblicare, e il consiglio che leggeva era scritto a mano in un
 * altro file ancora.
 *
 * LA CURA. La fascia dichiara una proporzione, non un'altezza; il consiglio dato a chi carica nasce
 * dallo stesso file della proporzione; e le due fasce che esistono nel sito — quella della home e
 * quella delle pagine di contenuto — la prendono da lì tutte e due, perché erano due copie della
 * stessa riga e avevano già cominciato a divergere.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CLASSI_FASCIA_BANNER,
  CLASSI_TESTO_FASCIA_BANNER,
  CONSIGLIO_IMMAGINE_BANNER,
  FORMA_CONSIGLIATA_BANNER,
  MISURA_CONSIGLIATA_BANNER,
  PROPORZIONI_FASCIA_BANNER,
} from '@/lib/banner-vetrina';

const RADICE = process.cwd();
const leggi = (p: string) => readFileSync(join(RADICE, p), 'utf8');
const senzaCommenti = (src: string) =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');

/** Le proporzioni dichiarate, lette dalle classi vere: `aspect-[16/9]` → 16/9. */
function proporzioniDichiarate(classi: string): number[] {
  return [...classi.matchAll(/aspect-\[(\d+)\/(\d+)\]/g)].map(([, a, b]) => Number(a) / Number(b));
}

/** La misura consigliata, letta come numeri: «1600×600» → [1600, 600]. */
function misuraConsigliata(): [number, number] {
  const m = MISURA_CONSIGLIATA_BANNER.match(/(\d+)\s*[×x]\s*(\d+)/);
  expect(m, 'la misura consigliata non è leggibile come due numeri').not.toBeNull();
  return [Number(m![1]), Number(m![2])];
}

// ─────────────────────────────────────────────────────────────────────────────
// ① La fascia dichiara una forma, non un'altezza.
// ─────────────────────────────────────────────────────────────────────────────

describe('la fascia dichiara una proporzione, non un altezza fissa', () => {
  it("non c'è più nessuna altezza fissa nella fascia", () => {
    // `h-56 sm:h-72` era la forma vecchia: 224 e 288 punti dentro una larghezza libera.
    expect(CLASSI_FASCIA_BANNER, "la fascia ha ancora un'altezza fissa").not.toMatch(/\bh-\d+\b/);
    expect(CLASSI_FASCIA_BANNER).toContain('w-full');
  });

  it('le proporzioni dichiarate ci sono, e sono tutte orizzontali', () => {
    const forme = proporzioniDichiarate(PROPORZIONI_FASCIA_BANNER);
    expect(forme.length, 'nessuna proporzione dichiarata: la fascia non ha una forma').toBeGreaterThan(0);
    for (const f of forme) {
      expect(f, `una fascia alta più che larga (${f.toFixed(2)}) non è un banner`).toBeGreaterThan(1);
    }
  });

  it('sul telefono la fascia resta alta abbastanza per il testo che ci sta sopra', () => {
    // Il testo sovrapposto — titolo, sottotitolo, pulsante — chiede circa 137 punti con
    // l'imbottitura corta. Su uno schermo da 320 la fascia è larga 288 (tolti i 16 di margine per
    // lato): la proporzione più stretta non deve renderla più bassa di così, o il titolo esce
    // dall'alto e il ritaglio se lo mangia.
    const forme = proporzioniDichiarate(PROPORZIONI_FASCIA_BANNER);
    const piuStretta = Math.max(...forme.filter((f) => f <= 2)); // la fascia dei telefoni
    const larghezzaTelefono = 320 - 16 * 2;
    expect(larghezzaTelefono / piuStretta, 'sul telefono il testo non ci sta').toBeGreaterThanOrEqual(137);
    expect(CLASSI_TESTO_FASCIA_BANNER, "l'imbottitura del telefono non è quella corta").toContain('p-4');
  });

  it('sul monitor largo la fascia non si mangia lo schermo', () => {
    // Il contenitore arriva a 1488 punti. Con il 16:9 che il pannello chiedeva prima, la fascia
    // sarebbe alta 837: uno schermo intero prima del primo prodotto. È la ragione per cui una
    // proporzione sola non basta, e vale la pena che resti scritta in una prova.
    const forme = proporzioniDichiarate(PROPORZIONI_FASCIA_BANNER);
    const piuLarga = Math.max(...forme);
    expect(1488 / piuLarga, 'sul monitor largo la fascia è troppo alta').toBeLessThanOrEqual(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ② Il consiglio dato a chi carica dice la verità.
// ─────────────────────────────────────────────────────────────────────────────

describe('quello che il pannello chiede è quello che il sito fa', () => {
  it('la misura consigliata ha davvero la forma consigliata', () => {
    const [larghezza, altezza] = misuraConsigliata();
    const forma = FORMA_CONSIGLIATA_BANNER.match(/^(\d+):(\d+)$/);
    expect(forma, 'la forma consigliata non è scritta come «3:1»').not.toBeNull();
    const atteso = Number(forma![1]) / Number(forma![2]);
    expect(larghezza / altezza, `${MISURA_CONSIGLIATA_BANNER} non è ${FORMA_CONSIGLIATA_BANNER}`)
      .toBeCloseTo(atteso, 2);
  });

  it('chi carica la forma consigliata non perde più di un terzo dell immagine', () => {
    // QUESTO È IL DIFETTO, MISURATO. Con `object-cover` di un'immagine di forma `r` dentro un
    // riquadro di forma `b` resta sempre `min(r,b) / max(r,b)`: il resto lo taglia il bordo.
    //
    // Il pannello consigliava il 16:9. Sul riquadro più largo — 4:1 sul computer — di un 16:9
    // resta 1,78/4, cioè il 44%: più della metà dell'immagine buttata via, ed è esattamente quello
    // che Nicola vedeva. Un tetto sul ritaglio peggiore è la sola forma di questa prova che
    // diventa rossa se qualcuno rimette il consiglio di prima.
    const forme = proporzioniDichiarate(PROPORZIONI_FASCIA_BANNER);
    const [larghezza, altezza] = misuraConsigliata();
    const consigliata = larghezza / altezza;

    const perditaPeggiore = Math.max(
      ...forme.map((b) => 1 - Math.min(consigliata, b) / Math.max(consigliata, b)),
    );
    expect(
      perditaPeggiore,
      `consigliando ${MISURA_CONSIGLIATA_BANNER} si butta via il ${Math.round(perditaPeggiore * 100)}% dell'immagine sullo schermo peggiore`,
    ).toBeLessThanOrEqual(0.35);
  });

  it('e non esiste una forma che ne perda sensibilmente meno', () => {
    // Il tetto qui sopra da solo si potrebbe soddisfare per caso. Qui si cerca davvero il minimo,
    // provando ogni forma da 1:1 a 5:1 a passi di un centesimo: se la consigliata non è a un
    // soffio dalla migliore possibile, vuol dire che si sta chiedendo la forma sbagliata.
    const forme = proporzioniDichiarate(PROPORZIONI_FASCIA_BANNER);
    const perdita = (r: number) => Math.max(...forme.map((b) => 1 - Math.min(r, b) / Math.max(r, b)));
    let migliore = Infinity;
    for (let r = 1; r <= 5; r += 0.01) migliore = Math.min(migliore, perdita(r));

    const [larghezza, altezza] = misuraConsigliata();
    expect(
      perdita(larghezza / altezza) - migliore,
      `si può consigliare una forma che perde il ${Math.round(migliore * 100)}% invece del ${Math.round(perdita(larghezza / altezza) * 100)}%`,
    ).toBeLessThanOrEqual(0.02);
  });

  it('il consiglio avverte che il soggetto va tenuto al centro', () => {
    // La stessa immagine viene ritagliata in tre modi diversi: senza questa frase chi carica non
    // ha nessun modo di sapere che cosa perderà, ed è il pezzo che mancava del tutto.
    expect(CONSIGLIO_IMMAGINE_BANNER.toLowerCase()).toContain('centro');
    expect(CONSIGLIO_IMMAGINE_BANNER).toContain(FORMA_CONSIGLIATA_BANNER);
    expect(CONSIGLIO_IMMAGINE_BANNER).toContain(MISURA_CONSIGLIATA_BANNER);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ③ L'invariante sui tre file veri: nessuno scrive più la forma a mano.
// ─────────────────────────────────────────────────────────────────────────────

describe("l'invariante sui file veri", () => {
  const PUNTI: Array<[string, string]> = [
    ['la fascia della home', 'components/home-sections/HomeSectionRenderer.tsx'],
    ['la fascia delle pagine di contenuto', 'components/cms/CmsBlockRenderer.tsx'],
  ];

  for (const [nome, file] of PUNTI) {
    it(`${nome} prende la forma dal file unico`, () => {
      const src = senzaCommenti(leggi(file));
      expect(src, `${nome} non usa le classi dichiarate`).toContain('CLASSI_FASCIA_BANNER');
      expect(src, `${nome} ha ancora l'altezza fissa`).not.toMatch(/h-56 sm:h-72/);
    });
  }

  it('il pannello non scrive più il consiglio a mano', () => {
    // Era qui che nasceva la bugia: la frase «Consigliato 16:9» viveva in un file e la fascia in un
    // altro, e nessuno dei due sapeva dell'altro.
    const form = senzaCommenti(leggi('components/admin/home/HomeSectionConfigForm.tsx'));
    expect(form, 'il pannello consiglia ancora il 16:9 a mano').not.toContain('Consigliato 16:9');
    expect(form, 'il pannello non prende il consiglio dal file unico').toContain('CONSIGLIO_IMMAGINE_BANNER');
  });
});
