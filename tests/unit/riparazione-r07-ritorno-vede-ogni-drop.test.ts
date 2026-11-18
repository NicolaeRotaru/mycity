import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { passo } from './_lavoro-di-rilascio';

/**
 * R07-001 — Dopo un ritorno indietro il riepilogo del rilascio guarda le migrazioni applicate e dice
 * se qualcuna TOGLIE qualcosa. Cercava solo DROP COLUMN, DROP TABLE e RENAME: un DROP FUNCTION (la
 * 105 alla riga 17), un DROP VIEW o un ALTER TABLE ... DROP senza la parola COLUMN passavano, e il
 * riepilogo rassicurava «il codice di prima dovrebbe trovare ancora tutto».
 *
 * Qui gira lo script vero del passo, in una cartella finta con le sue migrazioni. Senza rilascio di
 * prima (PRECEDENTE vuoto) il passo non chiama Vercel: scrive il riepilogo, con la nota sul database,
 * ed esce 1.
 */
const PASSO = 'Torna indietro, il sito appena pubblicato non risponde';
const ROOT = process.cwd();
const scene: string[] = [];

afterAll(() => {
  for (const s of scene) rmSync(s, { recursive: true, force: true });
});

function riepilogoCon(migrazioni: Record<string, string>): string {
  const scena = mkdtempSync(join(tmpdir(), 'r07-ritorno-'));
  scene.push(scena);
  mkdirSync(join(scena, 'migrations'));
  for (const [nome, testo] of Object.entries(migrazioni)) writeFileSync(join(scena, 'migrations', nome), testo);
  const riepilogo = join(scena, 'riepilogo.md');
  const uscite = join(scena, 'output.txt');
  writeFileSync(riepilogo, '');
  writeFileSync(uscite, '');
  const r = spawnSync('bash', ['-c', passo(PASSO).run!], {
    cwd: scena,
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_STEP_SUMMARY: riepilogo,
      GITHUB_OUTPUT: uscite,
      PRECEDENTE: '',
      MIGRAZIONI: String(Object.keys(migrazioni).length),
      MIGRAZIONI_ELENCO: Object.keys(migrazioni).join(' '),
    },
  });
  expect(r.status, r.stderr).toBe(1);
  return readFileSync(riepilogo, 'utf8');
}

describe('R07-001 · il riepilogo del ritorno indietro vede anche funzioni, viste e DROP senza COLUMN', () => {
  it('un DROP FUNCTION fa dire che il sito tornato indietro puo\' essere rotto', () => {
    const r = riepilogoCon({ '900_toglie_una_funzione.sql': 'DROP FUNCTION IF EXISTS public.vecchia(uuid);\n' });
    expect(r).toMatch(/TOLGONO o RINOMINANO/);
    expect(r).toMatch(/900_toglie_una_funzione\.sql`: riga 1: DROP FUNCTION/);
    expect(r).not.toMatch(/nessuna contiene/);
  });

  it('un DROP VIEW pure', () => {
    const r = riepilogoCon({ '901_toglie_una_vista.sql': 'CREATE INDEX IF NOT EXISTS i ON public.t (a);\nDROP VIEW IF EXISTS public.vetrina;\n' });
    expect(r).toMatch(/TOLGONO o RINOMINANO/);
    expect(r).toMatch(/901_toglie_una_vista\.sql`: riga 2: DROP VIEW/);
  });

  it('un ALTER TABLE ... DROP senza la parola COLUMN pure, anche su due righe', () => {
    const r = riepilogoCon({
      '902_colonna_su_una_riga.sql': 'ALTER TABLE public.orders DROP vecchia_colonna;\n',
      '903_colonna_su_due_righe.sql': 'ALTER TABLE public.orders\n  DROP IF EXISTS altra_colonna;\n',
    });
    expect(r).toMatch(/902_colonna_su_una_riga\.sql`: riga 1: ALTER TABLE public\.orders DROP vecchia_colonna/);
    expect(r).toMatch(/903_colonna_su_due_righe\.sql`: riga 2: DROP IF EXISTS altra_colonna/);
  });

  it('colonne e tabelle restano le prime nominate, la funzione viene dopo', () => {
    const r = riepilogoCon({
      '905_funzione_e_tabella.sql': 'DROP FUNCTION IF EXISTS public.vecchia(uuid);\nDROP TABLE IF EXISTS public.vecchia;\n',
    });
    expect(r).toMatch(/905_funzione_e_tabella\.sql`: riga 2: DROP TABLE IF EXISTS public\.vecchia;;riga 1: DROP FUNCTION/);
  });

  it('nella 105 vera si vede anche il DROP FUNCTION, se c\'e\' posto dopo le tabelle', () => {
    // Le prime tre righe della 105 che tolgono sono due tabelle e una colonna; il DROP FUNCTION
    // della riga 17 resta fuori dal conto di tre, ma la migrazione e' nominata come prima.
    const vera = readFileSync(join(ROOT, 'migrations', '105_remove_invoicing.sql'), 'utf8');
    const soloLaFunzione = vera
      .split('\n')
      .map((riga) => (/DROP\s+(TABLE|COLUMN)/i.test(riga) ? '-- tolta per la prova' : riga))
      .join('\n');
    const r = riepilogoCon({ '105_remove_invoicing.sql': soloLaFunzione });
    expect(r).toMatch(/105_remove_invoicing\.sql`: riga 17: DROP FUNCTION IF EXISTS public\.next_invoice_number/);
  });

  it('quello che non toglie niente al codice resta tranquillo', () => {
    const r = riepilogoCon({
      '904_innocua.sql': [
        '-- DROP FUNCTION public.vecchia(); (solo un commento)',
        'CREATE INDEX IF NOT EXISTS i ON public.t (a);',
        'ALTER TABLE public.t ALTER COLUMN a DROP NOT NULL;',
        'ALTER TABLE public.t ALTER COLUMN b DROP DEFAULT;',
        'ALTER TABLE public.t DROP CONSTRAINT IF EXISTS t_a_check;',
        'DROP POLICY IF EXISTS p ON public.t;',
        'DROP TRIGGER IF EXISTS g ON public.t;',
        '',
      ].join('\n'),
    });
    expect(r).not.toMatch(/TOLGONO o RINOMINANO/);
    expect(r).toMatch(/nessuna contiene DROP COLUMN, DROP TABLE o RENAME, e nemmeno DROP FUNCTION, DROP VIEW/);
  });
});
