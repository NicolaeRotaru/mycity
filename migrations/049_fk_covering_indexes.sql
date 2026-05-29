-- =============================================================================
-- 049 — Indici di copertura sulle foreign key non indicizzate
-- =============================================================================
-- L'advisor performance Supabase segnalava 46 foreign key senza indice di
-- copertura (JOIN e ON DELETE/UPDATE lenti, lock più ampi). Aggiungiamo un
-- indice b-tree per ciascuna. Additivo e idempotente (IF NOT EXISTS).
-- Colonne verificate una a una contro lo schema live prima di applicare.

CREATE INDEX IF NOT EXISTS idx_cashback_campaigns_target_category_id ON public.cashback_campaigns (target_category_id);
CREATE INDEX IF NOT EXISTS idx_cashback_redemptions_order_id ON public.cashback_redemptions (order_id);
CREATE INDEX IF NOT EXISTS idx_cashback_redemptions_user_id ON public.cashback_redemptions (user_id);
CREATE INDEX IF NOT EXISTS idx_categories_parent_id ON public.categories (parent_id);
CREATE INDEX IF NOT EXISTS idx_cod_reconciliations_reviewed_by ON public.cod_reconciliations (reviewed_by);
CREATE INDEX IF NOT EXISTS idx_contact_messages_handled_by ON public.contact_messages (handled_by);
CREATE INDEX IF NOT EXISTS idx_contact_messages_user_id ON public.contact_messages (user_id);
CREATE INDEX IF NOT EXISTS idx_daily_drops_product_id ON public.daily_drops (product_id);
CREATE INDEX IF NOT EXISTS idx_daily_stories_seller_id ON public.daily_stories (seller_id);
CREATE INDEX IF NOT EXISTS idx_disputes_against_id ON public.disputes (against_id);
CREATE INDEX IF NOT EXISTS idx_disputes_resolved_by ON public.disputes (resolved_by);
CREATE INDEX IF NOT EXISTS idx_email_queue_user_id ON public.email_queue (user_id);
CREATE INDEX IF NOT EXISTS idx_event_rsvps_event_id ON public.event_rsvps (event_id);
CREATE INDEX IF NOT EXISTS idx_favorites_product_id ON public.favorites (product_id);
CREATE INDEX IF NOT EXISTS idx_group_orders_organizer_id ON public.group_orders (organizer_id);
CREATE INDEX IF NOT EXISTS idx_group_orders_product_id ON public.group_orders (product_id);
CREATE INDEX IF NOT EXISTS idx_group_participants_user_id ON public.group_participants (user_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_events_sponsor_seller_id ON public.marketplace_events (sponsor_seller_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON public.messages (sender_id);
CREATE INDEX IF NOT EXISTS idx_newsletter_subscribers_user_id ON public.newsletter_subscribers (user_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON public.order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_orders_cash_collected_by ON public.orders (cash_collected_by);
CREATE INDEX IF NOT EXISTS idx_product_list_items_product_id ON public.product_list_items (product_id);
CREATE INDEX IF NOT EXISTS idx_product_questions_answered_by ON public.product_questions (answered_by);
CREATE INDEX IF NOT EXISTS idx_product_questions_author_id ON public.product_questions (author_id);
CREATE INDEX IF NOT EXISTS idx_product_views_user_id ON public.product_views (user_id);
CREATE INDEX IF NOT EXISTS idx_products_seller_id ON public.products (seller_id);
CREATE INDEX IF NOT EXISTS idx_profiles_approved_by ON public.profiles (approved_by);
CREATE INDEX IF NOT EXISTS idx_profiles_referred_by ON public.profiles (referred_by);
CREATE INDEX IF NOT EXISTS idx_recently_viewed_product_id ON public.recently_viewed (product_id);
CREATE INDEX IF NOT EXISTS idx_returns_decided_by ON public.returns (decided_by);
CREATE INDEX IF NOT EXISTS idx_returns_order_item_id ON public.returns (order_item_id);
CREATE INDEX IF NOT EXISTS idx_reviews_product_id ON public.reviews (product_id);
CREATE INDEX IF NOT EXISTS idx_reviews_user_id ON public.reviews (user_id);
CREATE INDEX IF NOT EXISTS idx_rider_reviews_user_id ON public.rider_reviews (user_id);
CREATE INDEX IF NOT EXISTS idx_rider_sos_events_handled_by ON public.rider_sos_events (handled_by);
CREATE INDEX IF NOT EXISTS idx_rider_sos_events_order_id ON public.rider_sos_events (order_id);
CREATE INDEX IF NOT EXISTS idx_seller_story_views_user_id ON public.seller_story_views (user_id);
CREATE INDEX IF NOT EXISTS idx_shop_of_month_selected_by ON public.shop_of_month (selected_by);
CREATE INDEX IF NOT EXISTS idx_shop_of_month_seller_id ON public.shop_of_month (seller_id);
CREATE INDEX IF NOT EXISTS idx_sponsored_listings_product_id ON public.sponsored_listings (product_id);
CREATE INDEX IF NOT EXISTS idx_sponsored_listings_seller_id ON public.sponsored_listings (seller_id);
CREATE INDEX IF NOT EXISTS idx_store_reviews_user_id ON public.store_reviews (user_id);
CREATE INDEX IF NOT EXISTS idx_subscription_orders_seller_id ON public.subscription_orders (seller_id);
CREATE INDEX IF NOT EXISTS idx_user_achievements_achievement_id ON public.user_achievements (achievement_id);
CREATE INDEX IF NOT EXISTS idx_zone_code_uses_code ON public.zone_code_uses (code);

NOTIFY pgrst, 'reload schema';
