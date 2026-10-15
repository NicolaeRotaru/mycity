#!/usr/bin/env bash
# =============================================================================
# Applica al database SOLO le migrazioni che non ci sono ancora, e le registra.
# =============================================================================
# Uso:  SUPABASE_DB_URL=postgres://... bash scripts/applica-migrazioni-mancanti.sh
#
# PERCHE' ESISTE (radiografia del 27/8/2026, difetto 69).
#
# Il passo del rilascio applicava TUTTI i file, ogni volta, con un ciclo:
#
#   for f in $(ls migrations/*.sql | sort -V); do psql -v ON_ERROR_STOP=1 -f "$f"; done
#
# Il commento sopra dichiarava «le migrazioni del progetto sono idempotenti».
# Non e' vero: 001 contiene `CREATE TABLE public.profiles (` e 002
# `CREATE TABLE public.categories (`, senza `IF NOT EXISTS`. Su un database che
# quelle tabelle ce le ha gia' — cioe' la produzione — psql risponde «relation
# already exists» e con ON_ERROR_STOP=1 il passo muore sul PRIMO file.
#
# Secondo difetto, indipendente: quel ciclo non registrava niente in
# `supabase_migrations.schema_migrations`. Il cancello subito dopo
# (`npm run db:check-drift`) legge proprio quella tabella: avrebbe trovato tutte
# le migrazioni «non applicate» e bloccato comunque il rilascio.
#
# Il giorno in cui si configurano i segreti per rendere sicuro il rilascio, i
# rilasci si fermerebbero del tutto — proprio mentre si spegne la strada
# vecchia. Qui si applica e si registra solo cio' che manca, come fa
# tests/sql/harness/apply.sh per il database di prova.
#
# LA PROVA: gira due volte di fila nella CI (job «Controlli database»). La
# seconda deve applicare zero file e uscire verde: l'idempotenza si prova, non
# si dichiara in un commento.
# =============================================================================
set -euo pipefail

DB="${SUPABASE_DB_URL:-}"
if [ -z "$DB" ]; then
  echo "✗ manca SUPABASE_DB_URL" >&2
  exit 1
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
MIG="$ROOT/migrations"

# 15/10/2026 (R53) — Il primo contatto col database. Se non va, si dice dove
# guardare: dalla CI il segreto SUPABASE_DB_URL e' rimasto per due mesi sulla
# connessione diretta di Supabase (solo IPv6), che da GitHub Actions non si
# raggiunge — e psql risponde solo «Network is unreachable».
#
# Il consiglio dipende da quello che psql ha detto davvero (collaudo del
# 15/10): mandare al Session pooler chi ha solo sbagliato la password lo fa
# girare a vuoto. L'errore di psql si stampa sempre, intero, sopra il consiglio.
if ! ERRORE_COLLEGAMENTO="$(psql "$DB" -q -v ON_ERROR_STOP=1 2>&1 >/dev/null <<'SQL'
CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
  version text PRIMARY KEY,
  name    text,
  statements text[]
);
SQL
)"; then
  [ -n "$ERRORE_COLLEGAMENTO" ] && printf '%s\n' "$ERRORE_COLLEGAMENTO" >&2
  echo "✗ non riesco a collegarmi al database: nessuna migrazione applicata." >&2
  case "$ERRORE_COLLEGAMENTO" in
    *"Network is unreachable"*|*"Cannot assign requested address"*|*"Address family not supported"*)
      RETE_IPV6=1 ;;
    *) RETE_IPV6=0 ;;
  esac
  case "$DB" in
    *@db.*.supabase.co*) RETE_IPV6=1 ;;
  esac
  if [ "$RETE_IPV6" = "1" ]; then
    echo "  Da GitHub Actions SUPABASE_DB_URL deve essere la riga del «Session pooler» (IPv4): Supabase → pannello Connect → riquadro «Session pooler», porta 5432. La connessione diretta db.<progetto>.supabase.co risponde solo in IPv6 e da li' non si raggiunge." >&2
  else
    case "$ERRORE_COLLEGAMENTO" in
      *"password authentication failed"*|*"no password supplied"*|*"Tenant or user not found"*)
        echo "  Il database risponde, ma rifiuta utente o password: controlla la password in SUPABASE_DB_URL. Nella riga del pooler l'utente e' postgres.<progetto>, non solo postgres." >&2 ;;
      *"could not translate host name"*)
        echo "  Il nome della macchina in SUPABASE_DB_URL non si trova: controlla l'indirizzo." >&2 ;;
      *)
        echo "  Il motivo e' nell'errore di psql qui sopra." >&2 ;;
    esac
  fi
  exit 1
fi

# =============================================================================
# CONTROLLO PREVENTIVO: il database che ha una storia PRIMA del registro
# =============================================================================
# COSA E' SUCCESSO DAVVERO (misurato il 7/9/2026 sulla produzione, in sola
# lettura, e poi riprodotto in locale su una copia fedele).
#
# La produzione ha 90 righe in `supabase_migrations.schema_migrations`, tutte
# con `version` a timestamp (20260529013234) e `name` descrittivo
# (payout_reversal_and_disputes). I file in `migrations/` si chiamano invece
# `001_create_tables.sql`, cioe' version `001` e name `create_tables`. La regola
# di salto qui sotto e' `version = '001' OR name = 'create_tables'`: in
# produzione nessuna delle due combacia, quindi la 001 risulta DA APPLICARE.
#
# Ma `001_create_tables.sql` contiene `CREATE TABLE public.profiles (` senza
# IF NOT EXISTS, e in produzione `public.profiles` esiste (9 righe). Con
# ON_ERROR_STOP=1 e `set -e`, questo script muore sul PRIMO file:
#
#   ▶ applico 001_create_tables.sql
#   psql: ERROR:  relation "profiles" already exists
#   (uscita 3, zero migrazioni applicate)
#
# Cioe': la riparazione che la scheda del difetto bloccante prescrive
# («lanciare una volta questo script contro produzione, e' idempotente»)
# NON funziona sulla produzione. E' idempotente sul database di PROVA, che
# `tests/sql/harness/apply.sh` costruisce applicando i file in ordine e
# registrandoli tutti: li' ogni file e' registrato col suo numero, quindi viene
# saltato. La produzione quella storia non ce l'ha: e' nata prima del registro.
#
# Misurato anche quanto sarebbe costato tirare dritto: riapplicando i 149 file
# a un database che li ha gia' tutti, 13 si rompono (001, 002, 020, 024, 036,
# 056, 059, 060, 085, 097, 104, 114, 115). «Riapplica tutto» non e' mai
# un'operazione sicura su questo repo.
#
# COSA FA QUESTO CONTROLLO. Riconosce il database nato prima del registro — il
# registro non e' vuoto, ma non conosce la PRIMA migrazione della cartella — e
# si FERMA prima di toccare qualsiasi cosa, spiegando cosa fare. Un rifiuto
# pulito al posto di un'esplosione a meta' strada.
#
# Non si ferma: su un database nuovo (registro vuoto -> si applica tutto da
# capo) e su un database la cui storia e' tracciata dall'inizio (registro che
# conosce la prima migrazione -> il salto per nome/numero funziona).
PRIMA_MIGRAZIONE="$(basename "$(ls "$MIG"/*.sql | sort -V | head -1)")"
PRIMA_VERSIONE="${PRIMA_MIGRAZIONE%%_*}"
PRIMA_NOME="${PRIMA_MIGRAZIONE#*_}"; PRIMA_NOME="${PRIMA_NOME%.sql}"

righe_registro="$(psql "$DB" -X -A -t -v ON_ERROR_STOP=1 \
  -c "SELECT count(*) FROM supabase_migrations.schema_migrations")"
conosce_la_prima="$(psql "$DB" -X -A -t -v ON_ERROR_STOP=1 \
  -c "SELECT 1 FROM supabase_migrations.schema_migrations
       WHERE version = '$PRIMA_VERSIONE' OR name = '$PRIMA_NOME' LIMIT 1")"

if [ "$righe_registro" -gt 0 ] && [ -z "$conosce_la_prima" ]; then
  cat >&2 <<FINE
✗ MI FERMO: questo database ha una storia precedente al registro delle migrazioni.

  Il registro ha $righe_registro migrazioni, ma non conosce la prima della
  cartella ($PRIMA_MIGRAZIONE). Se andassi avanti proverei ad applicarla,
  e fallirei subito: contiene CREATE senza IF NOT EXISTS su tabelle che questo
  database ha gia'.

  Cosa fare, una volta sola, prima di rilanciarmi:
  registrare come applicate le migrazioni che il database ha gia' (il
  «baseline»), senza rieseguirle. La procedura misurata e la lista esatta
  stanno in  docs/migrazioni-baseline-produzione.md

  Nessuna migrazione e' stata applicata. Il database non e' stato toccato.
FINE
  exit 2
fi

# =============================================================================
# PRIMA SI CONTA, POI SI TOCCA
# =============================================================================
# Il primo giro guarda soltanto: quali file il registro non conosce. Il secondo
# applica. In mezzo c'e' il tetto qui sotto, che decide prima di qualsiasi
# scrittura.
saltate=0
DA_APPLICARE=()
for f in $(ls "$MIG"/*.sql | sort -V); do
  name="$(basename "$f")"
  versione="${name%%_*}"
  descrizione="${name#*_}"; descrizione="${descrizione%.sql}"

  gia="$(psql "$DB" -X -A -t -v ON_ERROR_STOP=1 \
    -c "SELECT 1 FROM supabase_migrations.schema_migrations
         WHERE version = '$versione' OR name = '$descrizione' LIMIT 1")"
  if [ -n "$gia" ]; then
    saltate=$((saltate + 1))
    continue
  fi
  DA_APPLICARE+=("$f")
done

# =============================================================================
# IL TETTO DEL RILASCIO AUTOMATICO (15/10/2026)
# =============================================================================
# COSA SAREBBE SUCCESSO. La produzione e' indietro di 48 migrazioni (vedi
# docs/migrazioni-baseline-produzione.md). Il rilascio dopo la CI
# (.github/workflows/deploy-dopo-ci.yml) lancia questo script prima di
# pubblicare. Il giorno in cui si mettono su GitHub i segreti di Vercel e la
# riga giusta del database, la prima unione su main — anche «un cambio
# innocuo» per provare il rilascio — le avrebbe applicate tutte e 48 da sola,
# senza nessuno davanti.
#
# Fra quelle c'e' la 161, che chiude ai clienti la lettura dei negozi dalla
# tabella `profiles`. Il codice pubblicato oggi legge il negozio proprio da li'
# (lib/queries/catalogo.ts, la scheda prodotto): applicata prima che sia online
# il codice che legge la vista `seller_public_profiles`, ogni scheda prodotto
# direbbe «Prodotto non disponibile» a chiunque compri. E il riallineamento
# grande va fatto a bassa attivita', nello stesso giro, con la firma di Nicola:
# lo dice la procedura.
#
# COSA FA. Con MASSIMO_MIGRAZIONI impostato (lo imposta il rilascio
# automatico), se ne mancano di piu' si ferma PRIMA di applicare qualsiasi cosa,
# con uscita 4 e l'elenco. Un rilascio normale porta le sue migrazioni — finora
# mai piu' di 15 in una volta sola — quindi il tetto non lo tocca. Senza la
# variabile (la CI che ricostruisce da zero, o chi lancia a mano la procedura)
# non cambia niente.
MASSIMO="${MASSIMO_MIGRAZIONI:-}"
if [ -n "$MASSIMO" ]; then
  case "$MASSIMO" in
    *[!0-9]*)
      echo "✗ MASSIMO_MIGRAZIONI deve essere un numero intero, non «$MASSIMO». Non ho applicato niente." >&2
      exit 1
      ;;
  esac
  if [ "${#DA_APPLICARE[@]}" -gt "$MASSIMO" ]; then
    cat >&2 <<FINE
✗ MI FERMO: al database mancano ${#DA_APPLICARE[@]} migrazioni, e da qui ne applico al massimo $MASSIMO.

  Un rilascio normale porta poche migrazioni. Cosi' tante vogliono dire che il
  database e' rimasto indietro: e' il riallineamento descritto in
  docs/migrazioni-baseline-produzione.md, che si fa a mano, una volta, a bassa
  attivita' e con la firma di Nicola. Alcune di queste migrazioni chiudono
  porte che il codice gia' online potrebbe ancora usare: la procedura dice in
  che ordine farlo.

  Nessuna migrazione e' stata applicata. Il database non e' stato toccato.
  Quelle che mancano:
FINE
    for f in "${DA_APPLICARE[@]}"; do echo "    - $(basename "$f")" >&2; done
    exit 4
  fi
fi

applicate=0

for f in ${DA_APPLICARE[@]+"${DA_APPLICARE[@]}"}; do
  name="$(basename "$f")"
  versione="${name%%_*}"
  descrizione="${name#*_}"; descrizione="${descrizione%.sql}"

  # Si richiede al registro anche qui, file per file come prima: se un file
  # appena applicato avesse registrato anche questo (stesso nome, numero
  # diverso), lo si salta invece di riapplicarlo.
  gia="$(psql "$DB" -X -A -t -v ON_ERROR_STOP=1 \
    -c "SELECT 1 FROM supabase_migrations.schema_migrations
         WHERE version = '$versione' OR name = '$descrizione' LIMIT 1")"
  if [ -n "$gia" ]; then
    saltate=$((saltate + 1))
    continue
  fi

  echo "▶ applico $name"
  # QUANTO VALE DAVVERO "UNA TRANSAZIONE SOLA" (misurato il 6/9/2026).
  #
  # Qui c'era scritto: «se la migrazione si rompe a meta', non lascia il database
  # in uno stato intermedio e non si registra come applicata». Vero solo a meta',
  # e conviene sapere quale meta'.
  #
  # 1) --single-transaction avvolge il file in una transazione, ma se il file ne
  #    apre una sua con BEGIN e la chiude con COMMIT, quel COMMIT chiude la
  #    transazione del wrapper: tutto quello che segue viene eseguito e
  #    confermato per conto suo. Oggi succede in 23 migrazioni sulle 149 in cartella (fra cui
  #    153 e 154) e il danno e' nullo, perche' dopo il loro COMMIT resta solo
  #    NOTIFY. La prima che mettera' del lavoro vero dopo il proprio COMMIT si
  #    applichera' a meta', in silenzio. Per questo sotto c'e' un avviso: dice
  #    quali file non godono della garanzia, prima di applicarli.
  # 2) L'applicazione e la registrazione sono due comandi psql, cioe' due
  #    connessioni. Un intoppo di rete fra le due lascia la migrazione applicata
  #    ma non registrata, e al rilascio dopo viene riapplicata. Unirle in un
  #    comando solo cambierebbe cosa questo script esegue sul database di
  #    produzione: e' una modifica che va decisa e firmata a parte, non
  #    infilata in una riparazione minore.
  if grep -qE '^[[:space:]]*COMMIT[[:space:]]*;' "$f"; then
    echo "  ⚠ $name contiene un COMMIT suo: da quel punto in giu' la garanzia della transazione unica non vale." >&2
  fi
  psql "$DB" -q -v ON_ERROR_STOP=1 --single-transaction -f "$f"
  psql "$DB" -q -v ON_ERROR_STOP=1 \
    -c "INSERT INTO supabase_migrations.schema_migrations (version, name)
        VALUES ('$versione', '$descrizione')
        ON CONFLICT (version) DO NOTHING"
  applicate=$((applicate + 1))
done

echo "▶ applicate $applicate · gia' presenti $saltate"
