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
  "  rcat) d=\"$(map \"$1\")\"; mkdir -p \"$(dirname \"$d\")\"; cat > \"$d\" ;;",
  "  deletefile) rm -f \"$(map \"$1\")\" ;;",
  "  sync)",
  "    [[ -n \"${FAKE_SYNC_FAIL:-}\" && \"$1\" == *\"$FAKE_SYNC_FAIL\" ]] && { echo \"sync rifiutata\" >&2; exit 1; }",
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

// psql finto (R15-004, secondo giro): risponde alla sola domanda «quanti file ha il secchio in
// storage.objects» col numero scritto in <radice>/_db/<secchio>. Se il file non c'e' risponde come un
// database che non si raggiunge. Ogni chiamata si annota in <radice>/_db/registro. Nessuna rete.
const PSQL_FINTO = [
  "#!/usr/bin/env bash",
  "secchio=\"\"; for a in \"$@\"; do case \"$a\" in secchio=*) secchio=\"${a#secchio=}\" ;; esac; done",
  "domanda=\"$(cat)\"",
  "echo \"$* | $domanda\" >> \"$FAKE_ROOT/_db/registro\"",
  "[[ \"$domanda\" == *storage.objects* && \"$domanda\" == *\":'secchio'\"* ]] || { echo \"domanda inattesa\" >&2; exit 3; }",
  "f=\"$FAKE_ROOT/_db/$secchio\"",
  "[[ -f \"$f\" ]] || { echo \"psql: could not connect to server\" >&2; exit 2; }",
  "cat \"$f\"",
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
  // Il database finto: `conti` dice quanti file elenca per ogni secchio. Senza `conti` il psql finto
  // c'e' ma non risponde (database irraggiungibile). Le prove che non lo chiamano non hanno DB_URL,
  // quindi lo script non chiede niente a nessun database.
  const database = (conti: Record<string, number> = {}) => {
    mkdirSync(join(radice, '_db'), { recursive: true })
    for (const [secchio, n] of Object.entries(conti)) writeFileSync(join(radice, '_db', secchio), `${n}\n`)
    writeFileSync(join(bin, 'psql'), PSQL_FINTO)
    chmodSync(join(bin, 'psql'), 0o755)
  }
  const lancia = (env: Record<string, string>) => {
    const r = spawnSync('bash', ['-c', 'set -euo pipefail; TS=T1; riepilogo_lavoro() { :; }\n' + bloccoFoto()], {
      env: { ...process.env, DB_URL: '', PATH: `${bin}:${process.env.PATH}`, FAKE_ROOT: radice, HOME: radice, ...env },
      encoding: 'utf8',
    })
    return { uscita: r.status, out: (r.stdout || '') + (r.stderr || '') }
  }
  return { radice, file, cartella, database, lancia }
}
