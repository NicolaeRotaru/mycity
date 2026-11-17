/**
 * 17/11/2026 — LE PROVE DELLE MIGRAZIONI METTONO I FILE NELL'ORDINE DI apply.sh.
 *
 * `apply.sh` (la ricostruzione della CI) e lo script del rilascio ordinano le migrazioni byte per
 * byte (`LC_ALL=C sort`): 108_ viene prima di 108b_. Sei script di prova — la migrazione su
 * database pieno, le tre prove della 158/159/160, lo script sul database nato prima del registro
 * (gira in CI) e l'avvio del Supabase locale — e la simulazione del rilascio usavano ancora
 * `sort -V`, che mette 108b_ prima di 108_ (e 052b_ prima di 052_): provavano un ordine che in
 * produzione non c'è.
 *
 * Qui ogni ordinamento delle migrazioni scritto negli script si ESEGUE su una cartella di nomi
 * d'esempio e si confronta con quello di apply.sh.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RADICE = process.cwd();

const SCRIPT = [
  'tests/sql/harness/migrazione-su-database-pieno.sh',
  'tests/sql/harness/la-158-non-lascia-la-porta-aperta.sh',
  'tests/sql/harness/la-159-non-lascia-la-tabella-scoperta.sh',
  'tests/sql/harness/la-160-regge-un-ordine-annullato.sh',
  'tests/sql/harness/lo-script-non-si-schianta-sul-database-nato-prima-del-registro.sh',
  'tests/supabase-locale/avvia.sh',
];

const NOMI = ['001_init.sql', '052_negozi.sql', '052b_vetrina.sql', '108_coupon.sql', '108b_profili.sql', '109_ordini.sql', '540_rider.sql'];
const CARTELLA = mkdtempSync(join(tmpdir(), 'r01-ordine-migrazioni-'));
for (const n of NOMI) writeFileSync(join(CARTELLA, n), '-- vuota\n');
afterAll(() => rmSync(CARTELLA, { recursive: true, force: true }));

/** Le catene `ls "$MIG"/*.sql | sort …` scritte in uno script: quello che viene dopo `ls` (il conteggio `| wc -l` no). */
function catene(file: string): string[] {
  const testo = readFileSync(join(RADICE, file), 'utf8');
  return [...testo.matchAll(/\$\(ls "\$MIG"\/\*\.sql \| ([^)]+)\)/g)].map((m) => m[1].trim()).filter((c) => /\bsort\b/.test(c.split('|')[0]));
}

/** Esegue `ls "$MIG"/*.sql | <catena>` sulla cartella d'esempio e restituisce i nomi in uscita. */
function esegui(catena: string): string[] {
  const r = spawnSync('bash', ['-c', `ls "$MIG"/*.sql | ${catena}`], {
    encoding: 'utf8',
    env: { ...process.env, MIG: CARTELLA },
  });
  expect(r.status, r.stderr).toBe(0);
  return r.stdout.trim().split('\n').map((p) => p.slice(p.lastIndexOf('/') + 1));
}

const [ORDINE_DI_APPLY] = catene('tests/sql/harness/apply.sh');

describe('ordine delle migrazioni nelle prove', () => {
  it('apply.sh ordina byte per byte: 052 prima di 052b, 108 prima di 108b', () => {
    expect(ORDINE_DI_APPLY).toBe('LC_ALL=C sort');
    const ordine = esegui(ORDINE_DI_APPLY);
    expect(ordine).toEqual([...NOMI].sort());
    expect(ordine.indexOf('108_coupon.sql')).toBeLessThan(ordine.indexOf('108b_profili.sql'));
  });

  it.each(SCRIPT)('%s mette i file nello stesso ordine di apply.sh', (file) => {
    const trovate = catene(file);
    expect(trovate.length, `${file}: non trovo dove ordina le migrazioni`).toBeGreaterThan(0);
    for (const catena of trovate) {
      // Quello che segue l'ordinamento (`| tail -1`) si applica uguale all'ordine di apply.sh.
      const dopo = catena.split('|').slice(1).join('|').trim();
      const atteso = esegui(dopo ? `${ORDINE_DI_APPLY} | ${dopo}` : ORDINE_DI_APPLY);
      expect(esegui(catena), `${file}: «${catena}»`).toEqual(atteso);
      expect(catena, `${file}: «sort -V» mette 108b_ prima di 108_`).not.toMatch(/sort\s+-V/);
    }
  });

  it('la simulazione del rilascio ordina come lo script, non con sort -V', () => {
    const testo = readFileSync(join(RADICE, 'tests/unit/il-rilascio-non-riallinea-da-solo-un-database-rimasto-indietro.test.ts'), 'utf8');
    const chiamata = testo.match(/spawnSync\('sort',[^\n]*/)?.[0] ?? '';
    expect(chiamata, 'la simulazione non ordina più le migrazioni con sort').not.toBe('');
    expect(chiamata).not.toMatch(/'-V'/);
    expect(chiamata).toMatch(/LC_ALL: 'C'/);
  });
});
