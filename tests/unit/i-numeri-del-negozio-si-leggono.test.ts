/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ComponentType } from 'react';
import { monta } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';
import { contrasto, daEsadecimale } from './aiuti/contrasto';

/**
 * 3/9/2026 — NEL CRUSCOTTO DEL NEGOZIO LE RIGHE SOTTO I NUMERI NON SI
 * LEGGEVANO.
 *
 * È lo schermo che il negoziante apre ogni mattina. In cima c'è una fascia
 * terracotta con tre riquadri — oggi, sette giorni, trenta giorni — e sotto
 * ogni cifra una riga che spiega cosa vuol dire («3 ordini · al netto»). Quella
 * riga era bianco trasparente su fondo terracotta: misurata sui colori veri,
 * staccava 2,5 volte dallo sfondo contro le 4,5 che servono a un testo normale.
 * E era scritta a 11 pixel, il carattere più piccolo del sito.
 *
 * Non sparisce: semplicemente non la legge chi ha poca vista, chi guarda il
 * telefono al sole, chi ha lo schermo scadente. Cioè molta più gente di quanta
 * si pensi, sulla riga che spiega quanto ha incassato.
 *
 * QUESTA PROVA NON CERCA UNA CLASSE: rifà il conto. Legge i colori veri da
 * `tailwind.config.ts`, monta la pagina, prende le classi che finiscono davvero
 * a video, sovrappone le trasparenze una sull'altra come fa il browser e
 * calcola il rapporto di contrasto WCAG. Se domani qualcuno rimette una
 * trasparenza — o cambia la sfumatura di sfondo con una più chiara — questa
 * prova diventa rossa da sola.
 *
 * Il fondo non è un colore solo: è una sfumatura a tre tappe. Il conto si fa su
 * tutte e tre e vale la peggiore, perché il negoziante la riga la legge tutta,
 * non solo dove il fondo è comodo.
 */

/** Il testo normale deve staccare 4,5 volte dal suo sfondo (WCAG 1.4.3, AA). */
const SOGLIA_TESTO = 4.5;
/** Il gradino più piccolo dichiarato dal sistema tipografico: 12 pixel. */
const MINIMO_PIXEL = 12;

type Tavolozza = Record<string, Record<string, string>>;

async function tavolozza(): Promise<Tavolozza> {
  const mod = await monta('tailwind.config.ts');
  const config = mod.default as { theme?: { extend?: { colors?: Tavolozza } } };
  return config.theme?.extend?.colors ?? {};
}

/** Da `bg-white/10`, `text-cream-200`, `from-primary-700` al colore vero e alla sua opacità. */
function risolvi(
  classe: string,
  prefisso: string,
  colori: Tavolozza,
): { classe: string; hex: string; alfa: number } | null {
  if (!classe.startsWith(prefisso) || classe.includes(':')) return null;
  const [nome, opacita] = classe.slice(prefisso.length).split('/');
  const alfa = opacita === undefined ? 1 : Number(opacita) / 100;
  if (!Number.isFinite(alfa) || alfa < 0 || alfa > 1) return null;
  if (nome === 'white') return { classe, hex: '#FFFFFF', alfa };
  if (nome === 'black') return { classe, hex: '#000000', alfa };
  const m = nome.match(/^([a-z]+)-(\d+)$/);
  if (!m) return null;
  const hex = colori[m[1]]?.[m[2]];
  return hex ? { classe, hex, alfa } : null;
}

/** Un colore semitrasparente steso sopra un altro, come lo compone il browser. */
function sovrapponi(sopra: string, alfa: number, sotto: string): string {
  const a = daEsadecimale(sopra);
  const b = daEsadecimale(sotto);
  return (
    '#' +
    a
      .map((v, i) => Math.round(alfa * v + (1 - alfa) * b[i]).toString(16).padStart(2, '0'))
      .join('')
  );
}

const classi = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);

/** Le tappe della sfumatura di sfondo della fascia. */
function tappeDellaSfumatura(fascia: Element, colori: Tavolozza): string[] {
  const tappe = classi(fascia)
    .map((c) => risolvi(c, 'from-', colori) ?? risolvi(c, 'via-', colori) ?? risolvi(c, 'to-', colori))
    .filter((x): x is { classe: string; hex: string; alfa: number } => !!x)
    .map((x) => x.hex);
  return tappe.length > 0 ? tappe : [];
}

/** Tutti i fondi possibili sotto un testo: uno per ogni tappa della sfumatura. */
function fondiSotto(el: Element, fascia: Element, colori: Tavolozza): string[] {
  const strati: Array<{ hex: string; alfa: number }> = [];
  let n: Element | null = el;
  while (n) {
    for (const c of classi(n)) {
      const r = risolvi(c, 'bg-', colori);
      if (r) strati.push(r);
    }
    if (n === fascia) break;
    n = n.parentElement;
  }
  // Raccolti dal più interno al più esterno: si stendono al contrario.
  strati.reverse();
  return tappeDellaSfumatura(fascia, colori).map((base) =>
    strati.reduce((fondo, s) => sovrapponi(s.hex, s.alfa, fondo), base),
  );
}

/** Il colore del testo: il suo, o quello che eredita dal primo antenato che lo dichiara. */
function coloreDelTesto(el: Element, fascia: Element, colori: Tavolozza) {
  let n: Element | null = el;
  while (n) {
    for (const c of classi(n)) {
      const r = risolvi(c, 'text-', colori);
      if (r) return r;
    }
    if (n === fascia) break;
    n = n.parentElement;
  }
  return null;
}

/** Le righe di testo della fascia. I comandi (link e pulsanti) hanno una regola loro. */
function righeDiTesto(fascia: Element): Element[] {
  return Array.from(fascia.querySelectorAll('p, h1, h2, span')).filter((el) => {
    if (el.closest('a, button')) return false;
    if (el.getAttribute('aria-hidden') !== null) return false;
    const proprio = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => (n.textContent ?? '').trim())
      .join('');
    return proprio.length > 0;
  });
}

const STATISTICHE = {
  productCount: 12,
  availableCount: 9,
  orderCount: 34,
  vendutoArticoli: 812,
  incassato: 600,
  netto: 435,
  revenueToday: 43.5,
  revenue7: 187.2,
  revenue30: 435,
  ordiniOggi: 3,
  ordini7: 11,
  ordini30: 34,
  ordersToday: 3,
  orders7: 11,
  last30Count: 34,
  avgRating: 4.6,
  reviewCount: 8,
};

function apriIlCruscotto() {
  (globalThis as Record<string, unknown>).__PROFILO__ = {
    isSeller: true,
    profile: { id: 'negozio-1', store_name: 'Pane Quotidiano' },
  };
  (globalThis as Record<string, unknown>).__DATI_QUERY__ = (o: { queryKey?: readonly unknown[] }) =>
    Array.isArray(o?.queryKey) && o.queryKey[0] === 'seller' && o.queryKey[1] === 'stats'
      ? STATISTICHE
      : undefined;
}

describe('la fascia in cima al cruscotto del negozio', () => {
  beforeEach(apriIlCruscotto);
  afterEach(() => {
    document.body.innerHTML = '';
    delete (globalThis as Record<string, unknown>).__DATI_QUERY__;
    delete (globalThis as Record<string, unknown>).__PROFILO__;
  });

  it('ogni riga stacca dal suo sfondo almeno quanto serve per leggerla', async () => {
    const colori = await tavolozza();
    const mod = await monta('app/seller/dashboard/page.tsx');
    const s = accendi(mod.default as ComponentType);

    const fascia = s.radice.querySelector('section[class*="bg-gradient-to-br"]');
    expect(fascia, 'La fascia terracotta in cima al cruscotto non c\'è più: la prova non guarda niente').toBeTruthy();

    const tappe = tappeDellaSfumatura(fascia!, colori);
    expect(tappe.length, 'La sfumatura di sfondo non ha nessuna tappa riconoscibile').toBeGreaterThan(0);

    const righe = righeDiTesto(fascia!);
    expect(
      righe.length,
      'Nella fascia non c\'è più nessuna riga di testo: senza righe questa prova non prova niente',
    ).toBeGreaterThanOrEqual(8);

    const deboli: string[] = [];
    for (const riga of righe) {
      const testo = riga.textContent?.trim().slice(0, 30) ?? '';
      const colore = coloreDelTesto(riga, fascia!, colori);
      expect(colore, `Non riconosco il colore di «${testo}»: ${riga.getAttribute('class')}`).toBeTruthy();

      for (const fondo of fondiSotto(riga, fascia!, colori)) {
        const tinta = colore!.alfa === 1 ? colore!.hex : sovrapponi(colore!.hex, colore!.alfa, fondo);
        const misura = contrasto(tinta, fondo);
        if (misura < SOGLIA_TESTO) {
          deboli.push(`«${testo}» ${colore!.classe} su ${fondo} = ${misura.toFixed(2)}:1`);
        }
      }
    }

    expect(
      deboli,
      `Su questa fascia un testo normale deve staccare ${SOGLIA_TESTO} volte. Attenzione: sul punto più chiaro della sfumatura nemmeno il bianco pieno ci arriva, quindi non basta togliere la trasparenza al testo — va scurito il fondo della targhetta`,
    ).toEqual([]);
    s.smonta();
  }, 120000);

  it('nessuna riga è scritta più piccola del gradino minimo del sistema', async () => {
    const colori = await tavolozza();
    const mod = await monta('app/seller/dashboard/page.tsx');
    const s = accendi(mod.default as ComponentType);
    const fascia = s.radice.querySelector('section[class*="bg-gradient-to-br"]')!;
    void colori;

    const minuscole: string[] = [];
    for (const riga of righeDiTesto(fascia)) {
      for (const c of classi(riga)) {
        const m = c.match(/^text-\[(\d+(?:\.\d+)?)px\]$/);
        if (m && Number(m[1]) < MINIMO_PIXEL) {
          minuscole.push(`«${riga.textContent?.trim().slice(0, 30)}» ${c}`);
        }
        if (c === 'text-2xs') minuscole.push(`«${riga.textContent?.trim().slice(0, 30)}» ${c}`);
      }
    }

    expect(
      minuscole,
      `Le righe che spiegano i numeri erano a 11 pixel: sotto i ${MINIMO_PIXEL} dichiarati dal sistema, e proprio sulla riga che dice cosa vuol dire la cifra`,
    ).toEqual([]);
    s.smonta();
  }, 120000);
});
