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
  },

  products: {
    all:                     ['products'] as const,
    lists:                   () => [...queryKeys.products.all, 'list'] as const,
    list:    (filters: Record<string, unknown> = {}) =>
                              [...queryKeys.products.lists(), filters] as const,
    detail:  (id: string)    => [...queryKeys.products.all, 'detail', id] as const,
    search:  (q: string, filters: Record<string, unknown> = {}) =>
                              [...queryKeys.products.all, 'search', q, filters] as const,
    similar: (id: string)    => [...queryKeys.products.all, 'similar', id] as const,
  },

  stores: {
    all:                     ['stores'] as const,
    detail:  (id: string)    => [...queryKeys.stores.all, id] as const,
    nearby:  (lat: number, lng: number) =>
                              [...queryKeys.stores.all, 'nearby', lat, lng] as const,
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
    byId:    (id: string)    => ['profile', 'detail', id] as const,
    auth:                    ['profile', 'auth'] as const,
  },

  notifications: {
    all:                     ['notifications'] as const,
    count:                   ['notifications', 'count'] as const,
    list:                    ['notifications', 'list'] as const,
  },

  messages: {
    all:                     ['messages'] as const,
    unread:                  ['messages', 'unread'] as const,
    conversation: (id: string) => ['messages', 'conversation', id] as const,
  },

  loyalty: {
    all:                     ['loyalty'] as const,
    account:                 ['loyalty', 'account'] as const,
    transactions:            ['loyalty', 'transactions'] as const,
  },

  achievements: {
    all:                     ['achievements'] as const,
    mine:                    ['achievements', 'mine'] as const,
  },

  admin: {
    all:                     ['admin'] as const,
    today:                   ['admin', 'today'] as const,
    funnel:  (period: number)=> ['admin', 'funnel', period] as const,
    users:   (filters: Record<string, unknown> = {}) =>
                              ['admin', 'users', filters] as const,
    sos:                     ['admin', 'sos'] as const,
    disputes:                ['admin', 'disputes'] as const,
  },

  seller: {
    all:                     ['seller'] as const,
    stats:                   ['seller', 'stats'] as const,
    products:                ['seller', 'products'] as const,
    onboardingChecklist: (uid: string) =>
                              ['seller', 'onboarding', uid] as const,
    health:  (uid: string)   => ['seller', 'health', uid] as const,
  },

  rider: {
    all:                     ['rider'] as const,
    availability:            ['rider', 'availability'] as const,
    earnings:                ['rider', 'earnings'] as const,
  },

  home: {
    all:                     ['home'] as const,
    stories:                 ['home', 'stories'] as const,
    shopOfMonth:             ['home', 'shop-of-month'] as const,
    drop:                    ['home', 'drop'] as const,
    storyOfDay: (date: string)=> ['home', 'story-of-day', date] as const,
    trending:                ['home', 'trending'] as const,
    sponsored: (placement: string, categorySlug?: string) =>
                              ['home', 'sponsored', placement, categorySlug ?? null] as const,
  },

  lists: {
    all:                     ['lists'] as const,
    public:                  ['lists', 'public'] as const,
    featured:                ['lists', 'featured'] as const,
    mine:                    ['lists', 'mine'] as const,
    detail:  (id: string)    => ['lists', 'detail', id] as const,
    items:   (id: string)    => ['lists', 'items', id] as const,
  },
} as const;
