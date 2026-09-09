/**
 * 8/9/2026 — LA COPIA DELLE FOTO DICEVA «COPIATE» SENZA AVER MAI RIAPERTO UN
 * FILE.
 *
 * Fino a oggi bastava che `rclone sync` uscisse con zero. Non è la stessa cosa
 * di «le foto sono al sicuro»:
 *
 *  - la chiave del secchio di destinazione può avere il permesso di SCRIVERE e
 *    non quello di LEGGERE. Su Backblaze B2 e su S3 è una casella spuntata a
 *    parte, ed è l'errore più facile da fare perché sembra più prudente. Ogni
 *    notte la copia riesce, ogni notte esce verde, e il giorno del ripristino
 *    non si riapre niente: mesi di copie inutili scoperti nell'ora peggiore;
 *  - una destinazione che resta vuota (origine sbagliata, permesso di lettura
 *    tolto all'origine, secchio rinominato) fa uscire `sync` con zero;
 *  - un trasferimento troncato lascia file da zero byte, che si elencano
 *    benissimo e non contengono niente.
 *
 * La scheda che ha chiesto questa copia lo diceva già nell'ultima riga — «la
 * prova mensile deve verificare che almeno un file si riapra» — ed era la
 * clausola rimasta fuori.
 *
 * Qui si fanno girare notti vere, con lo script vero. Il programma che copia è
 * finto (su questa macchina rclone non c'è) ma non finge il risultato: lavora
 * su cartelle vere, e quando gli si toglie la lettura si comporta come si
 * comporta una chiave di sola scrittura.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, writeFileSync, chmodSync, existsSync, readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FINTO_RCLONE, FINTO_PGDUMP } from './aiuti/finto-rclone';

const RADICE = process.cwd();

function percorsoDi(programma: string): string {
  const dove = ['/usr/bin', '/bin', '/usr/local/bin']
    .map((d) => join(d, programma))
    .find((p) => existsSync(p));
  if (!dove) throw new Error(`serve ${programma} per far girare la prova`);
  return dove;
}

function bancoDiProva(opzioni: { letturaNegata?: boolean } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'foto-riaperta-'));
  const finti = join(base, 'finti');
  const fornitore = join(base, 'fornitore');
  const copia = join(base, 'copia');
  const dump = join(base, 'dump');
  const registro = join(base, 'rclone.log');
  for (const d of [finti, join(fornitore, 'products'), copia, dump]) {
    mkdirSync(d, { recursive: true });
  }

  writeFileSync(join(finti, 'pg_dump'), FINTO_PGDUMP);
  chmodSync(join(finti, 'pg_dump'), 0o755);
  writeFileSync(join(finti, 'rclone'), FINTO_RCLONE);
  chmodSync(join(finti, 'rclone'), 0o755);

  const notte = () => {
    const e = spawnSync(percorsoDi('bash'), ['scripts/backup-db.sh'], {
      cwd: RADICE,
      encoding: 'utf8',
      timeout: 20_000,
      env: {
        NODE_ENV: process.env.NODE_ENV ?? 'test',
        PATH: `${finti}:${process.env.PATH ?? ''}`,
        HOME: process.env.HOME ?? '/root',
        SUPABASE_DB_URL: 'postgresql://finto:finto@localhost:5432/postgres',
        BACKUP_DIR: dump,
        STORAGE_SYNC_SOURCE: `${fornitore}/`,
        STORAGE_SYNC_DEST: copia,
        STORAGE_SYNC_BUCKETS: 'products',
        REGISTRO_RCLONE: registro,
        ...(opzioni.letturaNegata ? { LETTURA_NEGATA: '1' } : {}),
      },
    });
    return {
      uscita: e.status,
      testo: `${e.stdout ?? ''}${e.stderr ?? ''}`,
      comandi: existsSync(registro)
        ? readFileSync(registro, 'utf8').split('\n').filter(Boolean)
        : [],
    };
  };

  return { fornitore: join(fornitore, 'products'), copia, notte };
}

describe('la copia notturna delle foto, prima di dirsi riuscita', () => {
  it('IL CASO CHE ROMPEVA — con una chiave che sa scrivere e non leggere, la notte diventa rossa', () => {
    // È il guasto che non si vede: la copia si scrive tutte le notti, il lavoro
    // esce verde per mesi, e il giorno del ripristino non si riapre niente.
    const banco = bancoDiProva({ letturaNegata: true });
    writeFileSync(join(banco.fornitore, 'pane-del-giorno.jpg'), 'la foto del negoziante');

    const notte = banco.notte();
    expect(
      notte.uscita,
      'una copia che non si potrà mai rileggere passava per riuscita',
    ).not.toBe(0);
    expect(notte.testo).toContain('esito-foto: fallita');
    expect(notte.testo, 'il messaggio deve dire dove guardare').toContain('non si riesce a LEGGERE');
    expect(notte.testo).not.toContain('esito-foto: copiate');
  });

  it('se nella copia non c è nemmeno una foto, la notte diventa rossa', () => {
    // `rclone sync` di un secchio vuoto esce con zero: origine sbagliata,
    // secchio rinominato, permesso tolto all'origine. La sincronia «riesce» e
    // la copia è vuota.
    const banco = bancoDiProva();
    const notte = banco.notte();
    expect(notte.uscita, 'una copia vuota passava per riuscita').not.toBe(0);
    expect(notte.testo).toContain('nemmeno una foto da riaprire');
    expect(notte.testo).not.toContain('esito-foto: copiate');
  });

  it('se la foto nella copia è da zero byte, la notte diventa rossa', () => {
    // Un trasferimento troncato lascia un file che si elenca benissimo e non
    // contiene niente: il negoziante dovrebbe rifotografare lo stesso.
    const banco = bancoDiProva();
    writeFileSync(join(banco.fornitore, 'focaccia.jpg'), '');
    const notte = banco.notte();
    expect(notte.uscita, 'un file vuoto passava per una foto salvata').not.toBe(0);
    expect(notte.testo).toContain('zero byte');
    expect(notte.testo).not.toContain('esito-foto: copiate');
  });

  it('quando la foto si riapre davvero, la notte è verde — e l ha letta, non solo elencata', () => {
    const banco = bancoDiProva();
    writeFileSync(join(banco.fornitore, 'pane-del-giorno.jpg'), 'la foto del negoziante');

    const notte = banco.notte();
    expect(notte.uscita, notte.testo).toBe(0);
    expect(notte.testo).toContain('esito-foto: copiate e riaperte');
    expect(notte.testo).toContain('Riaperta dalla copia: products/pane-del-giorno.jpg');
    // La differenza fra «l'ho elencata» e «l'ho letta»: senza la lettura vera,
    // una chiave di sola scrittura resterebbe invisibile.
    const letture = notte.comandi.filter((c) => c.startsWith('cat '));
    expect(letture.length, `nessuna lettura vera: ${notte.comandi.join(' | ')}`).toBe(1);
    expect(letture[0]).toContain('pane-del-giorno.jpg');
  });

  it('un secchio senza foto non basta a far passare la notte: ne serve almeno una in tutta la copia', () => {
    // Un singolo secchio vuoto è legittimo (`reviews` può non avere ancora
    // nessuna foto). Tutta la copia vuota no.
    const banco = bancoDiProva();
    mkdirSync(join(banco.fornitore, '..', 'stories'), { recursive: true });
    const notte = banco.notte();
    expect(notte.uscita).not.toBe(0);
    expect(notte.testo).toContain('nemmeno una foto da riaprire');
  });
});
