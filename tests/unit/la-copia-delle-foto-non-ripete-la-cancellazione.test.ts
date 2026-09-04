/**
 * 3/9/2026 (R180, secondo giro) — LA COPIA DELLE FOTO ERA UNO SPECCHIO, E UNO
 * SPECCHIO NON È UNA COPIA DI SICUREZZA.
 *
 * La copia notturna delle immagini è nata il 31/8 con `rclone sync`. `sync`
 * allinea la destinazione all'origine: quello che nell'origine non c'è più, lo
 * cancella anche nella copia.
 *
 * Il male da cui questa copia doveva difendere è scritto nella scheda che l'ha
 * chiesta — «un incidente sullo storage (cancellazione, bucket sbagliato,
 * guasto del fornitore) cancella il lavoro di catalogazione di tutti i
 * negozi» — ed è esattamente il male che uno specchio propaga: le foto
 * sparivano dal fornitore lunedì, il lavoro notturno le toglieva anche dalla
 * copia martedì alle 02:17, e la mattina dopo non c'erano più da nessuna parte.
 * La difesa avrebbe avuto ventiquattro ore di vita, e nessuno se ne sarebbe
 * accorto prima del giorno in cui serviva.
 *
 * QUI SI FANNO PASSARE DUE NOTTI VERE, con lo script vero. In mezzo si cancella
 * una foto dall'origine, come farebbe un incidente. Poi si va a vedere se quella
 * foto è ancora recuperabile, e se si riapre.
 *
 * Il programma che copia è finto — su questa macchina rclone non è installato —
 * ma non finge il risultato: fa davvero quello che rclone documenta di fare,
 * cioè cancellare i file di troppo nella destinazione oppure spostarli nella
 * cartella indicata da `--backup-dir`. E si rifiuta di partire, come il vero,
 * se quella cartella sta dentro la destinazione.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, writeFileSync, chmodSync, readdirSync, existsSync, rmSync, readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RADICE = process.cwd();

function percorsoDi(programma: string): string {
  const dove = ['/usr/bin', '/bin', '/usr/local/bin']
    .map((d) => join(d, programma))
    .find((p) => existsSync(p));
  if (!dove) throw new Error(`serve ${programma} per far girare la prova`);
  return dove;
}

/** Tutti i file sotto una cartella, col percorso relativo. */
function tuttiIFile(cartella: string, prefisso = ''): string[] {
  if (!existsSync(cartella)) return [];
  return readdirSync(cartella, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory()
      ? tuttiIFile(join(cartella, d.name), `${prefisso}${d.name}/`)
      : [`${prefisso}${d.name}`],
  );
}

/** Il finto `rclone`: la semantica documentata di `sync`, sui file veri. */
const FINTO_RCLONE = [
  '#!/usr/bin/env bash',
  'set -euo pipefail',
  'comando="${1:-}"; shift || true',
  'storico=""',
  'posizionali=()',
  'while [ $# -gt 0 ]; do',
  '  case "$1" in',
  '    --backup-dir) storico="$2"; shift 2;;',
  '    --*) shift;;',
  '    *) posizionali+=("$1"); shift;;',
  '  esac',
  'done',
  '[ "$comando" = "sync" ] || exit 0',
  'origine="${posizionali[0]:-}"; destinazione="${posizionali[1]:-}"',
  '# Come il vero: lo storico non puo stare dentro la destinazione.',
  'case "$storico" in',
  '  "$destinazione"|"$destinazione"/*)',
  '    echo "Destination and parameter to --backup-dir overlap" >&2; exit 1;;',
  'esac',
  'mkdir -p "$destinazione"',
  'for f in "$destinazione"/*; do',
  '  [ -e "$f" ] || continue',
  '  nome="$(basename "$f")"',
  '  if [ ! -e "$origine/$nome" ]; then',
  '    if [ -n "$storico" ]; then mkdir -p "$storico"; mv "$f" "$storico/$nome";',
  '    else rm -f "$f"; fi',
  '  fi',
  'done',
  'if [ -d "$origine" ]; then',
  '  for f in "$origine"/*; do [ -e "$f" ] || continue; cp "$f" "$destinazione/"; done',
  'fi',
  'exit 0',
].join('\n');

const FINTO_PGDUMP = [
  '#!/usr/bin/env bash',
  'uscita=""',
  'for a in "$@"; do case "$a" in --file=*) uscita="${a#--file=}";; esac; done',
  '[ -n "$uscita" ] && printf "copia finta\\n" > "$uscita"',
  'exit 0',
].join('\n');

/**
 * Il banco: le foto «del fornitore», la cartella della copia, i finti programmi.
 * `storico` si sceglie a partire dalla cartella della copia, perché il caso
 * peggiore da provare è proprio quello in cui le due si sovrappongono.
 */
function bancoDiProva(storico?: (copia: string) => string) {
  const base = mkdtempSync(join(tmpdir(), 'copia-non-specchio-'));
  const finti = join(base, 'finti');
  const fornitore = join(base, 'fornitore');
  const copia = join(base, 'copia');
  const dump = join(base, 'dump');
  for (const d of [finti, join(fornitore, 'products'), copia, dump]) mkdirSync(d, { recursive: true });

  writeFileSync(join(finti, 'pg_dump'), FINTO_PGDUMP);
  chmodSync(join(finti, 'pg_dump'), 0o755);
  writeFileSync(join(finti, 'rclone'), FINTO_RCLONE);
  chmodSync(join(finti, 'rclone'), 0o755);

  const storicoScelto = storico?.(join(copia, 'products'));

  const notte = () =>
    spawnSync(percorsoDi('bash'), ['scripts/backup-db.sh'], {
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
        ...(storicoScelto ? { STORAGE_SYNC_STORICO: storicoScelto } : {}),
      },
    });

  return {
    fornitore: join(fornitore, 'products'),
    copia: join(copia, 'products'),
    storico: storicoScelto ?? `${copia}-storico`,
    notte,
  };
}

describe('la copia notturna delle foto quando una foto sparisce dal fornitore', () => {
  it('IL CASO CHE ROMPEVA — la foto cancellata al fornitore resta recuperabile', () => {
    const banco = bancoDiProva();
    writeFileSync(join(banco.fornitore, 'pane-del-giorno.jpg'), 'la foto del negoziante');
    writeFileSync(join(banco.fornitore, 'focaccia.jpg'), 'un altra foto');

    const prima = banco.notte();
    expect(prima.status, `${prima.stdout}${prima.stderr}`).toBe(0);
    expect(readdirSync(banco.copia).sort()).toEqual(['focaccia.jpg', 'pane-del-giorno.jpg']);

    // L'incidente: la foto sparisce dal fornitore (cancellazione di massa,
    // secchio sbagliato, chiave compromessa).
    rmSync(join(banco.fornitore, 'pane-del-giorno.jpg'));

    const dopo = banco.notte();
    expect(dopo.status, `${dopo.stdout}${dopo.stderr}`).toBe(0);

    const nellaCopia = readdirSync(banco.copia);
    const nelloStorico = tuttiIFile(banco.storico);
    const dovEFinita = nelloStorico.find((f) => f.endsWith('pane-del-giorno.jpg'));
    expect(
      dovEFinita,
      `la copia notturna ha ripetuto la cancellazione: la foto non è più da nessuna parte. Nella copia: ${nellaCopia.join(', ')} — nello storico: ${nelloStorico.join(', ') || 'niente'}`,
    ).toBeTruthy();
    // E si riapre davvero: un file vuoto nello storico non salverebbe niente.
    expect(
      readFileSync(join(banco.storico, dovEFinita!), 'utf8'),
      'il file c è ma è vuoto: il negoziante dovrebbe rifotografare lo stesso',
    ).toBe('la foto del negoziante');
    // La foto ancora viva resta al suo posto: lo storico non è una scusa per
    // smettere di tenere la copia allineata.
    expect(nellaCopia).toContain('focaccia.jpg');
  });

  it('se lo storico finisce dentro la copia, la notte diventa rossa invece di cancellare', () => {
    // È l'errore di configurazione che riporterebbe lo specchio: va visto in un
    // giorno qualunque, non la mattina dell'incidente.
    const banco = bancoDiProva((copia) => join(copia, 'storico'));
    writeFileSync(join(banco.fornitore, 'foto.jpg'), 'x');
    const notte = banco.notte();
    expect(notte.status, 'una copia configurata come specchio passava per riuscita').not.toBe(0);
    expect(`${notte.stdout}${notte.stderr}`).toContain('esito-foto: fallita');
  });
});
