/**
 * Catalogo eventi PostHog — Single source of truth.
 *
 * Esperti consultati:
 * - Data Analyst: "Schema events centralizzato evita drift. Naming snake_case
 *   convenzionale PostHog. Properties tipizzate."
 * - Senior PM: "Funnel buyer = signup → view_product → add_to_cart →
 *   checkout_started → order_placed. Misura ogni step."
 *
 * Convention:
 * - Eventi in past tense: 'product_viewed', non 'view_product'
 * - Properties con prefisso entità: 'product_id', 'order_total_cents'
 */

import { track } from './posthog';

// Auth funnel
export const trackSignupCompleted = (userId: string, role: 'buyer' | 'seller' | 'rider' | 'admin') =>
  track('signup_completed', { user_id: userId, role });

export const trackSignedIn = (userId: string) =>
  track('signed_in', { user_id: userId });

export const trackSignedOut = () =>
  track('signed_out');

// Discovery funnel
export const trackProductViewed = (productId: string, props?: { price?: number; category?: string; seller_id?: string }) =>
  track('product_viewed', { product_id: productId, ...props });

export const trackStoreViewed = (sellerId: string) =>
  track('store_viewed', { seller_id: sellerId });

export const trackSearchPerformed = (query: string, resultCount: number) =>
  track('search_performed', { query, result_count: resultCount });

export const trackCategoryViewed = (slug: string) =>
  track('category_viewed', { category_slug: slug });

// Cart + checkout funnel
export const trackAddToCart = (productId: string, quantity: number, priceCents: number) =>
  track('add_to_cart', { product_id: productId, quantity, price_cents: priceCents });

export const trackRemoveFromCart = (productId: string) =>
  track('remove_from_cart', { product_id: productId });

export const trackCheckoutStarted = (totalCents: number, itemCount: number) =>
  track('checkout_started', { total_cents: totalCents, item_count: itemCount });

export const trackCouponApplied = (code: string, discountCents: number) =>
  track('coupon_applied', { code, discount_cents: discountCents });

export const trackOrderPlaced = (orderId: string, totalCents: number, paymentMethod: string, sellerId: string) =>
  track('order_placed', { order_id: orderId, total_cents: totalCents, payment_method: paymentMethod, seller_id: sellerId });

export const trackOrderCanceled = (orderId: string, reason?: string) =>
  track('order_canceled', { order_id: orderId, reason });

// Engagement
export const trackFavoriteAdded = (productId: string) =>
  track('favorite_added', { product_id: productId });

export const trackReviewSubmitted = (productId: string, rating: number, hasPhoto: boolean) =>
  track('review_submitted', { product_id: productId, rating, has_photo: hasPhoto });

export const trackReferralSent = (channel: 'whatsapp' | 'email' | 'copy_link') =>
  track('referral_sent', { channel });

export const trackShareCart = (channel: 'whatsapp' | 'email' | 'copy_link') =>
  track('cart_shared', { channel });

// Seller funnel
export const trackSellerOnboardingStarted = () =>
  track('seller_onboarding_started');

export const trackSellerOnboardingCompleted = () =>
  track('seller_onboarding_completed');

export const trackProductPublished = (productId: string, sellerId: string) =>
  track('product_published', { product_id: productId, seller_id: sellerId });

export const trackSellerOrderAccepted = (orderId: string) =>
  track('seller_order_accepted', { order_id: orderId });

// Rider funnel
export const trackRiderOrderAccepted = (orderId: string) =>
  track('rider_order_accepted', { order_id: orderId });

export const trackRiderDeliveryCompleted = (orderId: string, durationMinutes: number) =>
  track('rider_delivery_completed', { order_id: orderId, duration_minutes: durationMinutes });

// Errors (user-visible)
export const trackErrorShown = (code: string, message: string, page?: string) =>
  track('error_shown', { code, message, page });
