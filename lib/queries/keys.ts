/**
 * Le chiavi della cache del browser, in un posto solo: chi legge un dato e chi
 * lo fa rileggere devono guardare la stessa riga.
 *
 * Convenzione:
 *   - .all       → svuota un dominio intero (es. `queryKeys.orders.all`)
 *   - .detail(id) → il singolo elemento
 *
 * 30/8/2026 (R012) — QUI DENTRO C'ERANO CINQUANTADUE CHIAVI CHE NON USAVA
 * NESSUNO, E TRE COPPIE DI DOPPIONI.
 *
 * Il costo non era la memoria: era che chi apriva il file per capire quale
 * chiave usare ne trovava due plausibili — `health` accanto a `healthV2`,
 * `public` accanto a `publicV2` — e sceglieva a caso. E' esattamente cosi' che
 * nasce l'aggiornamento della cache che sbaglia bersaglio: il negoziante
 * modifica qualcosa, la pagina fa rileggere una chiave che non e' quella che
 * sta guardando, e continua a vedere il dato vecchio senza che nessuno abbia
 * sbagliato niente di visibile.
 *
 * Adesso ogni chiave definita qui e' usata da qualcuno, e una sola forma per
 * ogni cosa. A tenerlo vero e' `tests/unit/le-chiavi-della-cache-si-usano-tutte`,
 * che rilegge questo file e diventa rosso appena ne compare una che non serve a
 * nessuno.
 */

export const queryKeys = {
  orders: {
    all:                     ['orders'] as const,
    details:                 () => [...queryKeys.orders.all, 'detail'] as const,
    detail:  (id: string)    => [...queryKeys.orders.details(), id] as const,
    deliveryCode: (id: string) => ['delivery-code', id] as const,
    forReview: (id: string)  => ['order-for-review', id] as const,
  },

  products: {
    all:                     ['products'] as const,
    grid:    (filters: Record<string, unknown>) =>
                              [...queryKeys.products.all, filters] as const,
    ratings: (ids: string)   => ['products-ratings', ids] as const,
    // 22/8/2026 — i prodotti col voto minimo: filtro chiesto al database.
    conVotoAlmeno: (min: number) => ['products-voto-almeno', min] as const,
    detail:  (id: string)    => [...queryKeys.products.all, 'detail', id] as const,
    similar: (id: string, categoryId?: string | null, sellerId?: string | null) =>
                              [...queryKeys.products.all, 'similar', id, categoryId ?? null, sellerId ?? null] as const,
    boughtTogether: (id: string, sellerId?: string | null) =>
                              [...queryKeys.products.all, 'bought-together', id, sellerId ?? null] as const,
    activeDiscount: (id: string) => ['product-active-discount', id] as const,
    external: (id: string)   => ['product-external', id] as const,
  },

  stores: {
    all:                     ['stores'] as const,
    detail:  (id: string)    => [...queryKeys.stores.all, id] as const,
    sellerCard: (id: string) => [...queryKeys.stores.all, 'seller-card', id] as const,
    page:                    ['stores', 'page-v4'] as const,
    // 22/8/2026 — i negozi aperti adesso, chiesti al database invece che
    // dedotti nel browser da un campione di prodotti.
    apertiOra:               ['stores', 'aperti-ora'] as const,
    showcase:                ['stores', 'showcase-v2'] as const,
    // Il nome della chiave dice cosa e'; il valore resta quello che gia' gira
    // nei browser di chi ci usa, e non si tocca.
    vicini:                  ['near-stores-v2'] as const,
  },

  favorites: {
    all:                     ['favorites'] as const,
  },

  profile: {
    all:                     ['profile'] as const,
    me:                      ['profile', 'me'] as const,
    mine:                    ['profile', 'mine'] as const,
    /**
     * 27/8/2026 (R002) — QUESTA CHIAVE VIVEVA FUORI DAL SUO RAMO.
     *
     * Era `['auth-profile', uid]`, cioe' un albero tutto suo, mentre le pagine
     * che cambiano il profilo svuotavano `['profile','auth']`: due chiavi senza
     * radice in comune, quindi quelle svuotate non arrivavano mai qui e la
     * testata restava col nome e il logo vecchi. Ora sta sotto `['profile']`
     * come tutto il resto, e `invalidaProfiloDiChiEntrato` la prende.
     */
    authByUser: (uid: string) => ['profile', 'auth', uid] as const,
  },

  notifications: {
    count:                   ['notifications', 'count'] as const,
    list:                    ['notifications', 'list'] as const,
  },

  messages: {
    unreadByUser: (uid: string) => ['messages-unread', uid] as const,
    conversationByParam: (id: string) => ['conversation', id] as const,
    conversations:           ['conversations'] as const,
    conversationsByUser: (uid: string) => ['conversations', uid] as const,
    byParam: (id: string)    => ['messages', id] as const,
  },

  loyalty: {
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
    mine:                    ['my-referral'] as const,
    stats:   (code: string)  => ['referral-stats', code] as const,
    leaderboard:             ['referral-leaderboard'] as const,
  },

  admin: {
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

    audit:   (action?: string) => ['admin', 'audit', action ?? 'all'] as const,
    activity: (filters: Record<string, unknown> = {}) =>
                              ['admin', 'activity', filters] as const,
    activitySummary:         ['admin', 'activity', 'summary'] as const,
    events:                  ['admin', 'events'] as const,
    products:                ['admin', 'products'] as const,
    product: (id: string)    => ['admin', 'product', id] as const,
    sellersForm:             ['admin', 'sellers-form'] as const,
    support: (filter?: string) => ['admin', 'support', filter ?? 'all'] as const,
    sponsored: (filter?: string) => ['admin', 'sponsored', filter ?? 'all'] as const,
    shopOfMonth: (month: string) => ['admin', 'shop-of-month', month] as const,
    shopOfMonthLeaderboard:  ['admin', 'shop-of-month', 'leaderboard'] as const,
    approvedSellers:         ['admin', 'approved-sellers'] as const,
    coupons:                 ['admin', 'coupons'] as const,
    orders:                  ['admin', 'orders'] as const,
    disputes: (filter?: string) => ['admin', 'disputes', filter ?? 'all'] as const,
    codRemittances:          ['admin', 'cod-remittances'] as const,
  },

  seller: {
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
                              ['seller-onboarding-checklist', uid] as const,
    health:  (uid: string)   => ['seller-health', uid] as const,
    returnForOrder: (orderId: string) => ['seller', 'return', orderId] as const,
  },

  promotions: {
    active:                  ['promotions', 'active'] as const,
    home:                    ['promotions', 'home'] as const,
    byStore: (id: string)    => ['promotions', 'store', id] as const,
  },

  rider: {
    earnings:                ['rider', 'earnings'] as const,
    orders:                  ['rider', 'orders'] as const,
    pref:                    ['rider', 'pref'] as const,
    order:   (id: string)    => ['rider', 'order', id] as const,
    profile:                 ['rider', 'profile'] as const,
    history:                 ['rider', 'history'] as const,
    reviews:                 ['rider', 'reviews'] as const,
    ratingSummary:           ['rider', 'rating-summary'] as const,
    todayStats:              ['rider', 'today-stats'] as const,
  },

  qa: {
    product: (productId: string) => ['qa', productId] as const,
  },

  addresses: {
    all:                     ['addresses'] as const,
  },

  reviews: {
    detail:  (id: string)    => ['reviews', id] as const,
    store:   (id: string)    => ['reviews', 'store', id] as const,
  },

  events: {
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
    allList:                 ['all-categories'] as const,
    form:                    ['categories', 'form'] as const,
    bySlug:  (slug: string)  => ['category', slug] as const,
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
    allList:                 ['achievements-all'] as const,
    byUser:  (uid: string)   => ['achievements', uid] as const,
  },

  home: {
    dailyDrop:  (date: string) => ['daily-drop', date] as const,
    liveFeed:                ['live-feed'] as const,
    recentlyViewed: (uid: string) => ['recently-viewed', uid] as const,
    trendingNow:             ['home', 'trending-now'] as const,
  },

  lists: {
    all:                     ['lists'] as const,
    public:                  ['lists-public'] as const,
    inVetrina:               ['lists-featured'] as const,
    mine:                    ['lists', 'mine'] as const,
    mineMin:                 ['lists', 'mine-min'] as const,
    detail:  (id: string)    => ['lists', 'detail', id] as const,
    items:   (id: string)    => ['lists', 'items', id] as const,
    containing: (productId: string) => ['lists', 'containing', productId] as const,
  },
} as const;

/**
 * Svuota TUTTO quello che riguarda il profilo di chi ha fatto accesso.
 *
 * 27/8/2026 (R002) — La chiamavano in quattro (la richiesta da venditore, i
 * contatti del negozio, il profilo del fattorino, i dettagli del negozio) e
 * ognuna scriveva a mano la chiave da svuotare. Una sola sbagliata bastava a
 * lasciare in alto il nome vecchio, e non se ne accorgeva nessuno perché
 * svuotare una casella vuota non da' nessun errore. Adesso il punto e' uno solo:
 * se la chiave cambia, cambia qui, e cambia per tutti.
 */
export function invalidaProfiloDiChiEntrato(qc: {
  invalidateQueries: (filtro: { queryKey: readonly unknown[] }) => unknown;
}): void {
  qc.invalidateQueries({ queryKey: queryKeys.profile.all });
}
