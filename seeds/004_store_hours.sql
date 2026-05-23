-- Seed 003: orari di apertura per i negozi demo
--
-- Formato store_hours (jsonb):
--   { "mon": [["09:00","13:00"],["15:30","19:30"]], ..., "sun": [] }
--   Ogni giorno e' un array di intervalli [open, close]. Array vuoto = chiuso.
--
-- Tocca SOLO i seller demo (email @piacenza-demo.local). Idempotente.

DO $$
DECLARE
  -- Orari "standard negozio italiano": lun-sab 9-13 + 15:30-19:30, domenica chiuso
  hours_classic jsonb := '{
    "mon": [["09:00","13:00"],["15:30","19:30"]],
    "tue": [["09:00","13:00"],["15:30","19:30"]],
    "wed": [["09:00","13:00"],["15:30","19:30"]],
    "thu": [["09:00","13:00"],["15:30","19:30"]],
    "fri": [["09:00","13:00"],["15:30","19:30"]],
    "sat": [["09:00","13:00"],["15:30","19:30"]],
    "sun": []
  }'::jsonb;

  -- Orario continuato alimentari: lun-sab 7:30-20:00, dom 8-13
  hours_food jsonb := '{
    "mon": [["07:30","20:00"]],
    "tue": [["07:30","20:00"]],
    "wed": [["07:30","20:00"]],
    "thu": [["07:30","20:00"]],
    "fri": [["07:30","20:00"]],
    "sat": [["07:30","20:00"]],
    "sun": [["08:00","13:00"]]
  }'::jsonb;

  -- Orario boutique/abbigliamento: mar-sab 10-13 + 15:30-19:30, dom-lun chiusi
  hours_boutique jsonb := '{
    "mon": [],
    "tue": [["10:00","13:00"],["15:30","19:30"]],
    "wed": [["10:00","13:00"],["15:30","19:30"]],
    "thu": [["10:00","13:00"],["15:30","19:30"]],
    "fri": [["10:00","13:00"],["15:30","19:30"]],
    "sat": [["10:00","19:30"]],
    "sun": []
  }'::jsonb;

  -- Orario tech/elettronica: lun-sab 9:30-19:30 (continuato)
  hours_tech jsonb := '{
    "mon": [["09:30","19:30"]],
    "tue": [["09:30","19:30"]],
    "wed": [["09:30","19:30"]],
    "thu": [["09:30","19:30"]],
    "fri": [["09:30","19:30"]],
    "sat": [["09:30","19:30"]],
    "sun": []
  }'::jsonb;
BEGIN
  -- Alimentari: orario continuato 7 giorni
  UPDATE profiles SET store_hours = hours_food
   WHERE id IN (
     SELECT u.id FROM auth.users u
     WHERE u.email IN (
       'salumeria.borgo@piacenza-demo.local',
       'frutteto.verde@piacenza-demo.local'
     )
   );

  -- Abbigliamento e bellezza: orario boutique
  UPDATE profiles SET store_hours = hours_boutique
   WHERE id IN (
     SELECT u.id FROM auth.users u
     WHERE u.email IN (
       'boutique.eleganza@piacenza-demo.local',
       'stile.urbano@piacenza-demo.local',
       'bellezza.naturale@piacenza-demo.local',
       'profumeria.charme@piacenza-demo.local'
     )
   );

  -- Elettronica: orario continuato
  UPDATE profiles SET store_hours = hours_tech
   WHERE id IN (
     SELECT u.id FROM auth.users u
     WHERE u.email IN (
       'techzone.piacenza@piacenza-demo.local',
       'smart.store@piacenza-demo.local'
     )
   );

  -- Tutti gli altri demo: orario classico spezzato
  UPDATE profiles SET store_hours = hours_classic
   WHERE store_hours IS NULL
     AND id IN (
       SELECT u.id FROM auth.users u
       WHERE u.email LIKE '%@piacenza-demo.local'
     );
END $$;

NOTIFY pgrst, 'reload schema';
