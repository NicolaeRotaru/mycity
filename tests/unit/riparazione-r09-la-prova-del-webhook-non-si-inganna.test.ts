import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * 26/11/2026 — LA PROVA DELL'ANTI-DOPPIONE NON SI INGANNA CON UNO SPAZIO.
 *
 * `webhook-diviso-per-mestiere.test.ts` controlla che la rotta del webhook di Stripe segni
 * l'evento come lavorato (`processed: true`) solo dopo il gestore. Lo faceva cercando la parola
 * `processed: true`: una marcatura spostata prima di `switch (event.type)` e scritta
 * `processed:true` (senza spazio), o in un'altra forma, non la vedeva, e la prova restava verde.
 *
 * Qui quella prova si fa girare per davvero su copie guastate della rotta vera (la legge da
 * `ROTTA_DEL_WEBHOOK_DA_LEGGERE`), e deve diventare rossa. La rotta vera non si tocca.
 */

const RADICE = process.cwd();
const VERA = readFileSync(join(RADICE, 'app/api/stripe/webhook/route.ts'), 'utf8');
const SMISTAMENTO = '    switch (event.type) {\n';
const ERRORE = "    logger.error(err, { context: 'stripe-webhook-handler' });\n";

/** La rotta vera con `aggiunta` scritta subito prima di `prima`. */
function guasta(prima: string, aggiunta: string): string {
  expect(VERA.split(prima).length, `la rotta non ha più una riga sola «${prima.trim()}»`).toBe(2);
  return VERA.replace(prima, aggiunta + prima);
}

/** L'uscita della prova dell'anti-doppione quando legge `rotta` al posto della rotta vera. */
async function uscitaDellaProva(rotta: string): Promise<number> {
  const cartella = mkdtempSync(join(tmpdir(), 'rotta-webhook-'));
  const file = join(cartella, 'route.ts');
  writeFileSync(file, rotta);
  // Le variabili di vitest restano fuori: la prova figlia è una corsa a sé.
  const env: NodeJS.ProcessEnv = { ...process.env, ROTTA_DEL_WEBHOOK_DA_LEGGERE: file };
  for (const k of Object.keys(env)) if (/^_*VITEST/.test(k)) delete env[k];
  try {
    return await new Promise<number>((fatto) => {
      const figlia = spawn(
        process.execPath,
        [join(RADICE, 'node_modules/vitest/vitest.mjs'), 'run', 'tests/unit/webhook-diviso-per-mestiere.test.ts', '-t', 'anti-doppione', '--reporter=dot'],
        { cwd: RADICE, env, stdio: 'ignore' },
      );
      figlia.on('error', () => fatto(-1));
      figlia.on('close', (codice) => fatto(codice ?? -1));
    });
  } finally {
    rmSync(cartella, { recursive: true, force: true });
  }
}

describe('R09-003 · la prova dell anti-doppione vede la marcatura comunque sia scritta', () => {
  it('controprova: sulla copia della rotta vera la prova è verde', async () => {
    expect(await uscitaDellaProva(VERA)).toBe(0);
  }, 120_000);

  it('marcata prima dello smistamento, scritta «processed:true» senza spazio: rossa', async () => {
    const rotta = guasta(
      SMISTAMENTO,
      "    await admin.from('stripe_event_log').update({ processed:true, processed_at: new Date().toISOString() }).eq('event_id', event.id);\n",
    );
    expect(await uscitaDellaProva(rotta)).not.toBe(0);
  }, 120_000);

  it('marcata nel ramo dell errore, andando a capo: rossa (un gestore fallito non verrebbe più riprovato)', async () => {
    const rotta = guasta(
      ERRORE,
      "    await admin.from('stripe_event_log').update({\n      'processed':\n        true,\n    }).eq('event_id', event.id);\n",
    );
    expect(await uscitaDellaProva(rotta)).not.toBe(0);
  }, 120_000);
});
