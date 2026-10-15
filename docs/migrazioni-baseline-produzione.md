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

**Cosa devi fare.** Lanciare i due comandi del passo 2 e del passo 3, nello stesso giro, a bassa
attività. Il passo 1 è già fatto: le tredici righe sono nel registro dal 9 settembre. **Ma prima
guarda le due condizioni in «Prima di cominciare»** (15/10/2026): la 161 va applicata solo dopo
che è online il codice che legge i negozi dalla vista, altrimenti nessun prodotto si può più
comprare dal sito.

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

### Prima di cominciare — due condizioni (15/10/2026)

**① Il codice che legge i negozi dalla vista deve essere già online.** La 161 toglie ai clienti
la lettura dei negozi dalla tabella `profiles`. Fino a oggi la scheda prodotto, la ricerca
suggerita e le fasce della home leggono il negozio proprio da lì: se la 161 arriva prima del
codice che lo legge dalla vista `seller_public_profiles`, ogni scheda prodotto mostra «Prodotto
non disponibile» a chi compra, mentre il negoziante e l'amministratore la vedono perfetta.
Quindi: prima si unisce e si pubblica la riparazione della vetrina, si apre una scheda prodotto
da una finestra anonima e si controlla che il pulsante per comprare ci sia; **solo dopo** il
passo 2.

**② La riga di collegamento.** Gli esempi qui sotto usano la riga del «Session pooler»
(Supabase → pannello Connect → riquadro «Session pooler», porta 5432), la stessa che serve alla
copia notturna. La connessione diretta (`db.<progetto>.supabase.co`) risponde solo in IPv6: da un
computer o da una rete senza IPv6 — e da GitHub Actions sempre — non ci si arriva. Copia la riga
intera dal pannello: la regione e il prefisso (`aws-0` o `aws-1`) cambiano da progetto a progetto.
Se la password contiene `# / ? @ : %`, va scritta codificata (`#` → `%23`, `@` → `%40`, …).

**Il rilascio automatico non lo fa al posto tuo.** Da oggi il lavoro «Rilascio dopo CI verde»
applica da solo al massimo 20 migrazioni: se ne mancano di più si ferma prima di toccare il
database e rimanda qui. Senza questo tetto, il giorno in cui si mettono su GitHub i segreti di
Vercel la prima unione su `main` le avrebbe applicate tutte — 48 il 15 ottobre, 161 compresa —
senza nessuno davanti e senza guardare la condizione ①.

### Passo 1 — registrare il baseline

Già fatto il 9 settembre. L'istruzione resta qui sotto, nella storia: è innocua da rilanciare
(`ON CONFLICT DO NOTHING`), ma non serve.

### Passo 2 — contare quello che manca, poi applicarlo, 161 compresa

Prima si conta, in sola lettura:

```bash
SUPABASE_DB_URL="postgresql://postgres.clmpyfvpvfjgeviworth:<password>@aws-0-<regione>.pooler.supabase.com:5432/postgres" \
  node scripts/check-migration-drift.mjs
```

Elenca le migrazioni che mancano: chiamiamo **N** quante sono. Il 15 ottobre erano 48, dalla
lista della prova generale (fino alla 161). Ogni migrazione unita dopo si aggiunge: con le
riparazioni di ottobre arrivano anche la 162 e la 163, quindi N sarà almeno 50. **Le migrazioni
oltre la 161 non facevano parte della prova generale dell'11 ottobre sulla copia fedele della
produzione**: se l'elenco ne contiene, guardale prima di andare avanti.

Poi si applica, con la stessa riga:

```bash
SUPABASE_DB_URL="postgresql://postgres.clmpyfvpvfjgeviworth:<password>@aws-0-<regione>.pooler.supabase.com:5432/postgres" \
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
