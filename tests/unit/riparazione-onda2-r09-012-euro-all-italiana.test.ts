import { describe, it, expect, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * R09-012 — L'euro si scrive all'italiana: «12,50 €», non «€12.50», «€ 2,50» o «€0 – €500+».
 *
 * La casa dei formati è lib/format.ts (`formatPrice`, `formatPriceFromCents`, Intl it-IT). In tanti
 * posti l'importo era ancora ricomposto a mano: `€${(cents / 100).toFixed(2)}` (punto al posto
 * della virgola e simbolo davanti), `€{amount}` nelle pagine, «€5» nelle frasi. Qui:
 *  ① nessun file di app, components o lib (commenti esclusi) scrive l'euro all'inglese;
 *  ② alcuni percorsi veri danno la cifra italiana.
 */

const radice = join(__dirname, '..', '..');

function sorgenti(dir: string, out: string[] = []): string[] {
  for (const nome of readdirSync(join(radice, dir))) {
    if (nome === 'node_modules' || nome.startsWith('.')) continue;
    const rel = join(dir, nome);
    if (statSync(join(radice, rel)).isDirectory()) sorgenti(rel, out);
    else if (/\.(ts|tsx)$/.test(nome)) out.push(rel);
  }
  return out;
}

/** Il sorgente senza i commenti (le righe restano dove sono, per dire il numero giusto). */
function senzaCommenti(src: string): string {
  let out = '';
  let stato: 'codice' | 'riga' | 'blocco' = 'codice';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const dopo = src[i + 1];
    if (stato === 'codice') {
      if (c === '/' && dopo === '/' && src[i - 1] !== ':') { stato = 'riga'; i++; continue; }
      if (c === '/' && dopo === '*') { stato = 'blocco'; i++; continue; }
      out += c;
    } else if (stato === 'riga') {
      if (c === '\n') { stato = 'codice'; out += c; }
    } else if (c === '*' && dopo === '/') {
      stato = 'codice';
      i++;
    } else if (c === '\n') {
      out += c;
    }
  }
  return out;
}

/** Le forme inglesi: simbolo davanti a una cifra o a un'espressione, o decimale col punto prima dell'euro. */
const ALL_INGLESE = [
  /€\s?\$\{/, // `€${x}`
  /€\s?\{/, // €{x} nel JSX
  /€\s?\d/, // «€5», «€ 2,50»
  /toFixed\(\d\)\}?\s?€/, // `${x.toFixed(2)} €` / `…toFixed(2)}€`: il punto decimale
];

describe('R09-012 — ① niente euro all’inglese nel codice', () => {
  it('app, components e lib (commenti esclusi) passano da lib/format o scrivono «5 €»', () => {
    const trovati: string[] = [];
    for (const f of ['app', 'components', 'lib'].flatMap((d) => sorgenti(d))) {
      senzaCommenti(readFileSync(join(radice, f), 'utf8'))
        .split('\n')
        .forEach((riga, i) => {
          if (ALL_INGLESE.some((r) => r.test(riga))) trovati.push(`${relative('.', f)}:${i + 1}: ${riga.trim().slice(0, 120)}`);
        });
    }
    expect(trovati).toEqual([]);
  });

  it('la prova si controlla da sola: le forme di prima le vede, i commenti no', () => {
    const vede = (s: string) => ALL_INGLESE.some((r) => r.test(senzaCommenti(s)));
    expect(vede('const t = `Servono €${(c / 100).toFixed(2)}`;')).toBe(true);
    expect(vede('<span>€{minPrice} – €{maxPrice}</span>')).toBe(true);
    expect(vede("const s = 'ricevi €5 di credito';")).toBe(true);
    expect(vede('const s = `al massimo ${(c / 100).toFixed(2)} €`;')).toBe(true);
    expect(vede('// «€12.50» era il difetto')).toBe(false);
    expect(vede('<span>{minPrice} € – {maxPrice}{piu} €</span>')).toBe(false);
  });
});

vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => ({}) }));

describe('R09-012 — ② i percorsi veri scrivono la cifra all’italiana', () => {
  it('il prezzo dell’abbonamento viene da formatPriceFromCents', async () => {
    const { ABBONAMENTO_CENTESIMI_MESE, PREZZO_ABBONAMENTO_MESE } = await import('@/app/seller/earnings/commissione');
    const { formatPriceFromCents } = await import('@/lib/format');
    expect(PREZZO_ABBONAMENTO_MESE).toBe(formatPriceFromCents(ABBONAMENTO_CENTESIMI_MESE));
    expect(PREZZO_ABBONAMENTO_MESE).not.toMatch(/^€/);
  });

  it('il prezzo rifiutato dall’assistente si legge «3,50 € → 0,35 €»', async () => {
    const { motivoPrezzoRifiutato } = await import('@/lib/products/aiPatch');
    expect(motivoPrezzoRifiutato(0.35, 3.5)).toMatch(/^prezzo NON applicato \(3,50\s€ → 0,35\s€:/);
  });

  it('la regola della consegna per l’assistente dice «3,00 €», non «€3.00»', async () => {
    const { regolaConsegnaPerAi } = await import('@/lib/products/economics');
    const t = regolaConsegnaPerAi();
    expect(t).not.toMatch(/€\d|\d\.\d\d/);
    expect(t).toMatch(/\d,\d\d\s€ per una spesa da/);
  });
});
