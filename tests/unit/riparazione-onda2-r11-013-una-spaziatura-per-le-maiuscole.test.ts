import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * R11-013 — OTTO SPAZIATURE DIVERSE PER LA STESSA ETICHETTA MAIUSCOLA.
 *
 * Il design ha una misura sola per l'etichetta in maiuscoletto (eyebrow, intestazioni di colonna,
 * didascalie dei riquadri): `--tracking-wide` = 0,04em, che in Tailwind è `tracking-label` (e
 * `tracking-wide`, reso uguale nella sessione S10). Nel codice la stessa etichetta era scritta con
 * `tracking-wider` (0,05em), `tracking-widest` (0,1em), `tracking-[0.03em]`, `[0.04em]`, `[0.05em]`,
 * `[0.06em]`, `[0.08em]` o senza spaziatura: sulla stessa pagina del fattorino «DATI PERSONALI»
 * respirava 0,03em e «VEICOLO» zero, nell'amministrazione l'eyebrow 0,06em e i riquadri 0,04em.
 *
 * Adesso ogni classe con `uppercase` in app/, components/ e lib/ ha `tracking-label` (o il suo
 * gemello `tracking-wide`), e le due utility valgono quanto il token del design. Le uniche maiuscole
 * senza la spaziatura dell'etichetta sono quelle che etichette non sono, elencate qui sotto col
 * perché: chi ne aggiunge una nuova sceglie, e lo scrive.
 */

const RADICE = process.cwd();
const CARTELLE = ['app', 'components', 'lib'];
const AMMESSE = new Set(['tracking-label', 'tracking-wide']);

/** Maiuscole che non sono etichette: [file, un pezzo della classe che le riconosce, perché]. */
const NON_ETICHETTE: Array<[string, string, string]> = [
  ['components/Navbar.tsx', 'rounded-full', 'iniziale del nome nell’avatar'],
  ['components/MobileAccountSheet.tsx', 'rounded-full', 'iniziale del nome nell’avatar'],
  ['app/admin/coupons/page.tsx', 'uppercase', 'il campo dove si scrive il codice del buono'],
  ['components/seller/DatiDelTitolare.tsx', 'font-mono', 'il campo del codice fiscale'],
];

function file(dir: string, fuori: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) file(p, fuori);
    else if (/\.(tsx|ts)$/.test(nome)) fuori.push(p);
  }
  return fuori;
}

const MAIUSCOLO = /(?<![\w-])uppercase(?![\w-])/;
const STRINGA = /(["'`])([^"'`\n]*?(?<![\w-])uppercase(?![\w-])[^"'`\n]*?)\1/g;
const SPAZIATURA = /(?<![\w-])tracking-[^\s"'`]+/g;

type Classe = { dove: string; classe: string; spaziature: string[] };

/** Ogni classe con `uppercase`: le stringhe su una riga, e le righe di un template che va a capo. */
function classiMaiuscole(): Classe[] {
  const out: Classe[] = [];
  for (const c of CARTELLE) {
    for (const p of file(join(RADICE, c))) {
      const rel = relative(RADICE, p);
      readFileSync(p, 'utf8').split('\n').forEach((riga, i) => {
        const s = riga.trimStart();
        if (s.startsWith('*') || s.startsWith('//') || s.startsWith('/*') || !MAIUSCOLO.test(riga)) return;
        const stringhe = [...riga.matchAll(STRINGA)].map((m) => m[2]);
        for (const classe of stringhe.length > 0 ? stringhe : [riga]) {
          out.push({ dove: `${rel}:${i + 1}`, classe: classe.trim(), spaziature: classe.match(SPAZIATURA) ?? [] });
        }
      });
    }
  }
  return out;
}

const eccezione = (c: Classe) =>
  NON_ETICHETTE.find(([f, pezzo]) => c.dove.startsWith(`${f}:`) && c.classe.includes(pezzo));

describe('R11-013 · una spaziatura sola per l’etichetta maiuscola', () => {
  it('tracking-label e tracking-wide valgono quanto il token del design (--tracking-wide: 0.04em)', () => {
    const config = readFileSync(join(RADICE, 'tailwind.config.ts'), 'utf8');
    const blocco = /letterSpacing:\s*\{([\s\S]*?)\n\s*\},/.exec(config)?.[1] ?? '';
    const valore = (k: string) => new RegExp(`\\b${k}:\\s*'([^']+)'`).exec(blocco)?.[1];
    const token = /--tracking-wide:\s*([^;]+);/.exec(readFileSync(join(RADICE, 'app/globals.css'), 'utf8'))?.[1]?.trim();
    expect(token).toBe('0.04em');
    expect(valore('label')).toBe(token);
    expect(valore('wide')).toBe(token);
  });

  it('ogni classe con `uppercase` ha la spaziatura dell’etichetta, e nessun’altra', () => {
    const classi = classiMaiuscole();
    expect(classi.length, 'controprova: le maiuscole del sito ci sono').toBeGreaterThan(100);
    const fuori = classi
      .filter((c) => !eccezione(c))
      .filter((c) => c.spaziature.length !== 1 || !AMMESSE.has(c.spaziature[0]))
      .map((c) => `${c.dove} «${c.classe.slice(0, 90)}» → ${c.spaziature.join(' ') || 'nessuna spaziatura'}`);
    expect(fuori, 'etichette maiuscole con una spaziatura diversa da tracking-label (0,04em)').toEqual([]);
  });

  it('le maiuscole che non sono etichette ci sono ancora e sono solo quelle dell’elenco', () => {
    const classi = classiMaiuscole();
    for (const [f, pezzo, perche] of NON_ETICHETTE) {
      expect(classi.some((c) => c.dove.startsWith(`${f}:`) && c.classe.includes(pezzo)), `${f} (${perche}) non ha più la sua maiuscola: toglila dall'elenco`).toBe(true);
    }
  });

  it('le misure del fattorino sono le stesse dell’amministrazione e del negozio', () => {
    // I casi della voce: sulla stessa bacheca «DATI PERSONALI» a 0,03em e «VEICOLO» senza spaziatura;
    // l'eyebrow dell'amministrazione e del negozio a 0,06em, la colonna dell'account a 0,08em.
    const righe = (p: string) => readFileSync(join(RADICE, p), 'utf8');
    expect(righe('app/rider/profile/page.tsx')).toMatch(/uppercase tracking-label text-ink-400">Veicolo/);
    expect(righe('app/rider/profile/page.tsx')).toMatch(/uppercase tracking-label text-ink-700">Dati personali/);
    expect(righe('components/admin/AdminUI.tsx')).not.toMatch(/tracking-\[0\.0\d+em\]/);
    expect(righe('components/seller/SellerPageTitle.tsx')).not.toMatch(/tracking-\[0\.0\d+em\]/);
    expect(righe('components/account/AccountSidebar.tsx')).not.toMatch(/tracking-\[0\.0\d+em\]/);
  });
});
