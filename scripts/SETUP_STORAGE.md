# Setup Supabase Storage

Le funzionalità introdotte dai 13 blocker richiedono **3 bucket** in
Supabase Storage. Crearli da Dashboard → Storage → "Create bucket"
con le impostazioni indicate.

## 1. `products` (pubblico — già esistente)

- **Public**: sì
- Usato per: immagini prodotti, logo store, foto reso buyer, foto
  consegna del rider, foto contanti COD.

## 2. `invoices` (privato — NUOVO)

- **Public**: no
- Usato per: PDF fatture generate da `/api/invoices/generate`.
- Accesso: solo via signed URL (lib gestisce createSignedUrl per 30 giorni).

```sql
-- Eseguire da SQL editor:
insert into storage.buckets (id, name, public)
values ('invoices', 'invoices', false)
on conflict (id) do nothing;
```

## 3. `kyc-docs` (privato — NUOVO)

- **Public**: no
- Usato per: documenti KYC seller/rider (id_front, id_back, selfie,
  rider_license, rider_insurance, rider_haccp).
- Accesso: solo via signed URL al provider KYC + admin review.

```sql
insert into storage.buckets (id, name, public)
values ('kyc-docs', 'kyc-docs', false)
on conflict (id) do nothing;
```

## Policy minime sui bucket privati

Per i bucket privati nessuna policy = nessun accesso utente (solo
service_role). Se vuoi permettere all'utente di leggere i propri:

```sql
-- Esempio: utente può leggere solo i propri file kyc-docs
create policy "users read own kyc"
  on storage.objects for select
  using (
    bucket_id = 'kyc-docs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
```

## Variabili d'ambiente

Tutte documentate in `.env.example`. Le minime da configurare in
produzione:

- `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` + `STRIPE_CONNECT_CLIENT_ID`
- `RESEND_API_KEY` + dominio verificato (DKIM/SPF/DMARC)
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY`
- `SDI_PROVIDER=fattureincloud` + `SDI_API_KEY` + `SDI_COMPANY_ID`
- `KYC_PROVIDER=onfido` + `KYC_API_KEY`
- `NEXT_PUBLIC_APP_URL` (URL pubblico produzione)

Senza queste, i moduli corrispondenti restano in modalità "skip"
(loggano un warning ma non bloccano la build).
