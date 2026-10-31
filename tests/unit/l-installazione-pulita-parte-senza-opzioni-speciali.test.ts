import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 31/10/2026 (ondata 1) — `npm ci` partiva solo con un'opzione che conosceva la CI.
 *
 * package-lock.json e' scritto con `--legacy-peer-deps`, e la CI lo aggiungeva a
 * mano a ogni installazione. Chiunque altro (una macchina nuova, Dependabot,
 * Vercel) faceva `npm ci` e si sentiva dire che il file non era in pari.
 *
 * Qui si chiede a npm VERO, dalla cartella del progetto e senza nessuna opzione
 * ereditata dall'ambiente o dalla configurazione personale, come installerebbe.
 * Cosa non si prova da qui: un `npm ci` intero, che scarica tutte le librerie.
 */
function opzioneDiNpm(nome: string): string {
  const casa = mkdtempSync(join(tmpdir(), 'npm-casa-'));
  try {
    const vuota = join(casa, '.npmrc');
    writeFileSync(vuota, '');
    const pulito: NodeJS.ProcessEnv = { ...process.env, HOME: casa, npm_config_userconfig: vuota };
    for (const k of Object.keys(pulito)) {
      if (/^npm_config_/i.test(k) && k !== 'npm_config_userconfig') delete pulito[k];
    }
    const esito = spawnSync('npm', ['config', 'get', nome], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: pulito,
      timeout: 60_000,
    });
    if (esito.status !== 0) throw new Error(`npm config get ${nome} non ha risposto: ${esito.stderr}`);
    return esito.stdout.trim();
  } finally {
    rmSync(casa, { recursive: true, force: true });
  }
}

describe('l installazione pulita parte senza opzioni speciali', () => {
  it('npm, lanciato dal progetto senza niente in piu, installa come la CI', () => {
    expect(
      opzioneDiNpm('legacy-peer-deps'),
      'Senza .npmrc solo la CI sa che serve --legacy-peer-deps: npm ci altrove si rifiuta di partire',
    ).toBe('true');
  });
});
