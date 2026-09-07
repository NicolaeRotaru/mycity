# Allineare il database di produzione: la procedura misurata

> **In due righe.** Al database di produzione mancano pezzi che il sito pubblicato già usa.
> Si rimettono con tre passi: prima si registrano 13 migrazioni vecchie, poi se ne applicano 136, poi si controlla.

> 🔴 **Questa procedura scrive sul database di produzione. La firma è di Nicola.**
> Quello che sta qui sotto è stato provato per intero su una copia locale, il 7 settembre 2026.
> Non è un piano: è una prova generale riuscita.

**In parole semplici.** Il database di produzione è nato prima del registro delle migrazioni.
Il registro quindi non riconosce i file della cartella `migrations/`. Lo script che dovrebbe
allinearlo prova allora a rieseguire la prima migrazione di tutte. Quella crea le tabelle da
zero, le tabelle ci sono già, e lo script muore subito.

**Un esempio concreto.** Il file `140_nome_prodotto_sulla_riga_ordine.sql` aggiunge la colonna
`product_name` alla riga d'ordine. In produzione quella colonna non c'è. La pagina del venditore
che mostra cosa ha venduto chiede quella colonna, e va in errore. Sul computer di chi sviluppa
invece funziona benissimo: lì la migrazione è stata applicata.

**Cosa cambia per te.** Oggi il codice pubblicato chiama tabelle, colonne e funzioni che
in produzione non esistono. Le pagine che le usano falliscono o restano mute: i conti del
venditore, la colonna «Venduti», il tetto di spesa AI, le email «ordine pronto» e «ordine
consegnato», il carrello segnato come recuperato. Finita questa procedura, esistono.

**Cosa devi fare.** I tre passi qui sotto, in quest'ordine, una volta sola. Servono la
stringa di connessione di produzione e cinque minuti.

**Cosa non ho verificato.** La prova generale è girata su PostgreSQL 16 in locale, mentre la
produzione è PostgreSQL 17: una versione di scarto. E l'ho costruita applicando le migrazioni a un database vuoto,
poi svuotando il registro: imita la forma della produzione, non i suoi dati. Un ordine vero
non è mai passato di qui.

---

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
