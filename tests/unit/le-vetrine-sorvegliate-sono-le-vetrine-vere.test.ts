import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { isMarketplaceBrowsePath } from '@/lib/shopping-access';

/**
 * 6/9/2026 — IL NEGOZIANTE VENIVA SBATTUTO FUORI DA «NOVITÀ» SENZA UNA PAROLA.
 *
 * Un venditore entra nel marketplace in «modalità acquisto»: un permesso che
 * dura otto ore. Finito quello, il controllo all'ingresso del sito lo rimanda
 * alla sua dashboard — ma solo sulle pagine che qualcuno aveva scritto a mano
 * in un elenco dentro `lib/shopping-access.ts`.
 *
 * In quell'elenco mancavano proprio le sette destinazioni della barra sotto
 * l'header: Tutti i negozi, Promozioni, Novità, Regali, Vicino a te, Più
 * venduti, Piccoli prezzi. E mancava /categorie. Così il negoziante col
 * permesso scaduto apriva «Novità», vedeva i prodotti, toccava una scheda —
 * quella sì sorvegliata — e si ritrovava sulla dashboard senza una spiegazione.
 * Nell'elenco c'erano invece /collections e /daily-drops, due indirizzi senza
 * nessuna pagina dietro.
 *
 * La causa è che gli elenchi erano due, tenuti a mano, e non si parlavano: le
 * destinazioni della barra da una parte, le pagine sorvegliate dall'altra.
 * Questa prova li rimette uno di fronte all'altro, e li confronta con le pagine
 * che esistono davvero in `app/`. Se domani qualcuno aggiunge una voce alla
 * barra e si dimentica l'elenco, questa prova diventa rossa.
 */

const RADICE = resolve(__dirname, '..', '..');

/** Gli indirizzi delle voci della barra categorie, letti dalla barra vera. */
function destinazioniDellaBarra(): string[] {
  const sorgente = readFileSync(join(RADICE, 'components/CategoryBar.tsx'), 'utf8');
  const blocco = sorgente.match(/const DESTINATIONS: Entry\[\] = \[([\s\S]*?)\n\];/);
  expect(blocco, 'La barra categorie non elenca più le destinazioni così: la prova non guarda niente').toBeTruthy();
  return [...blocco![1].matchAll(/href:\s*'([^']+)'/g)].map((m) => m[1]);
}

/** Le pagine sorvegliate, lette dall'elenco vero. */
function prefissiSorvegliati(): string[] {
  const sorgente = readFileSync(join(RADICE, 'lib/shopping-access.ts'), 'utf8');
  const blocco = sorgente.match(/const MARKETPLACE_BROWSE_PREFIXES = \[([\s\S]*?)\n\];/);
  expect(blocco, 'L\'elenco delle pagine sorvegliate non si chiama più così: la prova non guarda niente').toBeTruthy();
  // Solo le righe che sono un indirizzo: i commenti in mezzo all'elenco hanno
  // apostrofi loro e non vanno scambiati per rotte.
  return [...blocco![1].matchAll(/^\s*'([^']+)',$/gm)].map((m) => m[1]);
}

/** C'è una pagina vera dietro questo indirizzo? */
function esisteLaPagina(prefisso: string): boolean {
  const cartella = join(RADICE, 'app', prefisso.replace(/^\//, ''));
  if (!existsSync(cartella)) return false;
  const cerca = (dir: string): boolean =>
    readdirSync(dir).some((voce) => {
      const pieno = join(dir, voce);
      if (voce === 'page.tsx') return true;
      return statSync(pieno).isDirectory() && cerca(pieno);
    });
  return cerca(cartella);
}

describe('le vetrine sorvegliate del venditore', () => {
  it('comprendono tutte le voci della barra categorie e l\'indice delle categorie', () => {
    const attese = [...destinazioniDellaBarra(), '/categorie'];
    expect(attese.length, 'La barra dovrebbe avere sette destinazioni più /categorie').toBe(8);

    const scoperte = attese.filter((href) => !isMarketplaceBrowsePath(href));
    expect(
      scoperte,
      'Queste pagine si aprono dalla barra ma nessuno le sorveglia: il venditore col permesso scaduto le sfoglia, poi tocca una scheda e si ritrova sulla dashboard senza capire perché',
    ).toEqual([]);
  });

  it('valgono anche per le pagine dentro quelle vetrine', () => {
    expect(isMarketplaceBrowsePath('/novita/pane'), 'Anche quello che sta dentro «Novità» è vetrina').toBe(true);
    expect(isMarketplaceBrowsePath('/categorie/alimentari'), 'Anche quello che sta dentro «Categorie» è vetrina').toBe(true);
  });

  it('non sorvegliano indirizzi senza nessuna pagina dietro', () => {
    const fantasmi = prefissiSorvegliati().filter((p) => !esisteLaPagina(p));
    expect(
      fantasmi,
      'Questi indirizzi sono sorvegliati ma non esistono come pagina: l\'elenco descrive un sito che non c\'è',
    ).toEqual([]);
  });

  it('lasciano fuori le aree di mestiere del venditore', () => {
    for (const fuori of ['/seller/dashboard', '/orders', '/profile', '/rider']) {
      expect(isMarketplaceBrowsePath(fuori), `${fuori} non è una vetrina del catalogo`).toBe(false);
    }
  });
});
