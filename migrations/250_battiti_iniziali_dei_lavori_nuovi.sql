-- 250_battiti_iniziali_dei_lavori_nuovi.sql
--
-- R01-019 (12/11/2026) — DOPO IL RILASCIO, UN LAVORO NUOVO RISULTAVA «MAI PARTITO».
--
-- La 095 ha seminato in cron_heartbeats una riga per ogni lavoro di allora, con
-- last_run_at = now(). I lavori nati dopo (external-price-alerts, riquadra-casse,
-- veloce-non-confermata) non hanno mai avuto la loro riga iniziale. Finche' non
-- battono il primo colpo, il sorvegliante (lib/cron-health.ts) li conta come
-- «mai partiti» e misura la finestra di prima accensione dal battito PIU' VECCHIO
-- che c'e' — quello di un lavoro giornaliero, che puo' avere piu' di 24 ore. Cosi'
-- subito dopo il rilascio partiva un falso allarme agli amministratori.
--
-- Qui si semina la riga iniziale come la 095: l'orologio di ogni lavoro parte dal
-- momento in cui questa migrazione si applica (il rilascio la applica prima di
-- pubblicare). Se poi il lavoro non parte davvero, la sua soglia normale lo
-- segnala. Una riga che esiste gia' non si tocca: un battito vero non si
-- sovrascrive.
--
-- Idempotente.

INSERT INTO public.cron_heartbeats (name, last_run_at) VALUES
  ('external-price-alerts', now()),
  ('riquadra-casse',        now()),
  ('veloce-non-confermata', now())
ON CONFLICT (name) DO NOTHING;
