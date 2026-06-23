# Prompt — Verifica GO-LIVE del marketplace MyCity (pronto per i primi negozi)

> **A cosa serve.** Dare un verdetto **GO / NO-GO** onesto e basato su PROVE prima di inserire i primi negozi e accettare ordini e pagamenti reali. Le domande a cui DEVE rispondere: la piattaforma funziona end-to-end? la **carta di credito è al sicuro**? **tutti i pagamenti vanno a buon fine** (nessun pagamento perso, nessun ordine fantasma)? il **carrello e gli ordini sono isolati per utente** (nessuno vede il carrello/ordine di un altro, nessun ordine finisce alla persona sbagliata)?
>
> **Come usarlo.** Apri Claude Code nella root del repo `mycity` e incolla tutto il testo sotto la riga. È una **verifica**, non un refactor: l'output è un report `GO_LIVE_<YYYY-MM-DD>.md`. È consentito **leggere codice, scrivere/eseguire test e script di verifica usa-e-getta, ed eseguire i flussi a runtime in ambiente di TEST**; NON modificare la logica di business e NON toccare dati di produzione.
>
> **Principio n.1 — verifica a RUNTIME, non "a lettura".** "Il codice sembra giusto" e "compila" NON bastano per andare live con soldi e dati di persone. Le due paure principali (isolamento dati e correttezza pagamenti) si verificano **eseguendo davvero**: come attaccante contro un altro utente, e con un pagamento reale in Stripe **test mode**. Se non puoi eseguire un controllo a runtime, marcalo **[DA VERIFICARE A RUNTIME]** con il comando esatto — non darlo per buono.

---

Sei un **QA/Security engineer senior** incaricato della **due-diligence di go-live** del marketplace **MyCity** (Next.js 15 + Supabase/Postgres con RLS + Stripe Checkout/Connect + COD). Il fondatore vuole **inserire i primi negozi domani** e ricevere/consegnare ordini e incassare pagamenti **in sicurezza**. Il tuo compito è verificare, con prove, che si può fare — o dire con precisione cosa manca.

Non sei un ottimista: il tuo default è "non si va live finché non l'ho **visto funzionare** e **visto fallire l'attacco**". Pensa come chi firma il "sì, possiamo prendere soldi e dati di clienti reali".

## 0. Contesto (verifica, non assumere)
- Ruoli: **Buyer, Seller, Rider, Admin**. Pagamenti: **Stripe Checkout** (hosted) + **Connect** (payout seller/rider) + **COD** (contanti, conferma rider). Isolamento dati: **RLS Postgres**.
- Tabelle chiave dell'isolamento: `user_carts`, `orders`, `order_items`, `pending_checkouts`, `user_addresses`, `conversations`/`messages`, `returns`, `profiles`, `order_pickup_codes`/`order_delivery_codes`.
- Idempotenza pagamenti: `stripe_event_log`. Webhook: `app/api/stripe/webhook/route.ts`. Checkout: `app/api/stripe/checkout/route.ts` + `app/api/orders/cod/route.ts`.
- **Stato noto (da un audit recente, da CONFERMARE a runtime):** un fix critico ha spostato la lettura del profilo in `authenticate()` (`lib/api/middleware.ts`) da chiave anon a service-role — se non confermato a runtime, i **buyer/rider potrebbero ricevere 403 al checkout**. Inoltre i test RLS/e2e **non girano in CI** di default (mancano i secret di un Supabase di test). Tratta questi due punti come priorità di verifica.

## 1. Ambiente di verifica (Fase 0 — fallo per primo)
Non testare in produzione. Prepara un ambiente **isolato**:
1. **Supabase di TEST** (progetto separato) con **tutte** le migrazioni applicate (`migrations/` in ordine). Verifica che siano applicate davvero (non solo i file).
2. **Stripe in TEST mode** (chiavi `sk_test`/`pk_test`, webhook secret di test). Connect in test.
3. **Seed** di attori distinti per i test di isolamento: **Buyer A**, **Buyer B**, **Seller S1**, **Seller S2** (approvati), **Rider R1**, **Admin**. Almeno 2 prodotti per S1 e S2.
4. Avvia l'app puntata a questo ambiente. Conferma le env critiche (Supabase, Stripe test, `CRON_SECRET`, `STRIPE_WEBHOOK_SECRET`).
5. Se NON puoi creare questo ambiente, **dillo subito** ed elenca esattamente cosa ti serve dal fondatore (chiavi test, URL progetto) — senza, molte verifiche restano [DA VERIFICARE A RUNTIME] e il verdetto non può essere GO pieno.

## 2. Fase 1 — ISOLAMENTO DATI (la paura n.1: "nessuno vede il carrello/ordine di un altro") 🔴
Questa è la verifica più importante. Va fatta in **DUE modi** per ogni risorsa: (a) **direttamente sul DB** con la chiave **anon** e con la sessione di **un altro utente** (test della RLS alla fonte), e (b) **via API/HTTP** con il token di un altro utente (test IDOR/authZ).

Per **ognuna** di queste risorse, prova come **Buyer B** (e come anon) ad accedere ai dati di **Buyer A** — deve essere **NEGATO** (riga vuota / 403):
- **Carrello** (`user_carts`): B non deve leggere né scrivere il carrello di A. Verifica anche il merge cross-device (login) che non mescoli carrelli.
- **Ordini** (`orders`, `order_items`): B non vede gli ordini di A; un **Seller S2 non vede gli ordini di S1**; un **Rider non vede ordini non suoi**. Apri direttamente `/orders/<id-di-A>` come B → deve dare not-found/403, non i dati.
- **Indirizzi** (`user_addresses`), **chat** (`conversations`/`messages`), **resi** (`returns`), **gift card/wallet**, **notifiche**: stessa cosa.
- **Profili** (`profiles`): un anon/buyer non deve poter leggere dati personali (telefono, indirizzo, email, ruolo) di altri; verifica che `authenticate()` funzioni per buyer/rider (il fix 🔴 sopra) E che non esponga PII.
- **Codici pickup/delivery** (`order_pickup_codes`/`order_delivery_codes`): leggibili **solo** dall'attore giusto (il rider assegnato / il seller), mai dal buyer sbagliato o da altri.
- **Scritture incrociate**: B prova a **mutare** un ordine/reso/prodotto di A o S1 (cambiare stato, cancellare, rispondere a recensione) → negato. Cerca IDOR in tutte le route con `[id]` (`app/api/**`).

**Prova attesa:** una tabella "risorsa × attore → consentito/negato" con l'evidenza (query+risultato o richiesta HTTP+status). Anche **un solo** accesso cross-utente riuscito = **NO-GO**.

> Suggerimento: esistono test d'integrazione RLS in `tests/integration/security/**` e `tests/sql/**`. **Falli girare davvero** contro il Supabase di test (con `SUPABASE_SERVICE_ROLE_KEY`), non lasciarli auto-skippare. Aggiungi i casi mancanti (carrello B↔A, ordine seller-vs-seller, codici consegna).

## 3. Fase 2 — SICUREZZA DELLA CARTA (PCI) 🔴
Obiettivo: la carta del cliente **non deve mai toccare il nostro backend**.
- Conferma che il pagamento carta usa **Stripe Checkout hosted** (o Elements/PaymentIntent lato Stripe): il PAN/CVV vengono inseriti **su dominio Stripe**, non sui nostri server. Cerca qualsiasi punto in cui numeri di carta passino dal nostro codice/DB → **non deve esistere** (`grep` di pattern carta, `card_number`, `cvv`, `pan`).
- **Webhook firmato**: `constructEvent` con `STRIPE_WEBHOOK_SECRET`; un payload non firmato/alterato viene **rifiutato** (provalo: POST con firma errata → 400).
- **Secret server-only**: nessuna chiave non-`NEXT_PUBLIC_` finisce nel bundle client (`sk_test`, service-role, webhook secret). Verifica nel bundle/sorgente.
- **Trasporto**: HTTPS forzato, CSP/headers di sicurezza presenti in prod, cookie `Secure`/`HttpOnly` dove serve.
- **Nessun dato carta persistito**: nel DB non si salvano PAN/CVV; al massimo `card_last4`/token Stripe (verifica che sia solo quello).
- Esito atteso: il profilo PCI realistico è **SAQ-A** (campo carta gestito da Stripe). Conferma che sia davvero così.

## 4. Fase 3 — TUTTI I PAGAMENTI VANNO A BUON FINE (nessun pagamento perso, nessun ordine fantasma) 🔴
Esegui in **Stripe test mode** il flusso reale e verifica gli invarianti del denaro:
1. **Pagamento riuscito → ordine creato esattamente una volta.** Buyer A paga con carta test (`4242…`). Conferma: `checkout.session.completed` → ordine(i) creato/i, stock decrementato, carrello svuotato, email/notifica inviate.
2. **Idempotenza.** Re-invia lo stesso evento webhook (replay) → **nessun ordine duplicato**, nessun doppio addebito logico (verifica `stripe_event_log`/dedup). Simula anche evento **fuori ordine** e **doppio**.
3. **Nessun "paid-without-order".** Se l'handler fallisce a metà, l'evento NON viene marcato processato e il retry di Stripe ricrea correttamente (niente pagamento incassato senza ordine). Verifica il comportamento su errore.
4. **Matematica al centesimo.** Totale addebitato = somma item + spedizione − sconti; lo **split** (commissione piattaforma + fee consegna + compenso rider + netto venditore) torna **esatto** (`sellerPayout + fee + deliveryFee + shipping === total`). Confronta ciò che il **venditore vede** (UI earnings) con ciò che **riceverà** davvero. *(Nota: c'è una decisione aperta sulla BASE della commissione — sul subtotale prodotti o sul totale: chiariscila prima di pagare denaro reale ai seller.)*
5. **Multi-seller checkout** (carrello con prodotti di S1 e S2): genera **un ordine per seller**, ciascuno visibile solo al proprio seller, con split corretto.
6. **COD** (`/api/orders/cod`): l'ordine si crea, il prezzo è **ricalcolato server-side** (il client non può falsare gli importi — provalo inviando importi gonfiati: devono essere ignorati), conferma contanti del rider e riconciliazione.
7. **Payout** (cron `release-payouts`, test mode): il payout al seller parte solo dopo consegna; un **chargeback vinto** non blocca per sempre il payout; un **refund/reso** fa il claw-back corretto.
8. **Anti-tampering**: come buyer, prova a pagare meno (manomettendo prezzi/sconti/spedizione lato client) → il server deve **ignorarli e ricalcolare** dal DB.

## 5. Fase 4 — FLUSSO REALE NEGOZIO → ORDINE → CONSEGNA (quello che farai domani)
Esegui end-to-end e verifica che **ogni attore veda solo il proprio**:
1. **Onboarding negozio**: crea Seller, approvazione admin, KYC (verifica che in prod NON sia in `mock` scambiato per reale), pubblica un prodotto, il prodotto è **visibile ai buyer** e **modificabile solo dal suo seller**.
2. **Ordine**: Buyer ordina → Seller (solo S1) lo vede e lo accetta → READY → assegnazione **Rider** → **pickup con codice** → **delivery con codice** → DELIVERED. Verifica che i codici siano verificabili **solo** dall'attore giusto e che lo stato segua la macchina a stati (niente salti illegali).
3. **L'ordine arriva alla persona giusta**: il buyer corretto vede il proprio ordine e tracking; il seller corretto la propria vendita; il rider corretto la propria consegna. **Nessun incrocio.**
4. **Reso/recesso** e **rimborso** funzionano e accreditano la persona giusta.

## 6. Fase 5 — PRONTI PER IL GIORNO DEL LANCIO (operatività)
- **Webhook Stripe** configurato sull'endpoint giusto con il secret di prod; eventi che arrivano davvero (test con un evento reale in test mode).
- **Cron** schedulati (release-payouts, expire-checkouts, send-emails/push, operational-alerts, process-deletions) con `CRON_SECRET`; girano e sono idempotenti.
- **Osservabilità**: Sentry attivo (server+client), alert operativi (ordini bloccati, payout falliti, backlog email) funzionanti; sai se qualcosa si rompe alle 22 di sabato.
- **Rate limit** adeguato (in multi-istanza serve Upstash); **CAPTCHA** su signup/contact attivo in prod.
- **Backup DB** attivi e **piano di rollback** (come torni indietro se un deploy rompe il checkout).
- **Consenso cookie/GDPR** bloccante prima del tracking; export/cancellazione dati funzionanti.

## 7. Regole di verifica (metodo)
- **Evidence-based.** Ogni "OK" ha una prova: comando+output, richiesta HTTP+status, screenshot/log, o test che passa. Niente "dovrebbe funzionare".
- **Pensa da attaccante.** Per l'isolamento, il test valido è *provare e fallire l'accesso*, non leggere la policy.
- **Distingui** [Verificato a runtime] / [Verificato staticamente] / [DA VERIFICARE A RUNTIME: comando]. Il verdetto GO richiede che i punti 🔴 (isolamento, carta, pagamenti) siano **[Verificato a runtime]**.
- **Severità chiara**: 🔴 blocca il lancio · 🟠 da sistemare entro pochi giorni (lancio con cautela/monitoraggio) · 🟡 dopo.
- **Non modificare la logica di business** durante la verifica; se trovi un bug 🔴, **fermati e segnalalo** con repro, poi (se richiesto) correggilo a parte.

## 8. Output — report GO_LIVE_<YYYY-MM-DD>.md
1. **Verdetto in cima: GO / GO-CON-CONDIZIONI / NO-GO**, in una frase, onesto.
2. **Scorecard** per area: Isolamento dati · Sicurezza carta (PCI) · Pagamenti effettuati · Flusso negozio→ordine→consegna · Operatività — ognuna 🟢/🟡/🔴 con la prova chiave.
3. **Bloccanti 🔴** (se presenti): cosa, prova, impatto, fix.
4. **Matrice isolamento** (risorsa × attore → consentito/negato) con evidenza.
5. **Esito flussi a runtime**: pagamento carta, idempotenza, COD, multi-seller, payout, consegna con codici — passati/falliti.
6. **Condizioni per il GO** (se "GO-con-condizioni"): la lista minima da chiudere prima di aprire ai clienti.
7. **Piano giorno-1**: cosa monitorare (Sentry/alert), come accorgersi di un problema, come fare rollback, chi paga cosa.
8. **Cosa NON è stato verificabile** e come chiuderlo.

---

**Inizia dalla Fase 0** (ambiente di test). Poi **Fase 1 (isolamento)** e **Fase 3 (pagamenti)**: sono le due paure principali del fondatore e richiedono prove a runtime. Sii onesto nel verdetto: meglio un "GO-con-condizioni" vero che un "GO" ottimista. Pensa come chi domani ci mette i soldi e i clienti reali.
