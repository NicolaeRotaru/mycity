/**
 * 6/9/2026 — IL FILTRO «CATEGORIA» DELLA RICERCA ERA UNA LISTA PIATTA, CON DUE «BAMBINI».
 *
 * Il menù a tendina metteva in fila, in ordine alfabetico, madri e figlie senza distinguerle:
 * «Abbigliamento», «Abbigliamento sportivo», «Abiti & Gonne», «Accessori», «Accessori & Borse»…
 * e in mezzo due voci «Bambini» una dietro l'altra. Una è l'abbigliamento per bambini (madre:
 * Abbigliamento, slug `bambini`), l'altra sono i libri per bambini (madre: Libri, slug
 * `libri-bambini`). Chi cerca un vestito per il figlio e prende quella sbagliata vede libri e
 * conclude che i negozi non hanno quello che cerca: nessun messaggio gli dice che ha sbagliato
 * voce. Anche il chip del filtro attivo diceva solo «Bambini».
 *
 * Nello stesso punto, e per la stessa causa — la lista non sapeva chi è madre e chi è figlia —
 * le scorciatoie di «Forse cercavi» erano `slice(0, 6)`: le prime sei righe in ordine
 * alfabetico, cioè cinque voci di abbigliamento su sei. Chi cercava «pane» e non trovava niente
 * si vedeva proporre gonne e borse, proprio nel momento in cui decide se restare o chiudere.
 *
 * ⚠️ Le categorie vere le scrivono le migrazioni, e questa prova le ricostruisce da lì: sei file,
 * 71 categorie, 9 principali. Il difetto era stato misurato sul database di prova con due comandi
 * psql; qui gli stessi due conti tornano dalle migrazioni, quindi la prova gira ovunque, anche
 * senza database acceso. Se domani una migrazione aggiunge una sottocategoria che si chiama come
 * un'altra, la prova se ne accorge da sola.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

type Categoria = { slug: string; name: string; parentSlug: string | null };

/** Le categorie come stanno nel database, ricostruite dalle migrazioni che le creano. */
function categorieDalleMigrazioni(): Categoria[] {
  const cats: Categoria[] = [];

  // 002 — le prime otto principali: INSERT … VALUES ('slug', 'Nome', 'emoji'), …
  const seed = readFileSync('migrations/002_categories_and_extras.sql', 'utf8');
  const blocco = seed.slice(seed.indexOf('Seed categorie principali'));
  for (const m of blocco.matchAll(/\('([a-z-]+)',\s*'([^']+)',\s*'([^']+)'\)/g)) {
    cats.push({ slug: m[1], name: m[2], parentSlug: null });
  }
  // 002 — le prime figlie: INSERT … SELECT 'slug', 'Nome', id … WHERE slug = 'madre'
  for (const m of seed.matchAll(
    /SELECT\s+'([a-z-]+)',\s*'([^']+)',\s*id FROM public\.categories WHERE slug = '([a-z-]+)'/g,
  )) {
    cats.push({ slug: m[1], name: m[2], parentSlug: m[3] });
  }
  // 013 — la nona principale (Giocattoli), che fa il 3x3 della home.
  const nona = readFileSync('migrations/013_extra_category.sql', 'utf8');
  for (const m of nona.matchAll(/VALUES \('([a-z-]+)', '([^']+)', '([^']+)'\)/g)) {
    cats.push({ slug: m[1], name: m[2], parentSlug: null });
  }
  // 057, 068, 069, 078 — le sottocategorie: values ('slug', 'Nome', 'slug-della-madre'),
  for (const file of [
    'migrations/057_subcategories.sql',
    'migrations/068_sport_subcategories.sql',
    'migrations/069_garden_beauty_toys_subcategories.sql',
    'migrations/078_more_subcategories.sql',
  ]) {
    for (const m of readFileSync(file, 'utf8').matchAll(/\('([a-z-]+)',\s*'([^']+)',\s*'([a-z-]+)'\)/g)) {
      cats.push({ slug: m[1], name: m[2], parentSlug: m[3] });
    }
  }
  return cats;
}

/** `.order('name')`: è così che la pagina le riceve da Supabase. */
const CATEGORIE = categorieDalleMigrazioni().sort((a, b) => a.name.localeCompare(b.name));
const MADRI = CATEGORIE.filter((c) => !c.parentSlug);

/** L'etichetta che la ricerca mostra nel chip del filtro attivo. */
function etichetta(c: Categoria): string {
  const madre = c.parentSlug ? CATEGORIE.find((x) => x.slug === c.parentSlug) : undefined;
  return madre ? `${madre.name} › ${c.name}` : c.name;
}

describe('le categorie che il database contiene davvero', () => {
  it('sono settantuno, e nove sono le principali', () => {
    expect(CATEGORIE.length, 'la ricostruzione dalle migrazioni non torna piu').toBe(71);
    expect(MADRI.length, 'le categorie principali non sono piu nove').toBe(9);
  });

  it('due si chiamano davvero uguale: e il difetto, non un sospetto', () => {
    const doppie = [
      ...new Set(
        CATEGORIE.filter((c, _i, tutte) => tutte.filter((x) => x.name === c.name).length > 1).map((c) => c.name),
      ),
    ];
    expect(doppie, 'lo stesso conto del comando psql della scheda').toEqual(['Bambini']);
  });
});

describe('«Forse cercavi» propone le vie d uscita vere', () => {
  it('la vecchia regola pescava una sola categoria principale su sei', () => {
    const primeSei = CATEGORIE.slice(0, 6);
    expect(primeSei.map((c) => c.name)).toEqual([
      'Abbigliamento',
      'Abbigliamento sportivo',
      'Abiti & Gonne',
      'Accessori',
      'Accessori & Borse',
      'Accessori sport',
    ]);
    expect(primeSei.filter((c) => !c.parentSlug).length, 'lo stesso conto del comando psql: 1 su 6').toBe(1);
  });

  it('la regola di adesso propone nove principali e nessuna sottocategoria', () => {
    expect(MADRI.length).toBe(9);
    expect(MADRI.some((c) => c.parentSlug), 'e rientrata dentro una sottocategoria').toBe(false);
  });
});

describe('il filtro «Categoria» non ha piu due voci indistinguibili', () => {
  it('col nome della madre davanti, tutte e settantuno le etichette sono uniche', () => {
    const etichette = CATEGORIE.map(etichetta);
    expect(new Set(etichette).size, 'due voci del filtro dicono ancora la stessa cosa').toBe(etichette.length);
  });

  it('le due «Bambini» diventano due cose diverse', () => {
    const vestiti = CATEGORIE.find((c) => c.slug === 'bambini');
    const libri = CATEGORIE.find((c) => c.slug === 'libri-bambini');
    expect(vestiti && libri, 'le due Bambini non sono piu nelle migrazioni').toBeTruthy();
    expect(etichetta(vestiti!)).toBe('Abbigliamento › Bambini');
    expect(etichetta(libri!)).toBe('Libri › Bambini');
  });
});

describe('la pagina della ricerca applica queste due regole', () => {
  /** Il codice senza i commenti: una spiegazione che nomina il difetto non e il difetto. */
  const src = readFileSync('app/search/page.tsx', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('legge la madre e l emoji di ogni categoria', () => {
    expect(src).toContain("select('id, slug, name, icon, parent_id')");
  });

  it('«Forse cercavi» non e piu un taglio alla sesta riga', () => {
    expect(src, 'le prime sei in ordine alfabetico sono tornate').not.toContain('categories.slice(0, 6)');
    expect(src).toContain('const didYouMean = madri;');
  });

  it('il menu a tendina e a gruppi, non piatto', () => {
    expect(src, 'senza optgroup le settantuno voci tornano tutte in fila').toContain('<optgroup');
  });

  it('il chip del filtro attivo porta il nome della madre', () => {
    expect(src).toContain('nomeConLaSuaMadre(categoryId)');
  });
});
