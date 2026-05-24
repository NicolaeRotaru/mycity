-- =============================================================================
-- 025 — Stripe event log (idempotenza webhook)
-- =============================================================================
-- Salva tutti gli event.id processati dal webhook /api/stripe/webhook.
-- L'unique constraint su event_id garantisce idempotenza: una insert
-- duplicata fa fallire il webhook handler con 23505 (unique_violation),
-- che e' il segnale "evento gia' processato, esci subito".
-- =============================================================================

create table if not exists public.stripe_event_log (
  event_id     text primary key,
  type         text not null,
  processed_at timestamptz default now()
);

create index if not exists stripe_event_log_type_idx
  on public.stripe_event_log (type, processed_at desc);

alter table public.stripe_event_log enable row level security;

-- Solo service_role puo' scrivere/leggere. Nessuna policy = nessun accesso
-- via JWT utente.
