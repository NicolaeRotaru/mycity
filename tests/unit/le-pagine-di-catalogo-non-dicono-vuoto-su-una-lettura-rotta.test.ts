/**
 * 27/8/2026 (R090, R094) — DUE PAGINE DI CATALOGO CHE SPACCIAVANO UNA LETTURA FALLITA PER UN
 * MONDO VUOTO.
 *
 * `/categorie` — la pagina da cui si sfoglia tutto il catalogo, linkata dalla barra e dal piè di
 * pagina — leggeva le categorie guardando solo `isLoading`. Se la lettura falliva, l'elenco restava
 * vuoto e la pagina disegnava il suo bel titolo «Categorie · Esplora tutte le categorie…» sopra una
 * griglia completamente vuota: nessun messaggio, nessun «riprova». Chi ci arrivava con una rete
 * storta vedeva un sito senza merce e non aveva modo di sapere che bastava ricaricare.
 *
 * `/category/[slug]` — stessa forma, parole peggiori: `if (!category) return «Categoria non
 * trovata.»`. `category` è nullo sia quando la categoria non esiste davvero sia quando la lettura è
 * caduta, e in nessuno dei due casi c'era una via d'uscita: né «riprova», né un link al catalogo.
 * In più, su uno slug morto la pagina rispondeva 200: per Google quella pagina risultava valida.
 *
 * ── PERCHÉ QUESTA PROVA GUARDA IL CODICE E NON LO SCHERMO ────────────────────────────────────
 * In questa repo un componente React non si può montare dentro una prova: il tsconfig tiene
 * `jsx: preserve` e la configurazione di vitest — che appartiene a un altro lotto — non ha il
 * plugin react. Questa prova è quindi un invariante di STRUTTURA, ed è dichiarato per quello che è:
 * per ogni pagina controlla che la lettura esponga il proprio errore e che il ramo dell'errore
 * venga PRIMA della frase che dichiara il vuoto. Il giorno che qualcuno rimette la frase sul vuoto
 * davanti all'errore, questa diventa rossa.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/** La destrutturazione della `useQuery` che alimenta il contenuto principale della pagina. */
function letturaPrincipale(src: string): string {
  const i = src.indexOf('= useQuery(');
  expect(i, 'la pagina non legge più niente: questa prova non misura più niente').toBeGreaterThan(0);
  const inizio = src.lastIndexOf('const {', i);
  return src.slice(inizio, i);
}

describe('la pagina /categorie', () => {
  const src = readFileSync('app/categorie/page.tsx', 'utf8');

  it('si accorge che la lettura è fallita', () => {
    expect(letturaPrincipale(src), 'una griglia vuota sotto il suo titolo, per sempre').toContain('isError');
  });

  it('offre di riprovare invece di restare muta', () => {
    expect(src).toContain('ErrorState');
    expect(src, 'senza «riprova» chi arriva con la rete storta se ne va e non torna').toContain('refetch');
  });

  it('il ramo dell errore viene prima di qualunque cosa disegni la griglia', () => {
    const errore = src.indexOf('ErrorState');
    const griglia = src.indexOf('tops.map');
    expect(errore).toBeGreaterThan(0);
    expect(errore, 'la griglia si disegna comunque, vuota, anche quando la lettura è caduta').toBeLessThan(griglia);
  });
});

describe('la pagina di una categoria', () => {
  const src = readFileSync('app/category/[slug]/page.tsx', 'utf8');

  it('distingue «non esiste» da «non sono riuscito a leggere»', () => {
    expect(letturaPrincipale(src), 'rete caduta e slug morto finivano nello stesso vicolo cieco').toContain('isError');
    const errore = src.indexOf('ErrorState');
    const assente = src.indexOf('notFound()');
    expect(errore, 'manca del tutto il ramo dell\'errore').toBeGreaterThan(0);
    expect(errore, 'si dichiara «non esiste» prima di aver escluso che sia caduta la rete').toBeLessThan(assente);
    expect(src, 'il vicolo cieco senza uscita è ancora lì').not.toContain('Categoria non trovata.');
  });

  it('su uno slug che non esiste risponde 404 davvero, non 200', () => {
    // Una pagina «non trovata» che risponde 200 resta valida per Google e continua a essere
    // proposta in ricerca a chi cerca quella categoria.
    expect(src).toContain('notFound()');
    expect(src).toContain("from 'next/navigation'");
  });
});
