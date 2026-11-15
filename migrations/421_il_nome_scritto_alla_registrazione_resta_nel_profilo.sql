-- Il nome scritto alla registrazione si perdeva e il profilo restava senza nome.
--
-- IL DIFETTO (R18-016). La pagina di registrazione mette il nome nei dati dell'account
-- (app/sign-up/page.tsx, `full_name` dentro `options.data`, cioe' auth.users.raw_user_meta_data).
-- L'ultima versione del grilletto handle_new_user (161, righe 97-118) scrive nel profilo solo id,
-- role, is_approved, approval_status e referral_code: il nome non entra mai, e nessun altro punto
-- lo copia. Ogni cliente iscritto con l'email ha il profilo senza nome: la testata lo saluta col
-- pezzo dell'email, il profilo dice «Il mio account», le email partono senza «Ciao Mario».
--
-- LA CURA, due pezzi nello stesso giro.
--   ① handle_new_user copia il nome: left(btrim(raw_user_meta_data->>'full_name'), 200), vuoto se
--     non c'e' o e' fatto solo di spazi. 200 e' la stessa misura che la cassa accetta per il nome
--     (app/api/orders/cod/route.ts e app/api/stripe/checkout/route.ts). Tutto il resto del
--     grilletto e' identico alla 161: chi sceglie negozio o fattorino nasce non approvato e
--     «in attesa», il controllo del rilascio cerca ancora 'pending'.
--   ② Il nome copiato finisce anche nella classifica degli inviti (get_referral_leaderboard, dietro
--     la vista referral_leaderboard). Il 5/11 la copia del nome era stata tolta proprio per questo:
--     prima si allinea la classifica, poi si copia. Qui la classifica da' solo il nome di
--     battesimo, come gli altri nomi che un utente vede di un altro (nomi_pubblici,
--     rider_reviews_ricevute). Stessa firma, stesse colonne, stessi permessi; la pagina della
--     classifica (spenta al lancio) mostra il nome come prima, senza l'iniziale del cognome.
--
-- I PROFILI GIA' NATI restano senza nome: recuperarli e' una scrittura sui dati veri, e la decide
-- Nicola. La domanda pronta (riempie solo i nomi vuoti, non tocca chi il nome l'ha gia' scritto):
--   UPDATE public.profiles p
--      SET full_name = left(btrim(u.raw_user_meta_data->>'full_name'), 200)
--     FROM auth.users u
--    WHERE u.id = p.id
--      AND coalesce(btrim(p.full_name), '') = ''
--      AND coalesce(btrim(u.raw_user_meta_data->>'full_name'), '') <> '';
-- (da lanciare con SET LOCAL mycity.allow_profile_write = '1' se il grilletto dei profili la ferma).
--
-- RITORNO INDIETRO: rieseguire handle_new_user della 161 (righe 97-118) e get_referral_leaderboard
-- della 048. Nessun dato viene toccato da questa migrazione.
--
-- LA PROVA: tests/sql/rls/riparazione-r18-nome-alla-registrazione.test.sql. Simula l'iscrizione
-- (una riga in auth.users coi dati dell'account, come fa Supabase) e guarda il profilo che nasce.

-- ① ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  role_choice text;
BEGIN
  role_choice := COALESCE(new.raw_user_meta_data ->> 'role', 'buyer');
  INSERT INTO public.profiles (id, role, is_approved, approval_status, referral_code, full_name)
  VALUES (
    new.id,
    CASE
      WHEN role_choice = 'seller' THEN 'seller'
      WHEN role_choice = 'rider'  THEN 'rider'
      ELSE 'buyer'
    END,
    false,
    'pending',
    upper(substr(md5(new.id::text), 1, 8)),
    NULLIF(left(btrim(new.raw_user_meta_data ->> 'full_name'), 200), '')
  );
  RETURN new;
END;
$function$;

-- ② ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_referral_leaderboard()
 RETURNS TABLE(user_id uuid, full_name text, store_name text, total_referrals bigint, converted_referrals bigint, month timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT
    p.id,
    NULLIF(split_part(btrim(coalesce(p.full_name, '')), ' ', 1), ''),
    p.store_name,
    count(r.id),
    count(r.id) FILTER (WHERE r.status = ANY (ARRAY['first_order', 'rewarded'])),
    date_trunc('month', now())
  FROM public.profiles p
  LEFT JOIN public.referrals r
    ON r.referrer_id = p.id
   AND r.created_at >= date_trunc('month', now())
  GROUP BY p.id, p.full_name, p.store_name
  HAVING count(r.id) > 0
  ORDER BY count(r.id) FILTER (WHERE r.status = ANY (ARRAY['first_order', 'rewarded'])) DESC,
           count(r.id) DESC
  LIMIT 50;
$function$;

NOTIFY pgrst, 'reload schema';
