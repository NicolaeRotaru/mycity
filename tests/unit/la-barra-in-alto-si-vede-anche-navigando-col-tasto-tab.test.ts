/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';
import { contrasto } from './aiuti/contrasto';

/**
 * CHI NAVIGA COL TASTO TAB PERDEVA IL SEGNO SULLA BARRA IN ALTO.
 *
 * Il segno che dice «sei qui» — l'anello del fuoco — è per tutto il sito un
 * filetto terracotta (`app/globals.css`). La barra in alto ha il fondo dello
 * stesso terracotta: uno sull'altro staccano 1,34 volte su 1, cioè il segno
 * non si vede. Le regole ne chiedono almeno 3. Chi si muove con la tastiera
 * arrivava sul carrello, sulle notifiche o sul menu dell'account e non sapeva
 * più dove fosse.
 *
 * Il filetto si disegna FUORI dal comando (`outline-offset: 2px`), quindi il
 * fondo che conta non è quello del pulsante: è quello che gli sta intorno.
 * Questa prova monta la barra vera, guarda le classi che arrivano davvero a
 * video, e rifà il conto del contrasto sui colori scritti in `tailwind.config.ts`.
 */

const SOGLIA_ANELLO = 3;    // WCAG 2.4.11: il segno del fuoco contro ciò che gli sta accanto
const SOGLIA_TESTO = 4.5;   // WCAG 1.4.3: un testo normale contro il suo fondo
const SOGLIA_GRAFICA = 3;   // WCAG 1.4.11: un'icona, che non è un testo

type Tavolozza = Record<string, Record<string, string>>;

async function tavolozza(): Promise<Tavolozza> {
  const mod = await monta('tailwind.config.ts');
  const config = mod.default as { theme?: { extend?: { colors?: Tavolozza } } };
  return config.theme?.extend?.colors ?? {};
}

function classi(el: Element): string[] {
  return (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
}

function coloreDi(nome: string, colori: Tavolozza): string | null {
  if (nome === 'white') return '#FFFFFF';
  if (nome === 'black') return '#000000';
  const m = nome.match(/^([a-z]+)-(\d+)$/);
  return m ? (colori[m[1]]?.[m[2]] ?? null) : null;
}

/** Il fondo pieno di un elemento: i veli (`bg-white/10`) e gli stati (`hover:`) non contano. */
function fondoProprio(el: Element, colori: Tavolozza): { classe: string; hex: string } | null {
  for (const c of classi(el)) {
    if (c.includes(':') || c.includes('/')) continue;
    if (!c.startsWith('bg-')) continue;
    const hex = coloreDi(c.slice(3), colori);
    if (hex) return { classe: c, hex };
  }
  return null;
}

/** Il fondo su cui poggia un elemento, cercato risalendo dai suoi genitori. */
function fondoAttorno(el: Element, colori: Tavolozza): { classe: string; hex: string } | null {
  let n: Element | null = el.parentElement;
  while (n) {
    const trovato = fondoProprio(n, colori);
    if (trovato) return trovato;
    n = n.parentElement;
  }
  return null;
}

/** Il colore dell'anello del fuoco dichiarato su un comando, se ce n'è uno. */
function anelloDichiarato(el: Element, colori: Tavolozza): { classe: string; hex: string } | null {
  for (const c of classi(el)) {
    const m = c.match(/^focus-visible:outline-(.+)$/);
    if (!m) continue;
    const hex = coloreDi(m[1], colori);
    if (hex) return { classe: c, hex };
  }
  return null;
}

/** L'anello che il sito dà a tutti quando nessuno ne chiede uno diverso. */
function anelloDiSistema(): { colore: string; staccato: boolean } {
  const css = readFileSync('app/globals.css', 'utf8');
  const blocco = css.match(/:focus-visible\s*\{([^}]*)\}/);
  if (!blocco) throw new Error('In app/globals.css non c\'è più la regola del fuoco: questa prova non sa più cosa confrontare');
  const colore = blocco[1].match(/outline:[^;]*?(#[0-9A-Fa-f]{6})/)?.[1];
  if (!colore) throw new Error(`Non riconosco il colore del fuoco in: ${blocco[1].trim()}`);
  return { colore, staccato: /outline-offset:\s*[1-9]/.test(blocco[1]) };
}

const PROFILI = {
  ospite: {},
  cliente: { isAuthenticated: true, isBuyer: true, profile: { full_name: 'Anna Rossi' } },
  fattorino: { isAuthenticated: true, isRider: true, profile: { full_name: 'Bruno Neri' } },
  // Il cerchietto dell'amministratore mostra una LETTERA bianca, non un'icona:
  // è un testo, e come tale gli servono 4,5 volte di stacco.
  amministratore: { isAuthenticated: true, isAdmin: true, profile: { full_name: 'Chiara Verdi' } },
};

async function barra(profilo: Record<string, unknown>) {
  (globalThis as Record<string, unknown>).__PROFILO__ = profilo;
  (globalThis as Record<string, unknown>).__DATI_QUERY__ = undefined;
  const mod = await monta('components/Navbar.tsx');
  return accendi(mod.default, {});
}

describe('l\'anello del fuoco sulla barra in alto', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    delete (globalThis as Record<string, unknown>).__PROFILO__;
  });

  it('il filetto si disegna staccato dal comando: il fondo che conta è quello intorno', () => {
    expect(
      anelloDiSistema().staccato,
      'Se l\'anello smette di essere staccato, il fondo che conta diventa quello del pulsante e il conto qui sotto va rifatto',
    ).toBe(true);
  });

  it('si vede su ogni comando della barra, per chi è dentro e per chi no', async () => {
    const colori = await tavolozza();
    const sistema = anelloDiSistema();
    const invisibili: string[] = [];
    let guardati = 0;

    for (const profilo of [PROFILI.ospite, PROFILI.cliente, PROFILI.fattorino, PROFILI.amministratore]) {
      const s = await barra(profilo);
      // Solo i comandi che prendono il filetto: il campo di ricerca ha un suo
      // segno (un alone) su fondo bianco, e non passa da qui.
      for (const el of Array.from(s.radice.querySelectorAll('a[href], button'))) {
        const fondo = fondoAttorno(el, colori);
        if (!fondo) continue;
        guardati += 1;
        const anello = anelloDichiarato(el, colori);
        const colore = anello?.hex ?? sistema.colore;
        const misura = contrasto(colore, fondo.hex);
        if (misura >= SOGLIA_ANELLO) continue;
        const nome = (testoVisibile(el) || el.getAttribute('aria-label') || el.getAttribute('title') || '(senza nome)').slice(0, 40);
        invisibili.push(`«${nome}»: anello ${colore} su ${fondo.classe} ${fondo.hex} = ${misura.toFixed(2)}:1`);
      }
      s.smonta();
      document.body.innerHTML = '';
    }

    expect(guardati, 'Nella barra non c\'è più nessun comando: la prova non guarda niente').toBeGreaterThan(10);
    expect(
      invisibili,
      `Chi naviga col tasto Tab perde il segno di dove si trova: servono almeno ${SOGLIA_ANELLO} volte di stacco`,
    ).toEqual([]);
  }, 60000);
});

describe('le scritte bianche della barra in alto', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    delete (globalThis as Record<string, unknown>).__PROFILO__;
  });

  it('staccano dal loro fondo quanto serve a chi ha poca vista', async () => {
    const colori = await tavolozza();
    const deboli: string[] = [];
    let guardati = 0;

    for (const profilo of [PROFILI.ospite, PROFILI.cliente, PROFILI.fattorino, PROFILI.amministratore]) {
      const s = await barra(profilo);
      for (const el of Array.from(s.radice.querySelectorAll('*'))) {
        if (!classi(el).includes('text-white')) continue;
        const fondo = fondoProprio(el, colori) ?? fondoAttorno(el, colori);
        if (!fondo || fondo.hex === '#FFFFFF') continue;
        guardati += 1;
        // Un'icona non è un testo: le regole le chiedono 3 volte di stacco, a
        // un testo 4,5. Decide quello che l'elemento mostra davvero.
        const scritta = testoVisibile(el);
        const soglia = scritta ? SOGLIA_TESTO : SOGLIA_GRAFICA;
        const misura = contrasto('#FFFFFF', fondo.hex);
        if (misura >= soglia) continue;
        deboli.push(`«${(scritta || '(icona)').slice(0, 40)}» bianco su ${fondo.classe} ${fondo.hex} = ${misura.toFixed(2)}:1, ne servono ${soglia}`);
      }
      s.smonta();
      document.body.innerHTML = '';
    }

    expect(guardati, 'Nella barra non c\'è più niente di scritto in bianco: la prova non guarda niente').toBeGreaterThan(0);
    expect(deboli, 'Bianco su un fondo troppo chiaro: si legge male al sole e con poca vista').toEqual([]);
  }, 60000);
});
