# Analisi marketplace MyCity Piacenza

Documento di audit completo dell'attuale piattaforma: cosa esiste, cosa manca, cosa serve per renderla un marketplace serio (livello Amazon / Etsy / Glovo / Just Eat / Vinted).

Stack rilevato: Next.js 14, React 18, TypeScript, Tailwind, Supabase (Postgres + Auth + Storage + Realtime), Leaflet/OSM, Anthropic SDK (Vision), Resend (presente ma non collegato).

---

## 1. Sintesi esecutiva

Il prodotto attuale è un MVP funzionante ma **non è un marketplace serio**. Ha l'ossatura giusta (catalogo, ordini, ruoli, RLS, mappa rider) ma è privo dei pilastri obbligatori per operare:

- **Pagamenti reali**: niente Stripe, niente carta, niente Apple/Google Pay. Solo "contanti alla consegna". Nessuno split payment, nessun escrow, nessun webhook.
- **Fatturazione**: nessuna fattura PDF, nessun XML SDI (obbligatorio per la legge italiana), nessuna conservazione sostitutiva.
- **GDPR**: niente cookie banner, niente consent management, privacy/cookie policy incomplete, niente "diritto all'oblio" reale.
- **KYC seller**: il form raccoglie i dati ma non verifica nulla con Agenzia Entrate, niente OCR documento, niente antimafia, niente AML.
- **KYC rider**: non esiste. Chiunque si registra come rider è subito approvato. Niente patente, niente assicurazione, niente HACCP.
- **Gestione cash on delivery**: il rider deve incassare contanti ma nessuna riconciliazione, nessuna firma digitale, nessuna foto, nessun audit. Rischio frode altissimo.
- **Resi/rimborsi/dispute**: la pagina `/returns` è informativa, ma il flusso reale di richiesta reso, approvazione, etichetta di ritorno, tracking rimborso NON ESISTE.
- **Pagamento al seller / rider**: payout simulato. La data del 5 di ogni mese è hardcoded, l'IBAN è salvato ma non collegato a Stripe Connect.
- **Magazzino**: lo stock è un numero, ma non viene decrementato all'ordine, niente alert sotto soglia, niente SKU, niente lotto/scadenza.
- **Varianti prodotto**: assenti. Non puoi vendere una maglia con taglie/colori.
- **Comunicazione**: niente chat buyer-seller, niente chat buyer-rider, niente numero mascherato, niente Q&A sui prodotti.

Per produzione legale in Italia mancano almeno **8-10 settimane** di lavoro su 2 sviluppatori solo per i blocker (pagamenti, SDI, GDPR, KYC, email transazionale, sicurezza sessioni).

---

## 2. Stato attuale per ruolo

### 2.1 BUYER — cosa può fare oggi

**Autenticazione**
- Sign-up con email/password + scelta ruolo (buyer/seller/rider).
- Reset password via magic link.
- Referral al sign-up con `?ref=` (bonus €5 al primo ordine).
- Nessun social login, nessun 2FA, nessuna verifica email post-signup, nessun OTP, nessun CAPTCHA.

**Navigazione**
- Navbar sticky con search, carrello, notifiche, profilo.
- Barra informativa top con USP (spedizione gratis ≥€30, pagamento alla consegna, ecc.).
- Footer con 5 sezioni e link social (FB/IG/TikTok/X/LinkedIn/YouTube/WhatsApp).

**Ricerca e scoperta**
- Search testuale via `?q=` su nomi prodotto/negozio.
- Filtri: categoria, prezzo max (€5-€500), spedizione gratuita, "aperti ora".
- Pagina `/near` con geolocalizzazione (haversine) per ordinare negozi per distanza.
- Pagina `/stores` con ricerca, sort (rating / assortimento / A-Z), filtro per categoria.
- Nessun ordinamento in `/search`, nessun autocomplete, nessun "trending", nessun filtro per brand/colore/taglia.

**Pagina prodotto**
- Galleria immagini, prezzo, descrizione, attributi categoria, rating medio, stato stock ("Esaurito" / "Solo X disponibili" / "Disponibile").
- Quantità +/- , "Aggiungi al carrello", "Acquista ora", preferiti.
- Banner spedizione gratuita / quanto manca.
- Trust signals + sezione recensioni con form (stelle 1-5 + commento testo).
- Prodotti correlati.
- Schema.org Product + AggregateRating.
- Mancano: varianti taglia/colore, Q&A, foto buyer, video review, "avvisami quando torna disponibile", confronto prodotti.

**Carrello**
- Storage in localStorage (non persiste tra dispositivi).
- Multi-store: prodotti raggruppati per venditore.
- Progress bar "Ti mancano €X per spedizione gratuita".
- Calcolo subtotale + spedizione (€4,90 sotto soglia, gratis sopra €30).
- Mancano: "salva per dopo", note per singolo item, suggerimenti, persistenza DB, gift wrap.

**Checkout (multi-step)**
- Step indirizzo: scelta da indirizzi salvati o nuovo form (con geocoding Nominatim).
- Opzione "ritiro in negozio" (-10%, senza spedizione).
- Coupon (validazione backend, sconto proporzionale ai venditori).
- Pagamento: solo "Contanti alla consegna" radio statico.
- Riepilogo sticky con preview immagini.
- Multi-store: un ordine separato per ogni seller.
- Mancano: carta di credito (Stripe/PayPal/Apple Pay/Google Pay/Klarna/contrassegno wallet), guest checkout, mancia rider, gift message, fattura PDF, validazione indirizzo reale.

**Tracking ordine**
- Lista ordini con badge stato.
- Dettaglio con timeline (NEW → ACCEPTED → READY → PICKED_UP → OUT_FOR_DELIVERY → DELIVERED).
- Mappa live con rider in movimento (subscription Realtime su `orders.rider_lat/lng`).
- Codice consegna 6 cifre + QR (mostrato in PICKED_UP/OUT_FOR_DELIVERY).
- Annullamento ordine se stato NEW (RPC `cancel_order`).
- "Ripeti ordine" (ripopola cart).
- Manca ETA dinamico, push notification quando rider è vicino, chat con rider, foto consegna.

**Account**
- `/profile`: 8 quick link (ordini, preferiti, indirizzi, impostazioni, gruppi, FAQ, assistenza, contatti) + banner referral.
- `/profile/addresses`: CRUD indirizzi con default, label (Casa/Ufficio), note rider.
- `/profile/settings`: tab Account (cambio email/lingua), Password, Notifiche (toggle email + push browser), Privacy (export dati JSON, link DPO), Danger Zone (elimina account con conferma "ELIMINA").
- `/profile/referral`: codice, link condivisibile, statistiche invitati.
- Mancano: foto profilo, dati anagrafici completi, wallet/gift card, cronologia transazioni, SMS, unsubscribe email link.

**Funzioni accessorie**
- Preferiti, notifiche (con auto-mark-read), gruppi di acquisto (lista + countdown), live activity feed in home.
- Pagine informative: FAQ con accordion, Help, Contact, Shipping, Returns, Privacy, Cookies, Terms, About.
- Cookie banner GDPR: **ASSENTE** (criticità legale).

---

### 2.2 SELLER — cosa può fare oggi

**Onboarding/KYC**
- Form lungo in `/sell` con: anagrafica (nome, cognome, CF, data nascita, residenza), azienda (P.IVA, ragione sociale, forma giuridica, sede, PEC, codice SDI), nome negozio, descrizione, logo, gallery (3 immagini + 1 video), location su mappa, IBAN.
- 4 consensi obbligatori (ToS, Privacy, accuratezza dati, addebito €50/mese).
- Stati: pending / approved / rejected / suspended (con motivo).
- Tutto raccolto in `profiles` (migration 021).
- **Manca verifica reale**: niente check P.IVA su Agenzia Entrate, niente OCR documento, niente face match, niente antimafia, niente AML/PEP.

**Vetrina negozio**
- Modifica logo, gallery (riordinabile ↑↓), nome, descrizione, telefono, indirizzo (mappa).
- Nessuna gestione orari apertura via UI (la colonna `store_hours` esiste, ma non c'è form), nessuna gestione ferie/vacanze, nessun ritiro in negozio configurabile.

**Catalogo prodotti**
- CRUD prodotti con: nome, descrizione, prezzo, stock, categoria, immagini (drag&drop), attributi dinamici per categoria.
- AI PhotoFill (Anthropic Vision) per estrarre nome/descrizione/prezzo/categoria da una foto.
- Toggle rapido "In vendita" / "Esaurito".
- Manca: varianti (taglia/colore/sapore/formato), SKU/EAN, gestione scorte vera (no decremento ordine, no min stock, no log movimenti, no lotto/scadenza), bundle, prodotti correlati, ricerca/filtri nel pannello, bulk upload CSV, sincronizzazione POS/ERP.

**Ordini**
- Lista raggruppata in "Da fare" / "In consegna" / "Completati" con auto-refresh 30s.
- Azioni: Accetta / Rifiuta (con motivo, rimborso automatico via RPC `seller_reject_order`) / "Pronto per il rider".
- Dettaglio con cliente, prodotti, totale, info rider, codice ritiro 4 cifre + QR.
- Manca: stampa etichetta spedizione, integrazione corrieri (SDA/BRT/DHL), tracking number ai buyer, gestione ritiro in negozio, slot di consegna.

**Dashboard**
- KPI: fatturato totale, prodotti in vendita, rating, articoli venduti.
- Breakdown 7g/30g (cassa + articoli).
- Suggerimenti personalizzati testuali.
- Nessun grafico vero, nessun funnel, nessun top prodotti, nessun cohort, nessun export CSV.

**Earnings**
- Commissione **hardcoded 8%** (non configurabile, non documentata via fatture).
- Storico mensile con stato "In attesa" / "✓ Pagato" simulato.
- Mini bar chart ultimi 7 giorni.
- Payout simulato il 5 di ogni mese.
- **Nessuna integrazione Stripe Connect**, l'IBAN è salvato ma non porta soldi.
- Nessuna fattura commissione del marketplace al seller, nessun documento contabile esportabile.

**Clienti**
- Lista aggregata da ordini con totale speso, # ordini, ultimo ordine, tag VIP / Attivo / Inattivo 30+gg.
- Filtri (tutti / VIP / ultimi 30 / inattivi / ricerca nome).
- Manca export CSV, segmentazione marketing, invio email campagna, RFM analysis.

**Recensioni**
- Lista con filtri per stelle, distribuzione, badge.
- Tasto "Rispondi" con textarea — **MA la risposta è mock**, non viene salvata sul DB.

**Help statico**
- 5 topic Q&A + contatti email/WhatsApp/form.

**Stato seller (layout)**
- Schermate dedicate per pending / suspended / rejected / wrong role.

**Mancano completamente lato seller**
- Coupon/promo creabili dal seller (la tabella `coupons` è solo admin).
- Flash sale, bundle deal, sconti su categoria.
- Newsletter ai propri clienti.
- Q&A pubblico sui prodotti.
- Chat con buyer.
- Sponsorizzazioni / posizionamento a pagamento.
- Multi-store / staff con permessi granulari (responsabile ordini, contabile, ecc.).
- Audit log delle azioni.
- Termini venditore versionati con re-consenso.

---

### 2.3 RIDER — cosa può fare oggi

**Onboarding**
- Sign-up identico al buyer: email + password + ruolo "rider".
- `is_approved = true` automatico — **nessun KYC, nessuna verifica**.
- Niente patente, niente assicurazione, niente foto profilo verificata, niente HACCP, niente mezzo dichiarato, niente targa, niente background check.

**Disponibilità**
- Toggle Online/Offline (visivo, pallino verde animato).
- Orari settimanali (lun-dom, fascia da-a). **Salvati in localStorage, NON in DB.**
- Fino a 6 zone preferite (suggerite o custom). Anche queste in localStorage.
- Nessun sistema di turni/slot prenotabili, nessun overbooking, nessuna sincronizzazione cross-device.

**Lista ordini**
- Dashboard mostra: le sue consegne attive, ordini READY senza rider (claimabili), ordini ACCEPTED senza rider (solo preview).
- Self-pickup "Accetta" con update atomico `is('rider_id', null)` per evitare double-claim.
- Refetch 60s.
- **Nessun algoritmo di assegnazione** (no distanza, no rating, no batching multi-ordine, no surge), è il primo che clicca.
- Niente push notification, niente offerta proattiva con timer, niente accept rate / completion rate tracciato.

**Ciclo ordine**
- Stati: ASSIGNED → PICKED_UP → OUT_FOR_DELIVERY → DELIVERED.
- Codice pickup 6 cifre (visibile solo seller) verificato via RPC `verify_pickup_code`.
- Codice delivery 6 cifre (visibile solo buyer) verificato via RPC `verify_delivery_code`.
- Tabelle `order_pickup_codes` / `order_delivery_codes` con RLS che il rider non legge mai (sicurezza buona).

**Navigazione**
- Mappa Leaflet/OSM con marker negozio/cliente, fit bounds, centro Piacenza.
- Pulsante "Naviga su Google Maps" — **link esterno**, non integrato.
- `watchPosition()` ogni 5-10s scrive `rider_lat/lng/updated_at`. Buyer vede in tempo reale.
- Manca turn-by-turn in-app, re-routing, ETA buyer-facing, ottimizzazione multi-ordine.

**Pagamenti / earnings**
- Earnings page: filtri (oggi/7g/30g/tutto), KPI (totale, # consegne, media per consegna), grafico ultimi 7 giorni.
- Pay = solo `shipping_cost` degli ordini DELIVERED.
- Payout simulato il 5 di ogni mese.
- **Nessun bonus, nessun multiplier picchi, nessun surge, nessun referral, nessun anticipo, nessuna invoice PDF, nessun regime fiscale tracciato (autonomo/parasubordinato).**

**Cash on delivery**
- Schermata mostra "totale da incassare in contanti".
- **NESSUNA conferma di incasso, NESSUNA foto, NESSUNA firma, NESSUNA riconciliazione.** Rischio frode altissimo.

**Storico**
- Lista ordini DELIVERED ordinata DESC, totale guadagni.

**Profilo**
- Solo nome, telefono, email. Manca foto, documento, mezzo, IBAN, contratto, polizza.

**Recensioni**
- Rating medio, badge "Top rider" se ≥4.5, distribuzione stelle, filtri.
- Niente penalty system, niente possibilità di replicare, niente protezione contro fake review.

**Sicurezza**
- **Nessun panic button / SOS.**
- Numero telefono buyer e seller visibili in chiaro (non mascherato).
- Niente in-app chat, niente messaggi precostituiti, niente report problema strutturato (cliente assente, indirizzo errato, pacco danneggiato).

---

### 2.4 INFRASTRUTTURA / ADMIN — cosa esiste oggi

**Database**
- 23 migrazioni applicate. RLS abilitato su tutte le tabelle critiche.
- Tabelle principali: `profiles`, `products`, `categories`, `orders`, `order_items`, `order_pickup_codes`, `order_delivery_codes`, `reviews`, `store_reviews`, `rider_reviews`, `notifications`, `user_addresses`, `favorites`, `coupons`, `group_orders`, `group_participants`, `referrals`, `newsletter_subscribers`.
- Indici performance applicati nella migration 020.
- Funzioni `SECURITY DEFINER` per operazioni critiche (verify codes, cancel order, seller_reject_order).

**Security headers (next.config.js)**
- X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy strict-origin, Permissions-Policy ristretta, HSTS 2 anni con preload, CSP (permissiva — `'unsafe-inline'` e `'unsafe-eval'` su script, da rivedere in prod).

**Rate limiting**
- In-memory sliding window (fragile in multi-instance): 5/h signup, 10/5min sign-in, 10/5min vision.

**Auth**
- Supabase Auth con session in localStorage → middleware non può verificare in modo affidabile lato server, fallback client-side. **Migrazione a `@supabase/ssr` con cookie httpOnly raccomandata.**

**Pannello admin**
- `/admin` dashboard con statistiche (utenti per ruolo, ordini per status, ricavi, prodotti).
- `/admin/users` — approvazione/rifiuto/sospensione/riattivazione/eliminazione seller, view dati KYC.
- `/admin/orders`, `/admin/products`, `/admin/coupons` esistono ma non analizzati in dettaglio.
- Mancano: dispute resolution, moderazione contenuti, gestione segnalazioni, analytics avanzato, export CSV, bulk actions, audit log.

**Notifiche**
- Sistema in-app via trigger Postgres (best-effort, errori RLS non rollbackano).
- **Resend in `package.json` ma MAI usato** — nessuna email transazionale viene inviata davvero.
- Niente SMS / Twilio.
- Niente push web (no service worker, no Web Push API).

**Storage media**
- Supabase Storage bucket `products` pubblico.
- next/image configurato per Supabase + Pexels + Dicebear + Iconify + placehold.
- `minimumCacheTTL: 60` (basso, da alzare in prod).

**Mappe**
- Leaflet + OpenStreetMap tiles + Nominatim per geocoding (gratuito ma rate-limited e non affidabile per uso commerciale serio).

**AI**
- `/api/vision/extract-product` con Claude Sonnet 4.5 per estrarre dati prodotto da foto. Auth + approvazione + rate limit + max 5MB.

**SEO**
- Metadata root + OpenGraph + JSON-LD OnlineStore + JSON-LD Product nelle pagine prodotto + manifest PWA.
- Manca robots.txt, sitemap.xml, Organization schema, breadcrumbs, LocalBusiness per negozi.

**Testing & CI/CD**
- **ZERO test** (no jest, no playwright).
- **Nessuna CI/CD** (no GitHub Actions, no GitLab CI).
- Solo `next lint`.

**Monitoring**
- Nessuno. Niente Sentry, niente uptime, niente Core Web Vitals, niente alert.

**Analytics**
- Nessuno. Niente GA4, Plausible, Mixpanel, niente event tracking, niente funnel.

---

## 3. Cosa manca per essere un marketplace serio

Le criticità sono divise per priorità. Le voci marcate 🔴 sono **bloccanti per il lancio**, le 🟠 sono **da fare entro il lancio**, le 🟡 sono **post-lancio entro 3 mesi**, le 🟢 sono **scalabilità / nice-to-have**.

### 3.1 🔴 BLOCKER — assolutamente prima di andare in produzione

1. **Pagamenti elettronici reali** — Integrare Stripe (carta + Apple Pay + Google Pay) + Stripe Connect Express per i seller con split payment automatico (commissione marketplace + payout seller + payout rider) + webhook per gestione stato + 3D Secure SCA + retry su falliti. Senza questo non c'è revenue.
2. **Fatturazione elettronica SDI** — Integrazione con provider (FattureInCloud, Aruba, Teamleader) per generare XML SDI, inviarlo, ricevere ricevute, archiviare in conservazione sostitutiva. **Obbligatoria per legge in Italia**.
3. **GDPR completo** — Cookie banner conforme (es. iubenda, OneTrust, Cookiebot), consent management granulare (necessari/analytics/marketing), informativa privacy completa, registro trattamenti, DPO, data export reale (Art. 20), diritto all'oblio reale (Art. 17, oggi cancella anagrafica ma non cronologia), DPA con Supabase/Anthropic/Resend, procedura breach 72h.
4. **KYC seller reale** — Verifica P.IVA su Agenzia Entrate (Open Data o Registro Imprese), OCR documento di identità + face match (IDnow, Jumio, Onfido, Veriff), check antimafia/REA, validazione IBAN SEPA, screening PEP/OFAC.
5. **KYC rider reale** — Documento, patente (per scooter/auto), libretto circolazione, assicurazione RC con scadenza tracciata (auto-disattivazione al rinnovo), HACCP per food, foto profilo verificata biometricamente, background check, contratto firmato digitalmente (autonomo/parasubordinato), regime fiscale tracciato.
6. **Cookie banner** — Tecnicamente parte del 3 ma è il singolo gap più urgente: oggi qualunque cookie analytics/marketing è illegale senza consenso.
7. **Email transazionali reali** — Resend è in package.json ma non collegato: serve template welcome / verifica email / conferma ordine / pickup / consegna / reso / password reset / unsubscribe link. DKIM/SPF/DMARC sul dominio.
8. **Sessioni server-side** — Migrare a `@supabase/ssr` con cookie httpOnly, altrimenti il middleware è bypassabile e c'è rischio session hijacking.
9. **CAPTCHA** — Cloudflare Turnstile o hCaptcha su signup, sign-in, contact form, newsletter, coupon redemption.
10. **Verifica email post-signup** — Oggi puoi registrarti con email finta. Indispensabile per qualità dati e antifrode.
11. **Termini e Condizioni completi** — ToS attuale è stub. Servono clausole consumer (14 gg recesso, garanzia 2 anni, diritti), responsabilità marketplace vs seller, giurisdizione, legge applicabile, versionamento con re-consenso.
12. **Flusso reso completo** — Bottone "Richiedi reso" in `/orders/[id]`, scelta articolo, motivo (dropdown), foto, generazione etichetta ritorno prepagata, stati tracciati (requested → approved → shipped_back → received → refunded), rimborso automatico con detrazione dal payout seller.
13. **Conferma cash on delivery dal rider** — Importo incassato + foto contanti/scontrino + firma digitale buyer + timestamp. Riconciliazione daily con alert su delta >5%. Senza questo il rider può rubare migliaia di euro.

### 3.2 🟠 ALTA — entro il lancio o nelle prime 4 settimane

14. **Varianti prodotto** — Tabella `product_variants(product_id, attrs_jsonb, sku, price_override, stock)`. Modifica UI prodotto + cart per gestire varianti come unità. Senza questo non vendi abbigliamento, scarpe, cibo a peso, ecc.
15. **Gestione magazzino vera** — Decremento atomico stock alla creazione ordine (transazione con `FOR UPDATE`), auto-flag "Esaurito" a 0, alert min stock, log movimenti (`stock_movements` table), SKU univoco, EAN/UPC, unità di misura (kg/pz/l), lotto + scadenza per food.
16. **2FA per admin e seller** — Supabase ha MFA nativo. Esporlo nelle settings (TOTP via Google Authenticator). Opt-in per buyer, obbligatorio per admin.
17. **Social login** — Google + Apple (Supabase provider nativi). Riduce drop-off signup del 30-50%.
18. **Dispute management** — Tabella `disputes`, workflow stati (open → seller_response → admin_review → resolved), upload prove (foto/video/chat log), evidence repository, decisione con redistribuzione fondi, fee chargeback.
19. **Escrow / hold pagamento** — Soldi del buyer tenuti dalla piattaforma e rilasciati al seller solo dopo `DELIVERED + N giorni` (es. 7 giorni per coprire periodo reso). Stripe Connect supporta nativamente.
20. **Assegnazione ordini intelligente al rider** — Algoritmo che considera distanza rider→negozio→cliente, tempo stimato, carico rider, rating, zona preferita, accept/completion rate. Push notification con timer 30s prima che vada al prossimo. Self-pickup come fallback.
21. **In-app chat buyer-rider (con numero mascherato)** — Provider tipo Twilio Proxy per mascherare il numero. Chat con messaggi precostituiti ("Sono a 2 min", "Non trovo il numero civico", "Cliente non risponde"). Transcript salvato per dispute.
22. **Chat buyer-seller** — Tabella `messages`, UI popup, notifiche, template risposte rapide, moderazione spam.
23. **Q&A pubblico sui prodotti** — Tabella `product_questions`. Buyer chiede, seller risponde, visibile a tutti. Moderazione admin.
24. **Penalty system rider** — Trigger automatici: rating < 4 → warning email, < 3.5 → call support, < 3 → 48h suspend, accept rate < 70% → visibilità ridotta, completion < 90% → flag. Appeal process.
25. **Panic button rider** — Bottone SOS in ordine attivo, geolocalizzazione immediata al supporto, possibile call automatica, registrazione evento.
26. **Turni prenotabili rider** — Tabelle `rider_shifts`, `shift_assignments` con max_riders per zona/fascia. Check-in 10 min prima, no-show tracciato.
27. **Foto consegna obbligatoria** — Il rider deve scattare una foto del pacco lasciato + opzionale firma digitale del buyer. Prova di consegna anti-dispute.
28. **Risposta seller alle recensioni — vera** — Oggi è mock. Tabella `review_responses`, RLS che permette al seller di rispondere solo alle proprie review, visualizzazione sotto la recensione.
29. **Coupon e promo creabili dal seller** — CRUD coupon seller-specific (PERCENT/FIXED/FREE_SHIPPING, scope categoria/prodotto, validità da-a, limite usi, first-order-only, stacking rules), statistiche utilizzo, bundle deal "compra 3 paghi 2".
30. **Validazione indirizzo reale** — Oggi usa Nominatim best-effort. Servono Google Address Autocomplete o HERE/Mapbox per evitare consegne sbagliate.
31. **Notifiche push web reali** — Service worker + Web Push API + VAPID, per: nuovo ordine seller, ordine pronto rider, rider in arrivo buyer, recensione, sconto preferiti.
32. **SMS Twilio** — Per OTP, conferma ordine, "il rider è a 2 min", reset password, recupero PIN consegna.
33. **Fattura PDF al buyer** — Generata al `DELIVERED`, scaricabile dal dettaglio ordine. Dati seller (P.IVA, indirizzo), buyer (eventuale P.IVA per B2B), itemized, totali, IVA per aliquota.
34. **Commissioni marketplace fatturate al seller** — Invoice mensile generata automaticamente con breakdown (payment processing, hosting, support, marketing) e numerazione progressiva.

### 3.3 🟡 MEDIA — entro 3 mesi dopo il lancio

35. **Stripe Radar / antifrode** — Riduce chargeback e ordini fraudolenti.
36. **Bonus e multiplier dinamici rider** — Picchi orari (+€1 per 12-14 e 19-22), zone undersupplied (1.2x-1.5x), streak bonus, rating bonus, anticipo guadagni con fee 1-2%.
37. **Dashboard analytics seller avanzato** — Funnel (impression → product view → cart → checkout → purchase), top prodotti per vendite/margine/visualizzazioni, RFM analysis, cohort, sparkline, export CSV/Excel.
38. **Sentry + GA4 + uptime** — Error tracking, web analytics con consent, monitoring 24/7.
39. **Search avanzato** — Meilisearch self-hosted o Algolia (typo tolerance, sinonimi, autocomplete, filtri sfaccettati per brand/colore/taglia/rating/in-stock/new/sale, ordinamento per prezzo/rilevanza/novità/bestseller, full-text PostgreSQL trigram come fallback).
40. **Recommendation engine** — "Visti di recente", "Acquistati insieme", "Suggeriti per te" basato su collaborative filtering o item-based.
41. **Reviews moderation** — Coda admin pre-publish per parole chiave a rischio, badge "acquisto verificato", foto/video upload, voti utili/non utili, segnalazione abuso.
42. **Newsletter system** — Trigger automatici (abbandono carrello, post-acquisto, win-back inactive, anniversary), template editor, segmentazione, opt-out one-click GDPR.
43. **Wallet / gift card** — Tabella `wallet_balances`, accredito automatico bonus referral, gift card codes generabili da admin/seller, spendibile in checkout.
44. **Guest checkout** — Possibilità di ordinare senza account, post-order proposta creazione account con un click.
45. **PWA completa** — Service worker per cache stale-while-revalidate, "Add to Home Screen", offline mode browsing catalogo.
46. **Bulk upload catalogo (CSV)** — Importazione batch prodotti con template + validazione riga-per-riga + import async in background.
47. **Gestione orari negozio via UI** — Form per modificare `store_hours` per giorno, ferie (chiusura temporanea), pause pranzo.
48. **Slot di consegna** — Buyer sceglie fascia oraria al checkout (15-17, 17-19, 19-21), seller può chiudere slot se overflow.
49. **Multi-store / staff con ruoli** — Tabelle `stores` separata da `profiles`, `store_members(store_id, user_id, role)` con permessi granulari (admin, ordini, contabile).
50. **Loyalty program** — Punti accumulati per acquisto, tier (Bronze/Silver/Gold), redemption per sconti/gift card.
51. **Subscription / ordini ricorrenti** — Prodotti "Subscribe & Save" con consegna ogni 2/4 settimane, pause/skip.
52. **Gruppi d'acquisto — UI seller** — Oggi il DB esiste ma nessuna UI seller per crearli e gestirli.
53. **AGCM / AGCOM compliance** — Documentazione criteri ranking trasparente (obbligo P2B Regulation EU 2019/1150), policy esclusività, dispute resolution trasparente.

### 3.4 🟢 SCALABILITÀ — quando hai trazione

54. **App nativa iOS/Android** — React Native o Flutter, push native, background GPS, camera scan documenti, widget home.
55. **In-app turn-by-turn rider** — Integrazione Google Maps Directions API o Mapbox, re-routing, ETA dinamico buyer-side.
56. **Multi-lingua** — next-intl o next-i18next, locale-aware URL (`/en/...`), translation management (Crowdin).
57. **Multi-valuta** — Per espansione UE.
58. **Status page pubblica** — statuspage.io o BetterStack.
59. **Integrazioni corrieri B2B** — EasyPost/Shippo per SDA/BRT/DHL/GLS/UPS quando l'ordine non è gestibile da rider locale.
60. **Sponsored products / Ads** — Seller può promuovere i propri prodotti pagando per posizionamento.
61. **A/B testing framework** — LaunchDarkly, GrowthBook.
62. **Recommendation ML** — Collaborative filtering avanzato, embedding prodotti.
63. **Audit log** — Chi ha fatto cosa e quando, sia su admin sia su seller.
64. **Backup/DR documentati** — Drill di recovery, RTO/RPO SLA, geo-redundancy.
65. **Public API + webhook** — Per integratori, Zapier/Make connector.
66. **Accessibility WCAG 2.1 AA** — Audit completo + remediation (ARIA, contrast, keyboard nav, screen reader).

---

## 4. Roadmap consigliata

### Settimane 1-2 (legal & money setup)
- Legal review ToS / Privacy / Cookie + adozione iubenda/OneTrust per cookie banner.
- Setup Stripe + Stripe Connect Express + onboarding seller minimo.
- Setup Resend con DKIM/SPF/DMARC + template welcome/verifica email/ordine/consegna.
- Migrazione sessioni a `@supabase/ssr` (cookie httpOnly).

### Settimane 3-4 (revenue & compliance)
- Integrazione SDI (FattureInCloud o equivalente) per fatture XML.
- Webhook Stripe + escrow (hold fino a DELIVERED + 7gg).
- Verifica email obbligatoria post-signup.
- CAPTCHA su signup/sign-in/contact.
- Validazione P.IVA con Agenzia Entrate.

### Settimane 5-6 (KYC & safety)
- KYC rider: documento + patente + RC + foto verificata.
- Conferma cash on delivery (importo + foto + firma).
- Panic button rider.
- Foto consegna obbligatoria.
- Flusso reso completo end-to-end.

### Settimane 7-8 (catalogo & UX)
- Varianti prodotto (taglia/colore/formato).
- Magazzino vero con decremento atomico + alert min stock.
- Risposta seller a review (oggi mock).
- Q&A pubblico sui prodotti.
- Sentry + GA4 + uptime monitoring.

### Mesi 3-4 (engagement)
- Push web + SMS Twilio.
- Assegnazione rider intelligente + turni prenotabili.
- Chat buyer-rider con numero mascherato.
- Dashboard analytics seller avanzato.
- Search avanzato (Meilisearch).

### Mesi 5-6 (scala)
- Recommendation engine, loyalty, wallet, gift card.
- Multi-store / staff con permessi.
- PWA completa.
- Bulk upload catalogo.
- AGCM / AGCOM compliance documentale.

---

## 5. Stima sforzo (2 sviluppatori full-time)

| Fase | Durata | Output |
|---|---|---|
| Blocker (legal + Stripe + SDI + GDPR + KYC + email) | 8-10 settimane | Marketplace lanciabile legalmente in Italia |
| Alta priorità (varianti, magazzino, dispute, escrow, rider intelligence, chat, fattura PDF) | 8-10 settimane | Marketplace competitivo livello MVP+ |
| Media priorità (analytics, search, recommendation, push, SMS, wallet, PWA) | 12 settimane | Marketplace livello "early traction" |
| Scalabilità (app nativa, multi-lingua, ads, audit, accessibility) | 6+ mesi | Marketplace livello "mature" |

**Totale per arrivare a livello Glovo/Etsy: ~10-12 mesi con team di 2-3 dev + 1 PM + supporto legale.**

---

## 6. Considerazioni finali

Il codice attuale è **pulito e ben strutturato**: RLS abilitato, security headers ragionevoli, codici di verifica pickup/delivery ben isolati, sistema di notifiche idempotente, AI Vision per UX seller, lazy-loading mappa, Realtime per tracking. La fondazione tecnica è solida.

Quello che manca **non è codice**, è **prodotto**: i pilastri (pagamenti reali, fatturazione legale, KYC, GDPR completo, resi, dispute, magazzino, varianti, antifrode, comunicazione) sono assenti o stub. È normale per un MVP di 23 migrazioni, ma è ciò che separa "demo che funziona" da "marketplace serio".

La priorità assoluta è chiudere i blocker legali/finanziari (Stripe + SDI + GDPR + KYC) **prima** di qualunque feature di engagement. Senza quelli, ogni ordine reale è un rischio legale o di frode.
