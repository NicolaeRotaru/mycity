"use client";

// tests/unit/aiuti/finti/react-con-use.mjs
import { default as default2 } from "react";
import {
  Children,
  Component,
  Fragment,
  Profiler,
  PureComponent,
  StrictMode,
  Suspense,
  cloneElement,
  createContext,
  createElement,
  createRef,
  forwardRef,
  isValidElement,
  lazy,
  memo,
  startTransition,
  version,
  useCallback,
  useContext,
  useDebugValue,
  useDeferredValue,
  useEffect,
  useId,
  useImperativeHandle,
  useInsertionEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition
} from "react";

// tests/unit/aiuti/finti/next-link.mjs
var Link = forwardRef(function Link2(props, ref) {
  const { href, children, prefetch, replace, scroll, shallow, locale, ...resto } = props;
  void prefetch;
  void replace;
  void scroll;
  void shallow;
  void locale;
  return createElement("a", { ref, href: typeof href === "string" ? href : String(href ?? ""), ...resto }, children);
});
var next_link_default = Link;

// components/PromoTicker.tsx
import { Pause, Play, Tag as Tag2 } from "lucide-react";

// tests/unit/aiuti/finti/react-query.mjs
function useQuery(opzioni) {
  if (Array.isArray(globalThis.__OPZIONI_QUERY__)) globalThis.__OPZIONI_QUERY__.push(opzioni);
  const sorgente = globalThis.__DATI_QUERY__;
  const data = typeof sorgente === "function" ? sorgente(opzioni) : sorgente;
  const base = {
    data,
    isLoading: false,
    isPending: false,
    isError: false,
    isSuccess: true,
    error: null,
    refetch: () => Promise.resolve({ data })
  };
  const guasto = globalThis.__ESITO_QUERY__;
  const sopra = typeof guasto === "function" ? guasto(opzioni) : guasto;
  return sopra ? { ...base, ...sopra } : base;
}

// tests/unit/aiuti/finti/supabase-client.mjs
var catena = (tavola) => {
  const c = {};
  let colonne = "";
  const passa = () => c;
  for (const m of ["insert", "update", "upsert", "delete", "eq", "neq", "in", "or", "ilike", "gte", "lte", "order", "limit", "range", "is", "not", "contains", "overlaps", "filter", "match"]) {
    c[m] = passa;
  }
  c.select = (cols) => {
    colonne = cols ?? "";
    return c;
  };
  const risposta = () => {
    const detta = globalThis.__RISPOSTA_SUPABASE__;
    const esito = typeof detta === "function" ? detta({ tavola, colonne }) : detta;
    return esito ?? { data: [], error: null };
  };
  c.single = async () => {
    const r = risposta();
    return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error ?? null };
  };
  c.maybeSingle = c.single;
  c.then = (risolvi) => Promise.resolve(risposta()).then(risolvi);
  return c;
};
var clientDellaProva = () => globalThis.__CLIENT_SUPABASE__;
var portaAuth = (nome, ripiego) => async (...argomenti) => {
  const finta = globalThis.__AUTH_FINTA__?.[nome];
  if (typeof finta === "function") return finta(...argomenti);
  return ripiego;
};
var NESSUNO = { data: { user: null, session: null }, error: null };
var supabase = {
  from: (tavola) => clientDellaProva() ? clientDellaProva().from(tavola) : catena(tavola),
  rpc: async (nome, argomenti) => clientDellaProva()?.rpc ? clientDellaProva().rpc(nome, argomenti) : { data: null, error: null },
  auth: {
    // Chi è collegato lo decide la prova, con `globalThis.__UTENTE__`.
    getUser: async () => ({ data: { user: globalThis.__UTENTE__ ?? null }, error: null }),
    // Il gettone della sessione lo decide la prova con `globalThis.__GETTONE__`
    // (15/10/2026): chi non lo imposta ha la sessione di prima, senza gettone, e
    // i componenti che lo pretendono si fermano su «Sessione scaduta» come prima.
    getSession: async () => ({
      data: {
        session: globalThis.__UTENTE__ ? { user: globalThis.__UTENTE__, access_token: globalThis.__GETTONE__ } : null
      },
      error: null
    }),
    /**
     * Chi ascolta i cambi di sessione si registra qui. La prova che vuole
     * provare cosa succede a un'uscita richiama gli ascolti a mano:
     * `globalThis.__ASCOLTI_AUTH__.forEach((a) => a('SIGNED_OUT', null))`.
     * Chi non li guarda non si accorge di niente.
     */
    onAuthStateChange: (ascolto) => {
      if (typeof ascolto === "function") {
        (globalThis.__ASCOLTI_AUTH__ ??= []).push(ascolto);
      }
      return { data: { subscription: { unsubscribe() {
      } } } };
    },
    signOut: portaAuth("signOut", { error: null }),
    signUp: portaAuth("signUp", NESSUNO),
    signInWithPassword: portaAuth("signInWithPassword", NESSUNO),
    resend: portaAuth("resend", NESSUNO),
    setSession: portaAuth("setSession", NESSUNO),
    resetPasswordForEmail: portaAuth("resetPasswordForEmail", { data: {}, error: null }),
    updateUser: portaAuth("updateUser", NESSUNO),
    exchangeCodeForSession: portaAuth("exchangeCodeForSession", NESSUNO)
  },
  channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}), unsubscribe: () => {
  } }),
  removeChannel: () => {
  },
  storage: {
    // L'indirizzo pubblico di una foto caricata lo decide la prova con
    // `globalThis.__URL_PUBBLICO__` (una funzione del percorso). Senza, resta
    // vuoto come prima (15/10/2026).
    from: () => ({
      getPublicUrl: (percorso) => ({
        data: {
          publicUrl: typeof globalThis.__URL_PUBBLICO__ === "function" ? globalThis.__URL_PUBBLICO__(percorso) : ""
        }
      }),
      upload: async () => ({ data: null, error: null })
    })
  }
};

// lib/queries/keys.ts
var queryKeys = {
  orders: {
    all: ["orders"],
    details: () => [...queryKeys.orders.all, "detail"],
    detail: (id) => [...queryKeys.orders.details(), id],
    deliveryCode: (id) => ["delivery-code", id],
    forReview: (id) => ["order-for-review", id]
  },
  products: {
    all: ["products"],
    grid: (filters) => [...queryKeys.products.all, filters],
    ratings: (ids) => ["products-ratings", ids],
    // 22/8/2026 — i prodotti col voto minimo: filtro chiesto al database.
    conVotoAlmeno: (min) => ["products-voto-almeno", min],
    detail: (id) => [...queryKeys.products.all, "detail", id],
    similar: (id, categoryId, sellerId) => [...queryKeys.products.all, "similar", id, categoryId ?? null, sellerId ?? null],
    boughtTogether: (id, sellerId) => [...queryKeys.products.all, "bought-together", id, sellerId ?? null],
    activeDiscount: (id) => ["product-active-discount", id],
    external: (id) => ["product-external", id]
  },
  stores: {
    all: ["stores"],
    detail: (id) => [...queryKeys.stores.all, id],
    sellerCard: (id) => [...queryKeys.stores.all, "seller-card", id],
    page: ["stores", "page-v4"],
    // 22/8/2026 — i negozi aperti adesso, chiesti al database invece che
    // dedotti nel browser da un campione di prodotti.
    apertiOra: ["stores", "aperti-ora"],
    showcase: ["stores", "showcase-v2"],
    // Il nome della chiave dice cosa e'; il valore resta quello che gia' gira
    // nei browser di chi ci usa, e non si tocca.
    vicini: ["near-stores-v2"]
  },
  favorites: {
    all: ["favorites"]
  },
  profile: {
    all: ["profile"],
    me: ["profile", "me"],
    mine: ["profile", "mine"],
    /**
     * 27/8/2026 (R002) — QUESTA CHIAVE VIVEVA FUORI DAL SUO RAMO.
     *
     * Era `['auth-profile', uid]`, cioe' un albero tutto suo, mentre le pagine
     * che cambiano il profilo svuotavano `['profile','auth']`: due chiavi senza
     * radice in comune, quindi quelle svuotate non arrivavano mai qui e la
     * testata restava col nome e il logo vecchi. Ora sta sotto `['profile']`
     * come tutto il resto, e `invalidaProfiloDiChiEntrato` la prende.
     */
    authByUser: (uid) => ["profile", "auth", uid]
  },
  notifications: {
    count: ["notifications", "count"],
    list: ["notifications", "list"]
  },
  messages: {
    unreadByUser: (uid) => ["messages-unread", uid],
    conversationByParam: (id) => ["conversation", id],
    conversations: ["conversations"],
    conversationsByUser: (uid) => ["conversations", uid],
    byParam: (id) => ["messages", id],
    // Per persona: la risposta dice se QUESTO utente ha una chat con l'Assistenza, e la
    // memoria non si svuota all'uscita: su un telefono condiviso il secondo non eredita il primo.
    idAssistenza: (uid) => ["support-account", uid]
  },
  loyalty: {
    accountByUser: (uid) => ["loyalty", "account", uid],
    txsByUser: (uid) => ["loyalty", "txs", uid]
  },
  giftCards: {
    all: ["gift-cards"],
    byUser: (uid) => ["gift-cards", uid]
  },
  wallet: {
    all: ["wallet"],
    byUser: (uid) => ["wallet", uid]
  },
  referrals: {
    mine: ["my-referral"],
    stats: (code) => ["referral-stats", code],
    leaderboard: ["referral-leaderboard"]
  },
  admin: {
    home: ["admin", "home"],
    branding: ["admin", "branding"],
    dailyDrops: ["admin", "daily-drops"],
    categories: ["admin", "categories"],
    today: ["admin", "today"],
    stats: ["admin", "stats"],
    funnel: (period) => ["admin", "funnel", period],
    users: (filters = {}) => ["admin", "users", filters],
    sos: ["admin", "sos"],
    audit: (action) => ["admin", "audit", action ?? "all"],
    activity: (filters = {}) => ["admin", "activity", filters],
    activitySummary: ["admin", "activity", "summary"],
    events: ["admin", "events"],
    products: ["admin", "products"],
    product: (id) => ["admin", "product", id],
    sellersForm: ["admin", "sellers-form"],
    support: (filter) => ["admin", "support", filter ?? "all"],
    sponsored: (filter) => ["admin", "sponsored", filter ?? "all"],
    shopOfMonth: (month) => ["admin", "shop-of-month", month],
    shopOfMonthLeaderboard: ["admin", "shop-of-month", "leaderboard"],
    approvedSellers: ["admin", "approved-sellers"],
    coupons: ["admin", "coupons"],
    orders: ["admin", "orders"],
    rimborsiDaDividere: ["admin", "rimborsi-da-dividere"],
    disputes: (filter) => ["admin", "disputes", filter ?? "all"],
    codRemittances: ["admin", "cod-remittances"]
  },
  seller: {
    stats: ["seller", "stats"],
    products: ["seller", "products"],
    product: (id) => ["seller", "product", id],
    orders: ["seller", "orders"],
    order: (id) => ["seller", "order", id],
    customers: ["seller", "customers"],
    earnings: ["seller", "earnings"],
    stripeStatus: ["seller", "stripe-status"],
    profile: ["seller", "profile"],
    promotions: ["seller", "promotions"],
    promotionsByUser: (uid) => ["seller", "promotions", uid],
    analytics: (uid) => ["seller", "analytics", uid],
    reviews: ["seller", "reviews"],
    pickupCode: (orderId) => ["seller", "pickup-code", orderId],
    myStories: ["seller", "my-stories"],
    storiesActive: ["seller", "stories", "active"],
    onboardingChecklist: (uid) => ["seller-onboarding-checklist", uid],
    health: (uid) => ["seller-health", uid],
    returnForOrder: (orderId) => ["seller", "return", orderId]
  },
  promotions: {
    active: ["promotions", "active"],
    home: ["promotions", "home"],
    byStore: (id) => ["promotions", "store", id]
  },
  rider: {
    earnings: ["rider", "earnings"],
    orders: ["rider", "orders"],
    pref: ["rider", "pref"],
    order: (id) => ["rider", "order", id],
    profile: ["rider", "profile"],
    history: ["rider", "history"],
    reviews: ["rider", "reviews"],
    ratingSummary: ["rider", "rating-summary"],
    todayStats: ["rider", "today-stats"]
  },
  qa: {
    product: (productId) => ["qa", productId]
  },
  addresses: {
    all: ["addresses"]
  },
  reviews: {
    detail: (id) => ["reviews", id],
    store: (id) => ["reviews", "store", id]
  },
  events: {
    public: ["events", "public"],
    rsvpCounts: ["events", "rsvp-counts"]
  },
  shopOfMonth: {
    current: ["shop-of-month", "current"],
    leaderboard: ["shop-of-month", "leaderboard"],
    page: ["shop-of-month-page"]
  },
  branding: {
    public: ["branding", "public"]
  },
  categories: {
    all: ["categories"],
    allList: ["all-categories"],
    form: ["categories", "form"],
    bySlug: (slug) => ["category", slug]
  },
  search: {
    suggest: (q) => ["search-suggest", q]
  },
  checkout: {
    groups: (key) => ["checkout-groups", key],
    authUser: ["auth-user"],
    userAddresses: (uid) => ["user-addresses", uid]
  },
  sponsored: {
    placement: (placement, categorySlug) => ["sponsored", placement, categorySlug ?? null]
  },
  achievements: {
    allList: ["achievements-all"],
    byUser: (uid) => ["achievements", uid]
  },
  home: {
    dailyDrop: (date) => ["daily-drop", date],
    liveFeed: ["live-feed"],
    recentlyViewed: (uid) => ["recently-viewed", uid],
    trendingNow: ["home", "trending-now"]
  },
  lists: {
    all: ["lists"],
    public: ["lists-public"],
    inVetrina: ["lists-featured"],
    mine: ["lists", "mine"],
    mineMin: ["lists", "mine-min"],
    detail: (id) => ["lists", "detail", id],
    items: (id) => ["lists", "items", id],
    containing: (productId) => ["lists", "containing", productId]
  }
};

// lib/delivery.ts
var EXPRESS_ETA_MIN = 30;
var EXPRESS_ETA_MAX = 60;
var EXPRESS_ETA_LABEL = `${EXPRESS_ETA_MIN}-${EXPRESS_ETA_MAX} min`;

// lib/quando-arriva.ts
var ORARI_DELLE_FASCE = [
  { orario: "7:30\u20139:00", daMinuti: 7 * 60 + 30, aMinuti: 9 * 60 },
  { orario: "9:00\u201311:00", daMinuti: 9 * 60, aMinuti: 11 * 60 },
  { orario: "11:00\u201313:00", daMinuti: 11 * 60, aMinuti: 13 * 60 },
  { orario: "13:00\u201316:30", daMinuti: 13 * 60, aMinuti: 16 * 60 + 30 },
  { orario: "16:30\u201318:00", daMinuti: 16 * 60 + 30, aMinuti: 18 * 60 },
  { orario: "18:00\u201319:30", daMinuti: 18 * 60, aMinuti: 19 * 60 + 30 },
  { orario: "19:30\u201321:00", daMinuti: 19 * 60 + 30, aMinuti: 21 * 60 }
];
var FASCE_DI_OGGI = ORARI_DELLE_FASCE.map((f) => ({
  etichetta: `Oggi \xB7 ${f.orario}`,
  daMinuti: f.daMinuti,
  aMinuti: f.aMinuti,
  oraDiFine: f.aMinuti / 60
}));
var FASCE_DI_DOMANI = ORARI_DELLE_FASCE.map((f) => `Domani \xB7 ${f.orario}`);
var FASCE_DI_PRIMA = [
  { etichetta: "In giornata \xB7 15:00\u201318:00", giorno: "oggi", daMinuti: 15 * 60, aMinuti: 18 * 60 },
  { etichetta: "Stasera \xB7 18:00\u201320:00", giorno: "oggi", daMinuti: 18 * 60, aMinuti: 20 * 60 },
  { etichetta: "Domani \xB7 9:00\u201312:00", giorno: "domani", daMinuti: 9 * 60, aMinuti: 12 * 60 },
  { etichetta: "Domani \xB7 12:00\u201315:00", giorno: "domani", daMinuti: 12 * 60, aMinuti: 15 * 60 },
  { etichetta: "Domani \xB7 15:00\u201318:30", giorno: "domani", daMinuti: 15 * 60, aMinuti: 18 * 60 + 30 },
  { etichetta: "Domani \xB7 18:30\u201320:00", giorno: "domani", daMinuti: 18 * 60 + 30, aMinuti: 20 * 60 }
];
var APERTURA_EXPRESS = 8;
var CHIUSURA_EXPRESS = 21;
var ETICHETTA_ADESSO = `Adesso \xB7 arrivo in ${EXPRESS_ETA_LABEL}`;
var FASCE_AMMESSE = [
  ETICHETTA_ADESSO,
  ...FASCE_DI_OGGI.map((f) => f.etichetta),
  ...FASCE_DI_DOMANI,
  ...FASCE_DI_PRIMA.map((f) => f.etichetta)
];

// lib/promessa-consegna.ts
var CONSEGNA_ALL_ORA_CHE_SCEGLI = "Consegna a casa, all'ora che scegli";
var VELOCE_IN_MINUTI = `veloce in ${EXPRESS_ETA_MIN}-${EXPRESS_ETA_MAX} minuti`;
var ORE_DELLA_VELOCE = `dalle ${APERTURA_EXPRESS} alle ${CHIUSURA_EXPRESS}`;
var QUANDO_SI_PUO_LA_VELOCE = `${ORE_DELLA_VELOCE}, a negozi aperti, con un fattorino in servizio`;
var CONSEGNA_O_VELOCE_ADESSO = `Consegna a casa all'ora che scegli, oppure ${VELOCE_IN_MINUTI}`;
var CONSEGNA_FRASE_INTERA = `${CONSEGNA_O_VELOCE_ADESSO}, ${QUANDO_SI_PUO_LA_VELOCE}`;

// lib/site-branding.ts
import { z } from "zod";
import {
  Banknote,
  Zap,
  MapPin,
  Truck,
  ShieldCheck,
  Tag,
  Sparkles,
  Gift,
  Heart,
  Check,
  Store,
  Clock
} from "lucide-react";
var WEDGE_ICON_KEYS = [
  "banknote",
  "zap",
  "mappin",
  "truck",
  "shield",
  "tag",
  "sparkles",
  "gift",
  "heart",
  "check",
  "store",
  "clock"
];
var WEDGE_ICONS = {
  banknote: Banknote,
  zap: Zap,
  mappin: MapPin,
  truck: Truck,
  shield: ShieldCheck,
  tag: Tag,
  sparkles: Sparkles,
  gift: Gift,
  heart: Heart,
  check: Check,
  store: Store,
  clock: Clock
};
function wedgeIcon(key) {
  return WEDGE_ICONS[key] ?? WEDGE_ICONS.tag;
}
var MAX_WEDGE_ITEMS = 5;
var wedgeItemSchema = z.object({
  icon: z.enum(WEDGE_ICON_KEYS),
  text: z.string().trim().min(1).max(60)
});
var brandingSchema = z.object({
  announcement: z.object({
    items: z.array(wedgeItemSchema).max(MAX_WEDGE_ITEMS).default([]),
    promoLinkEnabled: z.boolean().default(true)
  }).default({}),
  wordmark: z.object({
    accent: z.string().trim().max(20).default("My"),
    rest: z.string().trim().max(20).default("City")
  }).default({}),
  footerTagline: z.string().trim().max(220).default("")
}).default({});
var DEFAULT_WEDGE_ITEMS = [
  { icon: "banknote", text: "Paghi alla consegna" },
  // 29/10/2026 — Erano i minuti della veloce, promessi con un solo fattorino in attesa di approvazione: la
  // consegna normale arriva all'ora che sceglie il cliente, la veloce solo se c'è chi la fa.
  { icon: "zap", text: CONSEGNA_ALL_ORA_CHE_SCEGLI },
  { icon: "mappin", text: "Negozi veri di Piacenza" }
];
var DEFAULT_FOOTER_TAGLINE = `Il marketplace dei negozi di Piacenza. Compra dai commercianti locali. ${CONSEGNA_FRASE_INTERA}.`;
var DESCRIZIONE_DEL_SITO = `Compra online dai negozi di Piacenza: alimentari, casa, elettronica, libri. ${CONSEGNA_ALL_ORA_CHE_SCEGLI}, pagamento alla consegna.`;
function promessaSuperata(testo) {
  const t = testo.toLowerCase();
  if (/\babbigliamento\b/.test(t)) return "abbigliamento: al lancio non c'\xE8";
  if (/\b30\s*[-–]\s*60\s*min/.test(t) && !/\bveloce\b/.test(t)) {
    return "30-60 minuti promessi come certi, senza dire che sono la consegna veloce";
  }
  return null;
}
function scartaSeSuperata(campo, testo) {
  const motivo = promessaSuperata(testo);
  if (motivo) {
    console.error(`[site-branding] frase salvata scartata (${campo}): ${motivo} \u2014 \xAB${testo}\xBB`);
    return true;
  }
  return false;
}
function defaultBranding() {
  return {
    announcement: { items: DEFAULT_WEDGE_ITEMS.map((i) => ({ ...i })), promoLinkEnabled: true },
    wordmark: { accent: "My", rest: "City" },
    footerTagline: DEFAULT_FOOTER_TAGLINE
  };
}
function normalizeBranding(raw) {
  if (raw && typeof raw === "object" && Object.keys(raw).length > 0) {
    const parsed = brandingSchema.safeParse(raw);
    if (parsed.success) {
      const b = parsed.data;
      const items = b.announcement.items.filter((i) => !scartaSeSuperata("announcement", i.text));
      const tagline = b.footerTagline && !scartaSeSuperata("footerTagline", b.footerTagline) ? b.footerTagline : "";
      return {
        announcement: {
          items: items.length > 0 ? items : DEFAULT_WEDGE_ITEMS.map((i) => ({ ...i })),
          promoLinkEnabled: b.announcement.promoLinkEnabled
        },
        wordmark: { accent: b.wordmark.accent || "My", rest: b.wordmark.rest || "City" },
        footerTagline: tagline || DEFAULT_FOOTER_TAGLINE
      };
    }
  }
  return defaultBranding();
}

// components/hooks/useBranding.ts
function useBranding() {
  const { data } = useQuery({
    queryKey: queryKeys.branding.public,
    staleTime: 5 * 6e4,
    queryFn: async () => {
      const { data: data2, error } = await supabase.from("site_settings").select("branding").eq("id", 1).maybeSingle();
      if (error) throw error;
      return normalizeBranding(data2?.branding);
    }
  });
  return data ?? normalizeBranding(null);
}

// lib/queries/promo-attive.ts
async function ciSonoPromoAttive(supabase2, adesso = /* @__PURE__ */ new Date()) {
  const oraIso = adesso.toISOString();
  const { data } = await supabase2.from("seller_promotions").select("id").eq("status", "active").lte("starts_at", oraIso).gte("ends_at", oraIso).limit(1);
  return (data?.length ?? 0) > 0;
}

// components/PromoTicker.tsx
import { jsx, jsxs } from "react/jsx-runtime";
function PromoTicker() {
  const branding = useBranding();
  const [inPausa, setInPausa] = useState(false);
  const { data: hasPromo = false } = useQuery({
    queryKey: ["promotions", "active-any"],
    staleTime: 5 * 6e4,
    // 27/8/2026 (R084) — la domanda è da sì/no, e si chiedeva col conteggio esatto di TUTTE le
    // promozioni, su ogni pagina del sito. Ora si chiede una riga sola: `lib/queries/promo-attive.ts`.
    queryFn: () => ciSonoPromoAttive(supabase)
  });
  const showPromo = hasPromo && branding.announcement.promoLinkEnabled;
  const Track = ({ ariaHidden = false }) => /* @__PURE__ */ jsxs(
    "div",
    {
      "aria-hidden": ariaHidden || void 0,
      inert: ariaHidden || void 0,
      className: "flex shrink-0 items-center gap-x-8 px-4 sm:gap-x-10",
      children: [
        branding.announcement.items.map((it, i) => {
          const Icon = wedgeIcon(it.icon);
          return /* @__PURE__ */ jsxs("span", { className: "flex shrink-0 items-center gap-1.5", children: [
            /* @__PURE__ */ jsx(Icon, { size: 14, strokeWidth: 2.2, className: "text-accent-400" }),
            /* @__PURE__ */ jsx("span", { className: "font-medium", children: it.text })
          ] }, i);
        }),
        showPromo && /* @__PURE__ */ jsxs(
          next_link_default,
          {
            href: "/promozioni",
            className: "inline-flex shrink-0 items-center gap-1.5 rounded-full bg-accent-500 px-3 py-0.5 font-bold text-ink-900 transition-colors hover:bg-accent-400",
            children: [
              /* @__PURE__ */ jsx(Tag2, { size: 13, strokeWidth: 2.6 }),
              "Promozioni attive \xB7 Scopri"
            ]
          }
        )
      ]
    }
  );
  return /* @__PURE__ */ jsxs("div", { className: "relative flex items-center overflow-hidden border-b border-ink-800 bg-ink-900 text-xs text-ink-100 sm:text-sm", children: [
    /* @__PURE__ */ jsxs(
      "div",
      {
        "data-striscia": true,
        className: "animate-marquee flex w-max items-center whitespace-nowrap py-2",
        style: inPausa ? { animationPlayState: "paused" } : void 0,
        children: [
          /* @__PURE__ */ jsx(Track, {}),
          /* @__PURE__ */ jsx(Track, { ariaHidden: true })
        ]
      }
    ),
    /* @__PURE__ */ jsx(
      "button",
      {
        type: "button",
        onClick: () => setInPausa((p) => !p),
        "aria-label": inPausa ? "Riprendi la striscia degli annunci" : "Metti in pausa la striscia degli annunci",
        "aria-pressed": inPausa,
        className: "absolute right-0 top-0 flex h-full shrink-0 items-center bg-ink-900 px-2 text-ink-300 hover:text-ink-100",
        children: inPausa ? /* @__PURE__ */ jsx(Play, { size: 14, strokeWidth: 2.4, "aria-hidden": true }) : /* @__PURE__ */ jsx(Pause, { size: 14, strokeWidth: 2.4, "aria-hidden": true })
      }
    )
  ] });
}
export {
  PromoTicker as default
};
