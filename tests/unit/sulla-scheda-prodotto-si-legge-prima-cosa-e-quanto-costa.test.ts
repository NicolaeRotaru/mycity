/**
 * 3/9/2026 — DAL TELEFONO, IL NOME E IL PREZZO ARRIVAVANO DOPO LA PARTITA IVA.
 *
 * ── Cosa succedeva ──────────────────────────────────────────────────────────────────────────
 * Sulla scheda prodotto la griglia su telefono è a una colonna sola: i blocchi si leggono
 * nell'ordine in cui sono scritti. E l'ordine scritto era: la scheda del negozio, il link
 * «Segnala questo contenuto», il riquadro «Venduto da» con ragione sociale, sede e partita IVA —
 * e SOLO ALLORA il nome del prodotto e il prezzo. Sopra c'era già la foto quadrata a tutto
 * schermo, le miniature, le briciole di pane.
 *
 * Chi apriva un prodotto dal telefono vedeva quindi una foto, un negozio, un invito a segnalare
 * un abuso e una partita IVA prima di leggere COSA stava guardando e QUANTO costava.
 *
 * C'era anche la gerarchia dei titoli rovesciata: `VendutoDa` apre con un `<h2>`, e finiva
 * renderizzato prima dell'`<h1>` della pagina. Per chi naviga con un lettore di schermo la
 * struttura del documento comincia da un sottotitolo.
 *
 * ── Cosa prova questo file ──────────────────────────────────────────────────────────────────
 * Che nella colonna delle informazioni il nome del prodotto venga per primo, e che nessun blocco
 * che apre un titolo gli stia sopra. L'elenco dei blocchi che aprono un titolo NON è scritto qui:
 * si legge nei file dei componenti, uno per uno. Se domani un componente nuovo con un `<h2>`
 * dentro viene messo sopra il nome, questa prova diventa rossa senza che nessuno la aggiorni.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

const PAGINA = 'app/product/[id]/page.tsx';
const SORGENTE = readFileSync(PAGINA, 'utf8');

/** La colonna delle informazioni: da «INFO» fino al riquadro d'acquisto. */
const COLONNA = (() => {
  const da = SORGENTE.indexOf('{/* INFO');
  const a = SORGENTE.indexOf('{/* CTA STICKY');
  expect(da, 'la colonna delle informazioni non si trova più: la prova va riscritta').toBeGreaterThan(-1);
  expect(a).toBeGreaterThan(da);
  return SORGENTE.slice(da, a);
})();

/** Dove sta un pezzo dentro la colonna. −1 se non c'è. */
const dove = (pezzo: string | RegExp) =>
  typeof pezzo === 'string' ? COLONNA.indexOf(pezzo) : COLONNA.search(pezzo);

/** Il file di un componente, letto dalle righe di import della pagina. */
function fileDelComponente(nome: string): string | null {
  const m = SORGENTE.match(new RegExp(`import\\s+(?:\\{[^}]*\\b${nome}\\b[^}]*\\}|${nome})\\s+from\\s+'@/([^']+)'`));
  if (!m) return null;
  for (const est of ['.tsx', '.ts']) {
    if (existsSync(m[1] + est)) return m[1] + est;
  }
  return null;
}

describe('su telefono la colonna è una sola, quindi l’ordine scritto è l’ordine che si legge', () => {
  it('la griglia parte da una colonna: senza questo il resto della prova non vuol dire niente', () => {
    expect(SORGENTE).toMatch(/className="grid grid-cols-1 /);
  });
});

describe('il nome del prodotto è la prima cosa della colonna informazioni', () => {
  const nome = dove(/<h1 className="flex-1/);

  it('l’<h1> col nome del prodotto c’è', () => {
    expect(nome, "l'h1 col nome non si trova più nella colonna: la prova va riscritta").toBeGreaterThan(-1);
  });

  it('niente lo precede fra i blocchi che aprono un titolo', () => {
    const componenti = [...new Set([...COLONNA.matchAll(/<([A-Z]\w+)/g)].map((m) => m[1]))];
    const conTitolo: string[] = [];
    for (const c of componenti) {
      const file = fileDelComponente(c);
      if (!file) continue;
      // Apre un titolo di pagina o di sezione? Allora sopra l'h1 non ci può stare.
      if (/<h[12][\s>]/.test(readFileSync(file, 'utf8'))) conTitolo.push(c);
    }

    expect(
      conTitolo.length,
      'nessun componente della colonna apre un titolo: la prova non sta misurando niente',
    ).toBeGreaterThan(0);

    for (const c of conTitolo) {
      expect(
        dove(`<${c}`),
        `«${c}» apre un titolo e sta sopra l'<h1> col nome del prodotto: la gerarchia è rovesciata`,
      ).toBeGreaterThan(nome);
    }
  });
});

describe('e subito dopo il nome si legge quanto costa, non con chi si firma il contratto', () => {
  const nome = dove(/<h1 className="flex-1/);
  const prezzo = dove(/<span className="text-4xl font-extrabold/);
  const partitaIva = dove('<VendutoDa');
  const segnala = dove('<Segnala');
  const negozio = dove('<SellerCard');

  it('i quattro blocchi ci sono ancora tutti', () => {
    for (const [n, p] of [['prezzo', prezzo], ['VendutoDa', partitaIva], ['Segnala', segnala], ['SellerCard', negozio]] as const) {
      expect(p, `«${n}» non si trova più nella colonna: la prova va riscritta`).toBeGreaterThan(-1);
    }
  });

  it('il prezzo viene prima della ragione sociale e del link per segnalare', () => {
    expect(prezzo, 'il prezzo si legge dopo il nome').toBeGreaterThan(nome);
    expect(partitaIva, 'la partita IVA si legge prima del prezzo').toBeGreaterThan(prezzo);
    expect(segnala, 'l’invito a segnalare un abuso si legge prima del prezzo').toBeGreaterThan(prezzo);
  });

  it('la scheda del negozio sta sotto il titolo, non sopra', () => {
    expect(negozio, 'il negozio si legge prima di sapere cosa si sta guardando').toBeGreaterThan(nome);
  });
});
