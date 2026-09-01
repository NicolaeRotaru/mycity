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

> ⚠️ #238 — **Da verificare prima di fidarsi.** Qui c'era scritto che Supabase
> fa il ripristino al minuto (PITR) su tutti i piani. Non è così: sul piano
> gratuito il ripristino al minuto **non c'è**, e il ripristino di una copia
> giornaliera **sovrascrive la produzione**, non crea una copia a parte. Lo
> script `scripts/backup-db.sh` nasce proprio da questo: era la nostra unica
> rete di sicurezza vera, e non lo eseguiva nessuno.
>
> **Cosa c'è davvero, oggi:** la copia notturna di GitHub Actions
> (`.github/workflows/backup-db.yml`), cifrata, conservata 30 giorni, che dal
> 20 agosto comprende anche gli utenti. Il resto va confermato aprendo
> Supabase → Settings → Billing e Database → Backups, e scritto qui con la
> data del controllo.
>
> - Piano Supabase attivo: _da verificare_
> - Ripristino al minuto (PITR): _da verificare_
> - Data del controllo: _mai fatto_

### Restore drill (da eseguire ogni 3 mesi)

1. Crea nuovo Supabase project (test)
2. Vai sul project produzione → Database → Backups → seleziona timestamp
3. Click "Restore to new project"
4. Connetti il nuovo project a un branch dev di MyCity (env vars)
5. Verifica: signup, search, order placement funzionano
6. Distruggi il test project

> ⚠️ **22/8/2026 — I TRENTA MINUTI QUI SOTTO NON LI HA MAI CRONOMETRATI NESSUNO.**
>
> «~30 min dal trigger al ripristino» è una stima scritta a tavolino. La prova
> di ripristino non è mai stata fatta — lo dice la riga «Data del controllo:
> _mai fatto_» poco sopra — quindi non sappiamo:
>
> - se il file della copia notturna si riapre davvero su un database vuoto;
> - quanto ci mette;
> - se dopo il ripristino il sito parte, o se manca qualcosa che nessuno ha
>   pensato di includere.
>
> Una copia mai riprovata non è una copia: è un file di cui speriamo bene. E la
> speranza si scopre sbagliata nel momento peggiore.
>
> **Cosa chiude davvero questo punto** (in ordine di valore):
> 1. una prova di ripristino vera, cronometrata, con la data scritta qui;
> 2. un passo mensile nel lavoro notturno che riapplichi il dump su un database
>    vuoto — un ripristino che gira da solo è l'unica prova che regge nel tempo;
> 3. una copia fuori da GitHub (gli artefatti durano 30 giorni, e vivono nello
>    stesso posto del codice: un accesso compromesso li prende tutti e due).
>
> Il passo ② è preparato in `.github/workflows/backup-db.yml` (lavoro
> `prova-di-ripristino`, mensile) e gira da solo: non serve nessuna chiave in
> più oltre a quelle che la copia usa già.

**Time SLA per disaster reale**: stimato ~30 min, **mai misurato** (vedi sopra).

---

## 4-bis. Tornare indietro dopo un rilascio andato male

> #231 — Prima non era scritto da nessuna parte. Chi si trovava il sito rotto
> alle nove di sera trovava scritto come rilasciare, non come tornare indietro:
> l'unica strada che veniva in mente era un altro rilascio, cioè la cosa più
> lenta e più rischiosa da fare mentre il sito è giù.

**L'obiettivo, dichiarato:** si decide entro **10 minuti** dal primo segnale, si
torna indietro in **meno di 5**.

**Come si fa (è un clic):**

1. Vercel → il progetto **mycity** → scheda **Deployments**.
2. Trova l'ultimo rilascio marcato **Production** con lo stato *Ready*, quello
   **prima** di quello rotto.
3. Menù **⋯** su quella riga → **Instant Rollback** (o *Promote to Production*).
   I rilasci di Vercel sono immutabili: sta ripuntando il dominio su file che
   esistono già, non ricostruendo niente. Per questo è veloce.
4. Aspetta che il dominio mostri quel rilascio e ricontrolla la pagina rotta.

⚠️ Fino al 21/8/2026 questi quattro passi dicevano «Render → Events →
Rollback». Il sito è su Vercel, quindi quella procedura non avrebbe funzionato
— e l'avresti scoperto col sito giù e il cronometro che corre. Nicola ha
confermato di non usare più Render.

**Se il guasto nasce da una migrazione del database, il ritorno del codice NON
basta.** Il codice vecchio parlerà con un database nuovo, e la rottura resta —
a volte peggiora, perché il codice vecchio non sa niente delle colonne appena
cambiate. In quel caso: prima si rimette a posto il dato (vedi §4), poi si
torna indietro col codice. Se la migrazione ha cancellato o riscritto righe,
fermarsi e chiamare Nicola: un ripristino sbagliato è peggio del guasto.

**Da provare a freddo, una volta**, fuori dall'orario di punta: fai un rollback
su un rilascio innocuo, cronometra, e scrivi qui quanto ci è voluto davvero.
Una procedura mai provata non è una procedura.

- Ultima prova a freddo: _mai fatta_ (da compilare).

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
# Vercel pubblica in ~2 min
```

**Sempre**:
- ✅ `npm run build` localmente prima di push
- ✅ Test manuale sulla pagina toccata
- ❌ Mai `git push --force` su main

---

## 6. Cron job non parte

### `/api/cron/send-emails` o `/api/cron/abandoned-carts` silenzio

**Chi li fa partire**: Vercel. L'elenco e le cadenze stanno in `vercel.json`
→ `crons`; a parole sono descritti in `docs/crons.json`.

**Diagnosi**:
1. Vercel → il progetto **mycity** → scheda **Cron Jobs**: c'è l'ultimo giro di
   ognuno e come è finito. (Da riga di comando: `vercel crons ls`.)
2. Se 401 → `CRON_SECRET` non c'è, o non è identico. Vercel manda da solo
   `Authorization: Bearer <CRON_SECRET>` prendendolo dalla variabile del
   progetto: se la variabile manca, i lavori partono lo stesso e si prendono un
   401 — sembrano andati, non hanno fatto niente. Vercel → Settings →
   Environment Variables.
3. Se 405 → la rotta non accetta il GET. Vercel bussa **solo** in GET: ogni
   rotta sotto `app/api/cron/` deve esportare un `GET`.
4. Se 500 → bug nel codice. Sentry dovrebbe averlo catturato.
5. Se 504 → il lavoro ha sforato il tempo massimo. Il tetto è in `vercel.json`
   → `functions`; alzarlo è l'ultima spiaggia, prima si guarda perché ci mette
   tanto.
6. Se OK ma 0 email inviate → check `email_queue`:
   ```sql
   SELECT count(*), template
   FROM public.email_queue
   WHERE send_at <= now() AND sent_at IS NULL AND cancelled_at IS NULL
   GROUP BY template;
   ```

---

## 6-bis. Coda email indietro (allarme «EMAIL_BACKLOG»)

**Come ti arriva**: una email a `SUPPORT_EMAIL`, oggetto `[MyCity Alert] N
anomalie operative`, con dentro la riga
`[EMAIL_BACKLOG] Coda email: N messaggi non inviati da oltre 30 min.`
Lo stesso avviso compare in `/admin/today`. Torna al massimo una volta l'ora.

### Prima cosa da sapere, se sono le 3 di notte

**Nessuno sta perdendo soldi, e puoi rimandare a domani mattina presto.** In
questa coda ci sono solo le email di ciclo di vita: benvenuto, tutorial,
«ordine pronto», «ordine consegnato», promozioni e riaggancio. Le **conferme
d'ordine e gli avvisi al negozio NON passano di qui**: partono dritte nel
momento del pagamento, da un'altra strada. Una coda indietro ritarda un «il tuo
ordine è pronto», non un incasso e non un ordine.

Non è però una cosa da lasciare lì: `order_ready` che arriva il giorno dopo è
peggio che non arrivare, perché il cliente è già passato in negozio o si è già
arrabbiato.

### I numeri, per sapere quanto sei indietro

Il giro `/api/cron/send-emails` prende **15 messaggi ogni 10 minuti: 90
all'ora**. L'allarme suona a **50 messaggi fermi da più di 30 minuti**, ed è
tarato apposta su quella velocità: 50 messaggi sono **4 giri**, cioè **altri 30
minuti** per tornare in pari — sempre che nel frattempo non ne arrivino altri.
Quando l'allarme suona, insomma, la coda è profonda quanto l'attesa che l'ha
resa visibile.

Il conto a mente, per qualunque numero:

> **minuti per tornare in pari ≈ (quanti in coda ÷ 15, arrotondato per eccesso, − 1) × 10**

150 in coda = un'ora e mezza. 600 in coda = 6 ore e mezza — quella non si
aspetta, si svuota a mano (punto 3).

I tre numeri (15 per giro, un giro ogni 10 minuti, allarme a 50) sono legati fra
loro e non si toccano da soli: chi ne cambia uno senza gli altri trova rosso
`npx vitest run tests/unit/l-allarme-della-coda-email-segue-quanto-in-fretta-la-svuotiamo.test.ts`.

### 1. Guarda quanto è lunga (30 secondi)

Supabase → SQL editor:

```sql
-- Quanto è lunga adesso e da quando aspetta la più vecchia
SELECT count(*)                                                         AS in_coda,
       count(*) FILTER (WHERE send_at <= now() - interval '30 minutes')  AS in_ritardo,
       count(*) FILTER (WHERE attempts > 0)                              AS gia_fallite,
       min(send_at)                                                      AS la_piu_vecchia
FROM public.email_queue
WHERE sent_at IS NULL AND cancelled_at IS NULL AND send_at <= now();
```

```sql
-- Quante ne sono uscite davvero nell'ultima ora. Il massimo possibile è 90:
-- se sei vicino a 90 la macchina sta andando a tutta e il problema è il volume.
SELECT count(*) FROM public.email_queue WHERE sent_at > now() - interval '1 hour';
```

```sql
-- Chi sta aspettando, e se sta fallendo (last_error è il motivo vero)
SELECT template, count(*) AS quante, max(attempts) AS tentativi, max(last_error) AS ultimo_errore
FROM public.email_queue
WHERE sent_at IS NULL AND cancelled_at IS NULL AND send_at <= now()
GROUP BY template ORDER BY quante DESC;
```

```sql
-- Il giro sta ancora girando? (last_run_at deve essere di pochi minuti fa)
SELECT name, last_run_at FROM public.cron_heartbeats WHERE name = 'send-emails';
```

Nei log di Vercel, sulla funzione `send-emails`, la riga da cercare è
**`coda email piena`**: la scrive ogni giro che si è portato via tutti e 15 i
messaggi, cioè ogni giro che ne ha lasciati altri indietro.

### 2. Capisci quale dei tre casi è

| Cosa vedi | Cos'è | Dove andare |
|---|---|---|
| `last_run_at` vecchio di più di 20 minuti, 0 spedite nell'ultima ora | il giro **non parte** (segreto, 401, 500, deploy rotto) | §6, poi torna qui e svuota a mano |
| `gia_fallite` alto, `last_error` pieno di messaggi di Resend | il giro parte ma **Resend rifiuta** | resend.com/status e la dashboard Resend; se è un blocco del dominio non serve rilanciare |
| Giri regolari, `coda email piena` a ogni giro, ~90 spedite nell'ultima ora | va tutto bene, **è il volume**: arrivano più di 90 messaggi l'ora | punto 4 |

⚠️ **Prima di rilanciare qualunque cosa, controlla che `RESEND_API_KEY` ci sia
su Vercel.** Senza chiave il giro non spedisce ma **consuma un tentativo su ogni
riga che tocca**, e al quinto la riga viene annullata: quei messaggi sono persi
per sempre. Con la chiave mancante, il giro a mano fa danno invece che bene.

### 3. Svuota a mano una coda arretrata

Ogni chiamata spedisce fino a 15 messaggi e restituisce cosa ha fatto. Il
segreto è `CRON_SECRET` (Vercel → Settings → Environment Variables),
l'indirizzo è quello di `NEXT_PUBLIC_APP_URL`.

```bash
# 20 chiamate = fino a 300 messaggi. Una alla volta, MAI in parallelo.
for i in $(seq 1 20); do
  curl -s -H "Authorization: Bearer $CRON_SECRET" \
    https://<indirizzo-del-sito>/api/cron/send-emails
  echo
  sleep 3
done
```

Come si legge la risposta `{"ok":true,"sent":15,"skipped":0,"errors":0,"total":15}`:

- **sent** — partite davvero.
- **skipped** — scartate di proposito: chi ha detto no alle promozioni, un
  indirizzo che non esiste più, un nome di messaggio che non esiste. Non è un
  guasto, e quelle righe non tornano.
- **errors** — rifiutate da Resend: guarda `last_error` con la terza query.
  Riprovano da sole dopo 5, poi 25, poi 125 minuti; al quinto tentativo si
  fermano.
- **total = 15** — ce n'erano almeno altre: rilancia.
- **total < 15** — sei in pari, puoi fermarti.

Non lanciare più curl insieme: due giri contemporanei non spediscono la stessa
email due volte (le righe si prenotano una per una), ma raddoppiano le chiamate
a Resend, che risponde 429 — e ogni 429 sposta quel messaggio avanti di 5, 25,
125 minuti. Andresti più piano, non più veloce.

### 4. Quando si alza la cadenza

Solo nel terzo caso: i giri sono verdi, ogni giro torna pieno, ~90 uscite
nell'ultima ora e la coda **non cala per due ore di fila**. Vuol dire che 90
all'ora non bastano più: non è un guasto, è cresciuto il traffico.

È un rilascio in produzione → **🔴 lo firma Nicola**, non si fa alle 3 di notte.
Nel frattempo si tiene in pari a mano (punto 3).

I numeri da muovere **insieme**, altrimenti l'allarme diventa inutile:

1. `vercel.json` → `crons` → la cadenza di `/api/cron/send-emails`;
2. `EMAIL_PER_GIRO` in `app/api/cron/send-emails/route.ts`;
3. la soglia dell'allarme in `app/api/cron/operational-alerts/route.ts`.

La prova `tests/unit/l-allarme-della-coda-email-segue-quanto-in-fretta-la-svuotiamo.test.ts`
resta rossa finché i tre non tornano d'accordo: è lì per quello.

**Meglio accorciare la cadenza che ingrassare il giro.** Ogni riga si prenota
per 15 minuti (migrazione 085) e costa quattro viaggi al database più la
chiamata a Resend: un giro che non finisce dentro quei 15 minuti si fa
scavalcare dal giro dopo, e la stessa persona riceve il messaggio due volte.

### 5. Cosa non fare

- **Non cancellare righe** per far tacere l'allarme: dentro ci sono «ordine
  pronto» e «ordine consegnato», cioè messaggi che una persona sta aspettando.
- **Non alzare `EMAIL_PER_GIRO` da solo**, per il motivo qui sopra.
- **Non rilanciare il giro senza `RESEND_API_KEY`**: bruci i tentativi e perdi i
  messaggi.

---

## 7. Stripe webhook non riceve

**Sintomi**: ordini pagati via card non compaiono in DB.

**Diagnosi**:
1. Stripe Dashboard → Developers → Webhooks → verifica endpoint status
2. Se errori → guarda payload + risposta
3. Verifica `STRIPE_WEBHOOK_SECRET` fra le variabili d'ambiente su Vercel
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
| Sito giù | Verifica UptimeRobot, poi Vercel → Deployments → Instant Rollback (§4-bis). Supporto: vercel.com/help |
| Allarme «Coda email: N messaggi non inviati» | §6-bis. Non è un'emergenza: le conferme d'ordine non passano da quella coda |
| Frode evidente | Sospendi user via SQL (vedi #3) |
| Buyer arrabbiato (telefonata) | Apri ticket WhatsApp, prometti risposta entro 24h |

---

## 12. Contatti vendor

| Vendor | Contatto | Urgenza |
|---|---|---|
| Vercel | vercel.com/help | 24/7 |
| Supabase | support@supabase.io | 24/7 email |
| Stripe | dashboard.stripe.com → Help | 24/7 |
| Cloudflare | dashboard.cloudflare.com → Support | 24/7 |
| Resend | resend.com/contact | business hours |
| Anthropic | support@anthropic.com | business hours |
| Netsons (DNS) | netsons.com/area-clienti | business hours |

---

*Aggiorna ogni volta che ti trovi a googleare la procedura per la 2a volta.*
