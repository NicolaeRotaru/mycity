# MyCity Piacenza — Backup & Restore Strategy

> Versione 1.0 · da rivedere ogni 3 mesi con restore drill.

---

> ⚠️ **#238 — Questo documento prometteva una rete di sicurezza che potrebbe non
> esistere.** Diceva «ripristino al minuto, perdita massima 5 minuti» su tutti i
> piani; ma sul piano gratuito di Supabase il ripristino al minuto non c'è, e
> ripristinare una copia giornaliera **sovrascrive la produzione**. Nel
> frattempo `scripts/backup-db.sh` — scritto proprio perché «il piano gratuito
> non ha il ripristino al minuto» — non lo eseguiva nessuno.
>
> Due documenti che si contraddicono su come si salvano i dati sono peggio di
> nessun documento: qualcuno userà quello sbagliato come piano, il giorno
> peggiore.
>
> **Da fare (5 minuti, e vale più di tre paragrafi):** aprire Supabase →
> Settings → Billing e Database → Backups, e scrivere qui sotto cosa c'è
> davvero, con la data.
>
> - Piano attivo: _da verificare — serve il pannello Billing, non si vede da qui_
> - Ripristino al minuto (PITR): _da verificare — stesso posto_
> - Copie giornaliere, quante conservate: _da verificare — stesso posto_
> - Data del controllo: _mai fatto_
>
> **Controllato il 22/8/2026, e questo si vede:** il database di produzione
> (progetto «Mycity», regione eu-west-3) gira **PostgreSQL 17**, stato
> `ACTIVE_HEALTHY`. Non e' un dettaglio da nerd: la copia notturna installava
> un client PostgreSQL 16, e un client 16 **si rifiuta** di copiare un server
> 17. La copia notturna stava fallendo. Corretto lo stesso giorno agganciando
> la versione del client a quella del server.
>
> **Quello che è certo, oggi:** la copia notturna di GitHub Actions
> (`.github/workflows/backup-db.yml`) gira ogni notte alle 02:17 UTC, esce
> cifrata (segreto `BACKUP_PASSPHRASE`), comprende gli utenti dal 20 agosto e
> resta 30 giorni fra gli artefatti. È la rete che sappiamo esserci.

## TL;DR

- **Database**: copia notturna cifrata via GitHub Actions (30 giorni) + quello
  che offre il piano Supabase attivo, da verificare (vedi avviso sopra)
- **Elenco delle foto** (`storage.objects` + `storage.buckets`): nella copia
  notturna dal 31/8/2026. Non sono le foto: è la lista di quali file
  esistevano, con che nome e in che secchio — la mappa per sapere cosa manca
- **File delle foto** (immagini prodotti, stories, reviews): ⚠️ **ANCORA
  NESSUNA COPIA NOSTRA.** Il pezzo che le copia è scritto e pronto dentro
  `scripts/backup-db.sh`, ma è **spento**: si accende da solo appena ci sono un
  secchio di destinazione e le sue chiavi (vedi §3). Finché è spento, ogni
  notte scrive `esito-foto: non-configurato` e non finge di aver copiato
- **Codice**: GitHub origin/main + tutti i branch
- **Env vars**: Vercel → progetto → Settings → Environment Variables (NON in repo)
- **Restore drill**: ogni 3 mesi, documenta tempi

---

## 1. Cosa è critico

| Asset | Frequenza backup | RPO | RTO |
|---|---|---|---|
| Postgres DB | notturna (GitHub Actions, cifrata) | 24 h | 30 min |
| Elenco delle foto (`storage.objects`) | notturna, dentro la stessa copia | 24 h | 30 min |
| File delle foto (le immagini vere) | ⚠️ **nessuna copia** — il pezzo che le copia è pronto e spento (§3) | ∞ | ∞ |
| Codice | ogni push | 0 | 5 min (re-deploy) |
| Env vars | manuale on change | – | 1h (re-input) |
| DNS Netsons | static | – | 1h (re-config) |
| Stripe data | gestito da Stripe | 0 | 0 |

---

## 2. Backup automatici Supabase

### Free tier
- Daily backup retained 7 giorni
- **Nessun ripristino al minuto (PITR).** Qui c'era scritto «PITR a granularità
  ~5 min», che contraddiceva l'avviso in cima a questo stesso file. Due righe
  che si escludono a vicenda, nello stesso documento, sul punto che conta di
  più: qualcuno avrebbe usato quella sbagliata come piano, il giorno peggiore.
  Tolta il 22/8/2026.
- Restore: SOLO sull'istanza stessa (sovrascrive prod)

### Pro tier ($25/mese) — raccomandato dal primo €1k MRR
- Daily backup retained 14 giorni
- PITR retained 7 giorni
- Restore su nuovo project (clean recovery)
- Branching (database branches per dev)

### Quando passare a Pro
- Quando vai live con utenti reali
- Quando DB supera 500MB
- Quando vuoi ambiente staging

---

## 3. Backup manuali (sicurezza extra)

### Dump SQL settimanale

```bash
# Su tua macchina locale, ogni lunedì
pg_dump "$SUPABASE_DB_URL" \
  --schema=public \
  --no-owner \
  --no-acl \
  --data-only \
  > backups/mycity-$(date +%Y%m%d).sql

# Carica su Google Drive / Dropbox encrypted
gpg --encrypt --recipient your-email@ex.com backups/mycity-$(date +%Y%m%d).sql
```

Dove trovi `SUPABASE_DB_URL`:
- Supabase Dashboard → Settings → Database → Connection string (Direct)

### Storage backup

> ⚠️ **22/8/2026 — QUESTA PAGINA DICEVA UNA COSA CHE NON È VERA.**
>
> Qui c'era scritto «Supabase Storage è già backuppato (S3 replication 11 9s)»,
> e nella tabella §1 le immagini avevano RPO 0 e RTO 0 — cioè: perdita zero,
> ripristino immediato. Non esisteva nessuna copia delle foto: né uno script,
> né un passo del lavoro notturno, né un secchio nostro. La replica di cui
> parlava la riga è la durabilità interna del fornitore, che protegge da un
> disco rotto — non da una cancellazione, non da una chiave compromessa, non
> dalla chiusura del progetto.
>
> È il tipo di riga più pericoloso che ci sia in un documento di ripristino:
> chi lo legge in emergenza smette di cercare la copia, perché il documento
> gli dice che c'è.

**31/8/2026 (R180) — dove siamo adesso, in due righe:**

| Cosa | Copiata? | Dove |
|---|---|---|
| L'**elenco** dei file (nome, secchio, data, proprietario) | ✅ sì, ogni notte | `mycity-elenco-foto_<data>.dump.gpg`, cifrato, insieme al database |
| I **file** veri (le immagini) | ❌ no — pronto ma spento | serve un secchio di destinazione e le sue chiavi |

#### L'elenco: cosa copre e cosa no

La copia notturna salta apposta lo schema `storage` (dentro ci sono funzioni e
trigger del fornitore che un ripristino non saprebbe ricreare), e così si
perdeva **anche la lista**. Da oggi `scripts/backup-db.sh` fa un terzo dump
delle sole tabelle `storage.buckets` e `storage.objects`.

Non sono le foto. È la mappa: dopo un incidente dice **quali file esistevano,
con che nome, in che secchio e da quando** — cioè permette di sapere cosa si è
perso, di rimettere i file al posto giusto se li si recupera altrove, e di dire
a ogni negoziante esattamente quali immagini deve rifare. Senza, si ripartiva
da un catalogo che punta a nomi che nessuno conosce più.

Il file si chiama `mycity-elenco-foto_<data>.dump[.gpg]` e **non** comincia con
`mycity_` di proposito: la prova mensile di ripristino sceglie la copia da
riaprire per nome (`scripts/copie-di-backup.mjs`), e un terzo file con quel
prefisso le avrebbe rubato il posto.

Se un giorno l'elenco non si copiasse (permessi, schema spostato dal
fornitore), **la copia del database non si perde lo stesso**: viene scritta e
cifrata comunque, e il lavoro notturno diventa rosso alla fine con
`esito-elenco-foto: fallito`.

#### I file: pronti a partire, ancora spenti

**Stato vero, oggi: le immagini dei prodotti non hanno nessuna copia nostra.**
Se il progetto Supabase sparisce, spariscono con lui.

Il pezzo che le copia è già scritto in fondo a `scripts/backup-db.sh` e si
accende da solo: non serve modificare nessun file, servono **due variabili
d'ambiente e `rclone` installato**. Quello che manca non è codice — è un
secchio di destinazione fuori dal fornitore e le sue chiavi, che costano
qualche euro al mese: **la decide Nicola.**

| Variabile | Cos'è | Esempio |
|---|---|---|
| `STORAGE_SYNC_SOURCE` | il remote rclone del fornitore (finisce con `:`) | `supabase:` |
| `STORAGE_SYNC_DEST` | il remote rclone di destinazione | `b2:mycity-foto` |
| `STORAGE_SYNC_BUCKETS` | quali secchi copiare (facoltativa) | `products stories reviews` |

Ogni notte il lavoro scrive una riga che dice come è andata, e non ne esiste
una quarta:

- `esito-foto: non-configurato` → mancano le variabili. **Nessun file è stato
  copiato**, e il lavoro lo dice invece di tacere. Il resto della copia
  (database, utenti, elenco) è comunque riuscito.
- `esito-foto: copiate (...)` → i secchi sono stati sincronizzati davvero.
- `esito-foto: fallita ...` → ci ha provato e non ce l'ha fatta (o manca
  `rclone`): **il lavoro diventa rosso**, così si scopre in un giorno
  qualunque invece che la mattina dell'incidente.

Il comportamento è tenuto fermo da
`tests/unit/la-copia-notturna-non-finge-di-aver-salvato-le-foto.test.ts`, che
avvia lo script vero: con le chiavi (finte) deve provare a copiare, senza deve
dire «non configurato» e non dichiararsi riuscito.

**Cosa NON viene copiato anche quando è acceso:** `kyc-docs` (documenti
d'identità), `invoices` (fatture) e `cod-proof` (prove di pagamento in
contanti). Sono dati personali: portarli su un fornitore terzo è una decisione
con dentro il GDPR, e va presa prima — poi si aggiungono a
`STORAGE_SYNC_BUCKETS`.

#### Per accenderla (quando c'è la destinazione)

```bash
# 1. crea il secchio di destinazione presso il fornitore scelto e le chiavi
# 2. configura i due remote rclone (una volta, sulla macchina che fa la copia)
rclone config   # un remote per Supabase (S3-compatibile) e uno per la destinazione

# 3. passa le due variabili al lavoro notturno; da lì in poi parte da sola
STORAGE_SYNC_SOURCE="supabase:" STORAGE_SYNC_DEST="b2:mycity-foto" \
  bash scripts/backup-db.sh
```

Su GitHub Actions le due variabili vanno aggiunte al passo che esegue il
backup, e `rclone` installato nel lavoro: finché non ci sono, il lavoro resta
verde e scrive `esito-foto: non-configurato`.

---

## 4. Restore drill (ogni 3 mesi)

### Procedure

1. **Crea nuovo project Supabase test** (free tier)
   - Nome: `mycity-restore-test-YYYYMMDD`
   - Region: stessa di prod (EU)

2. **Restore da backup**
   - Vai sul project produzione → Database → Backups
   - Seleziona backup di ieri
   - Click "Restore to new project" → seleziona quello creato
   - Aspetta 5-30 min (dipende dalla size)

3. **Verifica integrità**

   ```sql
   -- Count critical tables
   SELECT 'profiles' as t, count(*) FROM public.profiles
   UNION ALL SELECT 'orders', count(*) FROM public.orders
   UNION ALL SELECT 'products', count(*) FROM public.products
   UNION ALL SELECT 'order_items', count(*) FROM public.order_items;

   -- Verify RLS abilitato
   SELECT tablename, rowsecurity FROM pg_tables
   WHERE schemaname = 'public' AND rowsecurity = false;
   -- Atteso: 0 rows (tutte hanno RLS)

   -- Verify triggers presenti
   SELECT trigger_name, event_object_table FROM information_schema.triggers
   WHERE trigger_schema = 'public';
   ```

   L'elenco delle foto sta in un file a parte
   (`mycity-elenco-foto_<data>.dump[.gpg]`): riaprilo nello stesso database di
   prova e controlla che ci sia, altrimenti in emergenza non sapresti nemmeno
   quali immagini mancano.

   ```bash
   psql -d prova -c "CREATE SCHEMA IF NOT EXISTS storage;"
   pg_restore --no-owner --no-acl --dbname=prova mycity-elenco-foto_<data>.dump
   psql -d prova -c "SELECT bucket_id, count(*) FROM storage.objects GROUP BY 1;"
   ```

4. **Smoke test app**
   - Cambia env `NEXT_PUBLIC_SUPABASE_URL` localmente al project test
   - `npm run dev`
   - Test: signup, login, search, add to cart, checkout (test mode)

5. **Misura tempi**

   | Step | Tempo |
   |---|---|
   | Crea project | 2 min |
   | Restore | ___ min |
   | Verifica integrità | 5 min |
   | Smoke test | 10 min |
   | **Totale** | ___ min |

6. **Distruggi project test**
   - Supabase → Settings → Delete project
   - **Documenta tempo totale in questo file** (sezione storico)

---

## 5. Recovery di emergenza (DR plan)

### Scenario: DB produzione corrotto / cancellato per errore

**Step-by-step (tempo target: 30 min)**:

1. **STOP scritture**: metti app in modalità manutenzione
   - Vercel → progetto → Settings → Environment Variables → `MAINTENANCE_MODE=true`
     (TODO implementare se manca)

2. **Trigger restore PITR**:
   - Supabase → Database → Backups → "Restore to point in time"
   - Seleziona timestamp pre-incidente
   - Conferma — questo **sovrascrive** il DB attuale

3. **Verifica restore completato**:
   - Aspetta notifica email Supabase
   - Esegui count query (vedi sezione 4)

4. **Riprendi traffico**:
   - Vercel → variabili d'ambiente → `MAINTENANCE_MODE=false`
   - Verifica app risponde correttamente

5. **Post-mortem**:
   - Scrivi cosa è successo, perché, come prevenire
   - Aggiungi safeguard (es. RLS più restrittiva, conferma DELETE in admin)

### Scenario: Repo GitHub corrotto / account compromesso

1. Tutti i branch locali sui tuoi PC sono backup
2. Push su nuovo repo GitHub (tu o team)
3. Vercel ripubblica dopo aver aggiornato il git URL
4. Rotate tutte le secret (variabili d'ambiente su Vercel)

### Scenario: Vercel down (raro ma possibile)

1. Setup mirror su Vercel (1h prep)
2. DNS Netsons → sposta il CNAME su un altro fornitore gia' pronto
3. TTL Netsons di solito 1h → totale downtime ~2h

---

## 6. Disaster Recovery Test Log

| Data | Tipo test | Tempo restore | Successo | Note |
|---|---|---|---|---|
| TBD | First drill | __ | __ | Da eseguire questa settimana |

---

## 7. Rotation secrets

### Quando ruotare

- Ogni 6 mesi (preventivo)
- Subito se sospetto leak
- Subito se employee/collaboratore lascia con accesso

### Cosa ruotare

| Secret | Dove | Procedura rotation |
|---|---|---|
| Supabase service role | Vercel env | Supabase Dashboard → Settings → API → Reset |
| Stripe secret | Vercel env | Stripe Dashboard → Developers → API keys → Roll |
| Stripe webhook secret | Vercel env | Stripe Dashboard → Webhooks → reveal/rotate |
| Resend API key | Vercel env | Resend dashboard → API Keys → revoke + new |
| Anthropic API key | Vercel env | console.anthropic.com → Settings → Keys |
| CRON_SECRET | Vercel env + cron-job.org | Generate random 32 char + update both |
| Cloudflare Turnstile | Vercel env | Turnstile dashboard → Sites → rotate |

---

## 8. Checklist trimestrale

- [ ] Restore drill eseguito (vedi sezione 4)
- [ ] Tempi documentati nel log (sezione 6)
- [ ] Secret più vecchi di 6 mesi ruotati (sezione 7)
- [ ] Dump SQL manuale fatto e archiviato cloud-encrypted
- [ ] Restore tempi target < 30 min confermato
- [ ] Riga `esito-foto:` dell'ultima copia notturna letta (§3): se dice ancora
      `non-configurato`, le immagini non hanno nessuna copia

---

*Documento da aggiornare ad ogni cambio architettura o nuovo vendor critico.*
