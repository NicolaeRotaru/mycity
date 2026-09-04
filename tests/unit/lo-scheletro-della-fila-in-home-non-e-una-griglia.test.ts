/**
 * In home la fila dei prodotti popolari caricava come griglia e poi diventava una riga.
 *
 * IL CASO, in tre gesti. Una persona apre la home dal telefono. Sotto l'hero compare un blocco di
 * dodici schede finte impilate a due per riga: sei righe, quasi un metro e mezzo di pagina. Comincia
 * a leggere. Arrivano i prodotti veri, e quelle dodici schede si stringono in UNA riga sola alta una
 * scheda: tutto quello che stava sotto risale di colpo di più di un metro. Chi aveva il dito su un
 * link tocca un'altra cosa.
 *
 * LA CAUSA. La griglia decideva due volte che forma avere, con due domande diverse:
 *
 *   · mentre carica  →  «sono una sezione?»  cioè fila **e** titolo
 *   · a dati arrivati →  «sono una fila?»
 *
 * In home il titolo lo scrive il renderer FUORI dal componente (`<ProductGrid limit={12} rail />`,
 * senza `title`), quindi la prima domanda rispondeva no e la seconda sì. Due risposte diverse alla
 * stessa domanda, e in mezzo la pagina che salta.
 *
 * PERCHÉ NON BASTAVA CAMBIARE `isSection` IN `rail` NEL RAMO DEL CARICAMENTO. Quella è la cura di
 * oggi. Domani qualcuno aggiunge un terzo ramo — una fila vuota, una fila in errore — e rifà la
 * scelta una terza volta, con una terza domanda. La cura è che la domanda sia UNA e che la forma
 * della fila sia scritta in un posto solo, dove tutti la prendono.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CASELLE_FINTE_FILA,
  CLASSI_CASELLA_FILA,
  CLASSI_FILA,
  DISTANZA_GRIGLIA,
} from '@/lib/griglia-prodotti';

const RADICE = process.cwd();
const senzaCommenti = (src: string) =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');

const GRIGLIA = senzaCommenti(readFileSync(join(RADICE, 'components/ProductGrid.tsx'), 'utf8'));

/** Il corpo del ramo che disegna lo scheletro, dal `if (isLoading)` al `return <SkeletonGrid`. */
function ramoDelCaricamento(): string {
  const da = GRIGLIA.indexOf('if (isLoading)');
  expect(da, 'non trovo il ramo del caricamento: la prova non misura niente').toBeGreaterThan(-1);
  const a = GRIGLIA.indexOf('<SkeletonGrid', da);
  expect(a, 'non trovo la fine del ramo del caricamento').toBeGreaterThan(da);
  return GRIGLIA.slice(da, a);
}

/** Il corpo del ramo che disegna le schede vere in fila. */
function ramoDeiDatiArrivati(): string {
  const da = GRIGLIA.indexOf('const railRow = (');
  expect(da, 'non trovo il ramo della fila vera: la prova non misura niente').toBeGreaterThan(-1);
  return GRIGLIA.slice(da, GRIGLIA.indexOf('classiGriglia(maxColumns)', da));
}

// ─────────────────────────────────────────────────────────────────────────────
// ① La forma della fila è dichiarata, e una sola.
// ─────────────────────────────────────────────────────────────────────────────

describe('la fila ha una forma sola, scritta in un posto solo', () => {
  it('il contenitore scorre in orizzontale e non manda niente a capo', () => {
    // `flex` senza `flex-wrap`: le schede restano su una riga. Se qualcuno ci mettesse una griglia,
    // la fila tornerebbe alta quanto tante righe.
    expect(CLASSI_FILA).toContain('flex');
    expect(CLASSI_FILA).not.toContain('flex-wrap');
    expect(CLASSI_FILA).not.toMatch(/grid-cols-\d/);
    expect(CLASSI_FILA).toContain('overflow-x-auto');
  });

  it('la distanza fra le caselle è la stessa della griglia, non un secondo numero', () => {
    expect(CLASSI_FILA).toContain(DISTANZA_GRIGLIA);
  });

  it('la casella ha una larghezza fissa e non si stringe', () => {
    // Senza `shrink-0` dodici schede dentro un contenitore flex si schiacciano fino a sparire.
    expect(CLASSI_CASELLA_FILA).toMatch(/\bw-\d+\b/);
    expect(CLASSI_CASELLA_FILA).toContain('shrink-0');
  });

  it('le caselle finte sono poche, e sono un numero dichiarato', () => {
    // In una fila orizzontale quello che sta oltre il bordo destro non spinge niente in basso:
    // il numero non cambia l'altezza della pagina. Dodici scheletri servivano solo a far
    // scaricare dodici animazioni.
    expect(CASELLE_FINTE_FILA).toBeGreaterThan(0);
    expect(CASELLE_FINTE_FILA).toBeLessThanOrEqual(8);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ② IL CASO: la home chiede una fila SENZA titolo. È lì che si rompeva.
// ─────────────────────────────────────────────────────────────────────────────

describe('la home chiede una fila senza titolo, ed è il caso che saltava', () => {
  const RENDERER = senzaCommenti(
    readFileSync(join(RADICE, 'components/home-sections/HomeSectionRenderer.tsx'), 'utf8'),
  );

  it("i prodotti popolari sono una fila e il titolo lo scrive il renderer, non la griglia", () => {
    // Se un domani questa chiamata guadagnasse un `title`, il difetto sparirebbe da solo e questa
    // prova non misurerebbe più il caso vero: allora va riscritta, non cancellata.
    const chiamata = RENDERER.match(/<ProductGrid\s[\s\S]{0,500}?\/>/);
    expect(chiamata, 'non trovo la fila dei prodotti popolari in home').not.toBeNull();
    expect(chiamata![0], 'la fila della home non è più una fila').toMatch(/\brail\b/);
    expect(chiamata![0], 'la fila della home ha un titolo: il caso è cambiato').not.toMatch(/\btitle=/);
  });

  it('lo scheletro sceglie la fila con la STESSA domanda del ramo dei dati', () => {
    const caricamento = ramoDelCaricamento();
    const arrivati = ramoDeiDatiArrivati();

    // Il cuore del fix: una domanda sola, `formaFila`, fatta due volte allo stesso modo.
    expect(caricamento, 'il ramo del caricamento non usa la domanda unica').toMatch(/if \(formaFila\)/);
    expect(GRIGLIA, 'il ramo dei dati non usa la domanda unica').toMatch(/if \(formaFila\) \{/);

    // E soprattutto: nessuno dei due chiede più «sono una sezione?» per decidere la FORMA.
    // `isSection` resta legittimo per decidere se stampare l'intestazione, non la forma.
    expect(caricamento, "il caricamento decide ancora la forma con «sono una sezione?»")
      .not.toMatch(/if \(isSection\)\s*\{/);
    expect(arrivati.length, 'non trovo il corpo della fila vera').toBeGreaterThan(0);
  });

  it('scheletro e schede vere usano lo stesso contenitore e la stessa casella', () => {
    // Erano due elenchi di classi copiati, e già divergevano: lo scheletro non aveva né lo
    // scorrimento né gli agganci. Due copie non restano uguali.
    const caricamento = ramoDelCaricamento();
    const arrivati = ramoDeiDatiArrivati();
    for (const [dove, testo] of [['caricamento', caricamento], ['dati arrivati', arrivati]] as const) {
      expect(testo, `il ramo «${dove}» scrive il contenitore a mano`).toContain('CLASSI_FILA');
      expect(testo, `il ramo «${dove}» scrive la casella a mano`).toContain('CLASSI_CASELLA_FILA');
      expect(testo, `il ramo «${dove}» ha ancora una larghezza scritta a mano`).not.toMatch(/className="w-\d+ shrink-0/);
    }
  });

  it("l'intestazione resta legata al titolo, non alla forma", () => {
    // La fila della home non ha titolo: se lo scheletro stampasse comunque un'intestazione vuota,
    // aggiungerebbe uno spazio che poi sparisce — cioè lo stesso difetto, più piccolo.
    expect(ramoDelCaricamento()).toContain('{isSection && sectionHeader}');
  });
});
