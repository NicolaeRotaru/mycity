# MyCity Piacenza — Security Audit Checklist

> Da eseguire 1x/mese in Supabase SQL Editor + 1x prima di ogni go-live di feature critica.

---

## 1. RLS audit (Row Level Security)

### 1.1 Tutte le tabelle hanno RLS abilitata

```sql
-- Atteso: 0 righe (tutte hanno RLS)
SELECT schemaname, tablename
FROM pg_tables
WHERE schemaname = 'public'
  AND rowsecurity = false;
```

**Fix**: per ogni tabella senza RLS:
```sql
ALTER TABLE public.<tablename> ENABLE ROW LEVEL SECURITY;
```

---

### 1.2 Nessuna policy permissiva "USING (true)"

```sql
-- Atteso: solo policies di sola SELECT pubblica intenzionale
-- (es. categories, products list page, store reviews)
SELECT
  schemaname, tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND (qual = 'true' OR with_check = 'true')
ORDER BY tablename;
```

**Review manualmente**: per ogni risultato verifica che sia intenzionale.
Policy permissive sono OK SOLO se:
- Sono `FOR SELECT` (read only)
- Su tabella con contenuto pubblico (es. `products`, `categories`)
- Su VIEW filtrate (es. `shop_of_month_leaderboard`)

❌ **MAI** `USING (true)` su `FOR INSERT/UPDATE/DELETE`.

---

### 1.3 Tabelle con dati PII hanno policy own-row

```sql
-- Verifica policy su tabelle sensibili
SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'profiles', 'orders', 'order_items', 'addresses',
    'notifications', 'messages', 'loyalty_accounts',
    'loyalty_transactions', 'push_subscriptions',
    'user_carts', 'business_orders'
  )
ORDER BY tablename, policyname;
```

**Pattern atteso**: ogni tabella ha policy `USING (auth.uid() = user_id)` o equivalente.

---

### 1.4 Policy admin sono presenti (per gestione)

```sql
SELECT tablename, policyname, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND qual LIKE '%role = %admin%';
```

Verifica che le tabelle che richiedono admin (orders, disputes, audit_log, ecc.)
abbiano una policy admin.

---

## 2. SECURITY DEFINER functions audit

```sql
-- Lista tutte le funzioni SECURITY DEFINER
SELECT
  n.nspname AS schema,
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS args,
  p.prosecdef AS security_definer,
  pg_get_function_arguments(p.oid) AS arguments
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.prosecdef = true
ORDER BY p.proname;
```

**Per ognuna verifica**:

1. **`SET search_path`** deve essere presente (impedisce schema injection):
   ```sql
   SELECT proname, proconfig
   FROM pg_proc
   WHERE prosecdef = true
     AND pronamespace = 'public'::regnamespace
     AND (proconfig IS NULL OR NOT 'search_path=public' = ANY(proconfig));
   ```
   Atteso: 0 righe.

2. **EXECUTE permissions sono ristrette**:
   ```sql
   SELECT
     r.routine_name,
     g.grantee, g.privilege_type
   FROM information_schema.routines r
   JOIN information_schema.role_routine_grants g
     ON g.routine_name = r.routine_name
   WHERE r.routine_schema = 'public'
     AND r.security_type = 'DEFINER'
     AND g.grantee IN ('anon', 'authenticated', 'public', 'PUBLIC')
   ORDER BY r.routine_name;
   ```
   Atteso: GRANT esplicito solo dove necessario (es. `award_loyalty_points` no, `track_story_view` sì).

3. **Body review**: ogni SECURITY DEFINER deve validare `auth.uid()` se opera su dati utente.

---

## 3. Service Role Key check (client leak)

```bash
# Da terminale, dal root del repo
grep -rn "SERVICE_ROLE_KEY\|service_role" --include="*.tsx" --include="*.ts" \
  components/ app/components/ app/seller/ app/buyer/ app/rider/ \
  2>/dev/null | grep -v node_modules
```

**Atteso**: 0 righe. La chiave deve essere SOLO in `app/api/*` (server-side).

```bash
# Verifica anche nel bundle prodotto
npm run build
grep -r "SERVICE_ROLE_KEY" .next/static/ 2>/dev/null
```

**Atteso**: 0 righe.

---

## 4. Stripe webhook signature

```bash
grep -n "constructEvent\|stripe-signature" app/api/stripe/webhook/route.ts
```

**Atteso**: presente `stripe.webhooks.constructEvent(raw, sig, secret)`.

**Test manuale**: invia POST con body finto + signature inventata, deve dare 400.

---

## 5. CSP header attivo

```bash
curl -I https://mycity-marketplace.com | grep -i "content-security-policy"
```

**Atteso**: header presente con direttive complete (vedi `next.config.js`).

---

## 6. HTTPS + HSTS

```bash
curl -I https://mycity-marketplace.com | grep -i "strict-transport"
```

**Atteso**: `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`.

---

## 7. Rate limiting endpoint API

```bash
grep -rn "rateLimit\|rate.limit" lib/rate-limit.ts app/api/
```

**Verifica**: tutti gli endpoint pubblici con costo (LLM, email send, signup) usano rate limit.

Endpoint da verificare:
- ✅ `/api/ai/description` (20/giorno per utente)
- ✅ `/api/vision/extract-product` (10/5min)
- ⚠️ `/api/contact` (rate limit? verifica)
- ⚠️ Signup endpoint (Turnstile copre, OK)

---

## 8. npm audit (dependency vulnerabilities)

```bash
npm audit --production
```

**Atteso**: 0 high/critical vulnerabilities.

Fix: `npm audit fix` se safe, altrimenti `npm audit fix --force` con cura.

---

## 9. Cookies e PII

```bash
grep -rn "document.cookie" components/ app/ 2>/dev/null
```

**Atteso**: 0 (no cookie diretti, tutti via Supabase Auth managed).

---

## 10. Storage buckets RLS

```sql
-- Lista bucket
SELECT id, name, public FROM storage.buckets;

-- Policy bucket
SELECT bucket_id, name, definition
FROM storage.policies
ORDER BY bucket_id, name;
```

**Atteso**:
- `products`: public read, authenticated insert/update/delete own
- `stories`: public read, authenticated insert, owner delete
- `reviews`: public read, authenticated insert
- (eventuali altri private bucket per KYC: private, only owner + admin)

---

## 11. Auth.users access

```sql
-- Verifica chi può leggere auth.users
-- Solo service_role dovrebbe avere full access
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'auth'
  AND table_name = 'users';
```

**Atteso**: solo `postgres`, `service_role`, `supabase_auth_admin`.

---

## 12. Trigger su tabelle critiche

```sql
SELECT
  event_object_table,
  trigger_name,
  action_timing,
  event_manipulation
FROM information_schema.triggers
WHERE trigger_schema = 'public'
ORDER BY event_object_table, trigger_name;
```

**Verifica trigger attesi**:
- `orders` → `check_buyer_achievements_on_order`
- `profiles` (INSERT) → `enqueue_lifecycle_emails`
- `rider_sos_events` → `notify_admins_on_sos`
- etc.

---

## Schedule audit

| Frequenza | Cosa |
|---|---|
| Settimanale | npm audit, Sentry alerts review |
| Mensile | Sezioni 1, 2, 3 (RLS + SECURITY DEFINER + Service Role) |
| Trimestrale | Tutto + restore drill |
| Pre-feature critica | Sezione 1 + nuove migration |

---

## Audit log (storico)

| Data | Auditor | Sezione | Risultato | Note |
|---|---|---|---|---|
| TBD | Founder | 1-12 | Da eseguire | Baseline pre-launch |
