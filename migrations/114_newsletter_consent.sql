-- Migrazione 114: double opt-in e prova del consenso per newsletter_subscribers
-- Aggiunge i campi necessari per GDPR Art.7 (prova del consenso) e double opt-in.
-- active=false al momento dell'iscrizione; confirmed_at si popola al click del link.

ALTER TABLE newsletter_subscribers
  ADD COLUMN IF NOT EXISTS confirmed_at       timestamptz,
  ADD COLUMN IF NOT EXISTS confirmation_token text UNIQUE,
  ADD COLUMN IF NOT EXISTS consent_ip         inet,
  ADD COLUMN IF NOT EXISTS consent_version    text DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS source             text DEFAULT 'website';

-- Indice per la lookup del token di conferma (endpoint /api/newsletter/confirm)
CREATE INDEX IF NOT EXISTS newsletter_subscribers_confirmation_token_idx
  ON newsletter_subscribers (confirmation_token)
  WHERE confirmation_token IS NOT NULL;
