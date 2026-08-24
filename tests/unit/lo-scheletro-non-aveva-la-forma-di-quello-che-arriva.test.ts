/**
 * Lo scheletro del caricamento non aveva la forma di quello che stava arrivando.
 *
 * Uno scheletro serve a una cosa sola: **tenere il posto** della forma che arriva. Se ha una forma
 * diversa non tiene il posto, lo sposta — ed è peggio di non averlo, perché promette una pagina e
 * ne consegna un'altra proprio mentre la persona sta leggendo.
 *
 * Due divergenze, misurate il 24/8 col file davanti:
 *
 * · **Le colonne.** Lo scheletro si fermava a quattro (`grid-cols-2 sm:3 md:4`), la griglia vera su
 *   schermo grande ne apre sei (`… lg:5 xl:6`). Appena arrivavano i prodotti la pagina si
 *   riorganizzava tutta, da quattro colonne a sei.
 * · **La foto.** Lo scheletro usava un'altezza fissa (`h-48`, 192 punti), la scheda vera un quadrato
 *   — alto quanto è largo. Su un telefono a due colonne quel quadrato è circa 180, su uno schermo a
 *   sei colonne circa 200. Non coincideva quasi mai.
 *
 * La causa è una sola: due elenchi di classi scritti a mano in due file diversi. La cura è che ce ne
 * sia uno, e che lo scheletro e la griglia vera chiedano a quello.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classiGriglia, DISTANZA_GRIGLIA, PROPORZIONE_FOTO } from '@/lib/griglia-prodotti';

const RADICE = process.cwd();
const senzaCommenti = (src: string) =>
  src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('le colonne della griglia sono una cosa sola', () => {
  it('la scala piena arriva a sei colonne', () => {
    const c = classiGriglia();
    expect(c).toContain('xl:grid-cols-6');
    expect(c).toContain('lg:grid-cols-5');
  });

  it('le pagine collezione si fermano a quattro, come prima', () => {
    const c = classiGriglia(4);
    expect(c).toContain('md:grid-cols-4');
    expect(c).not.toContain('lg:grid-cols-5');
    expect(c).not.toContain('xl:grid-cols-6');
  });

  it('«default» e «niente» sono la stessa cosa: nessuno resta indietro per distrazione', () => {
    expect(classiGriglia('default')).toBe(classiGriglia(undefined));
  });

  it('la distanza fra le schede è dichiarata, e la stessa in tutt e due i casi', () => {
    // Era `gap-4` nello scheletro e `gap-3` nella pagina promozioni: due passi diversi fra le
    // schede, quindi due altezze diverse della griglia.
    //
    // Si cerca la classe VERA nell'uscita, non la costante: `toContain(DISTANZA_GRIGLIA)` passava
    // anche con la costante vuota, perché ogni stringa contiene la stringa vuota. Una riga che non
    // può diventare rossa non è una prova — provata rompendola.
    const gapPiena = classiGriglia().match(/\bgap-\d+\b/);
    const gapQuattro = classiGriglia(4).match(/\bgap-\d+\b/);
    expect(gapPiena, 'la griglia piena non dichiara nessuna distanza').not.toBeNull();
    expect(gapQuattro, 'la griglia a quattro colonne non dichiara nessuna distanza').not.toBeNull();
    expect(gapPiena![0]).toBe(gapQuattro![0]);
    expect(gapPiena![0]).toBe(DISTANZA_GRIGLIA);
  });
});

describe("l'invariante di STRUTTURA sui file veri", () => {
  const scheletro = senzaCommenti(readFileSync(join(RADICE, 'components/SkeletonCard.tsx'), 'utf8'));
  const griglia = senzaCommenti(readFileSync(join(RADICE, 'components/ProductGrid.tsx'), 'utf8'));
  const promozioni = senzaCommenti(readFileSync(join(RADICE, 'app/promozioni/page.tsx'), 'utf8'));

  it('lo scheletro non ha più un elenco di colonne suo', () => {
    // È la riga che impedisce alla divergenza di tornare: due elenchi scritti a mano si allontanano
    // al primo cambio, e nessuno se ne accorge finché la pagina non salta.
    expect(scheletro).not.toMatch(/grid-cols-\d/);
    expect(scheletro).toMatch(/classiGriglia\(/);
  });

  it('nemmeno la griglia vera, né la pagina delle promozioni', () => {
    expect(griglia).not.toMatch(/grid-cols-\d/);
    expect(griglia).toMatch(/classiGriglia\(/);
    expect(promozioni).not.toMatch(/grid-cols-\d+ sm:grid-cols/);
    expect(promozioni).toMatch(/classiGriglia\(/);
  });

  it('la foto dello scheletro ha la proporzione della scheda vera, non un altezza fissa', () => {
    expect(scheletro).not.toMatch(/\bh-48\b/);
    expect(scheletro).toContain('PROPORZIONE_FOTO');
  });

  it('e quella proporzione è davvero quella che usa la scheda vera', () => {
    // Se un domani la scheda cambia forma, questa riga diventa rossa: la costante non la segue da
    // sola, e uno scheletro che non segue è di nuovo uno scheletro che sposta.
    const scheda = senzaCommenti(readFileSync(join(RADICE, 'components/ProductCard.tsx'), 'utf8'));
    const riquadroFoto = scheda.match(/<div className="relative ([a-z-\[\]/\d]+) w-full overflow-hidden/);
    expect(riquadroFoto, 'non trovo il riquadro-foto della scheda: la prova non misura niente').not.toBeNull();
    expect(riquadroFoto![1]).toBe(PROPORZIONE_FOTO);
  });

  it('anche la fila «Potrebbe piacerti» ha uno scheletro della forma giusta', () => {
    // Era un altro scheletro ancora, con un'altra forma: `aspect-[3/4]` senza righe di testo,
    // contro una scheda quadrata con tre righe sotto. Stessa malattia, terzo posto.
    const simili = senzaCommenti(readFileSync(join(RADICE, 'components/SimilarProducts.tsx'), 'utf8'));
    expect(simili).not.toMatch(/aspect-\[3\/4\]/);
    expect(simili).toContain('PROPORZIONE_FOTO');
    // E le due griglie — quella dello scheletro e quella vera — sono la stessa costante.
    const quante = (simili.match(/GRIGLIA_SIMILI/g) || []).length;
    expect(quante, 'lo scheletro e le schede vere non usano la stessa griglia').toBeGreaterThanOrEqual(3);
    expect(simili).not.toMatch(/className="grid grid-cols/);
  });

  it('dove lo scheletro sta dentro una griglia a quattro colonne, lo sa', () => {
    // Senza passargli le colonne, lo scheletro tornerebbe alla scala piena mentre la pagina ne
    // apre quattro: la stessa divergenza, girata al contrario.
    expect(promozioni).toMatch(/<SkeletonGrid[^>]*maxColumns=\{4\}/);
    expect(griglia).toMatch(/<SkeletonGrid[^>]*maxColumns=\{maxColumns\}/);
  });
});
