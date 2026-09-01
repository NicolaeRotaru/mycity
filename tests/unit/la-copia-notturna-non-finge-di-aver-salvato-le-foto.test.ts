/**
 * 31/8/2026 (R180) — LE FOTO DEI NEGOZI NON ERANO IN NESSUNA COPIA, E NEMMENO
 * IL LORO ELENCO.
 *
 * La copia notturna salta apposta lo schema `storage` (`--exclude-schema=storage`),
 * e in tutto il repository non c'era niente che copiasse i file veri. Quindi di
 * un incidente sulle immagini non si perdevano solo le foto: si perdeva anche
 * la lista di quali foto esistevano, con che nome e in che secchio. Chi
 * ripristina si ritrovava un catalogo di schede prodotto che puntano a file di
 * cui nessuno sa piu' nemmeno il nome.
 *
 * Queste prove avviano lo script di copia vero, con un `pg_dump` e un `rclone`
 * finti, e guardano cosa ha fatto davvero:
 *  - l'elenco degli oggetti dello storage finisce nella copia;
 *  - senza le chiavi della destinazione, la copia dei file dice «non
 *    configurato» e NON dichiara di aver copiato niente;
 *  - con le chiavi, ci prova per davvero, un secchio alla volta;
 *  - se la copia fallisce, il lavoro diventa rosso invece di passare in
 *    silenzio.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  chmodSync,
  readdirSync,
  readFileSync,
  existsSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scegliCopie } from '@/scripts/copie-di-backup.mjs';

const RADICE = process.cwd();

interface Esito {
  uscita: number | null;
  testo: string;
  cartella: string;
  pgDump: string[];
  rclone: string[];
}

/** Dove sta davvero un programma di sistema, senza chiederlo al PATH. */
function percorsoDi(programma: string): string {
  const dove = ['/usr/bin', '/bin', '/usr/local/bin']
    .map((d) => join(d, programma))
    .find((p) => existsSync(p));
  if (!dove) throw new Error(`serve ${programma} per far girare la prova`);
  return dove;
}

/**
 * Un PATH che contiene SOLO quello che serve. Serve per il caso «rclone non
 * c'e'»: se la prova si fidasse del PATH della macchina, su un computer con
 * rclone installato proverebbe un'altra strada e direbbe verde per il motivo
 * sbagliato.
 */
function pathSenzaSorprese(base: string, finti: string): string {
  const sistema = join(base, 'sistema');
  mkdirSync(sistema);
  for (const programma of ['bash', 'env', 'date', 'mkdir', 'du', 'cut', 'find', 'rm', 'ls']) {
    symlinkSync(percorsoDi(programma), join(sistema, programma));
  }
  return `${finti}:${sistema}`;
}

/** Avvia `scripts/backup-db.sh` in una cartella usa-e-getta, con i comandi esterni finti. */
function eseguiLaCopia(
  opzioni: {
    sincronia?: Record<string, string>;
    rclone?: 'ok' | 'fallisce' | 'assente';
    elencoFallisce?: boolean;
  } = {},
): Esito {
  const base = mkdtempSync(join(tmpdir(), 'copia-foto-'));
  const finti = join(base, 'finti');
  const cartella = join(base, 'backup');
  mkdirSync(finti);
  mkdirSync(cartella);

  const registroPg = join(base, 'pg_dump.log');
  const registroRclone = join(base, 'rclone.log');

  writeFileSync(
    join(finti, 'pg_dump'),
    [
      '#!/usr/bin/env bash',
      'echo "$@" >> "$REGISTRO_PGDUMP"',
      ...(opzioni.elencoFallisce
        ? ['case "$*" in *storage.objects*) echo "pg_dump: nessuna tabella trovata" >&2; exit 1;; esac']
        : []),
      'uscita=""',
      'for a in "$@"; do case "$a" in --file=*) uscita="${a#--file=}";; esac; done',
      '[ -n "$uscita" ] && printf "copia finta\\n" > "$uscita"',
      'exit 0',
    ].join('\n'),
  );
  chmodSync(join(finti, 'pg_dump'), 0o755);

  if (opzioni.rclone !== 'assente') {
    writeFileSync(
      join(finti, 'rclone'),
      [
        '#!/usr/bin/env bash',
        'echo "$@" >> "$REGISTRO_RCLONE"',
        `exit ${opzioni.rclone === 'fallisce' ? '1' : '0'}`,
      ].join('\n'),
    );
    chmodSync(join(finti, 'rclone'), 0o755);
  }

  // Senza rclone il PATH e' quello ridotto, e li' dentro non c'e' nemmeno gpg:
  // in quel caso la copia esce in chiaro, che e' l'altro avviso gia' coperto
  // da #234 e non c'entra con quello che si sta provando qui.
  const senzaRclone = opzioni.rclone === 'assente';
  const esecuzione = spawnSync(percorsoDi('bash'), ['scripts/backup-db.sh'], {
    cwd: RADICE,
    encoding: 'utf8',
    timeout: 20_000,
    env: {
      // I tipi del progetto vogliono NODE_ENV in ogni ambiente: qui non serve a
      // niente, lo script non lo guarda.
      NODE_ENV: process.env.NODE_ENV ?? 'test',
      PATH: senzaRclone ? pathSenzaSorprese(base, finti) : `${finti}:${process.env.PATH ?? ''}`,
      HOME: process.env.HOME ?? '/root',
      SUPABASE_DB_URL: 'postgresql://finto:finto@localhost:5432/postgres',
      BACKUP_DIR: cartella,
      ...(senzaRclone ? {} : { BACKUP_PASSPHRASE: 'passphrase-di-prova' }),
      REGISTRO_PGDUMP: registroPg,
      REGISTRO_RCLONE: registroRclone,
      ...(opzioni.sincronia ?? {}),
    },
  });

  const righe = (f: string) =>
    existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean) : [];

  return {
    uscita: esecuzione.status,
    testo: `${esecuzione.stdout ?? ''}${esecuzione.stderr ?? ''}`,
    cartella,
    pgDump: righe(registroPg),
    rclone: righe(registroRclone),
  };
}

const CHIAVI_FINTE = {
  STORAGE_SYNC_SOURCE: 'finto-fornitore:',
  STORAGE_SYNC_DEST: 'finta-destinazione:mycity-foto',
};

describe('l elenco delle foto dentro la copia notturna', () => {
  const esito = eseguiLaCopia();

  it('la copia porta via anche il registro degli oggetti dello storage', () => {
    const conElenco = esito.pgDump.filter((riga) => riga.includes('--table=storage.objects'));
    expect(
      conElenco.length,
      'nessuna copia dell elenco: dopo un incidente non si sa nemmeno che foto esistevano',
    ).toBe(1);
    expect(
      conElenco[0],
      'senza i secchi non si sa in quale cassetto stava ogni file',
    ).toContain('--table=storage.buckets');
  });

  it('l elenco delle foto esce cifrato come il resto della copia', () => {
    const file = readdirSync(esito.cartella);
    const elenco = file.filter((f) => f.includes('elenco-foto'));
    expect(elenco.length, `nella cartella c e solo: ${file.join(', ')}`).toBe(1);
    expect(
      elenco[0],
      'l elenco dei file dei clienti resterebbe in chiaro fra gli artefatti per trenta giorni',
    ).toMatch(/\.dump\.gpg$/);
  });

  it('se l elenco non si copia, la copia della notte non si perde lo stesso', () => {
    // Il registro degli oggetti e' un pezzo in piu': se un giorno non si
    // copiasse (permessi, schema spostato dal fornitore), non deve portarsi
    // dietro anche il database — ma la notte deve diventare rossa, non passare
    // liscia.
    const rotta = eseguiLaCopia({ elencoFallisce: true });
    expect(rotta.uscita, 'un elenco mancante passava inosservato').not.toBe(0);
    expect(rotta.testo).toContain('esito-elenco-foto: fallito');
    const file = readdirSync(rotta.cartella);
    expect(
      file.filter((f) => f.endsWith('.dump.gpg')).length,
      `il database e gli utenti sono spariti con l elenco: ${file.join(', ')}`,
    ).toBe(2);
    expect(file.some((f) => f.endsWith('.dump')), 'una copia in chiaro rimasta indietro').toBe(false);
  });

  it('la prova mensile di ripristino riapre ancora il database, non l elenco delle foto', () => {
    // Il terzo file non deve rubare il posto al database nella scelta della
    // copia da riaprire: se lo rubasse, la prova mensile direbbe «tutto bene»
    // dopo aver riaperto un elenco di nomi di file.
    const file = readdirSync(esito.cartella);
    expect(file.some((f) => f.includes('elenco-foto'))).toBe(true);
    const scelte = scegliCopie(file);
    expect(scelte.principale, 'la prova di ripristino riaprirebbe il file sbagliato').toMatch(
      /^mycity_\d.*\.dump\.gpg$/,
    );
    expect(scelte.utenti, 'gli utenti sparirebbero dalla prova di ripristino').toMatch(/_utenti/);
  });
});

describe('la copia dei file veri delle foto', () => {
  it('senza le chiavi lo dice, e non dichiara di aver copiato niente', () => {
    const esito = eseguiLaCopia();
    expect(esito.testo).toContain('esito-foto: non-configurato');
    expect(
      esito.testo,
      'la copia notturna si dichiara riuscita sulle foto senza aver copiato un solo file',
    ).not.toContain('esito-foto: copiate');
    expect(esito.rclone, 'ha provato a copiare senza sapere dove').toEqual([]);
    // Il database e' comunque copiato: le foto mancanti non devono far saltare
    // anche quello.
    expect(esito.uscita).toBe(0);
  });

  it('con le chiavi ci prova davvero, un secchio alla volta', () => {
    const esito = eseguiLaCopia({ sincronia: CHIAVI_FINTE });
    expect(
      esito.rclone.length,
      'le chiavi ci sono e nessun secchio e stato copiato',
    ).toBeGreaterThanOrEqual(3);
    const tutte = esito.rclone.join('\n');
    expect(tutte).toContain('finto-fornitore:products');
    expect(tutte).toContain('finta-destinazione:mycity-foto/products');
    expect(esito.testo).toContain('esito-foto: copiate');
    expect(esito.uscita).toBe(0);
  });

  it('se la copia di un secchio fallisce il lavoro diventa rosso', () => {
    const esito = eseguiLaCopia({ sincronia: CHIAVI_FINTE, rclone: 'fallisce' });
    expect(esito.uscita, 'una copia fallita passava per riuscita').not.toBe(0);
    expect(esito.testo).toContain('esito-foto: fallita');
    expect(esito.testo).not.toContain('esito-foto: copiate');
  });

  it('se le chiavi ci sono ma manca il programma che copia, lo dice e si ferma', () => {
    const esito = eseguiLaCopia({ sincronia: CHIAVI_FINTE, rclone: 'assente' });
    expect(esito.uscita, 'la sincronia era accesa e non ha copiato niente in silenzio').not.toBe(0);
    expect(esito.testo).toContain('esito-foto: fallita');
    // Deve dire QUALE pezzo manca: un «comando non trovato» in fondo a un log
    // notturno non lo legge nessuno.
    expect(esito.testo).toContain("rclone non e' installato");
  });
});
