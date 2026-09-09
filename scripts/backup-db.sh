#!/usr/bin/env bash
# Backup automatico DB Supabase via pg_dump.
#
# Esperti consultati:
# - SRE: "Supabase free tier non ha point-in-time recovery. Cron settimanale
#   esterno e' l'unica difesa contro data loss/corruption."
# - DBA: "pg_dump --format=custom comprime ~10x vs SQL plain. Restore con
#   pg_restore e' parallelizzabile."
# - Security: "Backup contiene PII completa. Encryption-at-rest obbligatoria
#   se va su S3/Drive. NON committare in git."
#
# Uso: chiamato da cron settimanale (es. domenica 03:00 Europe/Rome):
#   0 3 * * 0 /path/to/scripts/backup-db.sh
#
# Prerequisiti:
#   - pg_dump (postgresql-client 15+)
#   - SUPABASE_DB_URL in env: postgresql://postgres:[PWD]@db.[PROJECT].supabase.co:5432/postgres
#     (Dashboard → Settings → Database → Connection string → URI)
#   - BACKUP_DIR (default: ./backups)
#
# Facoltative — la copia dei FILE delle foto (vedi in fondo, R180). Finche' non
# ci sono, la copia delle immagini non parte e lo dice a chiare lettere:
#   - STORAGE_SYNC_SOURCE   remote rclone del fornitore, es. "supabase:"
#   - STORAGE_SYNC_DEST     remote rclone di destinazione, es. "b2:mycity-foto"
#   - STORAGE_SYNC_BUCKETS  quali secchi copiare (default: products stories reviews)
#   - STORAGE_SYNC_STORICO  dove finiscono i file spariti dall'origine
#                           (default: "<STORAGE_SYNC_DEST>-storico"). Vedi in
#                           fondo, R180 secondo giro: senza, la copia e' uno
#                           specchio e ripete la cancellazione invece di
#                           proteggerla.
#
# Quando la copia delle foto e' accesa, prima di dirsi riuscita lo script va a
# RIPRENDERE una foto dal secchio di destinazione e la legge davvero: "sync e'
# uscito con zero" e "la copia si riapre" sono due cose diverse, e la seconda e'
# quella che serve il giorno del ripristino. Vedi in fondo, 8/9/2026.
#
# Retention: 4 settimane di backup, ruotati FIFO.

set -euo pipefail

DB_URL="${SUPABASE_DB_URL:-}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-28}"

# 8/9/2026 — LO STATO DELLE FOTO STAVA SOLO IN UNA RIGA DI REGISTRO DELLE 02:17.
#
# «esito-foto: non-configurato» si scriveva su stderr e il lavoro usciva verde.
# Un registro notturno non lo apre nessuno: chi guarda la pagina del lavoro vede
# una spunta verde e conclude che le foto sono al sicuro. Lo stato di una rete di
# sicurezza deve stare dove si guarda, non dove si scava.
#
# Qui la stessa riga finisce anche nel riepilogo del lavoro (la pagina che si
# apre cliccando l'esecuzione). Fuori da GitHub la variabile non esiste e questa
# funzione non fa niente: lo script resta avviabile a mano come prima.
riepilogo_lavoro() {
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    printf '%s\n' "$1" >> "$GITHUB_STEP_SUMMARY"
  fi
}

if [[ -z "$DB_URL" ]]; then
  echo "[backup] ERROR: SUPABASE_DB_URL not set" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

TS=$(date -u +%Y%m%d_%H%M%S)
OUT="$BACKUP_DIR/mycity_${TS}.dump"

echo "[backup] Starting pg_dump → $OUT"
START=$(date +%s)

pg_dump \
  --format=custom \
  --no-owner \
  --no-acl \
  --exclude-schema=storage \
  --exclude-schema=auth \
  --exclude-schema=realtime \
  --exclude-schema=supabase_functions \
  --exclude-schema=extensions \
  --file="$OUT" \
  "$DB_URL"

# #234 — Gli utenti. Lo schema `auth` era escluso per intero, e li' dentro c'e'
# `auth.users`: la tabella a cui punta `profiles.id` e quindici altri file di
# migrazione. Ripristinando solo questo dump si ottiene un database senza
# nessun utente, quindi senza nessun profilo, negozio o ordine collegabile a
# una persona: nessuno riuscirebbe piu' ad accedere. Non era un backup, era un
# file. Qui si aggiunge un secondo dump delle tabelle di `auth` che servono per
# tornare a entrare (il resto dello schema e' roba interna di Supabase, che si
# ricrea da se').
#
# 6/9/2026 — LA SOLA TABELLA DEGLI UTENTI NON BASTAVA.
#
# Il sito fa entrare anche con Google (components/ui/AuthShell.tsx): il legame
# fra la persona e il suo account Google non vive in `auth.users`, vive in
# `auth.identities`. E chi ha acceso la doppia verifica ha i suoi fattori in
# `auth.mfa_factors`. Copiando la sola tabella degli utenti, dopo un ripristino
# i secondi fattori sparivano in silenzio — chi si era protetto di piu' si
# ritrovava senza protezione — e il collegamento con Google restava appeso al
# riaggancio automatico per email, che nessuno ha mai provato.
#
# `auth.mfa_challenges` no: sono le richieste in corso, durano minuti e non
# servono a nessun ripristino.
UTENTI="$BACKUP_DIR/mycity_${TS}_utenti.dump"
echo "[backup] Dump degli utenti (auth.users, auth.identities, auth.mfa_factors) → $UTENTI"
pg_dump \
  --format=custom \
  --no-owner \
  --no-acl \
  --table=auth.users \
  --table=auth.identities \
  --table=auth.mfa_factors \
  --file="$UTENTI" \
  "$DB_URL"

# 31/8/2026 (R180) — L'elenco delle foto. Lo schema `storage` e' escluso qui
# sopra (e va escluso: dentro ci sono funzioni e trigger del fornitore che un
# ripristino non riuscirebbe a ricreare). Ma cosi' si perdeva anche il REGISTRO
# degli oggetti: quali file esistevano, con che nome, in quale secchio, di chi
# erano. Senza, dopo un incidente non si sa nemmeno cosa si e' perso: le schede
# prodotto tornano puntando a immagini di cui nessuno conosce piu' il nome, e
# l'unico modo di rifare il catalogo e' richiamare ogni negoziante a
# rifotografare tutto.
#
# Questo file NON contiene le foto: contiene il loro elenco. Vale comunque,
# perche' e' la mappa che dice a un ripristino cosa manca e dove rimetterlo.
#
# Il nome non comincia con `mycity_` di proposito: la prova mensile di
# ripristino sceglie la copia da riaprire con scripts/copie-di-backup.mjs, che
# riconosce i file `mycity_<data>[_utenti].dump` — un terzo file con quel
# prefisso le avrebbe rubato il posto e la prova avrebbe «ripristinato» un
# elenco di nomi di file dichiarandosi soddisfatta.
#
# L'elenco e' un pezzo IN PIU': se un giorno non si copiasse — permessi, schema
# spostato dal fornitore — non deve portarsi dietro anche il database. Il
# fallimento non viene ingoiato: la notte diventa rossa lo stesso, ma alla fine,
# quando la copia dei dati e' gia' scritta e cifrata.
DA_CIFRARE=("$OUT" "$UTENTI")
ESITO_ELENCO="ok"
ELENCO_FOTO="$BACKUP_DIR/mycity-elenco-foto_${TS}.dump"
echo "[backup] Elenco degli oggetti dello storage → $ELENCO_FOTO"
if pg_dump \
  --format=custom \
  --no-owner \
  --no-acl \
  --table=storage.buckets \
  --table=storage.objects \
  --file="$ELENCO_FOTO" \
  "$DB_URL"; then
  DA_CIFRARE+=("$ELENCO_FOTO")
else
  ESITO_ELENCO="fallito"
  rm -f "$ELENCO_FOTO"
  echo "[backup] esito-elenco-foto: fallito — il database e' copiato, ma di quali immagini esistevano non resta traccia." >&2
fi

# #234 — La cifratura. Dentro c'e' tutto: nomi, indirizzi, telefoni, email,
# ordini. Fino a ieri il file usciva in chiaro e restava per trenta giorni fra
# gli artefatti di GitHub, che chiunque abbia accesso al repository puo'
# scaricare. Con la passphrase, esce cifrato e basta la passphrase per
# rileggerlo.
if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
  for f in "${DA_CIFRARE[@]}"; do
    gpg --batch --yes --symmetric --cipher-algo AES256 \
      --passphrase "$BACKUP_PASSPHRASE" --output "$f.gpg" "$f"
    rm -f "$f"
    echo "[backup] Cifrato: $f.gpg"
  done
else
  echo "[backup] ATTENZIONE: BACKUP_PASSPHRASE non impostata, il file resta in chiaro." >&2
fi

SIZE=$(du -sh "$BACKUP_DIR" | cut -f1)
DURATION=$(($(date +%s) - START))
echo "[backup] Done in ${DURATION}s — size: $SIZE"

# Rotation: rimuovi backup piu' vecchi di RETENTION_DAYS
find "$BACKUP_DIR" \
  \( -name "mycity_*.dump" -o -name "mycity_*.dump.gpg" \
     -o -name "mycity-elenco-foto_*.dump" -o -name "mycity-elenco-foto_*.dump.gpg" \) \
  -mtime +"$RETENTION_DAYS" -delete
echo "[backup] Rotation done (retention: ${RETENTION_DAYS} days)"

# ─────────────────────────────────────────────────────────────────────────────
# 31/8/2026 (R180) — LE FOTO VERE.
#
# Qui, fino a oggi, c'erano due righe commentate: «decommentare e configurare
# rclone». Nessuno le ha mai decommentate, e il documento del ripristino lo
# ammetteva in una nota — quindi le immagini di prodotti, storie e recensioni
# vivevano in un posto solo. Un errore sul progetto Supabase, una chiave
# compromessa o una cancellazione di massa e settimane di catalogazione dei
# negozianti spariscono: non si ripristinano da nessuna parte, si rifanno
# richiamando i negozianti a rifotografare tutto.
#
# La copia vera vuole un secchio di destinazione fuori dal fornitore, le sue
# chiavi e qualche euro al mese: e' una decisione di Nicola, non di questo
# script. Quello che questo script puo' fare — e da oggi fa — e' essere gia'
# pronto: appena le due variabili ci sono, la copia parte da sola; finche' non
# ci sono, lo dice a chiare lettere e non finge di aver copiato niente.
#
# Il silenzio era il vero difetto: un backup che non c'e' va visto in un
# giorno qualunque, non la mattina dell'incidente.
#
# Fuori dai secchi copiati di default restano `kyc-docs`, `invoices` e
# `cod-proof`: sono documenti d'identita', fatture e prove di pagamento, e
# portarli su un fornitore terzo e' una decisione con dentro il GDPR. Si
# aggiungono a mano in STORAGE_SYNC_BUCKETS, dopo quella decisione.
# ─────────────────────────────────────────────────────────────────────────────
SORGENTE_FOTO="${STORAGE_SYNC_SOURCE:-}"
DESTINAZIONE_FOTO="${STORAGE_SYNC_DEST:-}"
SECCHI_FOTO="${STORAGE_SYNC_BUCKETS:-products stories reviews}"

# 3/9/2026 (R180, secondo giro) — LA COPIA DELLE FOTO ERA UNO SPECCHIO, E UNO
# SPECCHIO NON E' UNA COPIA DI SICUREZZA.
#
# `rclone sync` allinea la destinazione all'origine: quello che nell'origine non
# c'e' piu', lo CANCELLA anche di la'. Il male da cui questa copia doveva
# difendere e' scritto nella scheda che l'ha chiesta — «un incidente sullo
# storage (cancellazione, bucket sbagliato, guasto del fornitore) cancella il
# lavoro di catalogazione di tutti i negozi» — ed e' esattamente il male che uno
# specchio propaga: le foto sparivano da Supabase lunedi', il lavoro notturno le
# toglieva anche dalla copia martedi' alle 02:17, e la mattina dopo non c'erano
# piu' da nessuna parte. La riparazione avrebbe avuto ventiquattro ore di vita.
#
# `--backup-dir` cambia il verbo: quello che sparisce dall'origine non viene
# cancellato dalla copia, viene SPOSTATO in una cartella con la data di stanotte.
# Non si perde niente per costruzione, senza dover ricordarsi di attivare il
# versionamento del fornitore di destinazione (che dipende da lui, cambia da
# fornitore a fornitore, e nessuno verifica mai che sia acceso).
#
# Il prezzo e' lo spazio: la cartella dello storico cresce, ed e' una spesa da
# guardare ogni tanto. Si paga volentieri — costa meno di un negoziante che
# rifotografa tutto il catalogo.
#
# Deve stare FUORI dalla cartella di destinazione, altrimenti rclone rifiuta di
# partire (e allora la notte diventa rossa, che e' il comportamento giusto: una
# copia che non parte va vista).
#
# 6/9/2026 — E LA BARRA IN FONDO SPEGNEVA TUTTO.
#
# Il valore predefinito si ricava dalla destinazione: "b2:mycity-foto" diventa
# "b2:mycity-foto-storico", un secchio accanto. Ma se la destinazione e' scritta
# con la barra in fondo — "b2:mycity-foto/", che e' un modo legittimo di
# scrivere un percorso — lo storico diventava "b2:mycity-foto/-storico", cioe'
# DENTRO lo stesso secchio della copia. Provato: rclone non si lamenta (le due
# cartelle sono affiancate, non una dentro l'altra), gira e non dice niente. Ed
# e' peggio che fermarsi: la rete di sicurezza finisce nello stesso secchio da
# cui dovrebbe difendere, e il giorno che quel secchio sparisce — cancellato,
# chiave rubata, guasto del fornitore — si porta via anche lo storico. Una
# riparazione nata per proteggere le foto non puo' dipendere da un carattere.
DEST_PULITA="$DESTINAZIONE_FOTO"
while [[ "$DEST_PULITA" == */ && ${#DEST_PULITA} -gt 1 ]]; do
  DEST_PULITA="${DEST_PULITA%/}"
done
STORICO_FOTO="${STORAGE_SYNC_STORICO:-${DEST_PULITA}-storico}"

# 8/9/2026 — DICEVA «COPIATE» SENZA AVER MAI RIAPERTO UN FILE.
#
# Fino a oggi bastava che `rclone sync` uscisse con zero. Non e' la stessa cosa
# di «le foto sono al sicuro», e la differenza si scopre il giorno peggiore:
#
#  - la chiave del secchio di destinazione puo' avere il permesso di SCRIVERE e
#    non quello di LEGGERE. Su Backblaze B2 e su S3 e' una casella spuntata a
#    parte, ed e' l'errore piu' facile da fare perche' sembra piu' prudente.
#    Ogni notte la copia riesce, ogni notte esce verde, e il giorno del
#    ripristino non si riapre niente: mesi di copie inutili;
#  - un secchio d'origine che risponde con un elenco vuoto (permesso di lettura
#    tolto, secchio rinominato) fa uscire `sync` con zero avendo svuotato la
#    destinazione;
#  - un trasferimento troncato lascia file da zero byte, che si elencano
#    benissimo e non contengono niente.
#
# La scheda che ha chiesto questa copia lo diceva gia' nell'ultima riga — «la
# prova mensile deve verificare che almeno un file si riapra» — ed era la
# clausola rimasta fuori. Qui si fa ogni notte invece che ogni mese: dopo la
# sincronia si va a RIPRENDERE una foto dalla copia e la si legge davvero.
#
# Un singolo secchio vuoto e' legittimo (`reviews` puo' non avere ancora
# nessuna foto). Tutta la copia vuota no: su un marketplace vivo vuol dire che
# la copia non contiene niente, e quella notte deve essere rossa.
FOTO_RIAPERTE=0

riapri_una_foto() {
  local secchio="$1"
  local dest="${DESTINAZIONE_FOTO}/${secchio}"
  local elenco primo temporaneo byte

  # Niente pipe verso `head`: un elenco illeggibile deve restare distinguibile
  # da un elenco vuoto. Con la pipe l'errore di rclone si perderebbe e un
  # secchio irraggiungibile passerebbe per «vuoto», cioe' per buono.
  if ! elenco="$(rclone lsf --files-only --recursive "$dest" 2>&1)"; then
    echo "[backup] esito-foto: fallita — la copia del secchio ${secchio} non si riesce a LEGGERE (${dest}). Di solito e' una chiave che sa scrivere e non leggere: la copia si scrive tutte le notti e non si riaprirebbe mai. Dettaglio: ${elenco}" >&2
    return 1
  fi

  primo="${elenco%%$'\n'*}"
  if [[ -z "$primo" ]]; then
    echo "[backup] Il secchio ${secchio} non ha nessun file nella copia: niente da riaprire."
    return 0
  fi

  temporaneo="$(mktemp)"
  if ! rclone cat --count 4096 "${dest}/${primo}" > "$temporaneo" 2>/dev/null; then
    rm -f "$temporaneo"
    echo "[backup] esito-foto: fallita — la foto ${secchio}/${primo} e' nell'elenco della copia ma non si riapre." >&2
    return 1
  fi
  byte=$(wc -c < "$temporaneo")
  rm -f "$temporaneo"
  if [[ "$byte" -eq 0 ]]; then
    echo "[backup] esito-foto: fallita — la foto ${secchio}/${primo} si apre ma e' vuota (zero byte): il negoziante dovrebbe rifotografare lo stesso." >&2
    return 1
  fi

  echo "[backup] Riaperta dalla copia: ${secchio}/${primo} (${byte} byte letti)."
  FOTO_RIAPERTE=$((FOTO_RIAPERTE + 1))
  return 0
}

if [[ -z "$SORGENTE_FOTO" || -z "$DESTINAZIONE_FOTO" ]]; then
  echo "[backup] esito-foto: non-configurato — l'elenco delle immagini e' nella copia, i FILE no." >&2
  echo "[backup] Per accenderla: STORAGE_SYNC_SOURCE (es. \"supabase:\"), STORAGE_SYNC_DEST (es. \"b2:mycity-foto\") e rclone installato. Vedi docs/backup-restore.md §3." >&2
  echo "::warning::Le foto dei negozi non hanno nessuna copia nostra: se il fornitore le perde, si rifanno una per una." >&2
  riepilogo_lavoro "⚠️ **Le foto dei negozi non sono in copia** — la copia delle immagini e' scritta ma spenta: mancano il secchio di destinazione e le sue chiavi. Database, utenti ed elenco delle foto sono copiati regolarmente. Vedi \`docs/backup-restore.md\` §3."
elif ! command -v rclone >/dev/null 2>&1; then
  echo "[backup] esito-foto: fallita — la copia delle foto e' configurata ma rclone non e' installato: nessun file e' stato copiato." >&2
  riepilogo_lavoro "❌ **Le foto non sono state copiate** — la copia e' configurata ma \`rclone\` non e' installato sulla macchina che fa il lavoro."
  exit 4
else
  # 6/9/2026 — LO STORICO E' UN SECCHIO A PARTE, E NESSUNO L'AVEVA MAI CREATO.
  #
  # `--backup-dir` scrive in un secchio DIVERSO da quello di destinazione:
  # qualcuno deve averlo creato e la chiave deve poterci scrivere. Se non c'e',
  # la copia delle foto puo' fallire per intero, e la notte in cui serve non
  # c'e' nessuna copia nuova.
  #
  # Qui si prova a crearlo: `mkdir` su un remote non fa danno se esiste gia'. Se
  # non si riesce — chiave senza permesso, fornitore che vuole il secchio creato
  # a mano — NON si esce: si dice e basta, e a decidere resta la copia vera qui
  # sotto. Spegnere una copia che magari funziona sarebbe lo stesso errore di
  # prima, al contrario.
  if ! rclone lsd "$STORICO_FOTO" >/dev/null 2>&1; then
    echo "[backup] Lo storico delle foto ($STORICO_FOTO) non risponde: provo a crearlo."
    if rclone mkdir "$STORICO_FOTO" >/dev/null 2>&1; then
      echo "[backup] Storico delle foto pronto: $STORICO_FOTO"
    else
      echo "[backup] ATTENZIONE: lo storico $STORICO_FOTO non esiste e non sono riuscito a crearlo. Se la copia qui sotto fallisce, e' questo: serve il secchio gia' creato presso il fornitore con una chiave che possa scriverci, oppure STORAGE_SYNC_STORICO che punti a uno che esiste." >&2
    fi
  fi

  for secchio in $SECCHI_FOTO; do
    echo "[backup] Foto: ${SORGENTE_FOTO}${secchio} → ${DESTINAZIONE_FOTO}/${secchio}"
    echo "[backup] Le foto sparite dall'origine finiscono in ${STORICO_FOTO}/${TS}/${secchio}, non nel cestino."
    if ! rclone sync "${SORGENTE_FOTO}${secchio}" "${DESTINAZIONE_FOTO}/${secchio}" \
         --backup-dir "${STORICO_FOTO}/${TS}/${secchio}"; then
      echo "[backup] esito-foto: fallita — il secchio ${secchio} non e' stato copiato. Le foto NON sono al sicuro." >&2
      riepilogo_lavoro "❌ **Le foto non sono state copiate** — il secchio \`${secchio}\` non e' stato sincronizzato."
      exit 5
    fi
    # La sincronia e' andata: adesso si va a riprendere una foto dalla copia e
    # la si legge. Vedi il commento lungo qui sopra — «uscita zero» e «si
    # riapre» sono due cose diverse.
    if ! riapri_una_foto "$secchio"; then
      riepilogo_lavoro "❌ **La copia delle foto non si riapre** — il secchio \`${secchio}\` e' stato scritto ma non si rilegge. Guarda il registro del lavoro: quasi sempre e' la chiave che sa scrivere e non leggere."
      exit 5
    fi
  done

  # Nessun secchio ha restituito un solo file: la copia delle foto e' vuota.
  # Puo' essere un'origine sbagliata, una chiave senza lettura, un secchio
  # rinominato. Comunque sia, dichiararla riuscita sarebbe la bugia peggiore
  # che questo script possa dire.
  if [[ "$FOTO_RIAPERTE" -eq 0 ]]; then
    echo "[backup] esito-foto: fallita — la sincronia e' riuscita ma nella copia non c'e' nemmeno una foto da riaprire (secchi: ${SECCHI_FOTO}). Controlla STORAGE_SYNC_SOURCE e i permessi della chiave." >&2
    riepilogo_lavoro "❌ **La copia delle foto e' vuota** — la sincronia e' uscita bene ma non c'e' un solo file da riaprire. Controlla \`STORAGE_SYNC_SOURCE\` e i permessi della chiave."
    exit 5
  fi

  echo "[backup] esito-foto: copiate e riaperte (${SECCHI_FOTO} → ${DESTINAZIONE_FOTO}, storico in ${STORICO_FOTO}; ${FOTO_RIAPERTE} secchi riaperti dalla copia)"
  riepilogo_lavoro "✅ **Le foto sono in copia e si riaprono** — ${DESTINAZIONE_FOTO} (${FOTO_RIAPERTE} secchi riletti dalla copia, storico in ${STORICO_FOTO})."
fi

if [ "$ESITO_ELENCO" != "ok" ]; then
  echo "[backup] La copia del database c'e' ed e' cifrata; l'elenco delle immagini no. Guarda l'errore di pg_dump qui sopra." >&2
  exit 6
fi

echo "[backup] Success — database, utenti ed elenco delle foto. Per i file delle immagini vale la riga «esito-foto» qui sopra."
