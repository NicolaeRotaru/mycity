#!/usr/bin/env bash
# =============================================================================
# Esegue i controlli RLS contro un database ricostruito dalle migrazioni.
# =============================================================================
# Uso:  tests/sql/harness/run.sh [nome_database]
# Ogni file in tests/sql/rls/ è una transazione con ROLLBACK: non lascia dati.
# Esce con codice diverso da zero al primo file rosso.
# =============================================================================
set -uo pipefail

DB="${1:-mycity_test}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"

rossi=0
for f in "$ROOT"/tests/sql/rls/*.test.sql; do
  [ -e "$f" ] || continue
  name="$(basename "$f")"
  echo "▶ $name"
  if out="$(psql -q -X -d "$DB" -v ON_ERROR_STOP=1 -f "$f" 2>&1)"; then
    # psql con -f scrive «psql:<file>:<riga>: INFO:  …», non «INFO: …»: il filtro di prima non
    # mostrava mai niente, nemmeno i dettagli di un file rosso (i tempi della prova di velocità).
    echo "$out" | grep -E "(^|: )(INFO|NOTICE):" | sed -E 's/^psql:[^ ]*: //; s/^(INFO|NOTICE):/  /'
  else
    rossi=$((rossi + 1))
    echo "$out" | grep -E "(^|: )(INFO|NOTICE|ERROR):" | sed -E 's/^psql:[^ ]*: //; s/^(INFO|NOTICE):/  /; s/^/  /'
  fi
done

if [ "$rossi" -gt 0 ]; then
  echo "✗ $rossi file con controlli rossi"
  exit 1
fi
echo "✓ tutti i controlli verdi"
