# PROMPT — Implementazione funzionalità AI (Anthropic) per MyCity

> **Cos'è questo file.** Un prompt operativo, auto-contenuto, da dare a Claude Code
> (o a uno sviluppatore) per costruire **ognuna** delle funzionalità AI del
> marketplace. Ogni funzione è una "task card" indipendente: leggi la Fondazione
> condivisa (§0), poi implementa le card nell'ordine consigliato (§6).
>
> **Come usarlo.** Copia il blocco "Fondazione condivisa" + la singola task card
> nella tua sessione Claude Code e dì: *"implementa questa card seguendo le
> convenzioni del repo, mostrami il diff prima di committare"*.
>
> **Stato attuale del codice (fonte di verità).**
> - Anthropic SDK già presente (`@anthropic-ai/sdk`), istanziato **inline** in
>   `app/api/ai/description/route.ts` (Haiku 4.5) e
>   `app/api/vision/extract-product/route.ts` (Sonnet 4.5).
> - Helper esistenti: `withSellerAuth` (`@/lib/api/middleware`), `ApiErrors`
>   (`@/lib/api/responses`), `rateLimit` (`@/lib/rate-limit`), `logger`
>   (`@/lib/logger`), `getServerSupabase` / `getAdminSupabase`
>   (`@/lib/supabase/server`).
> - Tabella `products`: `id, name, description, price, images(Json), seller_id,
>   status, category_id, attributes(Json)`. **`attributes` esiste ma è inutilizzato.**
> - Tabella `categories`: `id, slug, parent_id` (categorie a 2 livelli).
> - `NON esiste` ancora un modulo `lib/ai/` centralizzato → lo creiamo in §0.

---

## §0 — Fondazione condivisa (implementare PER PRIMA)

> **Esperti consultati**
> - *Staff Engineer*: "Oggi ogni route istanzia `new Anthropic()` e ripete prompt
>   e gestione errori. Centralizzare elimina duplicazione e rende il prompt
>   caching e il batch riusabili ovunque."
> - *FinOps/ML Eng*: "Senza un registro modelli e telemetria token non sai mai
>   quanto spendi per feature. Si misura prima di ottimizzare."
> - *Trust & Safety*: "Ogni input utente che entra in un prompt va trattato come
>   non fidato. Un moderation gate condiviso evita di replicare i controlli."

**Obiettivo:** un unico modulo `lib/ai/` che tutte le funzioni riusano.

**File da creare:**

### `lib/ai/client.ts` — singleton + registro modelli + caching
```ts
import Anthropic from '@anthropic-ai/sdk';

let _client: Anthropic | null = null;
export function getAnthropic(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('AI_NOT_CONFIGURED');
  return (_client ??= new Anthropic({ apiKey }));
}

/** Registro centrale: cambiare modello in UN posto. */
export const MODELS = {
  fast:   'claude-haiku-4-5-20251001', // testo: descrizioni, classificazione, traduzioni
  vision: 'claude-sonnet-4-5',         // immagini + ragionamento
  smart:  'claude-sonnet-4-5',         // dispute, casi complessi
} as const;

/** Prezzi indicativi $/Mtok per telemetria (aggiornare da anthropic.com/pricing). */
export const PRICE_PER_MTOK = {
  'claude-haiku-4-5-20251001': { in: 1, out: 5 },
  'claude-sonnet-4-5':         { in: 3, out: 15 },
} as const;
```

### `lib/ai/run.ts` — wrapper unico con caching, telemetria, errori
Implementa `runMessage(opts)` che:
1. Chiama `getAnthropic().messages.create(...)`.
2. Applica **prompt caching**: marca i blocchi statici (system prompt, tool schema)
   con `cache_control: { type: 'ephemeral' }` → fino a −90% sul costo input ripetuto.
3. Legge `response.usage` (`input_tokens`, `output_tokens`,
   `cache_read_input_tokens`) e logga il costo stimato via `logger.info('[ai]', …)`
   usando `PRICE_PER_MTOK`.
4. Mappa gli errori a `ApiErrors`: `status 401 → unavailable('API key…')`,
   `429 → rateLimited(60)`, altri → `badGateway`. **Mai loggare il messaggio raw**
   (può contenere frammenti di key/input) — solo lo `status`.

### `lib/ai/moderation.ts` — gate Trust & Safety condiviso
`assertSafeText(text)` e `classifyProductPolicy(input)`: usa `MODELS.fast` con un
tool `flag` (`{ allowed: boolean, reason?: string, category?: enum }`) per
intercettare prodotti vietati / testo offensivo prima di pubblicare.

### `lib/ai/batch.ts` — wrapper Batch API (−50%)
`submitBatch(requests[])` + `pollBatch(id)` su `client.messages.batches`. Per
tutti i job non realtime (import massivo, alt-text catalogo, riassunti notturni).

**Refactor:** riscrivi le 2 route esistenti per usare `getAnthropic()`/`runMessage`
(nessun cambio di comportamento, solo deduplicazione). **Acceptance:** `npm run
verify` verde, descrizione e foto funzionano come prima, i log mostrano i token.

**Convenzioni valide per TUTTE le card seguenti:**
- Tutte le route AI: `export const runtime = 'nodejs'`, protette da
  `withSellerAuth` (o `withAdminAuth` per le admin), **rate limit obbligatorio**,
  validazione input con `zod`, output via `NextResponse.json`.
- Input utente nei prompt: sempre passato come **dato**, mai concatenato per
  cambiare le istruzioni (anti prompt-injection). Per i task strutturati usa
  **sempre `tools` + `tool_choice`**, mai parsing di testo libero.
- i18n: i testi generati rispettano la lingua attiva (`next-intl`).
- Ogni nuovo file route apre con un commento `Esperti senior consultati:` (come
  da convenzione del repo).

---

## §2 — Inserimento prodotto a sforzo (quasi) ZERO

### Card A — Attributi strutturati nel campo `attributes`
> **Esperti**: *Marketplace PM* "gli attributi alimentano filtri e ricerca";
> *Data Eng* "schema JSON tipizzato, niente campi liberi a caso".

**Obiettivo:** una sola chiamata vision restituisce anche marca, colore, taglia,
materiale, peso/dimensioni, condizione, e (alimentari) allergeni/scadenza.

**Modifiche:** in `app/api/vision/extract-product/route.ts` estendi `EXTRACT_TOOL`
con un oggetto `attributes` (proprietà opzionali, tipizzate). Salva il risultato
nel campo `products.attributes` (JSON, già esistente). Aggiorna
`ExtractedProduct` in `components/seller/PhotoFillButton.tsx` e mostra gli
attributi come chip editabili nel form `app/seller/products/new/page.tsx`.

**Modello:** `MODELS.vision`. **Costo:** invariato (~€0,007/foto, stessa chiamata).
**Acceptance:** caricando una foto, il form pre-compila ≥3 attributi pertinenti;
campi assenti → omessi (non inventati).

---

### Card B — Multi-foto + lettura etichetta (OCR)
> **Esperti**: *Vision Eng* "fronte + retro etichetta = EAN, ingredienti,
> materiali gratis via OCR nativo"; *UX* "max 4 foto, una sola attesa".

**Obiettivo:** il seller carica 2–4 foto → inviate **in un'unica richiesta** (array
di blocchi `image`) → estrazione più ricca (legge testo di etichette/confezioni).

**Modifiche:** `PhotoFillButton` accetta multi-file (già ridimensiona a 1024px
JPEG 0.85 — riusa `resizeImage`). La route accetta `images: {base64, media_type}[]`
(zod, max 4, ognuna ≤5MB). Costruisci `content` con N blocchi `image` + il prompt.

**Modello:** `MODELS.vision`. **Costo:** ~€0,007 × n_foto (≈€0,02 con 3 foto).
**Guardrail:** rate limit invariato (10/5min); rifiuta >4 immagini.
**Acceptance:** con foto del retro, `attributes` include EAN/ingredienti quando leggibili.

---

### Card C — Caricamento massivo DA foto (Batch API)
> **Esperti**: *Operations* "onboarding negozio in minuti"; *FinOps* "batch =
> −50%, è asincrono e va benissimo per il bulk".

**Obiettivo:** il seller carica 5–30 foto (1 prodotto ciascuna) → N bozze prodotto
in stato `draft` da rivedere.

**Modifiche:** nuova route `app/api/vision/extract-batch/route.ts`: ridimensiona
client-side, invia via `lib/ai/batch.ts` (una request per foto, stesso
`EXTRACT_TOOL`). Salva i risultati come prodotti `status='draft'`. UI in
`app/seller/products/import/page.tsx` (nuova tab "Da foto") con polling stato +
anteprima/conferma in blocco.

**Modello:** `MODELS.vision` via Batch. **Costo:** ~€0,0035/foto (−50%) → 30 foto ≈ €0,10.
**Acceptance:** 10 foto → 10 bozze entro pochi minuti; conferma multipla pubblica i prodotti.

---

### Card D — Import "intelligente" listino fornitore (PDF/Excel/testo)
> **Esperti**: *Onboarding PM* "il vincolo del CSV con header esatti blocca i
> seller non tecnici"; *Data Eng* "Claude normalizza qualunque formato → righe pulite".

**Obiettivo:** carica un listino in qualunque formato → righe `{name, description,
price, stock, category_slug}` validate, riusando la pipeline di
`import/page.tsx`.

**Modifiche:** route `app/api/ai/parse-catalog/route.ts`. Per PDF usa il blocco
`document` dell'SDK; per Excel/CSV converti a testo lato server. Tool
`extract_rows` che ritorna un array tipizzato. Riusa la validazione/preview già
presente nella pagina import prima del commit atomico.

**Modello:** `MODELS.smart` (ragionamento su tabelle); **Batch** se il file è grande.
**Costo:** ~€0,01–0,05 per listino tipico. **Acceptance:** un PDF fornitore reale
produce righe corrette nell'anteprima, con `category_slug` mappato all'enum esistente.

---

### Card E — Descrizione bilingue IT/EN
> **Esperti**: *Growth* "expat e turisti convertono se leggono in inglese";
> *i18n Eng* "una chiamata, due lingue, niente traduzione manuale".

**Obiettivo:** `/api/ai/description` ritorna `{ it, en }`.

**Modifiche:** tool `write_description` con proprietà `it` e `en`. Salva su
`products` (aggiungi colonna `description_en` via migration idempotente
`038_*.sql`, con `NOTIFY pgrst`). Il PDP mostra la lingua attiva.

**Modello:** `MODELS.fast`. **Costo:** ~€0,0015 (poco più di una lingua sola).
**Acceptance:** descrizione coerente nelle due lingue, tono del brand rispettato.

---

### Card F — Prezzo suggerito context-aware
> **Esperti**: *Pricing Analyst* "il prezzo deve riflettere il TUO marketplace,
> non un generico mercato"; *Backend* "passa 2-3 comparabili reali nel prompt".

**Obiettivo:** migliorare `suggested_price_eur` usando prodotti simili già a catalogo.

**Modifiche:** prima della chiamata vision, query Supabase dei top 3 prodotti
stessa categoria (nome+prezzo) e iniettali nel prompt come **contesto comparativo**
(marcato come cache-able se stabile). Output invariato.

**Modello:** `MODELS.vision`. **Costo:** +~€0,001 (pochi token in più).
**Acceptance:** su categoria popolata, il prezzo suggerito cade nel range dei comparabili.

---

### Card G — Gate qualità foto + alt-text (accessibilità EAA)
> **Esperti**: *Conversion* "foto scarse uccidono le vendite"; *Accessibility/Legal*
> "alt-text è obbligo EAA"; *T&S* "qui blocchi anche prodotti vietati".

**Obiettivo:** ogni foto produce `quality {score, issues[]}` + `alt_text`, e un
flag `policy_ok`.

**Modifiche:** estendi `EXTRACT_TOOL` con `image_quality`, `alt_text`,
`policy_ok`. Se `policy_ok=false` → blocca con messaggio chiaro. Salva `alt_text`
e usalo nei `<img>` del PDP/store. Se qualità bassa → toast "rifai la foto".

**Modello:** `MODELS.vision` (stessa chiamata). **Costo:** invariato.
**Acceptance:** foto sfocata → avviso; ogni immagine pubblicata ha `alt` non vuoto.

---

## §3 — Funzioni AI sul resto del marketplace

> **Pattern condiviso (esperti)**: *Principal Eng* "sono tutte varianti di
> `runMessage` con un tool tipizzato + un rate limit. Stesso scheletro, prompt
> diverso." Implementale come route sottili che chiamano `lib/ai/run.ts`.

| # | Funzione | Route nuova/esistente | Tool/Output | Modello | Costo/chiamata | Guardrail chiave |
|---|---|---|---|---|---|---|
| 1 | **Smart-reply chat** | `app/api/chat/suggest` | `{replies: string[3]}` | fast | ~€0,001 | solo partecipanti conversazione |
| 2 | **Support chatbot + triage** | `app/api/support/assist` | `{answer, category, escalate}` | fast | ~€0,001 | fallback a umano se `escalate` |
| 3 | **Risposta a recensione** | `app/api/seller/reviews/[id]/suggest` | `{reply}` | fast | ~€0,001 | solo seller proprietario |
| 4 | **Riassunto recensioni (PDP)** | cron notturno (Batch) | `{summary, pros[], cons[]}` | fast/batch | ~€0,0005 | rigenera solo se nuove recensioni |
| 5 | **Triage dispute** | `app/api/admin/disputes/[id]/triage` | `{reason, suggested_outcome, summary}` | smart | ~€0,004 | solo admin, decisione resta umana |
| 6 | **Email lifecycle personalizzate** | dentro `cron/send-emails` | testo email | fast/batch | ~€0,0008 | rispetta consenso marketing |
| 7 | **Ricerca in linguaggio naturale** | `app/api/search/parse` | `{filters: {cat, max_price, …}}` | fast | ~€0,0008 | cache per query identiche |
| 8 | **Moderazione contenuti** | `lib/ai/moderation.ts` (riuso) | `{allowed, reason}` | fast | ~€0,0005 | applicata a descrizioni/chat/recensioni |
| 9 | **Bio negozio (onboarding)** | `app/api/ai/store-bio` | `{bio, tagline}` | fast | ~€0,001 | solo seller |
| 10 | **Riassunto "Today" admin** | dentro `app/admin/today` | testo insight | fast | ~€0,001 | solo admin, dati aggregati |
| 11 | **Contenuti home editoriali** | cron/admin (Batch) | testo | fast/batch | ~€0,0008 | revisione admin prima di pubblicare |

Per **ognuna**: route `runtime='nodejs'`, auth corretta, rate limit, `zod`,
`tool_choice` forzato, prompt statico cache-able, telemetria via `runMessage`.

---

## §4 — Ottimizzazione costi & performance (trasversale)

> **Esperti**: *FinOps* "misura, poi taglia"; *Perf Eng* "caching + modello giusto
> battono qualunque micro-ottimizzazione".

1. **Prompt caching** (già in `lib/ai/run.ts`): marca system prompt e tool schema
   come `ephemeral`. Massimo impatto su vision (schema fisso) e su tutte le route §3.
   Target: **>70% cache-read** sull'input → costo input effettivo ~1/10.
2. **Batch API** (`lib/ai/batch.ts`): obbligatoria per Card C, D e §3 #4/#6/#11.
   **−50%** sul prezzo. Mai per richieste interattive (latenza alta).
3. **Model router** (`MODELS`): default `fast`; sali a `vision`/`smart` solo dove
   serve. Vietato Opus salvo task esplicitamente complessi.
4. **Telemetria costi**: `runMessage` logga token e € stimati per `feature`.
   Aggiungi un pannello in `app/admin` ("Spesa AI per funzione, ultimi 30gg")
   leggendo i log o una tabella `ai_usage`.
5. **Budget guard**: contatore giornaliero per-seller già garantito dai
   `rateLimit` esistenti; aggiungi un cap globale mensile (env `AI_MONTHLY_CAP_EUR`)
   che, superato, degrada gracefully (`ApiErrors.unavailable`).

---

## §5 — Costi: riepilogo operativo

- **Nessun canone Anthropic.** Paghi solo i token. Batch −50%, caching fino a −90%
  sull'input ripetuto.
- **Costo per interazione** (post-caching, stime): descrizione ~€0,001 · foto
  ~€0,003–0,007 · testo §3 ~€0,0005–0,004.
- **Proiezione a regime** (50 seller attivi, tutte le funzioni accese):
  **~€15–25/mese** totali — invariata rispetto a oggi grazie a caching+batch.
- **Unico costo aggiuntivo reale = tempo di sviluppo.** Nessuna nuova
  infrastruttura: tutto gira sulle route Next già esistenti + Supabase.

---

## §6 — Ordine di implementazione consigliato

1. **§0 Fondazione** (`lib/ai/*` + refactor 2 route) — abilita tutto il resto.
2. **Card A + B + G** — un unica chiamata vision arricchita: attributi, multi-foto,
   alt-text, policy. Massimo impatto sul seller, costo invariato.
3. **Card E + F** — bilingue + prezzo context-aware (piccole modifiche di prompt).
4. **Card C + D** — bulk da foto e listino fornitore (Batch). Sblocca l'onboarding.
5. **§3** — a ondate, partendo da #8 moderazione (sicurezza) e #1/#3 (chat/recensioni).
6. **§4** — pannello spesa AI + budget cap, quando il volume sale.

> Ogni card è un PR piccolo e verificabile (`npm run verify` verde + test del
> percorso). Non accorpare più card in un solo PR: il diff resta rivedibile e il
> rollback chirurgico.
