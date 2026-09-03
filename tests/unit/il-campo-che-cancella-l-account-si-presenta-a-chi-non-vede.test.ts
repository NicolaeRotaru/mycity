import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 3/9/2026 — SUL CAMPO CHE CANCELLA L'ACCOUNT IL LETTORE DI SCHERMO DICEVA SOLO
 * «CAMPO DI TESTO».
 *
 * Nelle impostazioni del profilo, per cancellare l'account bisogna scrivere la
 * parola ELIMINA in un campo. L'etichetta stava sopra il campo ma non era
 * legata a lui: nessun `htmlFor` sulla `<label>`, nessun `id` sull'`<input>`,
 * nessun `aria-label`. Per le regole con cui si calcola il nome di un elemento
 * (HTML-AAM) quel campo non aveva nome: chi naviga con un lettore di schermo ci
 * arrivava col tasto Tab e sentiva «campo di testo, modificabile» — davanti
 * all'azione più distruttiva del profilo, senza sapere cosa scrivere. O si
 * blocca, o conferma senza aver capito. Sono i criteri WCAG 4.1.2 e 3.3.2,
 * tutti e due di livello A.
 *
 * ── Cosa prova questo file ─────────────────────────────────────────────────
 * Non cerca la parola `htmlFor`. RICALCOLA il nome accessibile di OGNI campo
 * scritto a mano nella pagina, con le stesse regole del lettore di schermo, e
 * pretende che non sia vuoto. Il campo di domani, scritto a mano come questo,
 * cade nella stessa rete.
 *
 * ⚪ Da qui non apro NVDA né VoiceOver: quello che verifico è che il nome esista
 * e da dove lo prende, non come lo pronuncia una voce vera.
 */

const PAGINA = join(process.cwd(), 'app/profile/settings/page.tsx');
const sorgente = readFileSync(PAGINA, 'utf8');

type Campo = { tag: string; inizio: number };
type Etichetta = { per: string | null; testo: string; inizio: number; fine: number };

/** Ogni `<input …>` scritto a mano nella pagina (la primitiva Input non conta: il nome lo lega da sé). */
function campiScrittiAMano(src: string): Campo[] {
  const campi: Campo[] = [];
  const re = /<input\b/g;
  for (const m of src.matchAll(re)) {
    const inizio = m.index!;
    const fine = src.indexOf('/>', inizio);
    campi.push({ tag: src.slice(inizio, fine + 2), inizio });
  }
  return campi;
}

/** Ogni `<label …>…</label>`, con il testo che resta togliendo i tag. */
function etichette(src: string): Etichetta[] {
  const trovate: Etichetta[] = [];
  for (const m of src.matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label>/g)) {
    const attributi = m[1];
    const per = attributi.match(/htmlFor="([^"]+)"/)?.[1] ?? null;
    const testo = m[2]
      .replace(/<[^>]*>/g, ' ')       // via i tag interni (lo <span> di ELIMINA)
      .replace(/\{[^}]*\}/g, ' ')     // via le espressioni
      .replace(/\s+/g, ' ')
      .trim();
    trovate.push({ per, testo, inizio: m.index!, fine: m.index! + m[0].length });
  }
  return trovate;
}

function attributo(tag: string, nome: string): string | null {
  return tag.match(new RegExp(`${nome}="([^"]*)"`))?.[1] ?? null;
}

/**
 * Il nome accessibile del campo, calcolato come lo calcola un lettore di
 * schermo: prima `aria-labelledby`, poi `aria-label`, poi la `<label>` legata
 * dall'`id`, poi la `<label>` che lo avvolge. Il segnaposto lo tengo da parte:
 * per lo standard un nome lo fa, ma sparisce appena si scrive, quindi qui non
 * vale come nome.
 */
function nomeAccessibile(campo: Campo, tutte: Etichetta[], src: string): { nome: string; da: string } {
  const perId = attributo(campo.tag, 'aria-labelledby');
  if (perId) {
    const bersaglio = src.match(new RegExp(`id="${perId}"[\\s\\S]{0,400}?>([^<]+)<`));
    return { nome: (bersaglio?.[1] ?? '').trim(), da: 'aria-labelledby' };
  }
  const ariaLabel = attributo(campo.tag, 'aria-label');
  if (ariaLabel) return { nome: ariaLabel.trim(), da: 'aria-label' };

  const id = attributo(campo.tag, 'id');
  if (id) {
    const legata = tutte.find((e) => e.per === id);
    if (legata) return { nome: legata.testo, da: 'label htmlFor' };
  }
  const avvolge = tutte.find((e) => campo.inizio > e.inizio && campo.inizio < e.fine);
  if (avvolge) return { nome: avvolge.testo, da: 'label che lo avvolge' };

  return { nome: '', da: attributo(campo.tag, 'placeholder') ? 'solo il segnaposto' : 'niente' };
}

describe('i campi scritti a mano nelle impostazioni del profilo', () => {
  const campi = campiScrittiAMano(sorgente);
  const tutte = etichette(sorgente);

  it('ce n è almeno uno, altrimenti questa prova non guarda niente', () => {
    expect(campi.length).toBeGreaterThan(0);
    expect(tutte.length).toBeGreaterThan(0);
  });

  it('ognuno ha un nome che un lettore di schermo può leggere', () => {
    for (const campo of campi) {
      const { nome, da } = nomeAccessibile(campo, tutte, sorgente);
      const riga = sorgente.slice(0, campo.inizio).split('\n').length;
      expect(
        nome.length,
        `il campo alla riga ${riga} non ha nome (${da}): il lettore di schermo dice solo «campo di testo»`,
      ).toBeGreaterThan(0);
    }
  });

  it('quello che cancella l account dice cosa bisogna scrivere', () => {
    const conferma = campi.find((c) => attributo(c.tag, 'id') === 'conferma-eliminazione');
    expect(conferma, 'il campo di conferma dell eliminazione non ha più il suo id').toBeDefined();

    const { nome, da } = nomeAccessibile(conferma!, tutte, sorgente);
    expect(da).toBe('label htmlFor');
    expect(nome, `il nome letto è «${nome}»: non dice la parola da scrivere`).toContain('ELIMINA');
    expect(nome.toLowerCase()).toContain('scrivi');
  });
});
