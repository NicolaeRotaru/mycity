/**
 * Query keys factory — single source of truth per React Query cache keys.
 *
 * Esperti consultati:
 * - Staff Frontend Engineer: "Stringly-typed query keys = errori silenti.
 *   Factory pattern → TypeScript-safe, refactor-safe, autocomplete."
 * - Senior Code Reviewer: "Per invalidation, usa .all per blast intero domain
 *   (es. qc.invalidateQueries({ queryKey: queryKeys.orders.all }) invalida
 *   list + detail + byUser di un colpo)."
 *
 * Convenzione:
 *   - .all       → invalidation blast
 *   - .lists()   → tutte le list views
 *   - .list(filters) → specific list view
 *   - .details() → tutti i detail
 *   - .detail(id) → specific detail
 */

export const queryKeys = {
  orders: {
    all:                     ['orders'] as const,
    lists:                   () => [...queryKeys.orders.all, 'list'] as const,
    list:    (filters: { status?: string; sellerId?: string } = {}) =>
                              [...queryKeys.orders.lists(), filters] as const,
    details:                 () => [...queryKeys.orders.all, 'detail'] as const,
    detail:  (id: string)    => [...queryKeys.orders.details(), id] as const,
    sellerOrder: (id: string)=> [...queryKeys.orders.all, 'seller', id] as const,
    riderOrder:  (id: string)=> [...queryKeys.orders.all, 'rider', id] as const,
    deliveryCode: (id: string) => ['delivery-code', id] as const,
    forReview: (id: string)  => ['order-for-review', id] as const,
  },

  products: {
    all:                     ['products'] as const,
    lists:                   () => [...queryKeys.products.all, 'list'] as const,
    list:    (filters: Record<string, unknown> = {}) =>
                              [...queryKeys.products.lists(), filters] as const,
    grid:    (filters: Record<string, unknown>) =>
                              [...queryKeys.products.all, filters] as const,
    ratings: (ids: string)   => ['products-ratings', ids] as const,
    detail:  (id: string)    => [...queryKeys.products.all, 'detail', id] as const,
    search:  (q: string, filters: Record<string, unknown> = {}) =>
                              [...queryKeys.products.all, 'search', q, filters] as const,
    similar: (id: string, categoryId?: string | null, sellerId?: string | null) =>
                              [...queryKeys.products.all, 'similar', id, categoryId ?? null, sellerId ?? null] as const,
    activeDiscount: (id: string) => ['product-active-discount', id] as const,
  },

  stores: {
    all:                     ['stores'] as const,
    detail:  (id: string)    => [...queryKeys.stores.all, id] as const,
    nearby:  (lat: number, lng: number) =>
                              [...queryKeys.stores.all, 'nearby', lat, lng] as const,
    page:                    ['stores', 'page-v4'] as const,
    showcase:                ['stores', 'showcase-v2'] as const,
    nearV2:                  ['near-stores-v2'] as const,
  },

  cart: {
    all:                     ['cart'] as const,
    items:                   ['cart', 'items'] as const,
  },

  favorites: {
    all:                     ['favorites'] as const,
    set:                     ['favorites', 'set'] as const,
  },

  profile: {
    all:                     ['profile'] as const,
    me:                      ['profile', 'me'] as const,
    mine:                    ['profile', 'mine'] as const,
    byId:    (id: string)    => ['profile', 'detail', id] as const,
    auth:                    ['profile', 'auth'] as const,
    authByUser: (uid: string) => ['auth-profile', uid] as const,
  },

  notifications: {
    all:                     ['notifications'] as const,
    count:                   ['notifications', 'count'] as const,
    list:                    ['notifications', 'list'] as const,
  },

  messages: {
    all:                     ['messages'] as const,
    unread:                  ['messages', 'unread'] as const,
    unreadByUser: (uid: string) => ['messages-unread', uid] as const,
    conversation: (id: string) => ['messages', 'conversation', id] as const,
    conversationByParam: (id: string) => ['conversation', id] as const,
    conversations:           ['conversations'] as const,
    conversationsByUser: (uid: string) => ['conversations', uid] as const,
    byParam: (id: string)    => ['messages', id] as const,
  },

  loyalty: {
    all:                     ['loyalty'] as const,
    account:                 ['loyalty', 'account'] as const,
    transactions:            ['loyalty', 'transactions'] as const,
    accountByUser: (uid: string) => ['loyalty', 'account', uid] as const,
    txsByUser:     (uid: string) => ['loyalty', 'txs', uid] as const,
  },

  giftCards: {
    all:                     ['gift-cards'] as const,
    byUser:  (uid: string)   => ['gift-cards', uid] as const,
  },

  wallet: {
    all:                     ['wallet'] as const,
    byUser:  (uid: string)   => ['wallet', uid] as const,
  },

  referrals: {
    all:                     ['referrals'] as const,
    mine:                    ['my-referral'] as const,
    stats:   (code: string)  => ['referral-stats', code] as const,
    leaderboard:             ['referral-leaderboard'] as const,
  },

  admin: {
    all:                     ['admin'] as const,
    home:                    ['admin', 'home'] as const,
    branding:                ['admin', 'branding'] as const,
    dailyDrops:              ['admin', 'daily-drops'] as const,
    categories:              ['admin', 'categories'] as const,
    today:                   ['admin', 'today'] as const,
    stats:                   ['admin', 'stats'] as const,
    funnel:  (period: number)=> ['admin', 'funnel', period] as const,
    users:   (filters: Record<string, unknown> = {}) =>
                              ['admin', 'users', filters] as const,
    sos:                     ['admin', 'sos'] as const,
    disputes:                ['admin', 'disputes'] as const,
    audit:   (action?: string) => ['admin', 'audit', action ?? 'all'] as const,
    activity: (filters: Record<string, unknown> = {}) =>
                              ['admin', 'activity', filters] as const,
    activitySummary:         ['admin', 'activity', 'summary'] as const,
    events:                  ['admin', 'events'] as const,
    products:                ['admin', 'products'] as const,
    support: (filter?: string) => ['admin', 'support', filter ?? 'all'] as const,
    sponsored: (filter?: string) => ['admin', 'sponsored', filter ?? 'all'] as const,
    shopOfMonth: (month: string) => ['admin', 'shop-of-month', month] as const,
    shopOfMonthLeaderboard:  ['admin', 'shop-of-month', 'leaderboard'] as const,
    approvedSellers:         ['admin', 'approved-sellers'] as const,
    cashback:                ['admin', 'cashback'] as const,
    coupons:                 ['admin', 'coupons'] as const,
    orders:                  ['admin', 'orders'] as const,
    disputes2: (filter?: string) => ['admin', 'disputes', filter ?? 'all'] as const,
  },

  seller: {
    all:                     ['seller'] as const,
    stats:                   ['seller', 'stats'] as const,
    products:                ['seller', 'products'] as const,
    product: (id: string)    => ['seller', 'product', id] as const,
    orders:                  ['seller', 'orders'] as const,
    order:   (id: string)    => ['seller', 'order', id] as const,
    customers:               ['seller', 'customers'] as const,
    earnings:                ['seller', 'earnings'] as const,
    stripeStatus:            ['seller', 'stripe-status'] as const,
    profile:                 ['seller', 'profile'] as const,
    promotions:              ['seller', 'promotions'] as const,
    promotionsByUser: (uid: string) => ['seller', 'promotions', uid] as const,
    analytics: (uid: string) => ['seller', 'analytics', uid] as const,
    reviews:                 ['seller', 'reviews'] as const,
    pickupCode: (orderId: string) => ['seller', 'pickup-code', orderId] as const,
    myStories:               ['seller', 'my-stories'] as const,
    storiesActive:           ['seller', 'stories', 'active'] as const,
    onboardingChecklist: (uid: string) =>
                              ['seller', 'onboarding', uid] as const,
    onboardingChecklistV2: (uid: string) =>
                              ['seller-onboarding-checklist', uid] as const,
    health:  (uid: string)   => ['seller', 'health', uid] as const,
    healthV2: (uid: string)  => ['seller-health', uid] as const,
    returnForOrder: (orderId: string) => ['seller', 'return', orderId] as const,
  },

  promotions: {
    all:                     ['promotions'] as const,
    active:                  ['promotions', 'active'] as const,
    home:                    ['promotions', 'home'] as const,
    byStore: (id: string)    => ['promotions', 'store', id] as const,
  },

  rider: {
    all:                     ['rider'] as const,
    availability:            ['rider', 'availability'] as const,
    earnings:                ['rider', 'earnings'] as const,
    orders:                  ['rider', 'orders'] as const,
    pref:                    ['rider', 'pref'] as const,
    activeOrder:             ['rider', 'active-order'] as const,
    order:   (id: string)    => ['rider', 'order', id] as const,
    profile:                 ['rider', 'profile'] as const,
    history:                 ['rider', 'history'] as const,
    reviews:                 ['rider', 'reviews'] as const,
  },

  groups: {
    all:                     ['groups'] as const,
    detail:  (id: string)    => ['groups', 'detail', id] as const,
    participation: (id: string) => ['groups', 'participation', id] as const,
    order:   (id: string)    => ['groups', 'order', id] as const,
    orders:                  ['group-orders'] as const,
  },

  qa: {
    all:                     ['qa'] as const,
    product: (productId: string) => ['qa', productId] as const,
  },

  addresses: {
    all:                     ['addresses'] as const,
    byUser:  (uid: string)   => ['addresses', uid] as const,
  },

  reviews: {
    all:                     ['reviews'] as const,
    detail:  (id: string)    => ['reviews', id] as const,
    store:   (id: string)    => ['reviews', 'store', id] as const,
  },

  events: {
    all:                     ['events'] as const,
    public:                  ['events', 'public'] as const,
    rsvpCounts:              ['events', 'rsvp-counts'] as const,
  },

  shopOfMonth: {
    current:                 ['shop-of-month', 'current'] as const,
    leaderboard:             ['shop-of-month', 'leaderboard'] as const,
    page:                    ['shop-of-month-page'] as const,
  },

  branding: {
    public:                  ['branding', 'public'] as const,
  },

  categories: {
    all:                     ['categories'] as const,
    showcase:                ['categories'] as const,
    allList:                 ['all-categories'] as const,
    top:                     ['categories', 'top'] as const,
    sub:     (id: string)    => ['categories', 'sub', id] as const,
    form:                    ['categories', 'form'] as const,
    bySlug:  (slug: string)  => ['category', slug] as const,
    avgPrice: (id: string)   => ['category-avg-price', id] as const,
  },

  search: {
    suggest: (q: string)     => ['search-suggest', q] as const,
  },

  checkout: {
    groups:  (key: string)   => ['checkout-groups', key] as const,
    authUser:                ['auth-user'] as const,
    userAddresses: (uid: string) => ['user-addresses', uid] as const,
  },

  sponsored: {
    placement: (placement: string, categorySlug?: string | null) =>
                              ['sponsored', placement, categorySlug ?? null] as const,
  },

  achievements: {
    all:                     ['achievements'] as const,
    allList:                 ['achievements-all'] as const,
    mine:                    ['achievements', 'mine'] as const,
    byUser:  (uid: string)   => ['achievements', uid] as const,
  },

  home: {
    all:                     ['home'] as const,
    stories:                 ['home', 'stories'] as const,
    shopOfMonth:             ['home', 'shop-of-month'] as const,
    drop:                    ['home', 'drop'] as const,
    storyOfDay: (date: string)=> ['home', 'story-of-day', date] as const,
    dailyStory: (date: string) => ['daily-story', date] as const,
    dailyDrop:  (date: string) => ['daily-drop', date] as const,
    liveFeed:                ['live-feed'] as const,
    recentlyViewed: (uid: string) => ['recently-viewed', uid] as const,
    trending:                ['home', 'trending'] as const,
    trendingNow:             ['home', 'trending-now'] as const,
    sponsored: (placement: string, categorySlug?: string) =>
                              ['home', 'sponsored', placement, categorySlug ?? null] as const,
  },

  lists: {
    all:                     ['lists'] as const,
    public:                  ['lists', 'public'] as const,
    publicV2:                ['lists-public'] as const,
    featured:                ['lists', 'featured'] as const,
    featuredV2:              ['lists-featured'] as const,
    mine:                    ['lists', 'mine'] as const,
    mineMin:                 ['lists', 'mine-min'] as const,
    detail:  (id: string)    => ['lists', 'detail', id] as const,
    items:   (id: string)    => ['lists', 'items', id] as const,
    containing: (productId: string) => ['lists', 'containing', productId] as const,
  },
} as const;
