/**
 * 6/9/2026 — SULLA PAGINA DEI RISULTATI, DUE COSE STAVANO SOPRA IL TITOLO. E NESSUNA DICEVA DOVE SI E'.
 *
 * ① Su telefono la colonna dei filtri è nascosta, quindi il primo blocco visibile era quello dei
 *    pulsanti «Ordina» e «Filtri»: due bottoni sospesi in cima, prima di sapere su che pagina si
 *    è e cosa si è cercato. La pagina categoria — che è la sua gemella e mostra le stesse cose —
 *    fa il contrario da sempre: intestazione a tutta larghezza per prima, poi filtri e risultati.
 *    Due pagine gemelle che si comportano in modo diverso.
 * ② Il primo figlio della colonna risultati era il carosello a pagamento. Chi ha appena premuto
 *    invio non trovava subito la conferma di cosa sta guardando. (Con zero campagne il carosello
 *    si nasconde da solo, quindi il difetto si vedeva solo a spazi sponsorizzati accesi.)
 *
 * Poi c'erano due cose vicine, dello stesso tipo: lo stesso briciolo di pane scritto in tre posti
 * con misure e frecce diverse, e i titoli delle file di prodotti tagliati a metà parola invece di
 * andare a capo.
 *
 * Qui non si monta React — in questa repo le prove non montano componenti — quindi si guarda
 * l'ordine e la forma nel sorgente. È un controllo di struttura, ed è dichiarato.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const ricerca = readFileSync('app/search/page.tsx', 'utf8');
const categoria = readFileSync('app/category/[slug]/page.tsx', 'utf8');
const collezioni = readFileSync('components/CollectionHeader.tsx', 'utf8');
const griglia = readFileSync('components/ProductGrid.tsx', 'utf8');

/** Dove compare, nel file, il primo pezzo di codice che assomiglia a questo. */
const dove = (src: string, pezzo: string): number => {
  const i = src.indexOf(pezzo);
  expect(i, `non si trova piu nel sorgente: ${pezzo}`).toBeGreaterThan(-1);
  return i;
};

describe('la pagina dei risultati dice prima dove si e, poi il resto', () => {
  const colonna = ricerca.slice(dove(ricerca, 'md:col-span-3'));

  it('briciolo di pane e titolo vengono prima dei pulsanti Ordina e Filtri', () => {
    expect(
      dove(colonna, '<Breadcrumb'),
      'i due pulsanti sono tornati sopra il titolo: su telefono si vedono prima di sapere dove si e',
    ).toBeLessThan(dove(colonna, 'md:hidden flex items-center justify-end'));
    expect(dove(colonna, '<h1')).toBeLessThan(dove(colonna, 'md:hidden flex items-center justify-end'));
  });

  it('briciolo di pane e titolo vengono prima del carosello sponsorizzato', () => {
    expect(
      dove(colonna, '<Breadcrumb'),
      'il carosello a pagamento e tornato sopra il briciolo di pane',
    ).toBeLessThan(dove(colonna, '<SponsoredCarousel'));
    expect(dove(colonna, '<h1')).toBeLessThan(dove(colonna, '<SponsoredCarousel'));
  });

  it('il carosello resta comunque sopra la griglia: la visibilita venduta non cala', () => {
    expect(dove(colonna, '<SponsoredCarousel')).toBeLessThan(dove(colonna, '<ProductGrid'));
  });

  it('i pulsanti restano sopra la griglia dei prodotti, non in fondo alla pagina', () => {
    expect(
      dove(colonna, 'md:hidden flex items-center justify-end'),
      'i filtri finiti sotto la lista dei prodotti sono peggio di prima',
    ).toBeLessThan(dove(colonna, '<ProductGrid'));
  });

  it('e la pagina categoria, che era gia giusta, lo resta', () => {
    expect(dove(categoria, '<div className="md:col-span-4">{header}</div>'))
      .toBeLessThan(dove(categoria, 'hidden md:block md:col-span-1'));
  });
});

describe('un briciolo di pane solo, per tutto il sito', () => {
  for (const [nome, src] of [['la ricerca', ricerca], ["l'intestazione delle collezioni", collezioni]] as const) {
    it(`${nome} usa il componente condiviso, non una copia a mano`, () => {
      expect(src, 'e tornata una copia scritta a mano').not.toContain('aria-label="Breadcrumb"');
      expect(src).toContain("from '@/components/ui/Breadcrumb'");
      expect(src).toContain('<Breadcrumb');
    });
  }

  it('nessuno dei due si porta piu dietro la misura fuori scala del testo', () => {
    for (const src of [ricerca, collezioni]) {
      const nav = src.slice(dove(src, '<Breadcrumb'), dove(src, '<Breadcrumb') + 400);
      expect(nav).not.toContain('text-[13px]');
    }
  });

  it('la pagina categoria non stampa due volte la stessa scheda per Google', () => {
    expect(
      collezioni,
      'il dato strutturato acceso qui dentro raddoppia quello che la pagina categoria stampa gia',
    ).toContain('datiStrutturati={false}');
    // Una sola scheda costruita (la stampa avviene in due rami che non convivono mai: hub o griglia).
    expect(
      (categoria.match(/'@type': 'BreadcrumbList'/g) ?? []).length,
      'la pagina categoria costruisce piu di una BreadcrumbList',
    ).toBe(1);
  });
});

describe('i titoli delle file di prodotti vanno a capo, non si tagliano', () => {
  const intestazione = griglia.slice(dove(griglia, 'const sectionHeader'), dove(griglia, 'const sectionHeader') + 900);

  it('nessuna delle due varianti taglia il titolo a una riga sola', () => {
    expect(
      (intestazione.match(/truncate/g) ?? []).length,
      '«Abbigliamento sportivo» torna mozzato a meta parola su uno schermo da 320px',
    ).toBe(0);
    expect((intestazione.match(/line-clamp-2/g) ?? []).length, 'servono tutte e due le varianti').toBe(2);
  });

  it('su telefono il titolo parte da una misura che ci sta', () => {
    expect((intestazione.match(/text-lg/g) ?? []).length).toBe(2);
    expect(intestazione, 'da tablet in su deve risalire come prima').toContain('sm:text-xl md:text-2xl');
  });
});
