/**
 * 16/10/2026 — SENZA LA RIGA DEL DATABASE, IL RILASCIO PUBBLICAVA LO STESSO.
 *
 * Con le chiavi di Vercel accese e il segreto SUPABASE_DB_URL assente, il passo
 * delle migrazioni scriveva un avviso e usciva verde. Il cancello «Il database
 * e' allineato al codice», scritto per diventare rosso proprio quando manca la
 * riga, gira solo se le migrazioni sono girate: saltava. E «Rilascia in
 * produzione» guarda solo le chiavi di Vercel: pubblicava. Codice nuovo su un
 * database vecchio — il guasto del 21 agosto — con un verde in fondo.
 *
 * Queste prove ESEGUONO il passo vero delle migrazioni senza la riga, e poi
 * PERCORRONO i passi del lavoro con le condizioni valutate come le valuta
 * GitHub (tests/unit/_condizioni-github.ts), usando l'esito vero del passo.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { passo, esegui } from './_lavoro-di-rilascio';
import { lavoroDiRilascio, eventoDopoLaCi, percorso, type EsitoFinto } from './_condizioni-github';

const MIGRAZIONI = 'Applica le migrazioni al database, prima di pubblicare';
const DERIVA = "Il database e' allineato al codice";
const RILASCIO = 'Rilascia in produzione';
const VERDETTO = 'Il verdetto — cosa ho provato davvero';
const CONTROLLO = "Il commit scaricato e' l'ultimo di main";

const cartelle: string[] = [];
afterAll(() => {
  for (const c of cartelle) rmSync(c, { recursive: true, force: true });
});

/** Il passo vero, senza la riga del database, con psql e sudo finti che si annotano. */
function migrazioniSenzaRiga() {
  const strumenti = mkdtempSync(join(tmpdir(), 'senza-riga-'));
  cartelle.push(strumenti);
  const registro = join(strumenti, 'chiamati.txt');
  writeFileSync(registro, '');
  for (const nome of ['psql', 'sudo']) {
    writeFileSync(join(strumenti, nome), `#!/usr/bin/env bash\necho "${nome} $*" >> "${registro}"\nexit 0\n`);
    chmodSync(join(strumenti, nome), 0o755);
  }
  const p = passo(MIGRAZIONI);
  const daFile: Record<string, string> = {};
  for (const [k, v] of Object.entries(p.ambiente)) if (!v.includes('${{')) daFile[k] = v.replace(/^"(.*)"$/, '$1');
  const r = esegui(p, { env: { ...daFile, PATH: `${strumenti}:${process.env.PATH}`, SUPABASE_DB_URL: '' } });
  return { ...r, chiamati: readFileSync(registro, 'utf8').split('\n').filter(Boolean) };
}

describe('il rilascio senza la riga del database', () => {
  it('il passo delle migrazioni finisce ROSSO, non tocca niente e spiega cosa manca', () => {
    const r = migrazioniSenzaRiga();
    expect(r.uscita, r.stdout + r.stderr).not.toBe(0);
    expect(r.output.applicate).toBe('false');
    expect(r.chiamati).toEqual([]);
    expect(r.riepilogo).toContain('manca la riga del database');
    expect(r.riepilogo).toContain('SUPABASE_DB_URL');
  });

  it('con le chiavi di Vercel accese, dopo quel rosso non si pubblica', () => {
    const migrazioni = migrazioniSenzaRiga();
    const esiti: Record<string, EsitoFinto> = {
      'Verifica di avere le chiavi': { esito: 'success', output: { pronto: 'true' } },
      [CONTROLLO]: { esito: 'success', output: { fidato: 'true' } },
      [MIGRAZIONI]: { esito: migrazioni.uscita === 0 ? 'success' : 'failure', output: migrazioni.output },
      [RILASCIO]: { esito: 'success', output: { indirizzo: 'https://mycity-nuovo.vercel.app' } },
      'Prova di fumo sul sito appena pubblicato': { esito: 'success', output: { codice: '0' } },
    };
    const girati = percorso(lavoroDiRilascio().steps ?? [], eventoDopoLaCi(), esiti);
    expect(girati).toContain(MIGRAZIONI);
    expect(girati).not.toContain(DERIVA);
    expect(girati).not.toContain(RILASCIO);
    // Il verdetto c'e', e non dice «il sito risponde».
    expect(girati).toContain(VERDETTO);
    const verdetto = esegui(passo(VERDETTO), {
      env: { PRONTO: 'true', INDIRIZZO: '', CODICE_FUMO: '', TORNATO: '', PASSO_RILASCIO: 'skipped', FERMO: migrazioni.output.fermo ?? '' },
    });
    expect(verdetto.uscita).not.toBe(0);
    expect(verdetto.riepilogo).toContain('si e fermato prima di pubblicare');
    expect(verdetto.riepilogo).not.toContain('Il sito risponde');
  });

  it('oggi, senza le chiavi di Vercel, il passo delle migrazioni non parte nemmeno: niente cambia', () => {
    const esiti: Record<string, EsitoFinto> = {
      'Verifica di avere le chiavi': { esito: 'success', output: { pronto: 'false' } },
      [CONTROLLO]: { esito: 'success', output: { fidato: 'true' } },
    };
    const girati = percorso(lavoroDiRilascio().steps ?? [], eventoDopoLaCi(), esiti);
    expect(girati).not.toContain(MIGRAZIONI);
    expect(girati).not.toContain(RILASCIO);
    expect(girati).toContain(VERDETTO);
  });
});
