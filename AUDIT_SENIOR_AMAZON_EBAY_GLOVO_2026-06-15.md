# Audit senior del marketplace MyCity — lente Amazon / eBay / Glovo

**Data:** 2026-06-15 · **Scope:** intero marketplace (read-only) · **Metodo:** 5 audit profondi paralleli per dominio + verifica sul **DB di produzione** (Supabase `Mycity`, advisor security/performance + `pg_policies`). Ogni finding è ancorato a `file:riga`. Epistemico marcato `[Fatto]` / `[Inferenza]` / `[Ipotesi]`.

> Lente: i tre senior che firmano o bloccano il go-live. **Amazon** (i conti riconciliano, idempotenza, ti accorgi quando si rompe), **eBay** (fiducia bilaterale, reputazione, anti-frode), **Glovo** (dispatch, race, contanti COD, unit economics). Prompt sorgente: `PROMPT_SENIOR_AMAZON_EBAY_GLOVO.md`.

---

## 1. Executive summary

**È pronto a gestire soldi e contanti reali a Piacenza? No — ma è più vicino di quanto sembri.** Le **fondamenta sono insolitamente solide** per un prodotto a questo stadio: niente IDOR cross-seller, claim rider e decremento stock **race-safe** a livello DB, payout **idempotenti** (claim atomico + idempotencyKey Stripe), wallet con **ledger append-only** e `CHECK >= 0`, recensioni con **gate-acquisto** reale, resi con refund Stripe + reversal idempotenti, OTP pickup/delivery segregati per RLS con anti-bruteforce. Le migrazioni 058–070 hanno chiuso quasi tutti i buchi classici. Questo **non** è un rebuild: è un "chiudi i fori specifici".

Ma i fori specifici, oggi, **fanno perdere soldi, violano la legge e lasciano abusi aperti**. I 9 che terrebbero sveglio un senior dei tre:

1. 🔴 **Sui contanti (COD) la piattaforma incassa €0 di commissione** e l'ordine resta `PENDING` a vita: non si calcola fee né payout seller, e `release-payouts` esclude i COD. Il cerchio del contante non si chiude (chi versa, a chi, quanto). *[Glovo/Amazon]*
2. 🔴 **La spedizione viene pagata due volte** (entra nel netto del seller *e* viene ri-trasferita al rider): incassata una volta dal buyer, in uscita due. Emorragia per ordine carta. *[Amazon]*
3. 🔴 **Doppia conferma incasso COD** (TOCTOU su `cash_confirmed_at`, nessun guard atomico) → riconciliazione falsabile. *[Glovo]*
4. 🔴 **SSRF** in `rehost-images`: un seller (auto-approvato) fa fetchare al server URL arbitrari (metadata cloud / rete interna). *[Amazon/eBay]*
5. 🔴 **Diritto all'oblio GDPR incompleto**: dopo "cancella account" nome+telefono+indirizzo restano **in chiaro** in `orders` (FK `SET NULL`, non cancellazione). *[Legal]*
6. 🔴 **Fatturazione elettronica SDI assente**: si raccolgono i dati B2B (`sdi_code`/PEC) ma non si emette nulla — obbligo di legge non assolto. *[Legal]*
7. 🔴 **Rate-limit di fatto disattivato in produzione**: in-memory per-istanza, `rateLimitAsync`/Upstash mai usato → brute-force su signin e abuso costo-AI non protetti su Render multi-istanza. *[Amazon/SRE]*
8. 🔴→verifica **`admin_list_user_emails()` eseguibile da qualsiasi utente loggato** (advisor live): se manca il guard `is_admin()` interno è un **dump email di massa**. *[eBay/Security]*
9. 🟠 **Il middleware legge `profiles` con la chiave anon** (non service-role): confermato sul DB live che **nessuna policy** copre il buyer normale → i flussi `withAuth` lato buyer rispondono 403. Bug di authZ latente, non leak. *[Amazon]*

**Sintesi a tre lenti:** *Amazon* boccia per i conti (COD fuori dal perimetro fee, spedizione doppia, denaro in float, idempotenza email/push incompleta) e per la cecità operativa (Sentry client tardivo, `logger.info/warn` scartati in prod, cron su scheduler esterno senza dead-man). *eBay* boccia per integrità reputazione (moderazione recensioni morta + auto-recensione possibile, KYC che non gate nulla, self-referral, dispute senza replica del seller). *Glovo* dà il **miglior voto sul cuore tecnico** (race chiuse) ma boccia sull'operatività dell'ultimo miglio (ordini orfani senza timeout, ordine a negozio chiuso, ETA placeholder, COD non riconciliato col compenso rider).

---

## 2. Scorecard a tre lenti

| Dimensione | Lente | Voto | Motivazione | Finding peggiore |
|---|---|:--:|---|---|
| Correttezza conti (checkout→payout→refund) | Amazon | 🔴 | Fee single-source OK, ma COD interamente fuori perimetro; spedizione doppia; denaro in float | Spedizione pagata due volte |
| Contanti / COD reconciliation | Glovo | 🔴 | Riconciliazione confronta solo rider↔atteso; no settlement; doppia conferma | Commissione COD mai incassata |
| Idempotenza (webhook/cron) | Amazon | 🟠 | Payout idempotente (ottimo); email/push no; webhook retry ri-conta coupon | `send-push` senza claim atomico |
| Race / concorrenza | Glovo | 🟢 | Double-claim e overselling **chiusi** a livello DB | (nessuno — baseline forte) |
| Dispatch / ultimo miglio | Glovo | 🟠 | Ordini orfani senza timeout; negozio chiuso ordinabile; ETA finta | Ordini READY orfani in limbo |
| Protezione bilaterale (buyer/seller) | eBay | 🟠 | Resi reali, ma dispute senza replica seller né freeze payout; refund COD cosmetico | Dispute senza diritto di replica |
| Reputazione / anti-frode | eBay | 🟠 | Gate-acquisto OK, ma moderazione morta, auto-recensione, self-referral | Moderazione recensioni dead-code |
| AuthZ / RLS | Amazon/eBay | 🟠 | Nessun IDOR; RLS solida. Ma middleware legge profilo via anon; RPC esposte | `admin_list_user_emails` ad authenticated |
| Sicurezza applicativa | Amazon | 🟠 | XSS/CSP ottimi; SSRF reale in rehost-images | SSRF rehost-images |
| Compliance legale (IT/EU) | Legal | 🔴 | GDPR oblio incompleto; SDI assente; consenso bypassato in 1 punto | Oblio non cancella PII ordini |
| Affidabilità / operatività | Amazon/SRE | 🟠 | Cron esterni senza dead-man; rate-limit inefficace; health parziale | Rate-limit in-memory multi-istanza |
| Performance / scala | Glovo | 🟡 | Indici sani (advisor live), ma liste senza paginazione + refetch 30s | `admin/orders` carica tutta la tabella |

---

## 3. Finding per severità

### 🔴 Critici — bloccano il go-live

#### 🔴-1 [Glovo/Amazon · COD] Commissione piattaforma mai incassata sugli ordini COD + ordine resta `PENDING` per sempre
- **Dove:** `app/api/orders/cod/route.ts:259` (insert senza fee/payout) · `migrations/061_*.sql:264` (`verify_delivery_code` non tocca `payment_status`) · `lib/stripe/client.ts:242` (`computeApplicationFeeCents` chiamata **solo** nel webhook carta, `webhook:238`).
- **Cosa fa oggi:** l'ordine COD nasce `payment_status='PENDING'` senza `application_fee_cents`/`seller_payout_cents`; alla consegna si setta solo `delivery_status='DELIVERED'`; `release-payouts` esclude i COD (`payment_method='card'`).
- **Perché blocca:** su **ogni** ordine in contanti la piattaforma incassa €0 di commissione, il seller non ha payout tracciato e l'ordine risulta a vita non pagato. Manca il triangolo *rider versa → piattaforma trattiene 8% → paga il seller netto*. Glovo non manda in prod un COD che non chiude il cerchio del contante.
- **Epistemico:** `[Fatto]` da codice (nessun endpoint popola fee/`PAID` per COD). Verifica live sul volume ordini **bloccata** dal classifier di sicurezza (vedi §8) — eseguibile con tua approvazione.
- **Fix:** alla consegna COD calcolare fee+payout e portare `payment_status='PAID'`; introdurre un **ledger di settlement** (debito rider→piattaforma→netto seller) agganciato a `cod_reconciliations`. **Sforzo:** L.

#### 🔴-2 [Amazon · escrow] La spedizione è pagata due volte
- **Dove:** `app/api/stripe/checkout/route.ts:289` (`totalCents = subtotal + shipping − coupon − pickup`) · `app/api/stripe/webhook/route.ts:239` (`seller_payout_cents = totalCents − fee` → spedizione **dentro** il netto seller) · `lib/stripe/payout.ts:161` (rider riceve `round(shipping_cost*100)`).
- **Cosa fa oggi:** la stessa quota di spedizione esce dalla charge due volte: una nel payout seller, una nel transfer rider. Incassata una sola volta dal buyer.
- **Perché blocca:** perdita strutturale di ~`shipping − fee%` su ogni ordine carta con rider. Su volumi, emorragia costante. "Ogni centesimo riconcilia" — qui un centesimo genera due uscite.
- **Epistemico:** `[Inferenza forte]` dal flusso dati. **Verifica:** ordine carta 1-seller+1-rider → `Σ(transfer seller + transfer rider)` vs `charge`.
- **Fix:** `seller_payout_cents = (subtotal − coupon − pickup) − fee`; la quota `shipping` resta sul saldo piattaforma e finanzia il rider. Comporre il payout in **un solo punto**. **Sforzo:** M.

#### 🔴-3 [Glovo · COD] Doppia conferma incasso (TOCTOU su `cash_confirmed_at`)
- **Dove:** `app/api/rider/cash-confirm/route.ts:63` (read guard) e `:84` (update senza filtro di stato).
- **Cosa fa oggi:** legge `cash_confirmed_at`; se null aggiorna con service-role **senza** `.is('cash_confirmed_at', null)` nel `WHERE`. Due richieste concorrenti passano entrambe il guard.
- **Perché blocca:** il rider (o doppio tap) conferma due volte lo stesso incasso → `upsertReconciliation` ricalcola `collected` mascherando un ammanco o gonfiando l'incassato. Si controlla la parte debole (il rider) con read-then-write, non con guard atomico.
- **Epistemico:** `[Fatto]` (nessun guard atomico/unique nel repo).
- **Fix:** update atomico `.is('cash_confirmed_at', null)` + check righe aggiornate (0 ⇒ 409), o RPC `FOR UPDATE`; partial unique su `(id) WHERE cash_confirmed_at IS NOT NULL`. **Sforzo:** S · **Quick win.**

#### 🔴-4 [Amazon/eBay · Security] SSRF in `rehost-images`: validato lo schema URL, non l'IP
- **Dove:** `lib/products/rehostImages.ts:42` (`isHttpUrl` controlla solo `http(s):`) e `:76` (`fetch(url)`); endpoint `app/api/products/rehost-images/route.ts:31`.
- **Cosa fa oggi:** un seller approvato invia fino a 10 URL che il server fetcha. Nessun blocco di host privati/loopback/link-local.
- **Perché blocca:** `image_urls:["http://169.254.169.254/latest/meta-data/…"]` o `http://localhost:<porta-interna>` → port-scan rete interna (distinguendo i `reason`), hit ai metadata endpoint cloud, SSRF blind. Il commento "blocca indirizzi interni via schema" è **falso**.
- **Epistemico:** `[Fatto]` (port-scan/SSRF blind); `[Ipotesi]` l'exfiltrazione completa credenziali (dipende dal cloud).
- **Fix:** risolvere il DNS e rifiutare IP privati/loopback/link-local/ULA prima del `fetch`; `redirect:'manual'` + re-check ad ogni hop; idealmente proxy egress allow-list. **Sforzo:** M · **Quick win** (stop-gap: bloccare `localhost`/IP letterali + `redirect:'manual'`).

#### 🔴-5 [Legal · GDPR Art.17] L'oblio non cancella la PII: nome+telefono+indirizzo restano negli ordini
- **Dove:** `app/api/cron/process-deletions/route.ts:85` (solo `UPDATE profiles` + `deleteUser(auth)`) · FK `ON DELETE SET NULL` in `migrations/001:29,49` e `011:69`.
- **Cosa fa oggi:** cancellando `auth.users` la riga `orders` resta con `delivery_full_name/phone/address` **in chiaro**, solo de-linkata. Nessun passaggio su `reviews.comment`, `messages.body`, `activity_events`, IP in `audit_logs`.
- **Perché blocca:** dopo "cancella account" la PII identificante resta interrogabile a tempo indefinito. Diritto all'oblio materialmente non soddisfatto.
- **Epistemico:** `[Fatto]`.
- **Fix:** job che anonimizza/cancella PII in `orders`, `reviews`, `messages`, `activity_events` e ripulisce IP in `audit_logs`. **Sforzo:** M · **Quick win parziale** (anonimizzare i `delivery_*` nel cron).

#### 🔴-6 [Legal · SDI] Fatturazione elettronica del tutto assente
- **Dove:** `app/api/invoices/generate/route.ts` **non esiste** (citato solo nei commenti di `migrations/041`, drift documentale); colonne `invoice_number/pdf_url/sdi_status` (`024:35`) mai popolate; dati B2B raccolti in `webhook:299`.
- **Cosa fa oggi:** si registra "chi vuole la fattura e dove mandarla" (PEC/SDI) ma non si genera né PDF né XML FatturaPA, e non si trasmette nulla a SDI. `grep FatturaPA` → 0.
- **Perché blocca:** la fattura elettronica B2B via SDI è obbligo di legge in Italia.
- **Epistemico:** `[Fatto]`.
- **Fix:** integrare provider SDI (Fatture in Cloud/Aruba) + XML; oppure rimuovere l'opzione "fattura" finché non c'è. La numerazione atomica gap-free esiste già (`024:159`, `next_invoice_number`) ma non è mai chiamata. **Sforzo:** Alto.

#### 🔴-7 [Amazon/SRE · anti-abuso] Rate-limit inefficace in produzione
- **Dove:** `lib/rate-limit.ts:22` (`const buckets = new Map()`); 16 callsite critici (`auth/signup:15`, `auth/signin:14`, `contact:32`, `ai/*`); `rateLimitAsync` (Upstash) ha **0 callsite**; `UPSTASH_*` assente in `render.yaml`.
- **Cosa fa oggi:** tutti gli endpoint sensibili usano il limiter sincrono in-memory per-istanza, azzerato a ogni deploy/cold-start e non condiviso tra istanze. `getClientIp` si fida del primo `x-forwarded-for` (spoofabile).
- **Perché blocca:** brute-force su signin (10/5min → 10·N istanze) e abuso del costo-AI (Anthropic reale) non protetti. Il finding col peggior rapporto rischio/sforzo.
- **Epistemico:** `[Fatto]` (callsite + assenza Upstash verificati).
- **Fix:** convertire i critical-path a `await rateLimitAsync()` + provisioning Upstash (free tier) in `render.yaml`. **Sforzo:** M · **Quick win** (Upstash + i 4 endpoint auth/AI).

#### 🔴-8 [eBay/Security · live] `admin_list_user_emails()` eseguibile da ogni utente `authenticated`
- **Dove:** advisor security live (`authenticated_security_definer_function_executable`) via `/rest/v1/rpc/admin_list_user_emails`; def. in `migrations/074_admin_user_emails.sql`.
- **Cosa fa oggi:** funzione `SECURITY DEFINER` che espone email utenti, con `EXECUTE` concesso al ruolo `authenticated`.
- **Perché blocca (da verificare):** se la funzione **non** fa `is_admin()` al suo interno, qualsiasi utente loggato può enumerare/dumpare le email di tutti → breach PII + materiale per ATO/phishing. Se il guard interno c'è, resta comunque `EXECUTE` da revocare (difesa in profondità).
- **Epistemico:** `[Fatto]` l'esposizione ad `authenticated` (advisor live); `[Ipotesi]` la presenza/assenza del guard interno — **da leggere nel corpo della funzione**.
- **Fix:** `REVOKE EXECUTE ON FUNCTION admin_list_user_emails FROM authenticated, anon;` e, se serve, gestirla solo via service-role nell'API admin. **Sforzo:** S · **Quick win.**

> **Nota meta (live):** gli advisor mostrano che le migrazioni "execute lockdown" (059/064/067) **non hanno preso del tutto**: restano esposte ad `anon` `reward_referrer_on_delivery`, `notify_buyer_on_order_status`, `track_sponsored_*`, `track_story_view`, `get_referral_leaderboard`, `is_admin`; e ad `authenticated` molte RPC mutanti. Le RPC con guard interno (`verify_*_code`, `cancel_order`, `redeem_gift_card`, `convert_loyalty_to_credit`) sono accettabili; le **trigger-function esposte ad anon** (`reward_referrer_on_delivery`, `notify_buyer_on_order_status`) vanno revocate (vedi 🟠-13).

---

### 🟠 Alti — da chiudere prima del lancio

#### 🟠-9 [Amazon · AuthZ] Il middleware legge `profiles` con la chiave **anon**, non service-role
- **Dove:** `lib/api/middleware.ts:66` (commento "via admin") + `:30` (client con `NEXT_PUBLIC_SUPABASE_ANON_KEY`, nessun JWT propagato).
- **Verifica live (`pg_policies` su `profiles`):** le SELECT sono `auth.uid()=id`, `is_admin()`, seller approvato con `store_name`, `public_profile_enabled=true`, rider su ordini assegnati. **Nessuna** copre un buyer normale letto da un client senza JWT (`auth.uid()` = NULL).
- **Cosa significa:** i `withAuth`/`withAuthRateLimit` lato **buyer** (`account/delete|export`, `chat/*`, `returns/create`, `orders/cod`, `stripe/checkout`, `gift-cards/checkout`, `support`) ricevono `forbidden('Profilo non trovato')`. Gli approvati-seller funzionano per caso (policy "anyone can view approved seller"). **Il dato live disambigua le due ipotesi del code-audit: è il ramo bug-funzionale, non il leak PII** (la policy permissiva temuta non esiste).
- **Epistemico:** `[Fatto]` l'uso della chiave anon + l'assenza di policy permissiva (pg_policies live). `[Inferenza]` il blast-radius esatto (quali route buyer sono colpite in prod vs. servite da Server Actions) — **verifica:** chiamare `/api/orders/cod` con un bearer di buyer reale.
- **Fix:** usare `getAdminSupabase()` (service-role) per il **solo** fetch profilo dentro `authenticate()` (lo user è già autenticato sopra), oppure propagare il JWT del bearer al client. **Sforzo:** S · **Quick win.**

#### 🟠-10 [Amazon/eBay · anti-frode] Coupon: nessun cap per-utente + cap globale con race (TOCTOU)
- **Dove:** `lib/coupons.ts:57` (check `uses_count >= max_uses` in lettura) · incremento `increment_coupon_usage` (`migrations/058:24`, `UPDATE … +1` **senza** `WHERE uses_count < max_uses`) eseguito **dopo** la creazione ordini (`checkout:326`, `cod:371`) · nessuna tabella `coupon_redemptions` per-utente.
- **Cosa fa oggi:** validazione e incremento non atomici, su transazioni diverse (per Stripe l'incremento è addirittura al webhook). Un coupon senza `max_uses` e non-`first_order_only` è riusabile illimitatamente dallo stesso utente; `first_order_only` è read-then-write in JS; `max_uses=1` superabile con N checkout concorrenti.
- **Epistemico:** `[Fatto]` (assenza guard condizionale + assenza tabella per-utente).
- **Fix:** RPC atomica `redeem_coupon` (`UPDATE … +1 WHERE uses_count<max_uses RETURNING`) + `coupon_redemptions(coupon_id,user_id)` UNIQUE nella stessa transazione; per Stripe prenotare al checkout e stornare se scade. **Sforzo:** M.

#### 🟠-11 [eBay · reputazione] Moderazione recensioni "dead code" + nessun blocco auto-recensione
- **Dove:** `lib/ai/moderation.ts` (zero chiamanti; il file dice "Da cablare in PR successive") · gate `migrations/061:368` richiede solo un ordine `DELIVERED` del prodotto, **senza** `buyer ≠ seller` · checkout non blocca `seller_id == user_id` (`stripe/checkout:160`).
- **Cosa fa oggi:** un seller può comprare il proprio prodotto (anche COD, auto-assegnandosi come rider con OTP suo), portarlo a DELIVERED e lasciare una 5★ `verified_purchase=true` (+20 punti). Nessun filtro AI su recensioni/descrizioni/chat.
- **Perché:** star-inflation legittimata dal badge "acquisto verificato"; possibilità di affossare un concorrente; contenuti non moderati.
- **Epistemico:** `[Fatto]` (dead code + assenza clausola anti-self); `[Inferenza]` l'exploit completo.
- **Fix:** clausola `reviews.user_id <> products.seller_id`; cablare `assertSafeText` su recensioni/descrizioni/chat/reply. **Sforzo:** Basso · **Quick win** (la clausola anti-self).

#### 🟠-12 [eBay · KYC] Rider e seller auto-approvati; il KYC non gate operatività né payout
- **Dove:** `handle_new_user` `migrations/015:151` (`is_approved=true` per seller/rider al signup) · policy claim rider `migrations/011:131` (nessun check ruolo/approvazione/KYC) · `admin/users/[id]/moderate:30` approva senza verificare `kyc_provider_status='APPROVED'` · nessun `app/api/kyc/webhook` · default `KYC_PROVIDER='mock'` (`lib/env.ts:49`).
- **Cosa fa oggi:** chi si dichiara rider è operativo all'istante: prende ordini, ritira merce, incassa contanti, accede a indirizzo/telefono del cliente — senza identità verificata. Il payout controlla solo Stripe `payouts_enabled`, non il KYC interno (che resta `PENDING` per sempre nel flusso Onfido).
- **Perché:** sicurezza fisica (rider non identificato a casa del cliente) + rischio riciclaggio COD + seller approvabile senza KYC.
- **Epistemico:** `[Fatto]`.
- **Fix:** gate operatività rider/seller su KYC `APPROVED`; implementare webhook KYC; provider fail-closed anche fuori produzione. **Sforzo:** Medio.

#### 🟠-13 [eBay/Security · live] Self-referral senza vincolo DB + trigger-function esposte ad anon
- **Dove:** RLS `migrations/015:134` (`WITH CHECK referred_id=auth.uid()`, **manca** `referrer_id <> referred_id`; anti-self solo client in `sign-up/page.tsx:76`) · reward `migrations/089:33` (`wallet_credit` al primo DELIVERED) · advisor live: `reward_referrer_on_delivery` e `notify_buyer_on_order_status` (`SECURITY DEFINER`) eseguibili da `anon` via REST.
- **Cosa fa oggi:** con due account (auto-seller+auto-rider) un attaccante porta a DELIVERED un COD verso sé stesso e incassa €5 ripetibili (Sybil, nessun check device/IP, nessun rate-limit). L'esposizione anon delle trigger-function amplia la superficie.
- **Epistemico:** `[Fatto]` (gap DB + esposizione advisor); `[Inferenza]` l'exploit end-to-end.
- **Fix:** `CHECK (referrer_id <> referred_id)` + correlazione email/IP/device server-side + rate-limit; `REVOKE EXECUTE … FROM anon` sulle trigger-function. **Sforzo:** Basso (il CHECK + revoke) · **Quick win.**

#### 🟠-14 [Glovo · inventory] L'annullo **admin** non ripristina lo stock
- **Dove:** `app/api/admin/orders/[id]/cancel/route.ts:64` (setta CANCELED senza `restore_stock_for_order`); confronto: `cancel_order` (`062:101`) e `seller_reject_order` (`062:128`) lo ripristinano.
- **Perché:** cliente compra l'ultimo pezzo → admin annulla per frode → `stock=0` permanente: il prodotto risulta esaurito pur essendo disponibile. Su artigiani a stock basso, perdita di vendite silenziosa.
- **Epistemico:** `[Fatto]` (ramo COD); `[Inferenza]` ramo carta (`refundOrder` non ispezionato a fondo, non emerso nei grep di restore).
- **Fix:** dopo il CANCELED, `restore_stock_for_order` idempotente. **Sforzo:** S · **Quick win.**

#### 🟠-15 [Glovo · inventory] `expire-checkouts` perde il `variant_id` nel restore → overselling latente
- **Dove:** `app/api/cron/expire-checkouts/route.ts:44` (`{product_id, qty}` senza `variant_id`) vs `webhook:729` (lo include).
- **Perché:** per prodotti con varianti (`080`), `reserve_stock` ha decrementato la variante, ma il restore senza `variant_id` incrementa `products.stock`, poi il trigger di rollup riallinea `products.stock = Σ varianti` → l'incremento si perde e la variante resta sotto-contata. Overselling su taglia/colore dopo ogni checkout Stripe scaduto **via cron** (il webhook è corretto: due percorsi divergenti per lo stesso evento).
- **Epistemico:** `[Fatto]` (asimmetria di codice).
- **Fix:** aggiungere `variant_id: it.variantId ?? null` nel cron; meglio centralizzare il restore in una funzione condivisa. **Sforzo:** XS · **Quick win.**

#### 🟠-16 [Glovo · live-ops] Ordini orfani: un `READY` che nessun rider prende resta in limbo
- **Dove:** dashboard rider `app/rider/page.tsx:94`; nessun cron di escalation dispatch; `rider_release_order` (`066:16`) rimette in READY ma non risolve l'orfano iniziale.
- **Perché:** il buyer ha pagato (carta) o atteso (COD) e vede "Pronto per il pickup" senza ETA né "nessun rider disponibile". Nessun timeout, re-broadcast, auto-cancel/refund o alert admin specifico. È il fallimento operativo classico del delivery.
- **Epistemico:** `[Inferenza forte]` (assenza confermata da grep su cron/RPC).
- **Fix:** cron "stale READY" → dopo N min alza alert admin + UI "ricerca rider/nessun rider"; oltre soglia auto-cancel+refund o offerta pickup. **Sforzo:** M.

#### 🟠-17 [Glovo · store-hours] Si può ordinare a un negozio chiuso
- **Dove:** `app/api/orders/cod/route.ts` e `app/api/stripe/checkout/route.ts` (0 occorrenze di `store_hours`/`isOpenNow`); `lib/store-hours.ts:19` esiste ma è solo UI; colonna `profiles.store_hours` esiste (`010`).
- **Perché:** ordine COD alle 3:00 a panetteria chiusa → nasce `NEW`, scoperto il mattino dopo, da rifiutare; su carta il cliente è pure addebitato. ETA "30-60 min" impossibile.
- **Epistemico:** `[Fatto]`.
- **Fix:** in entrambe le route caricare `store_hours` del seller e rifiutare con 409 se chiuso (con override "ordina per dopo" esplicito). **Sforzo:** S · **Quick win.**

#### 🟠-18 [Amazon · refund] Reso COD approvato senza rimborso reale né dovuto tracciato
- **Dove:** `app/api/returns/[id]/decide/route.ts:86` (ramo COD: resta `APPROVED`, nessun movimento) e `:55` (refund solo se `refundAmountCents` presente).
- **Perché:** il buyer COD ha pagato in contanti; un reso "approvato" non gli restituisce nulla e non crea un debito tracciato. Un reso approvato deve generare un movimento o un payable esplicito, mai un flag cosmetico.
- **Epistemico:** `[Fatto]`.
- **Fix:** accreditare wallet (`wallet_credit`) o registrare un payable verso il buyer; decurtare il settlement seller. **Sforzo:** M.

#### 🟠-19 [Amazon · denaro in float] Importi salvati in euro-float e ri-moltiplicati `*100`
- **Dove:** `orders.total_price/shipping_cost/discount_amount` scritti come `cents/100` (`webhook:246`, `cod:264`) e riletti come cents con `round(x*100)` in `payout.ts:161,310`, `cash-confirm:69`, `webhook:563`.
- **Perché:** il round-trip cents→euro-float→cents è soggetto a errori (es. `0.29` non esatto in float64); su rimborsi pro-rata e riconciliazioni a tolleranza €0,50 un drift di 1c può spostare OK↔MISMATCH. Il denaro va tenuto in interi end-to-end.
- **Epistemico:** `[Fatto]` (colonne float fonte dei calcoli); `[Ipotesi]` l'impatto numerico (da misurare con centesimi dispari + sconti pro-rata).
- **Fix:** persistere `total_cents/shipping_cents/discount_cents` interi come unica fonte; i float euro solo display. **Sforzo:** L.

#### 🟠-20 [Glovo · COD] Compenso rider non pagato sugli ordini COD
- **Dove:** `lib/stripe/payout.ts:157` (`releaseRiderPayout` esce per COD); `cash-confirm` non accredita nulla al rider; `cod_reconciliations.expected = Σ total_price` (`cash-confirm:135`).
- **Perché:** o il rider trattiene impropriamente parte del contante (ammanco rispetto all'atteso = MISMATCH), o versa tutto e non viene mai pagato. Il compenso COD dev'essere esplicito e in netting col dovuto.
- **Epistemico:** `[Fatto]`.
- **Fix:** nel settlement COD `payable_rider = shipping_cost`, compensato contro il versamento dovuto, a ledger. **Sforzo:** M.

#### 🟠-21 [Amazon/SRE] Email/push non idempotenti su run sovrapposti
- **Dove:** `app/api/cron/send-emails/route.ts:78` (fallback **senza** claim quando l'RPC `claim_pending_emails` fallisce) e `:143` (reset `claimed_at=null` su errore) · `app/api/cron/send-push/route.ts:33` (nessun claim atomico: SELECT `pushed_at IS NULL` poi invia, marca dopo).
- **Perché:** schedulati ogni 10/5 min da scheduler esterno; se un run supera la finestra, due run concorrenti selezionano le stesse righe → welcome/promo/push duplicati (danno reputazione mittente + spam). La migr. 085 copre solo il caso felice; `send-push` non ha nemmeno quello.
- **Epistemico:** `[Fatto]` (fallback/assenza claim); `[Inferenza]` la sovrapposizione (dipende dalla cadenza reale).
- **Fix:** eliminare il fallback non-atomico (RPC fallita ⇒ 503 e ritenta dopo); RPC `claim_pending_push` con `FOR UPDATE SKIP LOCKED` marca-prima-invia-dopo; su errore lasciare `claimed_at` e ritentare dopo TTL. **Sforzo:** S · **Quick win.**

#### 🟠-22 [Glovo · perf] Liste core senza paginazione + refetch 30s
- **Dove:** `app/admin/orders/page.tsx:45` e `app/seller/orders/page.tsx:45` (`.select(...).order(...)` senza `.range()`/`.limit()`, filtro stato **client-side**, `refetchInterval:30_000`).
- **Perché:** a 50k ordini ogni tab aperta scarica l'intera tabella + 2 join **ogni 30s** → payload multi-MB, main-thread bloccato, carico DB costante. Cresce linearmente senza tetto.
- **Epistemico:** `[Fatto]`.
- **Fix:** paginazione keyset server-side + filtro stato nella query (`.eq('delivery_status', …)`); alzare il refetch o Realtime mirato. **Sforzo:** M · **Quick win parziale** (`.limit(100)` come tampone).

#### 🟠-23 [eBay · protezione] Dispute (INR) senza diritto di replica del seller né freeze del payout
- **Dove:** tabella `disputes` (`027:329`) priva di `seller_response`/`evidence_urls`; apertura client-side (`app/orders/[id]/dispute/page.tsx:64`) non setta `orders.dispute_status` né congela il payout; risoluzione solo admin.
- **Perché:** con `HOLD_HOURS=1` il payout può partire mentre il reclamo è aperto; il seller onesto non ha difesa strutturata in-piattaforma; claw-back più difficile. Nessun rate-limit sull'apertura.
- **Epistemico:** `[Fatto]`.
- **Fix:** finestra di replica seller + evidence; `dispute_status='under_review'` all'apertura per trattenere il payout. **Sforzo:** M.

#### 🟠-24 [Legal · consenso] `ProductViewTracker` scrive tracking senza consenso
- **Dove:** `components/ProductViewTracker.tsx:35` (`insert product_views` + `upsert recently_viewed` **senza** `hasConsent('analytics')`); contrasta con `ActivityTracker.tsx:56` che lo controlla.
- **Perché:** profilazione comportamentale legata a `user_id` prima/senza consenso, ignorando `rejectAll()` → violazione ePrivacy/GDPR (PostHog/GA4/beacon sono invece correttamente opt-in).
- **Epistemico:** `[Fatto]`.
- **Fix:** anteporre `if (!hasConsent('analytics')) return;`. **Sforzo:** Basso · **Quick win.**

#### 🟠-25 [Amazon/SRE] Cron 100% su scheduler esterno non versionato, senza dead-man's-switch
- **Dove:** `render.yaml:65` (blocco cron commentato "gestiti ESTERNAMENTE"); nessun `type: cron`.
- **Perché:** se l'account cron-job.org scade/viene rate-limitato, i payout si fermano (soldi in HELD), le cancellazioni GDPR non avvengono, e — ironia — `operational-alerts` (l'allarme) è esso stesso un cron esterno: muore lo scheduler, muore l'allarme. `autoDeploy:true` senza rollback su health-fail.
- **Epistemico:** `[Fatto]`.
- **Fix:** cron su `type: cron` Render (IaC) o dead-man's-switch (Healthchecks.io); almeno `release-payouts` e `process-deletions` non su cron gratuito. **Sforzo:** M · **Quick win parziale** (Healthchecks su release-payouts).

#### 🟠-26 [Amazon/SRE] Sentry client inizializzato troppo tardi → errori pre-hydration persi
- **Dove:** mancano `sentry.client.config.ts`/`instrumentation-client.ts`; init in `lib/analytics/sentry.tsx:80` dentro `useEffect`.
- **Perché:** Next 15 si aspetta l'init client early; con init on-mount, crash di caricamento/hydration (incluso checkout pre-mount) non arrivano a Sentry. Il marketplace è cieco proprio nella finestra più fragile. (PII scrubbing è invece corretto.)
- **Epistemico:** `[Inferenza forte]` (comportamento `@sentry/nextjs` Next 15 + file mancante).
- **Fix:** `instrumentation-client.ts` con `Sentry.init` + `beforeSend` scrubbing. **Sforzo:** S · **Quick win.**

---

### 🟡 Medi — da pianificare

| # | Lente · Area | Finding | Dove | Fix | Sforzo |
|---|---|---|---|---|:--:|
| 27 | Glovo·dispatch | Bottone "Ho ritirato" (`ASSIGNED→PICKED_UP`) offerto in UI ma **bloccato dal trigger** (passa solo da `verify_pickup_code`) → toast d'errore confuso; rivela design legacy/ufficiale coesistenti | `rider/orders/[id]/page.tsx:230` vs trigger `061:159` | rimuovere la voce PICKED_UP da `actions[]` | XS · QW |
| 28 | Glovo·ETA | ETA "30-60 min" hardcoded, slegata da distanza e rider online | `lib/delivery.ts:11` | derivare da distanza+rider online; degradare a "standard" se 0 rider | M |
| 29 | Glovo·availability | `rider_is_online` non imposto nel claim: un rider offline può claimare via API | trigger `061:156` | aggiungere `AND rider_is_online` nel ramo claim | S · QW |
| 30 | Amazon·idempotenza | Webhook retry dopo fallimento parziale ri-conta coupon + ri-invia email (guard `pending COMPLETED` scritto solo a fine handler) | `webhook:199,331` | spostare `COMPLETED`+increment in transazione con la creazione ordini; email idempotenti | M |
| 31 | Amazon·escrow | `HOLD_HOURS=1` vs reso 14gg ⇒ claw-back sistematico (commenti dicono +24h/+3gg) | `cron/release-payouts:10` | hold più lungo o rolling reserve; riallineare commenti | S |
| 32 | Amazon·riconciliazione | Refund parziali concorrenti: lettura-somma-scrittura di `refunded_amount_cents` non atomica | `payout.ts:336` | RPC `FOR UPDATE` che incrementa e rifiuta oltre il totale | M |
| 33 | Amazon·idempotenza | Gift-card: idempotency-key Stripe annullata da `Date.now()` ⇒ doppio addebito possibile | `gift-cards/checkout:81` | chiave stabile per intento | S · QW |
| 34 | eBay·integrità | Punti loyalty + reward referral non stornati su refund/dispute persa | `webhook:550,683` | claw-back punti + reversal wallet | Basso |
| 35 | eBay·reputazione | Risposta seller alle recensioni non moderata (ma **non** impersona il buyer: timore infondato) | `seller/reviews/[id]/reply:43` | cablare `assertSafeText` sul reply | Basso · QW |
| 36 | eBay·audit | Refund da reso e cambio-ruolo non loggati; IP/UA mai valorizzati in `audit_logs` | `returns/[id]/decide` (no audit), `lib/audit.ts:38` | `writeAudit` su decide-reso e role-change; popolare IP/UA | Basso |
| 37 | Legal·P2B | Etichetta "Sponsored" poco prominente/in inglese; Termini dichiarano parametri di ranking (rating/orari) non usati nel sort reale | `SponsoredCarousel.tsx:85` vs `ProductGrid.tsx:57`, `terms:64` | label "Sponsorizzato" prominente; allineare Termini al ranking reale | Basso · QW |
| 38 | Amazon/SRE | Health check `/api/health` non verifica Stripe/Resend (esiste `lib/health/checks.ts`, alimenta solo `/status`) | `api/health/route.ts:31` | readiness `?deep=1` che riusa `checks.ts` | S · QW |
| 39 | Amazon/SRE | `operational-alerts` query payout fuori dall'indice parziale → seq scan ogni 15 min | `cron/operational-alerts:130`, idx `043:43` | indice parziale su `(delivered_at) WHERE payout_status IN ('PROCESSING','FAILED')` | S · QW |
| 40 | Glovo·perf | `LiveActivityFeed` sottoscrive **tutti** gli INSERT su `orders` per ogni visitatore → fan-out O(visitatori×ordini) | `LiveActivityFeed.tsx:74` | polling 60s (già `staleTime:60s`) o broadcast aggregato | S · QW |
| 41 | Amazon/SRE | `process-deletions` anonimizza poi cancella `auth.users` non atomicamente → utenti zombie su crash | `cron/process-deletions:85` | cancellare auth **prima**, o azzerare `deletion_requested_at` solo dopo delete riuscito | S · QW |
| 42 | Security·live | Leaked-password protection (HaveIBeenPwned) **disattivata** | Supabase Auth settings | abilitare | XS · QW |
| 43 | Perf·live | 3 FK senza indice + 2 `auth_rls_initplan` residui | advisor performance live | indici sulle 3 FK; wrap `auth.uid()` in subselect nelle 2 policy | S |

### 🟢 Minori — backlog / note

- **GDPR export incompleto:** `account/export` non include `messages` (chat) né `activity_events` pur dichiarando "tutti i dati" (`export/route.ts:78`). Quick win. *[Fatto]*
- **`INTERNAL_API_SECRET`:** `withInternalAuth` riusa `SUPABASE_SERVICE_ROLE_KEY` come secret server-to-server (`middleware.ts:202`) → accoppia due segreti. Separare. *[Fatto]*
- **`logger.info/warn` scartati in prod** (`lib/logger.ts:27`): nessun log strutturato dei run cron (quanti payout/email) finché non esplodono. Instradare a sink JSON (Render li cattura). *[Fatto]*
- **`rls_enabled_no_policy` su 8 tabelle server-only** (`email_queue`, `stripe_event_log`, `kpi_snapshots`, `operational_alert_log`, `uptime_checks`, `telegram_chats`, `merchants_leads`, `outreach_events`): RLS on + 0 policy = **deny-all** (sicuro, accessibili solo via service-role). Benigno, ma documentarlo come intenzionale. *[Fatto, advisor live]*
- **`pg_trgm` nello schema `public`** (advisor): spostare in schema dedicato. *[Fatto]*
- **76 "unused index" + 160 "multiple_permissive_policies"** (advisor perf): i primi sono rumore da DB giovane (non rimuovere alla cieca); i secondi un trade-off di design da rivedere solo se la latenza RLS emerge. *[Fatto]*

---

## 4. Flussi critici end-to-end — tiene o si rompe?

- **Buyer paga (carta) → webhook → ordine → payout seller → rider.** *Si rompe sui conti:* la spedizione finisce sia nel netto seller sia nel transfer rider (🔴-2). Idempotenza ordine OK (unique `stripe_session_id,seller_id`), ma il retry post-fallimento ri-conta coupon/email (🟡-30). Payout idempotente e corretto come **meccanismo** (claim atomico + idempotencyKey), ma rilasciato a +1h mentre il reso dura 14gg (🟡-31).
- **COD: rider incassa → conferma → riconciliazione.** *Si rompe in più punti:* nessuna commissione/`PAID` (🔴-1), doppia conferma possibile (🔴-3), compenso rider non gestito (🟠-20), e la riconciliazione confronta solo rider↔atteso senza settlement verso seller/piattaforma. Il cerchio del contante **non si chiude**.
- **Reso → rimborso → reversal payout.** *Tiene su carta* (refund Stripe + `transfers.createReversal` idempotenti, clamp al totale) ma **non su COD** (reso "approvato" senza movimento, 🟠-18) e i refund parziali concorrenti hanno una race (🟡-32). Punti loyalty/referral non stornati (🟡-34).
- **Claim rider sotto concorrenza.** *Tiene:* `UPDATE … WHERE rider_id IS NULL AND status='READY'` atomico, un solo vincitore. Overselling chiuso da `reserve_stock` con guard `stock>=qty`. **Baseline forte** — ma un rider offline può comunque claimare (🟡-29) e l'orfano senza rider non è gestito (🟠-16).
- **Recensione dopo acquisto.** *Tiene la forma* (gate `DELIVERED` + `verified_purchase` + unicità) *ma è aggirabile dal seller* (auto-acquisto, nessun `buyer≠seller`, 🟠-11) e non moderata.
- **Cancellazione account (GDPR).** *Si rompe:* anonimizza il profilo ma lascia PII negli ordini/chat/log (🔴-5), e il processo non è atomico (🟡-41).

---

## 5. Metriche di cui il marketplace è (oggi) cieco

Un senior dei tre non chiede solo "è corretto?", ma "**lo misuri?**". Mancano strumentazione/alert su:
- **COD reconciliation gap** (incassato − versato − dovuto): la tabella `cod_reconciliations` esiste ma non c'è settlement né alert sul gap.
- **Payout accuracy** (Σ payout = Σ vendite − fee − refund): nessun report di quadratura; con la spedizione doppia (🔴-2) non quadrerebbe.
- **Take-rate reale** (fee incassata vs dovuta): sui COD è **strutturalmente 0** (🔴-1).
- **No-rider rate / tempo in READY senza rider:** non misurato (🟠-16); nessuna colonna `ready_at` per il timeout dispatch.
- **Delivery SLA / errore ETA:** ETA è un placeholder (🟡-28), quindi non confrontabile col reale.
- **ODR / tasso INR-SNAD / refund-chargeback rate:** dati grezzi presenti (returns/disputes) ma nessuna aggregazione/alert.
- **Review trust** (recensioni/acquisti, anomalie self-review): nessun segnale.

---

## 6. Cosa è fatto bene (preservare)

Verificato nel codice e/o sul DB live — è ciò che rende il quadro recuperabile:
- **Concorrenza:** double-claim rider e overselling **race-safe** (`UPDATE` atomico + `reserve_stock` con guard, rollback dell'intera riserva).
- **Pagamenti come meccanismo:** payout idempotenti (claim atomico + `idempotencyKey` Stripe; `081` sblocca `PROCESSING`), refund+reversal idempotenti e clampati, **fee single-source** (`MARKETPLACE_FEE_BPS=800`).
- **Wallet:** ledger append-only, RPC `SECURITY DEFINER` con `FOR UPDATE` e `CHECK >= 0` (no double-spend, no scrittura client).
- **AuthZ/RLS:** nessun IDOR cross-seller; ownership verificata in tutte le route `[id]`; service-role mai esposto al client e usato **dopo** i check; XSS sanitizzato (DOMPurify) + CSP nonce `strict-dynamic` senza `unsafe-inline`.
- **Trust di base:** recensioni con gate-acquisto + `verified_purchase` server-side; OTP pickup/delivery segregati per RLS con lockout anti-bruteforce (5/15min); consenso PostHog/GA4/beacon opt-in.
- **DB:** indicizzazione complessivamente sana (advisor live: solo 3 FK scoperte); numerazione fattura atomica gap-free già pronta; migrazioni 058–070 hanno chiuso i buchi classici.

---

## 7. Prioritizzazione & roadmap (per ROI)

**Sprint 0 — quick win ad alto impatto (ore/1-2 gg):**
1. 🔴-3 guard atomico `cash_confirmed_at` · 🔴-8 `REVOKE EXECUTE admin_list_user_emails` (+ verifica guard interno) · 🟠-9 fetch profilo via service-role · 🔴-4 stop-gap SSRF (`redirect:'manual'` + blocco IP letterali privati).
2. 🟠-13 `CHECK referrer_id<>referred_id` + revoke trigger-function anon · 🟠-11 clausola `buyer≠seller` · 🟠-24 gate consenso ProductViewTracker · 🟠-14/15 restore stock (admin cancel + variant_id cron) · 🟠-17 check store-hours · 🟡-42 leaked-password ON.

**Sprint 1 — blocchi strutturali soldi/legge (1-2 settimane):**
3. 🔴-1 settlement COD (fee+`PAID`+ledger) · 🔴-2 ricomposizione payout (spedizione fuori dal netto seller) · 🔴-7 Upstash + `rateLimitAsync` · 🔴-5 oblio GDPR esteso a ordini/chat/log.
4. 🟠-10 redeem_coupon atomico + redemptions per-utente · 🟠-12 KYC che gate operatività + webhook · 🟠-21 idempotenza email/push · 🟠-25 cron IaC/dead-man.

**Sprint 2 — compliance, dispute, ops, perf (2-4 settimane):**
5. 🔴-6 SDI (provider + XML) · 🟠-23 dispute con replica+freeze · 🟠-18/20 refund e compenso rider COD · 🟠-16 timeout dispatch orfani · 🟠-19 denaro in interi end-to-end · 🟠-22 paginazione liste · 🟠-26 Sentry client early.
6. Resto dei 🟡 (ETA reale, health deep, indici alert, refund-race, audit, P2B label) come hardening continuo.

**Rischi strutturali (refactor, non quick-fix):** 🔴-1 (ledger COD end-to-end), 🔴-6 (integrazione SDI), 🟠-19 (modello monetario in interi), 🟠-12 (KYC come gate trasversale). Tutto il resto è chirurgia localizzata.

---

## 8. Domande aperte / assunzioni (da chiudere)

- **Verifica live degli ordini COD** (🔴-1): la query aggregata su `public.orders` è stata **bloccata dal classifier di sicurezza** (escalation su tabella di produzione). Con tua approvazione esplicita eseguo `SELECT payment_method, payment_status, count(*), count(application_fee_cents) …` per confermare quanti COD siano `PENDING`/senza fee sui dati reali.
- **Guard interno di `admin_list_user_emails`** (🔴-8): da leggere il corpo della funzione (`migrations/074`) per stabilire se è 🔴 (nessun `is_admin()`) o 🟠 (guard presente, manca solo il `REVOKE`).
- **Blast-radius del bug middleware** (🟠-9): confermare con un bearer di **buyer reale** quali route `withAuth` rispondono 403 in prod (vs. flussi serviti da Server Actions).
- **Spedizione doppia** (🔴-2): confermare con un ordine carta di test sommando `transfer seller + transfer rider` vs `charge`.
- **Config non nel repo:** comportamento Stripe live (webhook endpoint registrati, Connect capabilities), scheduler cron-job.org realmente attivo, env Render. Non verificabili dal solo codice.

---

*Audit prodotto con la lente di `PROMPT_SENIOR_AMAZON_EBAY_GLOVO.md`. Tutti i `file:riga` sono dei sorgenti correnti del branch. Le severità riflettono impatto×probabilità; dove ho corretto la severità proposta dall'analisi di dominio (es. il bottone PICKED_UP da 🔴 a 🟡) l'ho fatto perché l'impatto attuale è UX/correttezza, non perdita di denaro o breach.*
