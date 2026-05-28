# MyCity Piacenza

Marketplace dei negozi locali di Piacenza con consegna a domicilio.
Buyer, Seller, Rider, Admin — un singolo prodotto, 3+1 ruoli.

## Stack

- **Frontend**: Next.js 14 (App Router, Server Components, Server Actions)
- **Backend**: Supabase (Postgres + Auth + Storage + Realtime + RLS)
- **Payments**: Stripe Checkout + Connect (escrow) + COD
- **Email**: Resend (transactional)
- **AI**: Claude API (Anthropic) — description writer, photo extract
- **Hosting**: Render
- **DNS**: Netsons + Cloudflare proxy
- **Observability**: PostHog (analytics + replay) + Sentry (errors)
- **Maps**: Leaflet + OpenStreetMap (tiles) + Nominatim (geocoding)

## Setup locale

### Prerequisiti

- Node.js 20+
- npm 10+
- Account Supabase (free tier ok)
- Account Stripe (test mode)

### 1. Clona e installa

```bash
git clone https://github.com/NicolaeRotaru/mycity.git
cd mycity
npm install
```

### 2. Configura variabili d'ambiente

Crea `.env.local` con (chiavi reali da Supabase/Stripe):

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>  # SOLO server, mai in client

# Stripe
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_xxx
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx

# Resend
RESEND_API_KEY=re_xxx
RESEND_FROM_EMAIL=noreply@mycity-marketplace.com
RESEND_REPLY_TO=support@mycity-marketplace.com

# Anthropic (AI features)
ANTHROPIC_API_KEY=sk-ant-xxx

# Cloudflare Turnstile (CAPTCHA)
NEXT_PUBLIC_TURNSTILE_SITE_KEY=0x4xxx
TURNSTILE_SECRET_KEY=0x4xxx

# Push notifications (VAPID)
NEXT_PUBLIC_VAPID_PUBLIC_KEY=Bxx
VAPID_PRIVATE_KEY=xx
VAPID_SUBJECT=mailto:admin@mycity-marketplace.com

# Cron jobs (lifecycle email + abandoned cart)
CRON_SECRET=<random-32-char-string>

# App URL (canonical)
NEXT_PUBLIC_APP_URL=https://mycity-marketplace.com

# WhatsApp Business (footer)
NEXT_PUBLIC_WHATSAPP_NUMBER=+393000000000

# Observability (opzionale ma fortemente consigliato)
NEXT_PUBLIC_POSTHOG_KEY=phc_xxx
NEXT_PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com
NEXT_PUBLIC_SENTRY_DSN=https://xxx@oxxx.ingest.sentry.io/xxx

# Google Analytics 4 (opzionale)
NEXT_PUBLIC_GA_ID=G-XXXXXXXXXX
```

### 3. Applica le migrations su Supabase

Le migrations stanno in `migrations/`. Sono numerate (`001_`, `002_`, ...).
Per applicarle:

1. Vai sul tuo Supabase project → SQL Editor
2. Esegui in ordine `001_*.sql` → `037_*.sql` (l'ultima al momento di scrittura)
3. Verifica nell'output che non ci siano errori
4. Tutte le migrations sono **idempotenti** — puoi ri-eseguirle senza paura

### 4. Avvia in dev

```bash
npm run dev
```

→ Apri http://localhost:3000

### 5. Crea il primo admin

Dopo aver creato un account, in Supabase SQL editor:

```sql
UPDATE public.profiles
SET role = 'admin', is_approved = true
WHERE id = (SELECT id FROM auth.users WHERE email = 'tua-email@example.com');
```

## Comandi disponibili

```bash
npm run dev      # dev server (hot reload)
npm run build    # production build
npm run start    # production server (dopo build)
npm run lint     # ESLint
npx tsc --noEmit # type check (no emit)
```

## Cron jobs esterni

Gli endpoint cron sono pronti ma devono essere triggerati da fuori (es.
[cron-job.org](https://cron-job.org) free):

| Endpoint | Frequenza | Cosa fa |
|---|---|---|
| `POST /api/cron/send-emails` | ogni 10 min | Processa `email_queue` (welcome, tutorial, re-engagement, win-back) |
| `POST /api/cron/abandoned-carts` | ogni 1 h | Email "Hai dimenticato qualcosa" a 4h+ |
| `POST /api/cron/expire-checkouts` | ogni 30 min | Marca EXPIRED i `pending_checkouts` Stripe non pagati entro 2 h |
| `POST /api/cron/process-deletions` | ogni 24 h | Hard-delete account dopo 7gg cooldown |

Header richiesto: `Authorization: Bearer $CRON_SECRET`

## Architettura cartelle

```
app/
  api/                  # API routes (server-only)
    ai/                 # AI endpoints (description, vision)
    chat/               # Messaggi tra buyer/seller
    cron/               # Cron jobs (emails)
    stripe/             # Webhook + Checkout + Connect
  admin/                # Dashboard admin (/admin)
  buyer-facing pages    # /, /search, /product, /store, /cart, ...
  seller/               # Dashboard seller (/seller)
  rider/                # Dashboard rider (/rider)
components/
  home/                 # Home-only components (StoryOfDay, ShopOfMonthHero, ...)
  rider/                # Rider-only (SOS, CashConfirm, ...)
  seller/               # Seller-only (SellerHealthScore, ...)
  providers/            # React context providers
  hooks/                # Custom hooks (useProfile, useFavorites, ...)
lib/
  analytics/            # PostHog + Sentry + events catalog
  supabase/             # Client + server + admin Supabase setup
  stripe/               # Stripe client + helpers
  email/                # Resend wrapper + templates
  cart.ts               # localStorage cart
  geo.ts                # Haversine distance
  format.ts             # i18n number/date formatting
  errors.ts             # SQL code → IT user-friendly translation
migrations/             # SQL migrations (idempotenti, numerate)
public/                 # Static assets
```

## Roadmap migrazioni

Le migrations da 001 a 037 sono già applicate (vedi `migrations/`).
Quando aggiungi una nuova migration:

1. Numerala (es. `038_...`)
2. Rendila idempotente (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE … ADD COLUMN IF NOT EXISTS`, `DROP POLICY IF EXISTS` prima del `CREATE POLICY`)
3. Aggiungi `NOTIFY pgrst, 'reload schema';` in fondo per refresh PostgREST
4. Documenta gli "Esperti senior consultati" in cima al file

## Sicurezza

- ✅ RLS abilitata su tutte le tabelle pubbliche
- ✅ Service role key SOLO in API routes (mai client)
- ✅ Stripe webhook signature verificato
- ✅ CSP completa in `next.config.js`
- ✅ Turnstile CAPTCHA su signup
- ✅ Honeypot anti-bot
- ✅ Rate limit su API LLM
- ✅ Cookie consent GDPR (Consent Mode v2)
- ⚠️ Audit RLS periodico: `psql -c "SELECT schemaname, tablename, policyname, qual FROM pg_policies WHERE schemaname = 'public'"`

## Deploy

Push su branch `main` → Render auto-deploy.

```bash
git push origin main
```

Variabili d'ambiente: settale su Render → Dashboard → Environment.

## Documenti strategici

- [`docs/business-plan.md`](docs/business-plan.md) — Business plan 5 pagine
- [`docs/unit-economics.md`](docs/unit-economics.md) — Unit economics + breakeven
- [`docs/acquisition-plan-90d.md`](docs/acquisition-plan-90d.md) — Piano acquisition 90 giorni
- [`docs/runbook.md`](docs/runbook.md) — Operazioni critiche (refund, dispute, ban)
- [`docs/backup-restore.md`](docs/backup-restore.md) — Strategia backup + restore drill

## Licenza

Proprietario. Tutti i diritti riservati.

## Contatti

- Founder: Nicola
- Email: support@mycity-marketplace.com
- WhatsApp: +39 ... (in arrivo)
