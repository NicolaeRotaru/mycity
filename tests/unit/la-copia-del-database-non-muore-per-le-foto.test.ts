import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { percorso, type EsitoFinto, type LavoroYaml } from './_condizioni-github';

/**
 * 26/10/2026 — LA COPIA DEL DATABASE NON MUORE PER COLPA DELLE FOTO.
 *
 * Il difetto: in backup-db.yml il controllo «Le foto vanno in copia?» sta PRIMA
 * del passo che fa il dump. Con una configurazione delle foto a meta' (uno o due
 * valori su tre) quel controllo esce 1, e GitHub salta ogni passo successivo che
 * non ha un `if:` proprio. «Esegui il backup» non ce l'aveva: niente pg_dump,
 * niente copia del database, notte dopo notte, per colpa del pezzo meno
 * importante. Lo stesso nella prova mensile di ripristino.
 *
 * Qui le condizioni si VALUTANO come le valuta GitHub (percorso() di
 * _condizioni-github.ts), non si cercano parole nel file: una parola giusta in
 * una condizione sbagliata passerebbe lo stesso.
 *
 * Cosa deve restare vero anche dopo la correzione: se manca l'indirizzo del
 * database o la passphrase (il passo «Verifica…» fallisce) la copia NON parte.
 * Una copia senza passphrase sarebbe una copia in chiaro.
 */

const richiedi = createRequire(import.meta.url);
const yaml = richiedi('js-yaml') as { load: (testo: string) => unknown };

function lavoro(nome: string): LavoroYaml {
  const documento = yaml.load(
    readFileSync(join(process.cwd(), '.github/workflows/backup-db.yml'), 'utf8'),
  ) as { jobs?: Record<string, LavoroYaml> };
  const trovato = documento?.jobs?.[nome];
  if (!trovato?.steps?.length) throw new Error(`Non trovo il lavoro «${nome}» in backup-db.yml`);
  return trovato;
}

const NOTTE = { event_name: 'schedule', schedule: '41 3 1 * *' };
const FALLITO: EsitoFinto = { esito: 'failure' };

function girano(nomeLavoro: string, esiti: Record<string, EsitoFinto>): string[] {
  return percorso(lavoro(nomeLavoro).steps ?? [], NOTTE, esiti);
}

describe('copia notturna: le foto non fermano la copia del database', () => {
  it('con il controllo delle foto rosso (mezza configurazione) la copia del database si fa e si conserva', () => {
    const passi = girano('backup', { 'Le foto vanno in copia?': FALLITO });
    expect(passi).toContain('Esegui il backup');
    expect(passi).toContain('Conserva la copia fuori dal contenitore');
  });

  it('con «Prepara rclone» rosso la copia del database si fa lo stesso', () => {
    const passi = girano('backup', {
      'Le foto vanno in copia?': { esito: 'success', output: { accesa: 'si' } },
      'Prepara rclone': FALLITO,
    });
    expect(passi).toContain('Prepara rclone');
    expect(passi).toContain('Esegui il backup');
  });

  it('se manca l indirizzo del database o la passphrase la copia NON parte (niente copia in chiaro)', () => {
    const passi = girano('backup', { 'Verifica di sapere dove copiare': FALLITO });
    expect(passi).not.toContain('Esegui il backup');
  });

  it('se il client Postgres non si installa la copia non parte (userebbe un pg_dump sbagliato)', () => {
    const passi = girano('backup', { 'Installa il client Postgres': FALLITO });
    expect(passi).not.toContain('Esegui il backup');
  });
});

describe('prova mensile: le foto non fermano la prova di ripristino', () => {
  it('con il controllo delle foto rosso la copia fresca si fa e si riapre', () => {
    const passi = girano('prova-di-ripristino', { 'Le foto vanno provate?': FALLITO });
    expect(passi).toContain('Fai una copia fresca');
    expect(passi).toContain('Riaprila su un database vuoto, e cronometra');
  });

  it('con «Prepara rclone» rosso la prova di ripristino gira lo stesso', () => {
    const passi = girano('prova-di-ripristino', {
      'Le foto vanno provate?': { esito: 'success', output: { accesa: 'si' } },
      'Prepara rclone': FALLITO,
    });
    expect(passi).toContain('Fai una copia fresca');
    expect(passi).toContain('Riaprila su un database vuoto, e cronometra');
  });

  it('senza i segreti la prova di ripristino non parte', () => {
    const passi = girano('prova-di-ripristino', { 'Verifica di avere i segreti': FALLITO });
    expect(passi).not.toContain('Fai una copia fresca');
    expect(passi).not.toContain('Riaprila su un database vuoto, e cronometra');
  });
});
