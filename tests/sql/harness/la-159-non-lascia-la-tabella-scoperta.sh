#!/usr/bin/env bash
# =============================================================================
# La 159 non deve MAI lasciare `categories` senza il suo paletto
# =============================================================================
# Uso:  tests/sql/harness/la-159-non-lascia-la-tabella-scoperta.sh [nome_database]
#
# IL BUCO CHE QUESTO CONTROLLO CHIUDE.
#
# La 159 toglie il vincolo sul formato di `categories.image_url` e subito dopo
# lo rimette. Finche' le due righe stanno fuori da una transazione, sono due
# cose separate: la prima si salva da sola. Se fra l'una e l'altra entra una
# riga che il vincolo nuovo non accetta — la scrive l'API admin con la chiave di
# servizio, che in quella finestra non trova nessun paletto — l'ADD si ferma e
# la tabella resta SENZA vincolo. Per sempre, e in silenzio: il file si e'
# fermato a meta' e la meta' che ha fatto danno e' gia' committata. Da quel
# momento in `image_url` — che finisce nel `src` di un'immagine su una pagina
# pubblica — ci sta dentro qualunque cosa, `javascript:alert(1)` compreso.
#
# E c'era un secondo modo di scavalcare il paletto anche quando c'era: il
# browser toglie tabulazioni, a capo e ritorni carrello prima di leggere un
# indirizzo, e legge la barra rovescia come una barra. Cosi' `/<TAB>//evil.com`
# passava per un percorso di casa nostra ed era un altro sito.
#
# COSA PROVA, IN QUATTRO PASSI.
#   ① La 159 si applica e il vincolo del formato esiste davvero (senza questo,
#      tutto il resto sarebbe verde per finta).
#   ② LA FINESTRA: si rilancia il file mettendogli dentro una riga sporca nel
#      punto esatto in cui il vincolo non c'e' piu'. Alla fine il vincolo deve
#      essere ancora li' — lo STESSO oggetto di prima, non uno rimesso dopo —
#      la riga sporca fuori, e la tabella deve ancora rifiutare le schifezze.
#   ③ Rilanciarla da pulito funziona lo stesso (resta idempotente).
#   ④ I quindici casi, provati sulla tabella vera: dieci devono essere
#      rifiutati, cinque devono passare. Servono tutti e due i versi: un
#      vincolo che rifiuta tutto sarebbe "verde" sul primo elenco e avrebbe
#      spento le foto delle categorie.
#   ⑤ La stessa cosa su un collegamento con `standard_conforming_strings`
#      spento: la' la barra rovescia nelle regole si legge in un altro modo, e
#      senza la riga che la fissa la migrazione muore con «brackets [] not
#      balanced». Si applica il file per intero e si ricontrolla il caso della
#      barra rovescia.
# =============================================================================
set -uo pipefail

DB="${1:-mycity_prova_159}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
MIG="$ROOT/migrations"
LA159="$MIG/159_la_foto_della_categoria_si_cambia_senza_ripubblicare_il_sito.sql"
TMP="$(mktemp -d)"

butta_il_database() { psql -q -d postgres -c "DROP DATABASE IF EXISTS $DB WITH (FORCE);" >/dev/null 2>&1; }
pulisci() { butta_il_database; rm -rf "$TMP"; }
muori()   { echo "✗ $1"; pulisci; exit 1; }

[ -f "$LA159" ] || muori "non trovo $LA159"

echo "▶ ricostruisco $DB fermandomi prima della 159"
butta_il_database
psql -q -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $DB;" >/dev/null || exit 1
psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$HERE/00_shim_supabase.sql" >/dev/null 2>&1
for f in $(ls "$MIG"/*.sql | sort -V); do
  [ "$f" = "$LA159" ] && break
  if ! out="$(psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$f" 2>&1)"; then
    echo "$out" | grep -E "^psql:|ERROR" | head -3 | sed 's/^/      /'
    muori "$(basename "$f") non si applica nemmeno su un database vuoto"
  fi
done

categorie="$(psql -tA -d "$DB" -c "SELECT count(*) FROM public.categories")"
[ "${categorie:-0}" -ge 1 ] || muori "nessuna categoria in tabella: il controllo non proverebbe niente"
echo "  categorie in tabella: $categorie"

echo "▶ ① applico la 159"
if ! out="$(psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$LA159" 2>&1)"; then
  echo "$out" | grep -E "^psql:|ERROR|DETAIL" | head -5 | sed 's/^/    /'
  muori "la 159 non si applica"
fi
oid_prima="$(psql -tA -d "$DB" -c "SELECT oid FROM pg_constraint WHERE conname='categories_image_url_format'")"
[ -n "$oid_prima" ] || muori "dopo l'applicazione il vincolo del formato non c'e': i controlli dopo sarebbero verdi per finta"
colonna="$(psql -tA -d "$DB" -c "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='categories' AND column_name='image_url'")"
[ "${colonna:-0}" -eq 1 ] || muori "la colonna image_url non c'e'"
echo "  ok, colonna e vincolo ci sono"

echo "▶ ② la finestra: rilancio il file con una riga sporca dentro, nel punto scoperto"
# Il punto scoperto e' subito dopo il DROP del vincolo del formato. Si cerca la
# riga di CODICE (non i commenti, che nominano lo stesso DROP nel rollback):
# se non la si trova, ci si ferma — una prova che sbaglia il punto di innesto
# passerebbe senza aver provato niente.
DROPLINE="$(grep -n '^[[:space:]]*DROP CONSTRAINT IF EXISTS categories_image_url_format;' "$LA159" | grep -v ':[[:space:]]*--' | head -1 | cut -d: -f1)"
[ -n "$DROPLINE" ] || muori "non trovo la riga del DROP del vincolo: il punto di innesto sarebbe sbagliato e la prova non proverebbe niente"
RIGHE="$(grep -c '' "$LA159")"
[ "$DROPLINE" -lt "$RIGHE" ] || muori "il DROP e' l'ultima riga del file: punto di innesto senza senso"

sed -n "1,${DROPLINE}p" "$LA159" > "$TMP/con-la-riga-sporca.sql"
echo "UPDATE public.categories SET image_url = '//sito-esterno.example/foto.png' WHERE id = (SELECT id FROM public.categories ORDER BY slug LIMIT 1);" >> "$TMP/con-la-riga-sporca.sql"
sed -n "$((DROPLINE + 1)),\$p" "$LA159" >> "$TMP/con-la-riga-sporca.sql"
iniettate="$(grep -c '' "$TMP/con-la-riga-sporca.sql" 2>/dev/null || echo 0)"
[ "$iniettate" -eq "$((RIGHE + 1))" ] || muori "il file con la riga sporca ha $iniettate righe invece di $((RIGHE + 1)): non e' la 159, la prova non proverebbe niente"
grep -q "sito-esterno.example" "$TMP/con-la-riga-sporca.sql" || muori "la riga sporca non e' finita nel file: la prova non proverebbe niente"

# Senza ON_ERROR_STOP di proposito: e' il caso peggiore, quello in cui chi
# lancia il file non ha messo la rete e psql tira dritto fino in fondo.
psql -q -d "$DB" -f "$TMP/con-la-riga-sporca.sql" >/dev/null 2>&1

oid_dopo="$(psql -tA -d "$DB" -c "SELECT oid FROM pg_constraint WHERE conname='categories_image_url_format'")"
if [ -z "$oid_dopo" ]; then
  echo "  la tabella e' rimasta SENZA vincolo sul formato dopo un giro finito male."
  echo "  Da qui in poi in image_url — che va nel src di un'immagine pubblica — ci entra qualunque cosa."
  muori "la 159 non e' tutto-o-niente: il DROP si salva da solo e l'ADD no"
fi
[ "$oid_dopo" = "$oid_prima" ] || muori "il vincolo c'e' ma non e' lo stesso di prima (oid $oid_prima → $oid_dopo): qualcosa si e' salvato a meta'"

sporche="$(psql -tA -d "$DB" -c "SELECT count(*) FROM public.categories WHERE image_url IS NOT NULL")"
[ "${sporche:-1}" -eq 0 ] || muori "la riga sporca e' rimasta in tabella ($sporche righe piene): la transazione non ha riportato indietro niente"

if psql -q -d "$DB" -c "UPDATE public.categories SET image_url='javascript:alert(1)' WHERE image_url IS NULL" >/dev/null 2>&1; then
  psql -q -d "$DB" -c "UPDATE public.categories SET image_url=NULL" >/dev/null 2>&1
  muori "dopo il giro finito male la tabella accetta javascript:alert(1): il paletto non sta piu' guardando"
fi
echo "  ok: stesso vincolo di prima (oid $oid_dopo), riga sporca fuori, javascript: ancora rifiutato"

echo "▶ ③ e da pulito si riapplica lo stesso (idempotente)"
if ! out="$(psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$LA159" 2>&1)"; then
  echo "$out" | grep -E "^psql:|ERROR|DETAIL" | head -4 | sed 's/^/    /'
  muori "la 159 non regge una seconda applicazione"
fi
echo "  ok"

echo "▶ ④ i quindici casi, sulla tabella vera"
cat > "$TMP/i-quindici-casi.sql" <<'SQL'
DO $prova$
DECLARE
  r        record;
  esito    text;
  sbagliati int := 0;
  provati   int := 0;
  bersaglio uuid;
BEGIN
  SELECT id INTO bersaglio FROM public.categories ORDER BY slug LIMIT 1;
  FOR r IN SELECT * FROM (VALUES
    -- Quello che il browser legge come UN ALTRO SITO, e che qui deve restare fuori.
    ('tabulazione dopo la barra',   E'/\t//evil.com/x.jpg',                       'bloccato'),
    ('a capo dopo la barra',        E'/\n//evil.com/x.jpg',                       'bloccato'),
    ('ritorno carrello',            E'/\r//evil.com/x.jpg',                       'bloccato'),
    ('barra rovescia',              E'/\\evil.com/x.jpg',                         'bloccato'),
    ('tabulazione e una barra',     E'/\t/evil.com/x.jpg',                        'bloccato'),
    ('doppia barra',                '//sito-esterno.example/foto.png',            'bloccato'),
    ('barra rovescia nel dominio',  E'https://evil.com\\.images.pexels.com/x.jpg','bloccato'),
    ('javascript:',                 'javascript:alert(1)',                        'bloccato'),
    ('data:',                       'data:image/png;base64,AAA',                  'bloccato'),
    ('http in chiaro',              'http://evil.com/x.jpg',                      'bloccato'),
    -- E quello che deve passare: se lo bloccassimo, le tessere resterebbero
    -- senza foto per sempre e questo controllo sarebbe verde lo stesso.
    ('percorso del sito',           '/immagini/categorie/alimentari.jpg',                     'passa'),
    ('percorso con trattini',       '/immagini/foto-di-un-negozio_2.jpg',                     'passa'),
    ('foto pexels',                 'https://images.pexels.com/photos/1.jpg',                 'passa'),
    ('storage supabase',            'https://abc.supabase.co/storage/v1/object/public/x.png', 'passa'),
    ('https senza percorso',        'https://placehold.co',                                   'passa')
  ) AS t(etichetta, valore, atteso) LOOP
    provati := provati + 1;
    BEGIN
      UPDATE public.categories SET image_url = r.valore WHERE id = bersaglio;
      esito := 'passa';
    EXCEPTION WHEN check_violation THEN
      esito := 'bloccato';
    END;
    IF esito IS DISTINCT FROM r.atteso THEN
      sbagliati := sbagliati + 1;
      RAISE WARNING '  ✗ % → % (doveva essere %)', r.etichetta, esito, r.atteso;
    END IF;
  END LOOP;
  UPDATE public.categories SET image_url = NULL WHERE id = bersaglio;

  IF provati <> 15 THEN
    RAISE EXCEPTION 'provati % casi invece di 15', provati;
  END IF;
  IF sbagliati > 0 THEN
    RAISE EXCEPTION '% casi su % si comportano al contrario di come devono', sbagliati, provati;
  END IF;
  RAISE INFO '  ok, 15 casi su 15: 10 rifiutati, 5 passati';
END
$prova$;
SQL
if ! out="$(psql -q -X -d "$DB" -v ON_ERROR_STOP=1 -f "$TMP/i-quindici-casi.sql" 2>&1)"; then
  echo "$out" | grep -E "WARNING|ERROR" | head -8 | sed 's/^/  /'
  muori "il paletto non si comporta come dice il commento della migrazione"
fi
# Se la riga di riepilogo non c'e', il blocco non ha girato: un psql muto che
# esce con zero sarebbe un verde senza aver provato niente.
echo "$out" | grep -q "15 casi su 15" || muori "il blocco dei quindici casi non ha girato: il verde di questo passo non varrebbe niente"
echo "$out" | grep -oE "ok, 15 casi.*" | sed 's/^/  /'

echo "▶ ⑤ e regge anche un server con standard_conforming_strings spento"
psql -q -d postgres -c "DROP DATABASE IF EXISTS ${DB}_scs WITH (FORCE);" >/dev/null 2>&1
psql -q -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE ${DB}_scs TEMPLATE $DB;" >/dev/null 2>&1 \
  || muori "non riesco a copiare $DB"
buttascs() { psql -q -d postgres -c "DROP DATABASE IF EXISTS ${DB}_scs WITH (FORCE);" >/dev/null 2>&1; }

if ! out="$(PGOPTIONS="-c standard_conforming_strings=off" psql -q -X -d "${DB}_scs" -v ON_ERROR_STOP=1 -f "$LA159" 2>&1)"; then
  echo "$out" | grep -E "ERROR|HINT" | head -4 | sed 's/^/    /'
  buttascs
  muori "con standard_conforming_strings spento la 159 non si applica"
fi

# Non basta che l'indirizzo cattivo si fermi. Con quella bandierina spenta e
# senza la riga di guardia dentro la migrazione, il vincolo NASCE con dentro una
# regola illeggibile (le parentesi quadre restano aperte): il file si applica
# lo stesso, in silenzio, e poi si ferma TUTTO — anche una foto buona — la
# prima volta che qualcuno salva un indirizzo. Un controllo che guardasse solo
# il caso cattivo direbbe verde con il pannello categorie inutilizzabile.
# Quindi si guardano tutti e due i versi, e si pretende il motivo giusto:
# violazione del vincolo, non regola illeggibile.
cat > "$TMP/bandierina-spenta.sql" <<'SQL'
DO $scs$
DECLARE bersaglio uuid;
BEGIN
  SELECT id INTO bersaglio FROM public.categories ORDER BY slug LIMIT 1;
  BEGIN
    UPDATE public.categories SET image_url = '/immagini/categorie/alimentari.jpg' WHERE id = bersaglio;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'un indirizzo buono non passa piu'': % (%)', SQLERRM, SQLSTATE;
  END;
  BEGIN
    UPDATE public.categories SET image_url = E'/\\evil.com/x.jpg' WHERE id = bersaglio;
    RAISE EXCEPTION 'la barra rovescia e'' passata: il paletto non guarda piu'' niente';
  EXCEPTION
    WHEN check_violation THEN NULL;
    WHEN invalid_regular_expression THEN
      RAISE EXCEPTION 'il paletto e'' diventato una regola illeggibile: %', SQLERRM;
  END;
  UPDATE public.categories SET image_url = NULL WHERE id = bersaglio;
  RAISE INFO 'bandierina spenta: foto buona dentro, barra rovescia fuori';
END
$scs$;
SQL
if ! out="$(PGOPTIONS="-c standard_conforming_strings=off" psql -q -X -d "${DB}_scs" -v ON_ERROR_STOP=1 -f "$TMP/bandierina-spenta.sql" 2>&1)"; then
  echo "$out" | grep -E "ERROR" | head -3 | sed 's/^/    /'
  buttascs
  muori "con standard_conforming_strings spento il paletto non fa piu' il suo mestiere"
fi
echo "$out" | grep -q "foto buona dentro" || { buttascs; muori "il blocco della bandierina spenta non ha girato: verde senza aver provato niente"; }
buttascs
echo "  ok, la barra rovescia resta fuori e la foto buona entra comunque"

echo "✓ la 159 e' tutto-o-niente e il paletto non si scavalca con un carattere invisibile"
pulisci
exit 0
