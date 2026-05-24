-- =============================================================================
-- 024 — Blocker money / KYC / returns / cash reconciliation
-- =============================================================================
-- Aggiunge le colonne e tabelle che servono per:
--   B1 Pagamenti Stripe + Connect (split payment, escrow)
--   B2 Fatturazione SDI (numerazione, status, archivio)
--   B4 KYC seller (documenti caricati, esito provider)
--   B5 KYC rider (documenti caricati, assicurazione scadenze)
--  B12 Flusso reso (richiesta, evidence, stato, rimborso)
--  B13 Cash on delivery rider (importo conferma, foto, firma)
-- =============================================================================

-- ---------- ORDERS: campi Stripe / payout / invoice ----------
alter table public.orders
  add column if not exists stripe_session_id        text,
  add column if not exists stripe_payment_intent    text,
  add column if not exists stripe_charge_id         text,
  add column if not exists stripe_transfer_id       text,
  add column if not exists stripe_refund_id         text,
  add column if not exists payment_method           text,                -- 'card' | 'cod' | 'apple_pay' | 'google_pay'
  add column if not exists application_fee_cents    integer,             -- commissione marketplace
  add column if not exists seller_payout_cents      integer,             -- importo trasferito al seller
  add column if not exists payout_status            text default 'PENDING' check (payout_status in ('PENDING','HELD','TRANSFERRED','REFUNDED','FAILED')),
  add column if not exists payout_at                timestamptz,
  -- Cash on delivery rider
  add column if not exists cash_collected_cents     integer,
  add column if not exists cash_photo_url           text,
  add column if not exists cash_signature_url       text,
  add column if not exists cash_confirmed_at        timestamptz,
  add column if not exists cash_collected_by        uuid references auth.users(id) on delete set null,
  -- Proof of delivery
  add column if not exists delivery_photo_url       text,
  add column if not exists delivery_signature_url   text,
  -- Invoice
  add column if not exists invoice_number           text,
  add column if not exists invoice_pdf_url          text,
  add column if not exists invoice_sdi_status       text check (invoice_sdi_status in ('PENDING','SENT','ACCEPTED','REJECTED','NOT_REQUIRED')),
  add column if not exists invoice_sdi_id           text,
  add column if not exists invoice_issued_at        timestamptz;

create index if not exists orders_stripe_session_idx
  on public.orders (stripe_session_id) where stripe_session_id is not null;

create index if not exists orders_stripe_pi_idx
  on public.orders (stripe_payment_intent) where stripe_payment_intent is not null;

create index if not exists orders_invoice_number_idx
  on public.orders (invoice_number) where invoice_number is not null;

-- ---------- PROFILES: Stripe Connect + KYC docs ----------
alter table public.profiles
  add column if not exists stripe_account_id           text,                  -- acct_xxx
  add column if not exists stripe_charges_enabled      boolean default false,
  add column if not exists stripe_payouts_enabled      boolean default false,
  add column if not exists stripe_details_submitted    boolean default false,
  -- KYC documenti (URL su Supabase Storage private bucket)
  add column if not exists kyc_id_doc_front_url        text,
  add column if not exists kyc_id_doc_back_url         text,
  add column if not exists kyc_selfie_url              text,
  add column if not exists kyc_provider_check_id       text,
  add column if not exists kyc_provider_status         text check (kyc_provider_status in ('PENDING','APPROVED','REJECTED','EXPIRED')),
  add column if not exists kyc_provider_checked_at     timestamptz,
  -- Rider only
  add column if not exists rider_vehicle_type          text check (rider_vehicle_type in ('BIKE','EBIKE','SCOOTER','CAR')),
  add column if not exists rider_vehicle_plate         text,
  add column if not exists rider_license_url           text,
  add column if not exists rider_license_expires_on    date,
  add column if not exists rider_insurance_url         text,
  add column if not exists rider_insurance_expires_on  date,
  add column if not exists rider_haccp_url             text,
  add column if not exists rider_haccp_expires_on      date;

create index if not exists profiles_stripe_account_idx
  on public.profiles (stripe_account_id) where stripe_account_id is not null;

-- ---------- RETURNS: flusso reso completo ----------
create table if not exists public.returns (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.orders(id) on delete cascade,
  order_item_id   uuid references public.order_items(id) on delete set null,
  buyer_id        uuid not null references auth.users(id) on delete cascade,
  seller_id       uuid not null references auth.users(id) on delete cascade,
  reason          text not null check (reason in ('DAMAGED','WRONG_ITEM','NOT_AS_DESCRIBED','CHANGED_MIND','LATE','OTHER')),
  notes           text,
  photo_urls      jsonb default '[]'::jsonb,
  status          text not null default 'REQUESTED' check (status in ('REQUESTED','APPROVED','REJECTED','SHIPPED_BACK','RECEIVED','REFUNDED','CANCELED')),
  refund_amount_cents integer,
  refund_id       text,        -- id refund Stripe
  return_label_url text,
  tracking_number text,
  created_at      timestamptz default now(),
  decided_at      timestamptz,
  decided_by      uuid references auth.users(id) on delete set null,
  refunded_at     timestamptz,
  decision_notes  text
);

create index if not exists returns_buyer_idx    on public.returns (buyer_id, created_at desc);
create index if not exists returns_seller_idx   on public.returns (seller_id, created_at desc);
create index if not exists returns_order_idx    on public.returns (order_id);
create index if not exists returns_status_idx   on public.returns (status, created_at desc);

alter table public.returns enable row level security;

-- Buyer puo' leggere e creare i propri resi
create policy returns_buyer_read on public.returns
  for select using (auth.uid() = buyer_id);
create policy returns_buyer_insert on public.returns
  for insert with check (auth.uid() = buyer_id);

-- Seller vede i resi dei propri ordini
create policy returns_seller_read on public.returns
  for select using (auth.uid() = seller_id);

-- Admin
create policy returns_admin_all on public.returns
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------- COD AUDIT LOG: tracciamento incassi contanti ----------
create table if not exists public.cod_reconciliations (
  id              uuid primary key default gen_random_uuid(),
  rider_id        uuid not null references auth.users(id) on delete cascade,
  for_date        date not null,
  expected_cents  integer not null default 0,    -- somma totali ordini COD delivered quel giorno
  collected_cents integer not null default 0,    -- somma cash_collected_cents
  delta_cents     integer generated always as (collected_cents - expected_cents) stored,
  status          text not null default 'PENDING' check (status in ('PENDING','OK','MISMATCH','SETTLED')),
  notes           text,
  reviewed_by     uuid references auth.users(id) on delete set null,
  reviewed_at     timestamptz,
  created_at      timestamptz default now(),
  unique (rider_id, for_date)
);

create index if not exists cod_reconciliations_status_idx
  on public.cod_reconciliations (status, for_date desc);

alter table public.cod_reconciliations enable row level security;

create policy cod_rider_read on public.cod_reconciliations
  for select using (auth.uid() = rider_id);
create policy cod_admin_all on public.cod_reconciliations
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------- INVOICE SEQUENCE (numerazione progressiva fattura) ----------
create table if not exists public.invoice_sequences (
  seller_id   uuid primary key references auth.users(id) on delete cascade,
  year        integer not null,
  last_number integer not null default 0,
  updated_at  timestamptz default now()
);

alter table public.invoice_sequences enable row level security;

create policy inv_seq_admin_all on public.invoice_sequences
  for all using (public.is_admin()) with check (public.is_admin());

-- Allocazione numero fattura atomica: SELECT FOR UPDATE + bump
create or replace function public.next_invoice_number(p_seller uuid, p_year int)
returns text language plpgsql security definer as $$
declare
  v_n integer;
begin
  insert into public.invoice_sequences (seller_id, year, last_number)
    values (p_seller, p_year, 0)
    on conflict (seller_id) do update set updated_at = now();

  update public.invoice_sequences
     set last_number = case when year = p_year then last_number + 1 else 1 end,
         year = p_year,
         updated_at = now()
   where seller_id = p_seller
   returning last_number into v_n;

  return p_year::text || '/' || lpad(v_n::text, 6, '0');
end$$;

revoke all on function public.next_invoice_number(uuid, int) from public;
grant execute on function public.next_invoice_number(uuid, int) to service_role;
