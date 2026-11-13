// Aiutante delle prove R15 su scripts/backup-db.sh: SOLO dati finti, nessuna rete, nessun secchio vero.
// Estrae dallo script il blocco delle foto e lo fa girare con bash, con un rclone finto nel PATH che
// lavora su una cartella temporanea ("remote:percorso" diventa <radice>/remote/percorso).
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const RCLONE_FINTO = [
  "#!/usr/bin/env bash",
  "# rclone finto: \"remote:percorso\" -> $FAKE_ROOT/remote/percorso. Nessuna rete.",
  "map() { local r=\"${1%%:*}\" p=\"${1#*:}\"; p=\"${p#/}\"; echo \"$FAKE_ROOT/$r/$p\"; }",
  "bucket_ok() { local d; d=\"$(map \"$1\")\"; local rel=\"${d#\"$FAKE_ROOT\"/}\"; local top; top=\"$(echo \"$rel\" | cut -d/ -f1-2)\"; [[ -d \"$FAKE_ROOT/$top\" ]]; }",
  "cmd=\"$1\"; shift",
  "case \"$cmd\" in",
  "  lsd) bucket_ok \"$1\" ;;",
  "  mkdir) [[ \"${FAKE_MKDIR_FAIL:-}\" == \"1\" ]] && exit 1; mkdir -p \"$(map \"$1\")\" ;;",
  "  lsf) d=\"$(map \"${@: -1}\")\"; [[ -d \"$d\" ]] || exit 0; (cd \"$d\" && find . -type f | sed 's|^\\./||' | sort) ;;",
  "  cat) cat \"$(map \"${@: -1}\")\" ;;",
  "  sync)",
  "    src=\"$(map \"$1\")\"; dst=\"$(map \"$2\")\"; bd=\"\"",
  "    [[ \"${3:-}\" == \"--backup-dir\" ]] && bd=\"$(map \"$4\")\"",
  "    if [[ -n \"$bd\" ]]; then bucket_ok \"$4\" || { echo \"storico mancante\" >&2; exit 1; }; fi",
  "    mkdir -p \"$dst\" \"$src\"",
  "    (cd \"$dst\" && find . -type f | sed 's|^\\./||') | while read -r f; do",
  "      [[ -z \"$f\" ]] && continue",
  "      if [[ ! -f \"$src/$f\" ]]; then mkdir -p \"$(dirname \"$bd/$f\")\"; mv \"$dst/$f\" \"$bd/$f\"; fi",
  "    done",
  "    cp -r \"$src/.\" \"$dst/\" ;;",
  "  *) exit 2 ;;",
  "esac",
].join('\n') + '\n'

export function bloccoFoto(): string {
  const s = readFileSync(join(process.cwd(), 'scripts/backup-db.sh'), 'utf8')
  const a = s.indexOf('SORGENTE_FOTO="${STORAGE_SYNC_SOURCE:-}"')
  const b = s.indexOf('if [ "$ESITO_ELENCO" != "ok" ]')
  if (a < 0 || b < 0) throw new Error('blocco delle foto non trovato nello script')
  return s.slice(a, b)
}

export function mondoFinto() {
  const radice = mkdtempSync(join(tmpdir(), 'r15-rclone-'))
  const bin = join(radice, '_bin')
  mkdirSync(bin)
  writeFileSync(join(bin, 'rclone'), RCLONE_FINTO)
  chmodSync(join(bin, 'rclone'), 0o755)
  const file = (remoto: string, nome: string, contenuto = 'x') => {
    const [r, p] = remoto.split(':')
    const d = join(radice, r, p, ...nome.split('/').slice(0, -1))
    mkdirSync(d, { recursive: true })
    writeFileSync(join(radice, r, p, nome), contenuto)
  }
  const cartella = (remoto: string) => {
    const [r, p] = remoto.split(':')
    mkdirSync(join(radice, r, p), { recursive: true })
  }
  const lancia = (env: Record<string, string>) => {
    const r = spawnSync('bash', ['-c', 'set -euo pipefail; TS=T1; riepilogo_lavoro() { :; }\n' + bloccoFoto()], {
      env: { PATH: `${bin}:${process.env.PATH}`, FAKE_ROOT: radice, HOME: radice, ...env },
      encoding: 'utf8',
    })
    return { uscita: r.status, out: (r.stdout || '') + (r.stderr || '') }
  }
  return { radice, file, cartella, lancia }
}
