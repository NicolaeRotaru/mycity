import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * 22/8/2026 — UN LINK MORTO DENTRO «COSA FARE SE ABBIAMO UN PROBLEMA».
 *
 * I Termini mandavano i consumatori alla piattaforma ODR europea, che la
 * Commissione ha spento il 20 luglio 2025. Chi ci provava ci sbatteva contro
 * nel momento in cui era già arrabbiato — la sezione peggiore dove tenere un
 * indirizzo che non risponde.
 *
 * Questo guardiano tiene un elenco di riferimenti che non esistono più e
 * fallisce se ricompaiono in una pagina che le persone leggono.
 */

const RADICE = join(__dirname, '..', '..');

/** Riferimenti morti: perché lo sono, e da quando. */
const MORTI: Array<{ testo: string; perche: string }> = [
  {
    testo: 'ec.europa.eu/consumers/odr',
    perche: 'la piattaforma ODR europea è stata chiusa dalla Commissione il 20 luglio 2025',
  },
  {
    testo: 'webgate.ec.europa.eu/odr',
    perche: 'stesso indirizzo, forma vecchia',
  },
];

function pagine(dir: string, dentro: string[] = []): string[] {
  for (const voce of readdirSync(dir)) {
    if (voce === 'node_modules' || voce.startsWith('.')) continue;
    const percorso = join(dir, voce);
    if (statSync(percorso).isDirectory()) pagine(percorso, dentro);
    else if (/\.(tsx|md)$/.test(voce)) dentro.push(percorso);
  }
  return dentro;
}

describe('le pagine legali non mandano in un vicolo cieco', () => {
  const file = [...pagine(join(RADICE, 'app')), ...pagine(join(RADICE, 'components'))];

  it.each(MORTI)('nessuna pagina cita più $testo', ({ testo, perche }) => {
    const colpevoli = file
      .filter((f) => readFileSync(f, 'utf8').includes(testo))
      .map((f) => relative(RADICE, f));

    expect(
      colpevoli,
      `«${testo}» non porta da nessuna parte: ${perche}. Compare in:\n  ` +
        colpevoli.join('\n  '),
    ).toEqual([]);
  });

  it('la sezione sui reclami dice cosa fare davvero', () => {
    const terms = readFileSync(join(RADICE, 'app', 'terms', 'page.tsx'), 'utf8');
    // Non basta togliere il link morto: al suo posto ci deve essere una strada.
    expect(terms).toContain('giorni lavorativi');
    expect(terms.toLowerCase()).toContain('mediazione');
  });

  it('i Termini non si cambiano più «in qualsiasi momento» con accettazione tacita', () => {
    const terms = readFileSync(join(RADICE, 'app', 'terms', 'page.tsx'), 'utf8');
    expect(terms).not.toContain('in qualsiasi momento. Le modifiche sostanziali');
    // Ci devono essere i motivi e il diritto di andarsene senza costi.
    expect(terms).toContain('giustificato');
    expect(terms).toContain('recedere senza costi');
  });

  it('il modulo di recesso tipo c’è', () => {
    const terms = readFileSync(join(RADICE, 'app', 'terms', 'page.tsx'), 'utf8');
    expect(terms).toContain('Modulo di recesso tipo');
    expect(terms).toContain('notifico il recesso');
  });
});

/**
 * 22/8/2026 — IL PULSANTE CHE CONCLUDE L'ORDINE IN CONTANTI.
 *
 * Diceva «Conferma ordine». Sul ramo contanti il pagamento avviene dopo, alla
 * consegna, ed è proprio per questo che il pulsante lo deve dire: chi preme
 * deve sapere che al fattorino dovrà dare dei soldi.
 */
describe('il pulsante finale dice che si sta per pagare', () => {
  const somm = readFileSync(join(RADICE, 'components', 'checkout', 'OrderSummary.tsx'), 'utf8');
  const pagina = readFileSync(join(RADICE, 'app', 'checkout', 'page.tsx'), 'utf8');

  it('sul ramo contanti c’è un verbo di pagamento, non solo «conferma»', () => {
    expect(somm).toContain('Ordina e paga alla consegna');
    expect(somm).not.toContain('`Conferma ordine · ${formatPrice(total)}`');
  });

  it('la barra in fondo sul telefono dice la stessa cosa', () => {
    expect(pagina).toContain("'Ordina e paga alla consegna'");
  });

  it('chi usa un lettore di schermo sente la stessa frase di chi legge', () => {
    // L'aria-label non deve raccontare una cosa diversa dal testo visibile.
    const i = pagina.indexOf('aria-label={');
    expect(pagina.slice(i, i + 300)).toContain('Ordina e paga alla consegna');
  });
});
