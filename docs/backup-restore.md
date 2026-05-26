# MyCity Piacenza — Backup & Restore Strategy

> Versione 1.0 · da rivedere ogni 3 mesi con restore drill.

---

## TL;DR

- **Database**: Supabase PITR (Point In Time Recovery) automatico, 7gg (free) / 14gg (Pro)
- **Storage** (immagini prodotti, stories, reviews): replicato su Supabase S3
- **Codice**: GitHub origin/main + tutti i branch
- **Env vars**: Render dashboard (NON in repo)
- **Restore drill**: ogni 3 mesi, documenta tempi

---

## 1. Cosa è critico

| Asset | Frequenza backup | RPO | RTO |
|---|---|---|---|
| Postgres DB | continuo (WAL) | 0-5 min | 30 min |
| Storage (immagini) | replicato S3 | 0 | 0 |
| Codice | ogni push | 0 | 5 min (re-deploy) |
| Env vars | manuale on change | – | 1h (re-input) |
| DNS Netsons | static | – | 1h (re-config) |
| Stripe data | gestito da Stripe | 0 | 0 |

---

## 2. Backup automatici Supabase

### Free tier
- Daily backup retained 7 giorni
- PITR a granularità ~5 min
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

Supabase Storage è già backuppato (S3 replication 11 9s).
Per ulteriore sicurezza, sync settimanale:

```bash
# rclone configurato con bucket Supabase + bucket personale
rclone sync supabase:products gdrive:mycity-backup/products/
rclone sync supabase:stories gdrive:mycity-backup/stories/
rclone sync supabase:reviews gdrive:mycity-backup/reviews/
```

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
   - Render dashboard → env `MAINTENANCE_MODE=true` (TODO implementare se manca)

2. **Trigger restore PITR**:
   - Supabase → Database → Backups → "Restore to point in time"
   - Seleziona timestamp pre-incidente
   - Conferma — questo **sovrascrive** il DB attuale

3. **Verifica restore completato**:
   - Aspetta notifica email Supabase
   - Esegui count query (vedi sezione 4)

4. **Riprendi traffico**:
   - Render env `MAINTENANCE_MODE=false`
   - Verifica app risponde correttamente

5. **Post-mortem**:
   - Scrivi cosa è successo, perché, come prevenire
   - Aggiungi safeguard (es. RLS più restrittiva, conferma DELETE in admin)

### Scenario: Repo GitHub corrotto / account compromesso

1. Tutti i branch locali sui tuoi PC sono backup
2. Push su nuovo repo GitHub (tu o team)
3. Render auto-deploy dopo aver aggiornato il git URL
4. Rotate tutte le secret (env vars Render)

### Scenario: Render down (rare ma possibile)

1. Setup mirror su Vercel (1h prep)
2. DNS Netsons → cambio CNAME da Render a Vercel
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
| Supabase service role | Render env | Supabase Dashboard → Settings → API → Reset |
| Stripe secret | Render env | Stripe Dashboard → Developers → API keys → Roll |
| Stripe webhook secret | Render env | Stripe Dashboard → Webhooks → reveal/rotate |
| Resend API key | Render env | Resend dashboard → API Keys → revoke + new |
| Anthropic API key | Render env | console.anthropic.com → Settings → Keys |
| CRON_SECRET | Render env + cron-job.org | Generate random 32 char + update both |
| Cloudflare Turnstile | Render env | Turnstile dashboard → Sites → rotate |

---

## 8. Checklist trimestrale

- [ ] Restore drill eseguito (vedi sezione 4)
- [ ] Tempi documentati nel log (sezione 6)
- [ ] Secret più vecchi di 6 mesi ruotati (sezione 7)
- [ ] Dump SQL manuale fatto e archiviato cloud-encrypted
- [ ] Restore tempi target < 30 min confermato

---

*Documento da aggiornare ad ogni cambio architettura o nuovo vendor critico.*
