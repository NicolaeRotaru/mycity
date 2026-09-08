/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ComponentType } from 'react';
import { monta } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';
import {
  apriIlCruscotto, chiudiIlCruscotto, statisticheDelCruscotto,
} from './aiuti/cruscotto-del-negozio';

/**
 * 6/9/2026 — SUL TELEFONO L'INCASSO USCIVA DAL SUO RIQUADRO.
 *
 * In cima al cruscotto del negoziante ci sono tre riquadri — oggi, sette
 * giorni, trenta giorni — con dentro quanto ha guadagnato. Stavano in fila per
 * tre a QUALSIASI larghezza: `grid-cols-3`, senza nessuna variante per lo
 * schermo piccolo.
 *
 * Il conto su un telefono da 360 punti: la pagina ne toglie 32 di margine
 * laterale, la fascia colorata altri 48, restano 280. Tolti gli spazi fra i
 * riquadri e diviso tre, a ognuno ne restano una sessantina di scritto utile.
 * «€1234.56» — una parola sola, senza punti dove andare a capo — a quel corpo
 * ne occupa piu' di ottanta. Cioe' il negozio che vende bene e' proprio quello
 * a cui la cifra sbordava sul riquadro accanto.
 *
 * QUESTA PROVA NON CERCA UNA CLASSE NEL FILE: monta la pagina, legge dal DOM le
 * classi che finiscono davvero a video (quante colonne sul telefono, quanto
 * spazio interno, che corpo ha la cifra), rifa' il conto della larghezza
 * disponibile e la confronta con la larghezza della cifra scritta. Se domani
 * qualcuno rimette i tre in fila, o rialza il corpo del carattere, questa
 * diventa rossa da sola.
 *
 * QUELLO CHE QUESTA PROVA NON PUO' FARE: jsdom non impagina, quindi la
 * larghezza del testo e' stimata dalle metriche di Inter (le cifre di questo
 * carattere sono larghe circa sei decimi del corpo), non misurata da un motore
 * grafico. E' un bilancio di spazio, non uno screenshot.
 */

/** Lo schermo stretto su cui il negoziante apre il cruscotto al banco. */
const TELEFONO = 360;
/** `main ... px-4` in components/seller/SellerShell.tsx: 16 punti per lato. */
const MARGINE_PAGINA = 32;

/** La scala di Tailwind: `p-6` = 6 × 4 punti. */
const passo = (n: number) => n * 4;

/** Il corpo dei caratteri, dai nomi di Tailwind ai punti. */
const CORPI: Record<string, number> = {
  'text-xs': 12, 'text-sm': 14, 'text-base': 16, 'text-lg': 18,
  'text-xl': 20, 'text-2xl': 24, 'text-3xl': 30, 'text-4xl': 36,
};

/** Quanto e' larga una lettera, in frazioni del corpo (Inter, grassetto). */
function larghezzaInEm(carattere: string): number {
  if (carattere >= '0' && carattere <= '9') return 0.6;
  if (carattere === '€') return 0.63;
  if ('.,'.includes(carattere)) return 0.28;
  if (carattere === ' ') return 0.26;
  return 0.55;
}

const larghezzaDelTesto = (testo: string, corpo: number) =>
  [...testo].reduce((s, c) => s + larghezzaInEm(c), 0) * corpo;

const classi = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
/** Solo le classi senza due punti: quelle che valgono sul telefono. */
const classiDelTelefono = (el: Element) => classi(el).filter((c) => !c.includes(':'));

/** Il primo numero che segue un prefisso, fra le classi valide sul telefono. */
function numeroDellaClasse(el: Element, prefisso: string): number | null {
  for (const c of classiDelTelefono(el)) {
    const m = c.match(new RegExp(`^${prefisso}(\\d+(?:\\.\\d+)?)$`));
    if (m) return Number(m[1]);
  }
  return null;
}

/** Un negozio che sta andando bene: quattro cifre prima della virgola. */
const apriIlCruscottoDelNegozio = () =>
  apriIlCruscotto(statisticheDelCruscotto({
    revenueToday: 234.56, revenue7: 1234.56, revenue30: 4321.99,
    ordiniOggi: 4, ordini7: 21, ordini30: 88,
  }));

describe('i tre riquadri dei guadagni, in cima al cruscotto del negozio', () => {
  beforeEach(apriIlCruscottoDelNegozio);
  afterEach(chiudiIlCruscotto);

  it('su uno schermo da 360 punti ogni cifra ci sta dentro il suo riquadro', async () => {
    const mod = await monta('app/seller/dashboard/page.tsx');
    const s = accendi(mod.default as ComponentType);

    const fascia = s.radice.querySelector('section[class*="bg-gradient-to-br"]');
    expect(fascia, 'La fascia in cima al cruscotto non c\'è più: la prova non guarda niente').toBeTruthy();

    const dentro = fascia!.querySelector('div[class*="p-6"], div[class*="p-5"], div[class*="p-4"]');
    const imbottituraFascia = dentro ? (numeroDellaClasse(dentro, 'p-') ?? 0) : 0;
    expect(imbottituraFascia, 'Non riconosco l\'imbottitura della fascia').toBeGreaterThan(0);

    const griglia = Array.from(fascia!.querySelectorAll('div[class*="grid-cols-"]')).find((g) =>
      (g.textContent ?? '').includes('Oggi') && (g.textContent ?? '').includes('30 giorni'),
    );
    expect(griglia, 'Non trovo più la griglia dei tre riquadri (Oggi / 7 giorni / 30 giorni)').toBeTruthy();

    const colonne = numeroDellaClasse(griglia!, 'grid-cols-');
    expect(colonne, 'La griglia non dichiara quante colonne fa sul telefono').toBeTruthy();
    const spazio = passo(numeroDellaClasse(griglia!, 'gap-') ?? 0);

    // Lo spazio scritto disponibile dentro la fascia, sul telefono.
    const dentroLaFascia = TELEFONO - MARGINE_PAGINA - 2 * passo(imbottituraFascia);
    const larghezzaColonna = (dentroLaFascia - spazio * (colonne! - 1)) / colonne!;

    const stretti: string[] = [];
    for (const riquadro of Array.from(griglia!.children)) {
      const occupa = numeroDellaClasse(riquadro, 'col-span-') ?? 1;
      const imbottitura = passo(numeroDellaClasse(riquadro, 'px-') ?? 0);
      const utile = larghezzaColonna * occupa + spazio * (occupa - 1) - 2 * imbottitura;

      const cifra = Array.from(riquadro.querySelectorAll('p')).find((p) =>
        (p.textContent ?? '').includes('€'),
      );
      expect(cifra, `Nel riquadro «${riquadro.textContent?.slice(0, 12)}» non c'è più nessuna cifra`).toBeTruthy();

      const nomeCorpo = classiDelTelefono(cifra!).find((c) => c in CORPI);
      expect(nomeCorpo, `Non riconosco il corpo della cifra: ${cifra!.getAttribute('class')}`).toBeTruthy();

      const testo = cifra!.textContent ?? '';
      const serve = larghezzaDelTesto(testo, CORPI[nomeCorpo!]);
      if (serve > utile) {
        stretti.push(`«${testo}» chiede ${serve.toFixed(0)} punti e ne ha ${utile.toFixed(0)}`);
      }
    }

    expect(
      stretti,
      'Su 360 punti la cifra esce dal riquadro e finisce sopra quello accanto: sul telefono i riquadri non possono stare tre in fila',
    ).toEqual([]);
    s.smonta();
  }, 120000);

  it('la griglia si allarga da tablet in su invece di restare fissa', async () => {
    const mod = await monta('app/seller/dashboard/page.tsx');
    const s = accendi(mod.default as ComponentType);
    const fascia = s.radice.querySelector('section[class*="bg-gradient-to-br"]')!;
    const griglia = Array.from(fascia.querySelectorAll('div[class*="grid-cols-"]')).find((g) =>
      (g.textContent ?? '').includes('Oggi') && (g.textContent ?? '').includes('30 giorni'),
    )!;

    expect(
      classi(griglia).some((c) => /^(sm|md|lg):grid-cols-/.test(c)),
      'Stringere le colonne sul telefono senza riallargarle sul grande vuol dire buttare via metà dello schermo del computer',
    ).toBe(true);
    s.smonta();
  }, 120000);
});
