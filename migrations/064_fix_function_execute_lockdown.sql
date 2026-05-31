-- 064: fix del lockdown EXECUTE (correzione di 062/063)
--
-- Le REVOKE ... FROM anon, authenticated di 062/063 erano inefficaci: le funzioni
-- hanno il grant EXECUTE di default a PUBLIC, che anon/authenticated ereditano.
-- Qui revochiamo da PUBLIC (oltre ad anon/authenticated) e ri-concediamo a
-- service_role le RPC chiamate dal backend. Le funzioni trigger NON necessitano di
-- alcun grant (i trigger eseguono nel contesto del proprietario).
-- Le RPC client (cancel_order, seller_reject_order, verify_*, track_story_view,
-- touch_loyalty_streak, get_referral_leaderboard) e is_admin restano invariate.
-- Idempotente.

DO $$
DECLARE
  fn text;
  -- Funzioni trigger: revoca totale, nessun grant (girano come owner).
  trigger_fns text[] := ARRAY[
    'auto_republish_on_restock()','award_photo_review_bonus()','cancel_lifecycle_on_first_order()',
    'check_achievements_on_review()','check_buyer_achievements_on_order()','check_referral_achievements()',
    'contact_messages_rate_limit()','create_order_verification_codes()','enforce_order_update_rules()',
    'enforce_profile_update_rules()','enqueue_lifecycle_emails()','handle_new_profile_welcome_bonus()',
    'handle_new_user()','newsletter_rate_limit()','notify_admins_on_sos()','notify_favorite_price_drop()',
    'notify_riders_on_accepted()','notify_riders_on_ready()','product_views_dedup()','reviews_set_verified()',
    'update_conversation_on_message()','update_group_quantity()','dispute_block_payout()'
  ];
  -- RPC server/cron-only: revoca da PUBLIC e grant a service_role.
  server_fns text[] := ARRAY[
    'award_loyalty_points(uuid,integer,text,uuid)','claim_pending_emails(integer)',
    'increment_coupon_usage(text)','list_abandoned_carts_to_recover(integer)',
    'mark_abandoned_cart_email_sent(uuid)','next_invoice_number(uuid,integer)',
    'process_expired_deletions()','unlock_achievement(uuid,text)',
    'reserve_stock(jsonb)','restore_stock(jsonb)','restore_stock_for_order(uuid)'
  ];
BEGIN
  FOREACH fn IN ARRAY trigger_fns LOOP
    BEGIN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
    EXCEPTION WHEN undefined_function THEN RAISE NOTICE 'skip: %', fn; END;
  END LOOP;

  FOREACH fn IN ARRAY server_fns LOOP
    BEGIN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
    EXCEPTION WHEN undefined_function THEN RAISE NOTICE 'skip: %', fn; END;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
