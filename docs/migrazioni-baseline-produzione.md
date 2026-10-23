# Allineare il database di produzione: la procedura misurata

> **In due righe.** Al database di produzione mancano pezzi che il sito pubblicato già usa, e altri
> sono tornati indietro il 9 settembre. Si sistema con un comando solo, che applica le migrazioni
> mancanti (48 il 15 ottobre, fino alla 161, la riparazione; di più se nel frattempo ne sono state
> unite altre), più un controllo.

> 🔴 **Questa procedura scrive sul database di produzione. La firma è di Nicola.**

## Aggiornamento dell'11 ottobre 2026 — leggere prima di tutto

**In parole semplici.** Il 9 settembre il «passo 2» qui sotto è stato lanciato a mano in
produzione, a pezzi, ed è stato interrotto dopo la migrazione 079. Rieseguire migrazioni vecchie
riscrive sopra le versioni nuove: undici funzioni e ventisette regole di accesso sono tornate a
com'erano fra maggio e luglio. La conseguenza più visibile: **nessuno riesce più a iscriversi
come negozio o come fattorino** (il database rifiuta la riga del profilo).

**Un esempio concreto.** La funzione che crea il profilo alla registrazione è tornata alla
versione della 015: scrive «approvato» a chi sceglie negozio, mentre lo stato resta «in attesa».
Il vincolo `chk_approvazione_coerente` della 119 rifiuta la riga, e Supabase risponde
all'iscrizione con un errore del database. I clienti, invece, si iscrivono.

**Cosa cambia per te.** La procedura del 7 settembre, lanciata così com'era, non bastava più:
avrebbe lasciato rotta l'iscrizione e aperte dieci regole, e in più avrebbe riportato indietro
due cose che oggi funzionano (il compenso del fattorino in attesa, `HELD`, e la bacheca dei
fattorini della 124), perché riapplica la 119 e la 122 che la produzione ha già. La migrazione
**161** viene dopo tutte e chiude quello che resta. Lo script la applica da solo, in coda.

> ⚠️ **Non ancora il passo 2 (aggiornato il 14/10/2026).** Il passo 2 chiude la lettura dei
> profili degli altri utenti. Non lo fa solo la 161: lo fanno già la 110 e la 112, che sono fra le
> 48, e la 161 lo ripete. Quindi saltare la 161 non basta.
>
> Oggi il sito prende il negozio proprio da lì, e non solo nel catalogo. Lo fanno la scheda
> prodotto, le vetrine, la ricerca, il carrello e la cassa (nome e posizione del negozio), la
> pagina dell'ordine del cliente e quella del fattorino (indirizzo e telefono del negozio), i
> messaggi e le pagine del venditore. Con il passo 2 fatto prima di cambiare il codice, ogni
> prodotto mostrerebbe «Prodotto non disponibile» e il fattorino non vedrebbe dove ritirare.
>
> Prima va pubblicato il codice che legge i negozi da `seller_public_profiles` in tutti quei punti,
> poi il passo 2. Il controllo che lo dice: fuori dall'area admin, nessuna lettura
> `profiles!…` o `.from('profiles')` deve restare sul profilo di un altro utente.
>
> Lo ha trovato la radiografia dell'11 ottobre; misurato il 14/10 sulla copia fedele, entrando
> come visitatore senza account. Oggi il negozio si legge per 9 prodotti su 9. Dopo il passo 2,
> per 0 su 9 da `profiles`, e per 9 su 9 da `seller_public_profiles`.
>
> **Stato al 16/10/2026.** La prima ondata del sito (richiesta #258) sposta su
> `seller_public_profiles` la scheda prodotto, le vetrine, la ricerca, le fasce della home, i
> preferiti e le anteprime. Carrello, cassa, pagine degli ordini, pagine del fattorino, messaggi e
> pagine del venditore leggono ancora da `profiles`: verificato il 15/10 sul database ricostruito
> con tutte le migrazioni, dove dopo la 161 restano solo «la propria riga» e «amministratore». Il
> passo 2 resta fermo finché non è riparata anche questa seconda parte.
>
> **Stato al 18/10/2026.** La seconda parte è nella richiesta che segue la #258, sullo stesso ramo
> `ccr-60372c68-p3gpjz`. Carrello, cassa, lista condivisa, pagine degli ordini, pagine del
> fattorino, messaggi, storie, drop, eventi e «Chi siamo» leggono il negozio da
> `seller_public_profiles`. L'autore delle liste e il profilo pubblico si leggono dal server, solo
> per chi ha acceso il profilo pubblico. Restano letture del profilo di un altro utente che oggi in
> produzione tornano già vuote per quasi tutti, perché passano solo per chi ha acceso il profilo
> pubblico: il nome del fattorino visto dal cliente e dal negozio, il nome del cliente visto dal
> negozio (chat, Clienti), la firma di domande e recensioni. Non bloccano il passo 2: dopo,
> mancano anche ai pochi col profilo pubblico. Gli incassi da dichiarare del fattorino
> (`lib/rider/leggi-incassi-da-dichiarare.ts`) leggono ancora l'insegna da `profiles`, ma dal
> server col client di servizio, che le regole non le guarda: dopo il passo 2 funzionano uguale. **Con quella richiesta online, il passo 2 si può
> fare**, insieme al passo 0.

> **Stato al 19/10/2026.** La #259 è online. Il passo 0 c'è: Supabase è sul piano Pro e tiene una
> copia al giorno per sette giorni (l'ultima prima del passo 2: 19/10 alle 04:53 UTC). Dallo
> strumento Supabase della sessione è entrata solo la 091: i comandi che cancellano o sostituiscono
> qualcosa chiedono una conferma che sul telefono non compare, e la chiamata scade. Il passo 2 adesso
> passa dal lavoro `.github/workflows/migrazioni-a-mano.yml`: si avvia dalla pagina Actions, solo da
> `main`, con tre caselle: APPLICA, quante migrazioni ci si aspetta (48) e il numero dell'ultima
> (163). Sono due lavori. Il primo conta senza scrivere (`scripts/conta-migrazioni-mancanti.sh`) e
> mette l'elenco nel riepilogo: se il numero o l'ultima non tornano, si ferma. Il secondo parte solo
> dopo il primo, nell'ambiente `database-produzione`: con la spunta «Required reviewers» aspetta
> l'«Approve» di Nicola, che arriva dopo aver visto l'elenco. Il secondo riconta, gira questo stesso
> script col tetto uguale al conto, lo rilancia col tetto 0, fa i cinque controlli del passo 3 più un
> sesto sulla guardia dei contanti, e il controllo della deriva. Se il lavoro si ferma, viene
> annullato o scade dopo aver cominciato a scrivere, un ultimo passo riconta quelle che mancano
> ancora e scrive nel riepilogo con che caselle riavviare. Si mette in fila col rilascio automatico. Tutti e due i lavori si
> fermano se sta girando la copia del database (`backup-db.yml`): l'orario scritto è le 02:17 UTC,
> ma GitHub la fa partire fra le 07 e le 10 UTC, quindi si guarda se gira davvero. E si fermano se,
> dopo l'avvio, su `main` sono cambiate le migrazioni o gli script che le applicano. Se il secondo
> lavoro si ferma a metà, il database resta a metà: per esempio la 125, la 126 e la 127 tolgono la
> guardia sui contanti, che solo la 163 rimette. Va riavviato appena si è capito il motivo. Serve il
> segreto `SUPABASE_DB_URL` con la riga del Session pooler (la #255 è unita: si può cambiare).

**Cosa devi fare.** La stringa del Session pooler va nel segreto `SUPABASE_DB_URL` appena è unita
la richiesta #255 del sito, non prima (il perché è nella sezione qui sotto). I passi 0, 2 e 3 vanno fatti insieme, nello stesso giro e a
bassa attività, solo dopo che è online il codice che legge i negozi da `seller_public_profiles`
in tutti i punti dell'avviso qui sopra, non solo nel catalogo. Il passo 1 è già fatto: le
tredici righe sono nel registro dal 9 settembre.

**Cosa non ho verificato.** La prova generale è girata su PostgreSQL 16, la produzione è la 17.
E non ho potuto provare il comando contro la produzione vera: da qui il database si legge
soltanto.

### Come è stata provata (11/10/2026)

Su una **copia fedele della produzione**, ricostruita dal catalogo vero: 2.198 oggetti (funzioni,
regole di accesso, vincoli, indici, colonne, permessi) identici a quelli di produzione, con lo
stesso registro delle migrazioni (191 righe) e i dati veri con nomi e recapiti mascherati.

| passo | risultato misurato |
|---|---|
| prove `tests/sql/rls/` sulla copia, così com'è oggi | 33 file rossi su 33 (si fermano all'iscrizione) |
| `applica-migrazioni-mancanti.sh` | `applicate 48 · gia' presenti 108`, uscita 0 |
| confronto con un database costruito dal repository | zero differenze sugli oggetti del sito |
| prove `tests/sql/rls/` dopo | 33 verdi su 33 |
| script rilanciato | `applicate 0` |

Restano diverse, apposta, solo cose che col sito non c'entrano: le tabelle della macchina AD
(`kpi_snapshots`, `merchants_leads`, `outreach_events`, `telegram_chats`, `uptime_checks`), le
cartelle foto `avatars` e `stores`, e i permessi per colonna su `profiles` per i visitatori
anonimi, che in produzione sono più stretti del repository.

### La regola nuova

**Mai rieseguire a mano una migrazione vecchia.** Né dal pannello di Supabase né dallo
strumento: si passa solo da `scripts/applica-migrazioni-mancanti.sh`, che salta quelle già
registrate. Se una migrazione vecchia sembra «mancare», si scrive una migrazione nuova che
rimette la definizione finale, come la 161.

## La procedura (aggiornata)

### Prima di tutto: l'indirizzo giusto del database

**In parole semplici.** Il database si raggiunge da due porte. Quella «diretta»
(`db.clmpyfvpvfjgeviworth.supabase.co`) funziona solo su IPv6. Quella del «Session pooler»
funziona ovunque. Si usa la seconda.

**Un esempio concreto.** L'11 ottobre la copia notturna è fallita come tutte le sere, e il
motivo è scritto nel diario del lavoro: `connection to server at "db.clmpyfvpvfjgeviworth.supabase.co"
(2a05:…), port 5432 failed: Network is unreachable`. Il segreto `SUPABASE_DB_URL` su GitHub c'è,
ma punta alla porta diretta, e i server di GitHub non hanno IPv6. Lo stesso succede da molte
connessioni di casa.

**Cosa devi fare.** In Supabase apri il progetto, premi «Connect» e copia la stringa del
**Session pooler**. Ha la forma `postgresql://postgres.clmpyfvpvfjgeviworth:<password>@aws-…pooler.supabase.com:5432/postgres`.
Usala nei comandi qui sotto. Mettila anche al posto del segreto `SUPABASE_DB_URL` su GitHub:
così ripartono da sole la copia notturna e il controllo della deriva.

**Il segreto, solo dopo la #255 (aggiornato il 14/10/2026).** Oggi la copia notturna non arriva
mai al database, quindi non scrive niente. Con la stringa giusta ci arriva. Senza la #255, una
copia caduta a metà lascerebbe il database in chiaro fra i file scaricabili del lavoro. Il
repository è pubblico: quei file li scarica chiunque abbia un account GitHub. La #255 chiude questa
strada. Insegna anche al controllo delle prove automatiche a riconoscere la produzione dalla
stringa nuova.

**Attenzione alle chiavi di Vercel.** Lo stesso segreto lo usa anche il rilascio automatico
(`.github/workflows/deploy-dopo-ci.yml`): prima di pubblicare, applica le migrazioni che mancano.
Oggi quel passo si salta, perché su GitHub mancano le tre chiavi di Vercel. Se le metti mentre il
passo 2 aspetta, il primo rilascio applicherebbe da solo le 48 migrazioni, con il codice ancora da
riparare. Quindi: le chiavi di Vercel solo dopo che è online il codice dell'avviso in cima.

### Passo 0 — una copia del database, prima di scriverci

Nessuna copia notturna è mai riuscita, quindi oggi non esiste una copia da cui ripartire. Prima
del passo 2:

```bash
mkdir -p ~/copie-mycity && chmod 700 ~/copie-mycity
pg_dump --version   # deve dire 17
pg_dump "<stringa del Session pooler>" -Fc -f ~/copie-mycity/mycity-prima-della-161.dump
```

⚠️ **La copia sta fuori dalla cartella del sito, sempre.** Dentro c'è tutto: nomi, telefoni,
indirizzi e ordini dei clienti. Ci sono anche gli accessi degli utenti, cioè le sessioni aperte e
i secondi fattori. Il repository è pubblico: un file lasciato nella cartella del sito finisce
online col primo `git add`. Non va mai committato, caricato da qualche parte o incollato in una
chat. Per sicurezza, `.gitignore` ignora comunque i file `.dump`.

Atteso: uscita 0 e un file non vuoto. **Senza una copia riuscita non si passa al passo 2.**
Tienila qualche giorno dopo il passo 2, poi cancellala. Il passo 2 riscrive anche righe vive: per
esempio la 094 ricalcola `seller_payout_cents` sugli ordini. Se un errore si vede dopo, la copia
serve ancora.

Serve `pg_dump` alla versione 17 o più nuova: la produzione è PostgreSQL 17, e un `pg_dump` più
vecchio si rifiuta («server version mismatch»). Il pannello di Supabase non aiuta: il progetto è
sul piano gratuito, e lì le copie non si scaricano. Se il tuo `pg_dump` è più vecchio, due strade:

- con Docker, senza installare niente:
  `docker run --rm -v ~/copie-mycity:/out postgres:17 pg_dump "<stringa del Session pooler>" -Fc -f /out/mycity-prima-della-161.dump`
- su Ubuntu, il pacchetto `postgresql-client-17` da apt.postgresql.org, chiamato col percorso
  intero `/usr/lib/postgresql/17/bin/pg_dump`. Altrimenti può partire ancora il 16: è il tranello
  che ha fatto fallire ventuno copie notturne.

**Il tetto delle 20 migrazioni (dalla richiesta #258).** Il lavoro «Rilascio dopo CI verde» applica
da solo al massimo 20 migrazioni: se ne mancano di più si ferma prima di toccare il database e
rimanda qui. È una rete in più, non un permesso: le chiavi di Vercel restano dopo il codice
dell'avviso in cima.

### Passo 1 — registrare il baseline

Già fatto il 9 settembre. L'istruzione resta qui sotto, nella storia: è innocua da rilanciare
(`ON CONFLICT DO NOTHING`), ma non serve.

### Passo 2 — contare quello che manca, poi applicarlo, 161 compresa

⚠️ Solo dopo che è online il codice che legge i negozi da `seller_public_profiles` in tutti i
punti dell'avviso in cima, non solo nel catalogo. Subito prima, la copia del passo 0.

Prima si conta, in sola lettura:

```bash
SUPABASE_DB_URL="<stringa del Session pooler>" \
  node scripts/check-migration-drift.mjs
```

Elenca le migrazioni che mancano: chiamiamo **N** quante sono. Il 15 ottobre erano 48, dalla
lista della prova generale (fino alla 161). Ogni migrazione unita dopo si aggiunge: con le
riparazioni di ottobre arriva anche la 163, quindi N sarà almeno 49. **Le migrazioni
oltre la 161 non facevano parte della prova generale dell'11 ottobre sulla copia fedele della
produzione**: se l'elenco ne contiene, guardale prima di andare avanti.

Poi si applica, con la stessa riga:

```bash
SUPABASE_DB_URL="<stringa del Session pooler>" \
  bash scripts/applica-migrazioni-mancanti.sh
```

Atteso: `▶ applicate N · gia' presenti …`, uscita 0, con lo stesso N di prima (alla prova
generale: `applicate 48 · gia' presenti 108`). Un numero diverso da N vuol dire che qualcosa è
cambiato fra i due comandi: fermati e chiedi. Gli avvisi «contiene un COMMIT suo» sono attesi e
innocui (vedi la testa dello script).

### Passo 3 — verificare

```bash
SUPABASE_DB_URL="..." bash scripts/applica-migrazioni-mancanti.sh   # atteso: applicate 0
```

E in sola lettura:

```sql
select
  (select prosrc like '%''pending''%' from pg_proc
    where oid = 'public.handle_new_user()'::regprocedure)                      as iscrizione_in_attesa,
  pg_get_constraintdef((select oid from pg_constraint
    where conname = 'orders_rider_payout_status_check')) like '%HELD%'          as compenso_held,
  not exists (select 1 from pg_policies where schemaname = 'public'
    and policyname in ('Anyone can read active coupons','Public profile read',
                       'Anyone can view approved seller profiles',
                       'Riders can view buyer of assigned orders',
                       'sponsored_listings_owner_rw','messages_update_read'))  as porte_chiuse,
  exists(select 1 from information_schema.columns
    where table_name = 'order_items' and column_name = 'product_name')          as nome_prodotto,
  exists(select 1 from pg_proc where proname = 'enqueue_order_status_email')    as email_ordine;
```

Tutti `true`. La 161 fa da sola gli stessi controlli alla fine: se uno fallisce, si ferma e non
si registra.

---

# Storia: la procedura del 7 settembre (superata)


## Cosa ho misurato in produzione (7/9/2026, in sola lettura)

| cosa | valore |
|---|---|
| righe nel registro `supabase_migrations.schema_migrations` | 90, su 149 file in cartella |
| forma di quelle righe | `version` a timestamp (`20260529013234`), `name` descrittivo |
| forma dei file in `migrations/` | `001_create_tables.sql` → version `001`, name `create_tables` |
| ultima migrazione registrata | `20260828230000` · `129p_ponte_produzione_catalogo_visibile` (28 agosto) |
| la 001 risulta registrata? | no, né per numero né per nome |
| `public.profiles` esiste? | sì, con 9 righe |

Le due righe in fondo alla tabella sono il difetto. La regola con cui lo script decide di
saltare una migrazione è `version = '001' OR name = 'create_tables'`. In produzione non trova
niente. Quindi considera la prima migrazione ancora da applicare. E quella migrazione crea la
tabella `profiles` senza rete: se la tabella c'è già, si ferma con un errore.

Riprodotto in locale, ecco cosa faceva lo script prima della riparazione:

```
▶ applico 001_create_tables.sql
psql: ERROR:  relation "profiles" already exists
(uscita 3 — zero migrazioni applicate)
```

## Le 13 migrazioni che non si possono rieseguire

Misurate, non stimate: ho ricostruito un database con tutte e 149 le migrazioni applicate,
e ho rieseguito ogni file uno per uno. Tredici si rompono.

| file | perché si rompe |
|---|---|
| `001_create_tables` | `relation "profiles" already exists` |
| `002_categories_and_extras` | `relation "categories" already exists` |
| `020_security_hardening_and_indexes` | policy già presente |
| `024_blockers_money_kyc_returns_cash` | policy già presente |
| `036_curated_lists_and_indices` | `cannot change return type of existing function` |
| `056_active_promo_products` | `cannot change return type of existing function` |
| `059_security_audit_rpc_lockdown` | `next_invoice_number` non esiste più |
| `060_harden_product_views` | policy già presente |
| `085_email_queue_real_claim` | `cannot change return type of existing function` |
| `097_cod_remittance` | `cannot change return type of existing function` |
| `104_invoice_sequence_per_year` | `invoice_sequences` non esiste più (la 105 ha tolto la fatturazione) |
| `114_hardening_radiografia` | `cannot change name of view column` |
| `115_privacy_radiografia` | policy già presente |

Tutte e tredici sono già in produzione. Per tre di loro l'ho verificato oggetto per oggetto:
la 097, la 114 e la 115. Le altre dieci sono le fondamenta su cui il sito gira ogni giorno.
La 104 è un caso a parte. L'ha superata la 105, che ha tolto la fatturazione. Il suo stato
finale corretto è «non c'è»: va registrata come applicata, e non rieseguita.

Le altre 136 sono ri-eseguibili senza danno: usano tutte `IF NOT EXISTS` o
`CREATE OR REPLACE`. Dove sono già applicate non fanno niente; dove mancano, riempiono il buco.

## Una cosa che non aspettavamo: la 127 è applicata a metà

In produzione la funzione `enforce_order_update_rules` (migrazione 127) c'è, ma la vista
`rider_consegne_storico` della **stessa** migrazione non c'è. Qualcuno ha applicato metà
file a mano. Conta perché la migrazione 152 fa `REVOKE ALL ON public.rider_consegne_storico`:
su una vista che non esiste, si ferma. È il motivo per cui la procedura riapplica **tutti**
i 136 file in ordine, e non solo la coda dalla 130 in poi.

## La procedura

### Passo 1 — registrare il baseline

Sono le tredici della tabella qui sopra.

Non applica niente. Scrive solo tredici righe nel registro, così lo script le salta.

```sql
INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES
  ('001','create_tables'),
  ('002','categories_and_extras'),
  ('020','security_hardening_and_indexes'),
  ('024','blockers_money_kyc_returns_cash'),
  ('036','curated_lists_and_indices'),
  ('056','active_promo_products'),
  ('059','security_audit_rpc_lockdown'),
  ('060','harden_product_views'),
  ('085','email_queue_real_claim'),
  ('097','cod_remittance'),
  ('104','invoice_sequence_per_year'),
  ('114','hardening_radiografia'),
  ('115','privacy_radiografia')
ON CONFLICT (version) DO NOTHING;
```

### Passo 2 — applicare le altre 136

```bash
SUPABASE_DB_URL="postgresql://postgres:<password>@db.clmpyfvpvfjgeviworth.supabase.co:5432/postgres" \
  bash scripts/applica-migrazioni-mancanti.sh
```

Atteso, misurato sulla prova generale: `▶ applicate 136 · gia' presenti 13`, uscita 0.

### Passo 3 — verificare

```bash
SUPABASE_DB_URL="..." node scripts/check-migration-drift.mjs   # atteso: verde
SUPABASE_DB_URL="..." bash scripts/applica-migrazioni-mancanti.sh   # atteso: applicate 0
```

E in sola lettura, che gli oggetti ci siano davvero:

```sql
select to_regclass('public.ai_spend_daily')            is not null as tetto_spesa_ai,
       to_regclass('public.segnalazioni')              is not null as segnalazioni,
       to_regclass('public.rider_consegne_storico')    is not null as storico_rider,
       exists(select 1 from information_schema.columns
              where table_name='order_items' and column_name='product_name') as nome_prodotto,
       exists(select 1 from pg_proc where proname='enqueue_order_status_email') as email_ordine;
```

Tutti `true`.

## Se qualcosa si ferma

Ogni file gira dentro una transazione. Se si ferma, quel file non lascia mezzo lavoro dietro,
e non viene registrato. Si legge l'errore, si risolve, si rilancia lo stesso comando: riparte
da dove si era fermato. Resta l'avvertenza già scritta in testa allo script. Ventitré file su
149 aprono una transazione loro, e da quel punto in giù la garanzia non vale. Oggi dopo quel
punto c'è solo una notifica, quindi il danno possibile è nullo.
