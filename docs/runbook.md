# MyCity Piacenza — Runbook Operativo

> Procedure per gestire le situazioni più frequenti. Bus factor mitigation.

---

## 1. Rimborso a buyer

### Caso A: Rimborso totale (ordine non consegnato)

**Trigger**: buyer apre dispute, seller conferma colpa, o ordine annullato post-pagamento.

**Steps**:
1. Vai su Stripe Dashboard → Payments → trova `pi_xxx` con `metadata.order_id`
2. Click "Refund" → seleziona "Full refund" → reason "Requested by customer"
3. Stripe webhook `charge.refunded` aggiornerà l'ordine automaticamente:
   - `payment_status = FAILED`
   - `delivery_status = CANCELED`
   - `payout_status = REFUNDED`
4. Verifica: `/admin/orders/[id]` mostra "Annullato + Rimborsato"
5. Buyer riceve email automatica da Stripe + nostra (template `refundIssuedTemplate`)

**Time SLA**: 24h dalla richiesta.

### Caso B: Rimborso parziale (es. 1 prodotto su 5 difettato)

**Steps**:
1. Stripe Dashboard → Payments → "Refund partial" → importo specifico
2. **Manualmente** aggiorna nell'admin l'ordine con nota interna
3. Riconcilia seller payout: se già pagato, deduci dal prossimo payout
4. Email manuale al buyer spiegando il rimborso parziale

---

## 2. Dispute resolution

**Apertura**: buyer da `/orders/[id]/dispute` o seller da `/seller/orders/[id]`.

### Workflow

1. Admin riceve notifica push + email
2. `/admin/disputes` mostra la dispute aperta
3. SLA: rispondere entro **48h**
4. Possibili esiti:
   - **Favor buyer**: rimborso totale (vedi sopra)
   - **Favor seller**: chiudi dispute con motivazione, no rimborso
   - **Negoziato**: rimborso parziale + nota
5. Marca dispute come `resolved` con `resolution_note`

### Template risposte standard

**A favore buyer**:
> "Ciao [nome], abbiamo verificato la tua segnalazione e procediamo con il
> rimborso totale di €[X]. Riceverai l'accredito entro 5-7 giorni lavorativi
> sulla stessa carta di pagamento. Ci scusiamo per il disagio."

**A favore seller**:
> "Ciao [nome], abbiamo verificato la situazione: l'ordine risulta consegnato
> correttamente e nei tempi previsti. Non possiamo procedere al rimborso.
> Se vuoi chiarire ulteriormente, contattaci su WhatsApp."

---

## 3. Ban / sospendi utente

### Buyer (ban)

```sql
UPDATE public.profiles
SET role = 'pending_approval', is_approved = false
WHERE id = '<user-uuid>';

-- Annulla tutti gli ordini in corso
UPDATE public.orders
SET delivery_status = 'CANCELED'
WHERE user_id = '<user-uuid>' AND delivery_status IN ('NEW', 'ACCEPTED');

-- Log audit
INSERT INTO public.audit_log (admin_id, target_user_id, action, reason)
VALUES (auth.uid(), '<user-uuid>', 'ban', 'frode pagamento ricorrente');
```

### Seller (sospendi)

```sql
UPDATE public.profiles
SET is_approved = false, approval_status = 'suspended'
WHERE id = '<seller-uuid>';

-- Disabilita tutti i prodotti
UPDATE public.products SET status = 'disabled'
WHERE seller_id = '<seller-uuid>';
```

---

## 4. Disaster recovery (DB restore)

### Backup

Supabase fa **PITR (Point In Time Recovery)** automatico:
- Free tier: 7 giorni
- Pro tier: 14 giorni

### Restore drill (da eseguire ogni 3 mesi)

1. Crea nuovo Supabase project (test)
2. Vai sul project produzione → Database → Backups → seleziona timestamp
3. Click "Restore to new project"
4. Connetti il nuovo project a un branch dev di MyCity (env vars)
5. Verifica: signup, search, order placement funzionano
6. Distruggi il test project

**Time SLA per disaster reale**: ~30 min dal trigger al ripristino prod.

---

## 5. Deploy di emergenza (hotfix)

```bash
# Su branch main
git checkout main
git pull
# Fix
git add -A
git commit -m "hotfix: <description>"
git push origin main
# Render auto-deploy parte in ~2 min
```

**Sempre**:
- ✅ `npm run build` localmente prima di push
- ✅ Test manuale sulla pagina toccata
- ❌ Mai `git push --force` su main

---

## 6. Cron job non parte

### `/api/cron/send-emails` o `/api/cron/abandoned-carts` silenzio

**Diagnosi**:
1. Vai su cron-job.org → Cronjobs → verifica "Last execution" status
2. Se 401 → `CRON_SECRET` mismatched. Verifica env Render.
3. Se 500 → bug nel codice. Sentry dovrebbe averlo catturato.
4. Se OK ma 0 email inviate → check `email_queue`:
   ```sql
   SELECT count(*), template
   FROM public.email_queue
   WHERE send_at <= now() AND sent_at IS NULL AND cancelled_at IS NULL
   GROUP BY template;
   ```

---

## 7. Stripe webhook non riceve

**Sintomi**: ordini pagati via card non compaiono in DB.

**Diagnosi**:
1. Stripe Dashboard → Developers → Webhooks → verifica endpoint status
2. Se errori → guarda payload + risposta
3. Verifica `STRIPE_WEBHOOK_SECRET` su Render env
4. Tentativi falliti vengono ri-tentati da Stripe per 3gg

**Workaround manuale**:
- Recupera l'ordine via `checkout_session_id` da Stripe
- Insert manuale via Supabase SQL editor (vedi schema `orders` in migration 011)

---

## 8. Rider non si vede live sulla mappa buyer

**Sintomi**: buyer apre `/orders/[id]` ma niente posizione rider.

**Diagnosi**:
1. Rider ha attivato GPS sharing? Verifica nel suo `/rider/orders/[id]` pulsante "Condividi posizione"
2. Browser permission geolocation? Rider deve dare consenso al browser.
3. Realtime channel attivo? Apri DevTools Network → Filter WS → cerca "supabase.realtime"
4. Realtime publication include `orders`? Vedi migration 034:
   ```sql
   SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
   ```

---

## 9. KYC seller pending da troppo tempo

**Workflow**:
1. Founder controlla `/admin/users?role=seller&status=pending` settimanalmente
2. Per ogni pending da 48h+, contatto WhatsApp diretto
3. Documenti mancanti → richiesta esplicita lista
4. Approva via `/admin/users/[id]` → `is_approved=true`
5. Trigger automatico: notifica push + email al seller

---

## 10. Daily story / Shop of month / Events vuoti

**Sintomo**: home senza contenuto curato (MaybeSection sta nascondendo le sezioni).

**Azione settimanale del founder**:
- **Lunedì 9:00**: scrivi 1 daily_story per la settimana via `/admin/daily-stories` (TODO se manca)
- **Primo del mese**: scegli "Shop of month" via `/admin/shop-of-month`
- **Ogni 2 settimane**: pubblica 1 evento via `/admin/events`

---

## 11. Cosa fare se tu (founder) sei via

### Setup pre-vacanza (1 settimana prima)

1. Auto-responder email/WhatsApp: "Risposte entro X giorni"
2. Pause campagne acquisition (cron + Instagram)
3. Settle tutti gli ordini in PENDING
4. Identifica 1 persona "on-call" emergency (parente, partner)
5. Condividi questo runbook con on-call person

### On-call quick reference

| Evento | Azione |
|---|---|
| SOS rider | Apri `/admin/sos`, chiama 112 e numero rider |
| Sito giù | Verifica UptimeRobot, ping Render support |
| Frode evidente | Sospendi user via SQL (vedi #3) |
| Buyer arrabbiato (telefonata) | Apri ticket WhatsApp, prometti risposta entro 24h |

---

## 12. Contatti vendor

| Vendor | Contatto | Urgenza |
|---|---|---|
| Render | support.render.com | 24/7 chat |
| Supabase | support@supabase.io | 24/7 email |
| Stripe | dashboard.stripe.com → Help | 24/7 |
| Cloudflare | dashboard.cloudflare.com → Support | 24/7 |
| Resend | resend.com/contact | business hours |
| Anthropic | support@anthropic.com | business hours |
| Netsons (DNS) | netsons.com/area-clienti | business hours |

---

*Aggiorna ogni volta che ti trovi a googleare la procedura per la 2a volta.*
