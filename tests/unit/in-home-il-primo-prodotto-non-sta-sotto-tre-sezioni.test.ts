/**
 * Sulla home il primo prodotto da comprare arrivava dopo tre sezioni intere.
 *
 * IL CASO. Una persona apre mycity.live dal telefono. Vede l'hero: occhiello, titolo, sottotitolo,
 * due pulsanti, cinque pastiglie di categoria, la fascia dell'orario di consegna, tre rassicurazioni.
 * Scorre. Trova «Come funziona», tre schede impilate che spiegano una cosa che non ha ancora deciso
 * di fare. Scorre ancora. Trova sei tessere di categoria — cartelli, non merce. Solo dopo, il primo
 * articolo con una foto e un prezzo.
 *
 * IL CONTO, rifatto sulle classi vere per un telefono da 360 punti di larghezza (il calcolo è
 * un'aritmetica sulle classi, NON una misura presa in un browser — sotto c'è come si ottiene):
 *
 *     hero              ~783 punti    la scheda-negozio a fianco è `hidden md:flex`, sul telefono non c'è
 *     come funziona     ~761 punti    tre schede una sotto l'altra, più il pulsante in fondo
 *     categorie         ~505 punti    sei tessere 4:3 su tre righe
 *     ─────────────────────────────
 *     primo prodotto  ~2.150 punti dall'alto della pagina, più la barra in cima
 *
 * Un telefono da 360×640 mostra circa 576 punti di contenuto per volta. Il primo articolo comprabile
 * stava quindi a QUASI QUATTRO SCHERMATE di distanza — su un mercato, cioè su una pagina che esiste
 * per far vedere della roba da comprare.
 *
 * Le due sezioni di mezzo si contano davvero perché per un visitatore nuovo le altre non ci sono:
 * «ordina di nuovo» si nasconde da sola a chi non ha fatto accesso, e l'offerta del giorno compare
 * solo se qualcuno l'ha programmata.
 *
 * LA CURA. I prodotti popolari salgono subito sotto l'hero (~900 punti, meno di due schermate) e
 * «come funziona» scende sotto i negozi vicini, dove risponde a una domanda che a quel punto uno se
 * l'è fatta davvero.
 *
 * PERCHÉ NON BASTA RIORDINARE L'ELENCO. Riordinare è la cura di oggi. Domani qualcuno aggiunge una
 * sezione «la nostra storia» in cima e il difetto torna, identico, senza che niente diventi rosso.
 * Qui la misura è una funzione — `sezioniPrimaDelPrimoProdotto` — che si può fare a una home
 * qualunque, anche a una composta a mano dal pannello.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  defaultHomeSite,
  newHomeSection,
  sezioniPrimaDelPrimoProdotto,
  SEZIONI_CHE_POSSONO_NON_COMPARIRE,
  SEZIONI_CHE_VENDONO,
  type HomeSectionType,
  type HomeSite,
} from '@/lib/home-site';

/** Costruisce una home con le sezioni date, nell'ordine dato. */
function home(...tipi: HomeSectionType[]): HomeSite {
  return { version: 1, sections: tipi.map((t) => ({ ...newHomeSection(t), id: t })) };
}

// ─────────────────────────────────────────────────────────────────────────────
// ① La misura, sui due ordini: quello di prima e quello di adesso.
// ─────────────────────────────────────────────────────────────────────────────

describe('quanto si scorre prima di vedere qualcosa da comprare', () => {
  it("IL CASO: con l'ordine vecchio erano due sezioni piene, «come funziona» e le categorie", () => {
    // Questa è la forma VECCHIA, scritta qui per far vedere cosa cambia. Se un domani la misura
    // smettesse di accorgersene, questa riga diventa rossa prima di tutte le altre.
    const vecchia = home(
      'hero', 'reorder', 'howItWorks', 'categories', 'dropOfDay', 'popularProducts',
      'liveActivity', 'nearbyStores', 'trustRow', 'newsletter', 'sellerCta',
    );
    expect(sezioniPrimaDelPrimoProdotto(vecchia)).toEqual(['howItWorks', 'categories']);
  });

  it('adesso, sulla home di partenza, non si scorre niente: la merce è subito sotto', () => {
    expect(sezioniPrimaDelPrimoProdotto(defaultHomeSite())).toEqual([]);
  });

  it('e i prodotti stanno prima di «come funziona», non dopo', () => {
    const ordine = defaultHomeSite().sections.map((s) => s.type);
    expect(ordine.indexOf('popularProducts')).toBeLessThan(ordine.indexOf('howItWorks'));
    expect(ordine.indexOf('popularProducts')).toBeLessThan(ordine.indexOf('categories'));
  });

  it('riordinare non ha perso né duplicato nessuna sezione', () => {
    // Il modo più facile di rompere un riordino è farlo a mano e dimenticare una riga.
    const ordine = defaultHomeSite().sections.map((s) => s.type);
    expect(new Set(ordine).size, 'una sezione compare due volte').toBe(ordine.length);
    expect([...ordine].sort()).toEqual([
      'categories', 'dropOfDay', 'hero', 'howItWorks', 'liveActivity', 'nearbyStores',
      'newsletter', 'popularProducts', 'reorder', 'sellerCta', 'trustRow',
    ].sort());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ② La misura non si lascia ingannare da una sezione che il visitatore non vede.
// ─────────────────────────────────────────────────────────────────────────────

describe('quello che il visitatore non vede non conta come merce mostrata', () => {
  it("«ordina di nuovo» in cima non salva la home: a un visitatore nuovo non compare", () => {
    // ReorderRail: «if (!user) return null; // ospite → self-hide». Metterla prima dei prodotti
    // farebbe risultare la home a posto mentre chi arriva la prima volta vede ancora due sezioni
    // di racconto — ed è precisamente il modo in cui questo difetto si potrebbe ri-nascondere.
    const finta = home('hero', 'reorder', 'howItWorks', 'categories', 'popularProducts');
    expect(sezioniPrimaDelPrimoProdotto(finta)).toEqual(['howItWorks', 'categories']);
  });

  it("nemmeno l'offerta del giorno, che c'è solo se qualcuno l'ha programmata", () => {
    const finta = home('hero', 'dropOfDay', 'howItWorks', 'popularProducts');
    expect(sezioniPrimaDelPrimoProdotto(finta)).toEqual(['howItWorks']);
  });

  it("una sezione che può sparire non conta nemmeno come sezione da scorrere", () => {
    // Se non compare, non costa scorrimento: contarla sarebbe severo per il verso sbagliato.
    const finta = home('hero', 'stories', 'popularProducts');
    expect(sezioniPrimaDelPrimoProdotto(finta)).toEqual([]);
  });

  it('una sezione spenta dal pannello non conta', () => {
    const site = defaultHomeSite();
    const prodotti = site.sections.find((s) => s.type === 'popularProducts')!;
    prodotti.enabled = false;
    // Spenti i prodotti, sopra restano le sezioni di racconto: la home torna quella di prima.
    expect(sezioniPrimaDelPrimoProdotto(site)).toContain('categories');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ③ La conseguenza dello spostamento: quella fila adesso si legge per prima.
// ─────────────────────────────────────────────────────────────────────────────

describe('salita in cima, la fila deve reggere anche quando è vuota', () => {
  const RENDERER = readFileSync(
    join(process.cwd(), 'components/home-sections/HomeSectionRenderer.tsx'),
    'utf8',
  );

  it('lo stato vuoto non chiede di togliere filtri che non esistono', () => {
    // Lo stato vuoto generico dice «Prova a modificare i filtri o cerca qualcos'altro». Sulla home
    // filtri non ce ne sono e non c'è niente da cercare: era un'istruzione impossibile, e prima
    // stava in fondo alla pagina. Adesso è la prima cosa sotto l'hero, quindi la si sistema.
    const chiamata = RENDERER.match(/<ProductGrid\s[^>]*rail[\s\S]{0,400}?\/>/);
    expect(chiamata, 'non trovo la fila dei prodotti popolari in home').not.toBeNull();
    expect(chiamata![0], 'la fila della home non dice niente di suo quando è vuota')
      .toContain('emptyTitle');
    expect(chiamata![0]).toContain('emptyDescription');
    expect(chiamata![0], "lo stato vuoto della home parla ancora di filtri").not.toContain('filtri');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ④ Le due liste su cui poggia la misura devono restare sensate.
// ─────────────────────────────────────────────────────────────────────────────

describe('le liste che dicono cosa è merce e cosa può sparire', () => {
  it('le categorie non sono merce: sono un cartello', () => {
    // È la distinzione che regge tutta la misura. Una tessera «Alimentari» non ha un prezzo:
    // chi la tocca fa un passo in più prima di vedere qualcosa da comprare.
    expect(SEZIONI_CHE_VENDONO).not.toContain('categories');
    expect(SEZIONI_CHE_VENDONO).not.toContain('howItWorks');
    expect(SEZIONI_CHE_VENDONO).toContain('popularProducts');
  });

  it("i prodotti popolari sono l'unica merce su cui si può contare sempre", () => {
    // Tutte le altre sezioni che vendono possono non comparire. Se un domani anche i prodotti
    // popolari finissero in quella lista, la misura tornerebbe sempre vuota e non misurerebbe
    // più niente: questa riga lo impedisce.
    expect(SEZIONI_CHE_POSSONO_NON_COMPARIRE).not.toContain('popularProducts');
    const sicure = SEZIONI_CHE_VENDONO.filter((t) => !SEZIONI_CHE_POSSONO_NON_COMPARIRE.includes(t));
    expect(sicure, 'nessuna sezione di merce è garantita: la misura non può dire niente').not.toHaveLength(0);
  });
});
