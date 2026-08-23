import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { SECCHIO_PUBBLICO } from '@/lib/storage/percorso-caricamento';

/**
 * #167 · ANTI-RICADUTA — nessuno costruisce piu' a mano il percorso di caricamento.
 *
 * ── Che tipo di prova e' questa, detto prima ─────────────────────────────────────────────────
 * Non e' la prova che il difetto e' riparato: quella e'
 * `tests/unit/il-percorso-che-il-database-rifiuta.test.ts`, che ESEGUE la porta con un client finto
 * e guarda il percorso che consegna allo storage.
 *
 * Questa e' un invariante di struttura, e va detto perche' e' un controllo su del TESTO: «nessun
 * file, a parte la porta, chiama `.upload()` sul secchio pubblico». Un controllo cosi' non puo'
 * fallire come fallisce la realta' — ma la proprieta' che misura e' esattamente strutturale, e il
 * giorno in cui qualcuno riscrive una chiamata a mano diventa rosso.
 *
 * Perche' serve, misurato il 23/8/2026: rimettendo a mano `store-media/…` dentro il componente, le
 * diciannove prove della porta restavano tutte VERDI. Provavano che la regola sa giudicare, non che
 * chi carica ci passi — ed e' la stessa distinzione che aveva lasciato vivere il difetto per mesi.
 * In un ambiente senza schermo il componente non si puo' far girare; quello che si puo' fare e'
 * impedire che la strada alternativa venga riaperta in silenzio.
 */

const RADICE = process.cwd();
const CARTELLE = ['app', 'components', 'lib'];

/** Chi puo' chiamare `.upload()` sul secchio pubblico, e perche'. */
const AMMESSI = new Map<string, string>([
  ['lib/storage/carica-immagine.ts', "e' la porta: e' il suo mestiere"],
]);

function tuttiIFile(dir: string, out: string[] = []): string[] {
  for (const voce of readdirSync(dir)) {
    if (voce === 'node_modules' || voce.startsWith('.')) continue;
    const pieno = join(dir, voce);
    if (statSync(pieno).isDirectory()) tuttiIFile(pieno, out);
    else if (/\.(ts|tsx)$/.test(voce)) out.push(pieno);
  }
  return out;
}

describe('la porta dei caricamenti non si scavalca', () => {
  const file = CARTELLE.flatMap((c) => tuttiIFile(join(RADICE, c)));

  it('trova davvero dei file da guardare (se no non sta misurando niente)', () => {
    expect(file.length).toBeGreaterThan(200);
  });

  it(`nessuno chiama .upload() sul secchio «${SECCHIO_PUBBLICO}» fuori dalla porta`, () => {
    const colpevoli: string[] = [];
    for (const f of file) {
      const rel = relative(RADICE, f);
      if (AMMESSI.has(rel)) continue;
      const testo = readFileSync(f, 'utf8');
      if (new RegExp(`from\\(\\s*['"\`]${SECCHIO_PUBBLICO}['"\`]\\s*\\)\\s*\\.upload\\(`).test(testo)) {
        colpevoli.push(rel);
      }
    }
    expect(
      colpevoli,
      `questi file caricano sul secchio pubblico senza passare dalla porta: costruiscono il percorso ` +
        `a mano, ed e' esattamente cosi' che tre schermate sono nate rifiutate dal database. ` +
        `Usa caricaImmagine() da @/lib/storage/carica-immagine.\n  ${colpevoli.join('\n  ')}`,
    ).toEqual([]);
  });

  it('le esenzioni dichiarate esistono ancora (se no sono bugie che coprono un buco)', () => {
    for (const [rel, perche] of AMMESSI) {
      expect(() => statSync(join(RADICE, rel)), `${rel} e' esentato «${perche}» ma non esiste piu'`).not.toThrow();
    }
  });

  it('il rilevatore non e cieco: su un testo costruito lo trova', () => {
    const finto = `await supabase.storage.from('${SECCHIO_PUBBLICO}').upload(path, file, {});`;
    expect(new RegExp(`from\\(\\s*['"\`]${SECCHIO_PUBBLICO}['"\`]\\s*\\)\\s*\\.upload\\(`).test(finto)).toBe(true);
  });
});
