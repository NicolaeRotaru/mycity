"use client";
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};

// tests/unit/aiuti/finti/supabase-client.mjs
var catena, clientDellaProva, portaAuth, NESSUNO, supabase;
var init_supabase_client = __esm({
  "tests/unit/aiuti/finti/supabase-client.mjs"() {
    catena = (tavola) => {
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
    clientDellaProva = () => globalThis.__CLIENT_SUPABASE__;
    portaAuth = (nome, ripiego) => async (...argomenti) => {
      const finta = globalThis.__AUTH_FINTA__?.[nome];
      if (typeof finta === "function") return finta(...argomenti);
      return ripiego;
    };
    NESSUNO = { data: { user: null, session: null }, error: null };
    supabase = {
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
  }
});

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

// tests/unit/aiuti/finti/next-image.mjs
function Image(props) {
  const { src, alt, fill, priority, quality, loader, placeholder, blurDataURL, sizes, unoptimized, ...resto } = props;
  void fill;
  void priority;
  void quality;
  void loader;
  void placeholder;
  void blurDataURL;
  void sizes;
  void unoptimized;
  return createElement("img", { src: typeof src === "string" ? src : "", alt, ...resto });
}
var next_image_default = Image;

// app/seller/products/page.tsx
import { Copy, EyeOff, Sparkles, Download, Plus, Pencil, SlidersHorizontal, X, Check as Check2, Package } from "lucide-react";

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
function useInfiniteQuery(opzioni) {
  const base = useQuery(opzioni);
  const pagina = Array.isArray(base.data) ? base.data : base.data == null ? [] : [base.data];
  return {
    ...base,
    data: { pages: [pagina], pageParams: [opzioni?.initialPageParam ?? 0] },
    fetchNextPage: () => Promise.resolve(),
    hasNextPage: false,
    isFetchingNextPage: false
  };
}
var useMutation = () => {
  const annota2 = (variabili) => {
    if (Array.isArray(globalThis.__MUTAZIONI__)) globalThis.__MUTAZIONI__.push(variabili);
  };
  return {
    mutate: (variabili) => annota2(variabili),
    mutateAsync: async (variabili) => annota2(variabili),
    isPending: false,
    isError: false,
    error: null
  };
};
var useQueryClient = () => ({
  invalidateQueries: () => {
  },
  setQueryData: (chiave, valore) => {
    if (Array.isArray(globalThis.__CACHE_SCRITTA__)) globalThis.__CACHE_SCRITTA__.push([chiave, valore]);
  },
  getQueryData: () => void 0,
  cancelQueries: async (filtro) => {
    if (Array.isArray(globalThis.__CACHE_SCRITTA__)) globalThis.__CACHE_SCRITTA__.push(["annulla", filtro?.queryKey]);
  }
});

// app/seller/products/page.tsx
init_supabase_client();
import { toast } from "sonner";

// lib/format.ts
var PREZZO_IT = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });
var formatPrice = (n) => PREZZO_IT.format(Number(n));

// lib/image-url.ts
var SIZE_PX = {
  thumb: 100,
  card: 400,
  detail: 800,
  hero: 1200
};
var LARGHEZZA_MASSIMA = 1600;
var NOMI_QUADRATI = ["thumb", "card"];
var QUALITY = 75;
function buildPexelsUrl(url, sizePx, ritaglia) {
  url.searchParams.set("w", String(sizePx));
  if (ritaglia) {
    url.searchParams.set("h", String(sizePx));
    url.searchParams.set("fit", "crop");
  }
  url.searchParams.set("auto", "compress");
  url.searchParams.set("cs", "tinysrgb");
  return url.toString();
}
function buildSupabaseStorageUrl(url, sizePx, square) {
  if (url.pathname.includes("/storage/v1/object/public/")) {
    url.pathname = url.pathname.replace(
      "/storage/v1/object/public/",
      "/storage/v1/render/image/public/"
    );
  }
  url.searchParams.set("width", String(sizePx));
  if (square) url.searchParams.set("height", String(sizePx));
  url.searchParams.set("quality", String(QUALITY));
  url.searchParams.set("resize", "cover");
  return url.toString();
}
function sizedImage(src, size, opzioni = {}) {
  if (!src) return "";
  if (src.startsWith("data:") || src.startsWith("blob:")) return src;
  const perNome = typeof size === "string";
  const sizePx = perNome ? SIZE_PX[size] : Math.min(LARGHEZZA_MASSIMA, Math.max(1, Math.ceil(size)));
  const square = opzioni.quadrato ?? (perNome ? NOMI_QUADRATI.includes(size) : false);
  try {
    const url = new URL(src);
    const host = url.hostname;
    if (host === "images.pexels.com") {
      return buildPexelsUrl(url, sizePx, opzioni.quadrato !== false);
    }
    if (host.endsWith(".supabase.co")) {
      return buildSupabaseStorageUrl(url, sizePx, square);
    }
    return src;
  } catch {
    return src;
  }
}

// messages/it.json
var it_default = {
  actions: {
    save: "Salva",
    saving: "Salvataggio\u2026",
    cancel: "Annulla",
    confirm: "Conferma",
    delete: "Elimina",
    edit: "Modifica",
    back: "Indietro",
    next: "Avanti",
    close: "Chiudi",
    retry: "Riprova",
    submit: "Invia",
    search: "Cerca",
    add: "Aggiungi",
    remove: "Rimuovi"
  },
  states: {
    loading: "Caricamento\u2026",
    saving: "Salvataggio\u2026",
    sending: "Invio\u2026",
    processing: "Elaborazione\u2026",
    noResults: "Nessun risultato",
    notFound: "Non trovato"
  },
  errors: {
    generic: "Qualcosa non ha funzionato. Riprova tra un momento.",
    network: "Problema di connessione. Controlla la rete.",
    unauthorized: "Devi accedere per continuare.",
    forbidden: "Non hai i permessi per questa azione.",
    rateLimit: "Troppe richieste. Aspetta qualche secondo.",
    sessionExpired: "La sessione \xE8 scaduta. Accedi di nuovo.",
    required: "Campo obbligatorio",
    invalidEmail: "Email non valida",
    invalidPhone: "Numero di telefono non valido",
    passwordShort: "Almeno 8 caratteri"
  },
  toasts: {
    saved: "Salvato.",
    deleted: "Eliminato.",
    sent: "Inviato.",
    copied: "Copiato negli appunti.",
    updated: "Aggiornato."
  },
  nav: {
    home: "Home",
    search: "Cerca",
    cart: "Carrello",
    orders: "Ordini",
    profile: "Profilo",
    signIn: "Accedi",
    signUp: "Registrati",
    signOut: "Esci",
    stores: "Negozi",
    messages: "Chat",
    me: "Tu",
    admin: "Admin",
    users: "Utenti",
    products: "Prodotti",
    history: "Storico",
    availability: "Online",
    addProduct: "Inserisci",
    surveillance: "Attivit\xE0",
    support: "Assistenza"
  },
  checkout: {
    title: "Checkout",
    addressTitle: "Indirizzo di consegna",
    paymentTitle: "Metodo di pagamento",
    summaryTitle: "Riepilogo ordine",
    payNow: "Paga ora",
    totalLabel: "Totale"
  },
  search: {
    filters: "Filtri",
    sortBy: "Ordina per",
    sortShort: "Ordina",
    category: "Categoria",
    allCategories: "Tutte le categorie",
    price: "Prezzo",
    minPrice: "Prezzo minimo",
    maxPrice: "Prezzo massimo",
    minRating: "Rating minimo",
    ratingAll: "Tutti",
    freeShipping: "Prodotti da 30 \u20AC in su",
    openNow: "Solo negozi aperti ora",
    promotion: "Solo in promozione",
    inStock: "Solo disponibili",
    reset: "Azzera",
    resetFilters: "Azzera filtri",
    showResults: "Mostra risultati",
    resultsFor: "Risultati per \xAB<hl>{q}</hl>\xBB",
    allProducts: "Tutti i prodotti",
    sortedBy: "Ordinato per {label}",
    countLine: "{count, plural, =0 {Nessun prodotto} one {# prodotto dai negozi di Piacenza} other {# prodotti dai negozi di Piacenza}}",
    activeFilters: "Filtri attivi",
    removeFilter: "Rimuovi filtro: {label}",
    clearAll: "Azzera tutto",
    noResultsTitle: "Nessun risultato per \xAB{q}\xBB",
    noResultsGeneric: "Nessun prodotto trovato",
    noResultsFiltered: "I filtri attivi sono troppo stretti. Prova ad allargarli.",
    noResultsDescription: "Non abbiamo trovato questo prodotto. Ecco alcune alternative dai negozi di Piacenza.",
    didYouMean: "Forse cercavi",
    alsoInteresting: "Potrebbe interessarti",
    filterPrice: "Fino a \u20AC{max}",
    filterPriceRange: "\u20AC{min} \u2013 \u20AC{max}",
    filterPriceMin: "Da \u20AC{min}",
    filterCategory: "Categoria: {name}",
    chip: {
      freeShipping: "Da 30 \u20AC in su",
      promotion: "In promozione",
      inStock: "Disponibili",
      openNow: "Aperti ora",
      minRating: "Rating {rating}+"
    },
    sort: {
      relevance: "Rilevanza",
      newest: "Pi\xF9 recenti",
      price_asc: "Prezzo crescente",
      price_desc: "Prezzo decrescente",
      rating: "Pi\xF9 recensiti",
      discount_desc: "Sconto maggiore"
    }
  },
  marketing: {
    tagline: "Il marketplace dei negozi di Piacenza",
    subTagline: "Compra dai negozi sotto casa, ricevi a domicilio.",
    becomeSeller: "Diventa venditore",
    explore: "Esplora i negozi"
  },
  forms: {
    uploadLogo: "Carica logo",
    uploadPhoto: "Carica",
    replacePhoto: "Sostituisci",
    uploading: "Caricamento\u2026",
    openDispute: "Apri reclamo",
    saveStore: "Salva negozio",
    saveAndStart: "Salva e avvia verifica",
    submitting: "Invio verifica\u2026",
    continue: "Continua",
    step3Label: "Conferma"
  },
  confirm: {
    yesSuspend: "S\xEC, sospendi",
    yesReactivate: "S\xEC, riattiva",
    yesDelete: "S\xEC, elimina",
    yesApprove: "S\xEC, approva",
    yesReject: "S\xEC, rifiuta"
  },
  admin: {
    sellerApproved: "Venditore approvato e notificato",
    requestRejected: "Richiesta rifiutata e notificata",
    storeReactivated: "Negozio riattivato",
    accountDeleted: "Account eliminato definitivamente",
    storeSuspended: "Negozio sospeso"
  },
  newsletter: {
    blurb: "Cosa c'\xE8 nel piatto a Piacenza \u2014 ricetta + storia di un negoziante + 3 offerte. Ogni venerd\xEC.",
    placeholder: "la-tua@email.it",
    subscribe: "Iscriviti",
    subscribed: "Ti abbiamo scritto: apri l'email e clicca il link per confermare l'iscrizione.",
    subscribedBox: "Controlla la posta: l'iscrizione si attiva col link che ti abbiamo mandato. Se non lo trovi, guarda nello spam."
  }
};

// tests/unit/aiuti/finti/next-intl.mjs
function dentro(percorso) {
  return percorso.split(".").reduce((n, p) => n && typeof n === "object" ? n[p] : void 0, it_default);
}
function useTranslations(spazio) {
  const t = (chiave) => {
    const valore = dentro(spazio ? `${spazio}.${chiave}` : chiave);
    return typeof valore === "string" ? valore : chiave;
  };
  t.rich = t;
  t.raw = t;
  return t;
}

// components/ConfirmDialog.tsx
import { AlertTriangle, Check } from "lucide-react";
import { jsx, jsxs } from "react/jsx-runtime";
var current = null;
var listeners = /* @__PURE__ */ new Set();
var notify = () => listeners.forEach((cb) => cb());
function confirmDialog(opts) {
  return new Promise((resolve) => {
    if (current) current.resolve(false);
    const opener = typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null;
    current = { ...opts, resolve, opener };
    notify();
  });
}

// components/ui/LoadingState.tsx
import { Loader2 } from "lucide-react";

// lib/cn.ts
function cn(...classes) {
  return classes.filter(Boolean).join(" ");
}

// components/ui/LoadingState.tsx
import { jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
function LoadingState({ variant = "spinner", message, description, rows = 3, cards = 8, className }) {
  const t = useTranslations("states");
  const msg = message ?? t("loading");
  if (variant === "inline") {
    return /* @__PURE__ */ jsxs2("span", { role: "status", "aria-live": "polite", className: cn("inline-flex items-center gap-2 text-sm text-ink-500", className), children: [
      /* @__PURE__ */ jsx2(Loader2, { size: 14, className: "animate-spin", "aria-hidden": true }),
      msg
    ] });
  }
  if (variant === "spinner") {
    return /* @__PURE__ */ jsxs2("div", { role: "status", "aria-live": "polite", className: cn("py-12 text-center", className), children: [
      /* @__PURE__ */ jsx2(Loader2, { size: 32, className: "animate-spin text-primary-700 mx-auto mb-2", strokeWidth: 2.2, "aria-hidden": true }),
      /* @__PURE__ */ jsx2("p", { className: "text-sm text-ink-500", children: msg })
    ] });
  }
  if (variant === "cards") {
    return /* @__PURE__ */ jsxs2("div", { role: "status", "aria-busy": "true", "aria-live": "polite", className: cn("text-center", className), children: [
      /* @__PURE__ */ jsx2(Loader2, { size: 40, className: "animate-spin text-primary-700 mx-auto mb-5", strokeWidth: 2.2, "aria-hidden": true }),
      /* @__PURE__ */ jsx2("h2", { className: "font-serif text-2xl font-bold text-ink-900 mb-1.5", children: msg }),
      description && /* @__PURE__ */ jsx2("p", { className: "text-base text-ink-600 mb-8", children: description }),
      /* @__PURE__ */ jsx2("div", { className: "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 text-left", children: Array.from({ length: cards }).map((_, i) => /* @__PURE__ */ jsxs2("div", { className: "bg-white border border-cream-300 rounded-2xl overflow-hidden", "aria-hidden": true, children: [
        /* @__PURE__ */ jsx2("div", { className: "skeleton aspect-square" }),
        /* @__PURE__ */ jsx2("div", { className: "skeleton h-3 rounded m-2.5" }),
        /* @__PURE__ */ jsx2("div", { className: "skeleton h-3 rounded m-2.5 w-1/2" })
      ] }, i)) })
    ] });
  }
  return /* @__PURE__ */ jsx2("div", { role: "status", "aria-live": "polite", "aria-label": msg, className: cn("space-y-3", className), children: Array.from({ length: rows }).map((_, i) => /* @__PURE__ */ jsx2(
    "div",
    {
      className: "skeleton h-4 rounded",
      style: { width: `${100 - i * 15}%` }
    },
    i
  )) });
}

// components/ui/ErrorState.tsx
import { AlertTriangle as AlertTriangle2, RotateCcw, ArrowLeft, LifeBuoy } from "lucide-react";

// components/ui/Button.tsx
import { Loader2 as Loader22 } from "lucide-react";
import { Fragment as Fragment2, jsx as jsx3, jsxs as jsxs3 } from "react/jsx-runtime";
var VARIANTS = {
  primary: "bg-primary-700 hover:bg-primary-800 text-white shadow-warm-sm",
  // CTA d'acquisto (mostarda): alta visibilità sul canvas neutro.
  accent: "bg-accent-400 hover:bg-accent-500 text-ink-900 shadow-sm hover:shadow-warm",
  secondary: "bg-white border border-cream-300 hover:bg-cream-50 text-ink-900",
  ghost: "text-primary-700 hover:bg-primary-50",
  danger: "bg-red-600 hover:bg-red-700 text-white",
  success: "bg-olive-600 hover:bg-olive-700 text-white"
};
var SIZES = {
  sm: "px-3 py-1.5 text-xs gap-1 min-h-[32px]",
  md: "px-4 py-2.5 text-sm gap-1.5 min-h-[44px]",
  lg: "px-5 py-3 text-base gap-2 min-h-[48px]"
};
var BASE = "inline-flex items-center justify-center font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2 disabled:bg-cream-200 disabled:text-ink-600 disabled:border-cream-300 disabled:shadow-none disabled:cursor-not-allowed";
var SHAPES = {
  rounded: "rounded",
  pill: "rounded-full"
};
var Button = forwardRef(function Button2({ variant = "primary", size = "md", shape = "rounded", loading = false, icon: Icon, iconRight: IconRight, fullWidth = false, className, children, ...rest }, ref) {
  const classes = cn(BASE, VARIANTS[variant], SIZES[size], SHAPES[shape], fullWidth && "w-full", className);
  const iconSize = size === "sm" ? 12 : size === "lg" ? 18 : 14;
  const content = /* @__PURE__ */ jsxs3(Fragment2, { children: [
    loading && /* @__PURE__ */ jsx3(Loader22, { size: iconSize, className: "animate-spin", "aria-hidden": true }),
    !loading && Icon && /* @__PURE__ */ jsx3(Icon, { size: iconSize, strokeWidth: 2.4, "aria-hidden": true }),
    children,
    !loading && IconRight && /* @__PURE__ */ jsx3(IconRight, { size: iconSize, strokeWidth: 2.4, "aria-hidden": true })
  ] });
  if ("href" in rest && rest.href) {
    const { href, target, rel } = rest;
    return /* @__PURE__ */ jsx3(next_link_default, { href, target, rel, className: classes, children: content });
  }
  const { disabled: disabledProp, type: typeProp, ...restButtonProps } = rest;
  return /* @__PURE__ */ jsx3(
    "button",
    {
      ref,
      type: typeProp ?? "button",
      "aria-busy": loading || void 0,
      disabled: disabledProp || loading,
      className: classes,
      ...restButtonProps,
      children: content
    }
  );
});

// components/ui/ErrorState.tsx
import { jsx as jsx4, jsxs as jsxs4 } from "react/jsx-runtime";
function ErrorState({
  title,
  description,
  retry,
  onRetry,
  backHref,
  backLabel,
  variant = "default",
  className = "",
  supportHref = "/faq",
  codiceErrore
}) {
  const riprova = retry ?? onRetry;
  const compatto = variant === "compact";
  const tErrors = useTranslations("errors");
  const tActions = useTranslations("actions");
  const _title = title ?? "Qualcosa \xE8 andato storto";
  const _desc = description ?? tErrors("generic");
  const _back = backLabel ?? tActions("back");
  return /* @__PURE__ */ jsxs4("div", { className: `${compatto ? "py-6" : "py-12"} px-4 text-center ${className}`, role: "alert", children: [
    /* @__PURE__ */ jsx4("div", { className: `mx-auto rounded-full bg-secondary-50 text-secondary-600 flex items-center justify-center mb-6 ${compatto ? "w-12 h-12" : "w-24 h-24"}`, children: /* @__PURE__ */ jsx4(AlertTriangle2, { size: compatto ? 22 : 42, strokeWidth: 1.8, "aria-hidden": true }) }),
    /* @__PURE__ */ jsx4("h2", { className: `font-serif font-bold text-ink-900 ${compatto ? "text-base" : "text-2xl"}`, children: _title }),
    /* @__PURE__ */ jsx4("p", { className: `text-ink-600 mt-2.5 max-w-md mx-auto leading-relaxed ${compatto ? "text-xs" : "text-base"}`, children: _desc }),
    /* @__PURE__ */ jsxs4("div", { className: "mt-4 flex items-center justify-center gap-2 flex-wrap", children: [
      riprova && /* @__PURE__ */ jsx4(Button, { onClick: riprova, icon: RotateCcw, variant: "primary", children: tActions("retry") }),
      backHref && /* @__PURE__ */ jsxs4(
        next_link_default,
        {
          href: backHref,
          className: "inline-flex items-center gap-1.5 bg-white border border-cream-300 hover:bg-cream-50 text-ink-700 px-4 py-2.5 rounded-lg font-semibold text-sm",
          children: [
            /* @__PURE__ */ jsx4(ArrowLeft, { size: 14, strokeWidth: 2.4, "aria-hidden": true }),
            _back
          ]
        }
      ),
      supportHref && /* @__PURE__ */ jsxs4(
        next_link_default,
        {
          href: supportHref,
          className: "inline-flex items-center gap-1.5 bg-white border border-cream-300 hover:bg-cream-50 text-ink-700 px-4 py-2.5 rounded-lg font-semibold text-sm",
          children: [
            /* @__PURE__ */ jsx4(LifeBuoy, { size: 14, strokeWidth: 2.4, "aria-hidden": true }),
            "Contatta il supporto"
          ]
        }
      )
    ] }),
    codiceErrore ? /* @__PURE__ */ jsxs4("p", { className: "mt-6 text-xs leading-relaxed text-ink-500", children: [
      "Codice errore:",
      " ",
      /* @__PURE__ */ jsx4("code", { className: "font-mono text-ink-700 select-all break-all", children: codiceErrore }),
      " \u2014 riportalo se ci scrivi."
    ] }) : null
  ] });
}

// lib/stato-vista.ts
function statoDellaVista(d) {
  const errore = d.errore !== void 0 && d.errore !== null && d.errore !== false;
  if (errore) {
    return {
      stato: "rotto",
      perche: "la lettura \xE8 fallita: non sappiamo cosa c'\xE8, e dirlo \xABvuoto\xBB sarebbe inventare",
      mostraScheletro: false,
      mostraVuoto: false,
      mostraErrore: true
    };
  }
  if (!d.letto || d.caricando) {
    return {
      stato: "carico",
      perche: d.caricando ? "la lettura \xE8 in corso" : "nessuno ha ancora letto: \xABvuoto\xBB sarebbe una risposta su una domanda mai fatta",
      mostraScheletro: true,
      mostraVuoto: false,
      mostraErrore: false
    };
  }
  const quanti = Number.isFinite(Number(d.quanti)) ? Math.max(0, Math.trunc(Number(d.quanti))) : 0;
  if (quanti === 0) {
    return {
      stato: "vuoto",
      perche: "letto, e non c'\xE8 niente",
      mostraScheletro: false,
      mostraVuoto: true,
      mostraErrore: false
    };
  }
  return { stato: "pieno", perche: `letto, ${quanti} element${quanti === 1 ? "o" : "i"}`, mostraScheletro: false, mostraVuoto: false, mostraErrore: false };
}

// lib/vista-query.ts
function quantiDi(dati) {
  if (dati === void 0 || dati === null) return 0;
  if (Array.isArray(dati)) return dati.length;
  return 1;
}
function vistaDaQuery(q, opzioni = {}) {
  const caricando = Boolean(q.isPending ?? q.isLoading);
  const haDato = q.data !== void 0 && q.data !== null;
  const verdetto = statoDellaVista({
    letto: haDato,
    caricando,
    // Un `isError` alzato senza oggetto errore è comunque un errore: la bandierina basta, e
    // pretendere anche l'oggetto lascerebbe passare proprio il caso che si vuole fermare.
    errore: q.isError ? q.error ?? true : void 0,
    quanti: opzioni.quanti ?? quantiDi(q.data)
  });
  return { ...verdetto, dati: q.data };
}

// components/ui/Card.tsx
import { jsx as jsx5 } from "react/jsx-runtime";
var VARIANTS2 = {
  bordered: "bg-white border border-cream-300",
  elevated: "bg-white border border-cream-300 shadow-warm",
  flat: "bg-cream-50",
  /**
   * 3/9/2026 — LA CARD DEL PERCORSO D'ACQUISTO, UNA SOLA.
   *
   * Nel checkout le tre card di sinistra erano `bordered` (bordo sabbia, angoli
   * da 12px, niente ombra) e il riepilogo di destra era scritto a mano
   * (`bg-white border border-surface-200 rounded-xl shadow-card`: bordo grigio,
   * 16px, con ombra). Le due colonne stanno nella stessa griglia e su computer
   * si vedono insieme: angoli diversi, bordi di due tinte, ombra su una sola,
   * nel punto in cui la persona decide se pagare. Adesso è una variante sola,
   * e chi la usa non riscrive più le classi a mano.
   */
  funnel: "bg-white border border-surface-200 shadow-card"
};
var PADDINGS = {
  none: "",
  sm: "p-3",
  md: "p-4",
  lg: "p-6"
};
function Card({ variant = "bordered", padding = "md", className, children, as: Tag = "div", hover = false }) {
  return /* @__PURE__ */ jsx5(
    Tag,
    {
      className: cn(
        variant === "funnel" ? "rounded-xl" : "rounded-lg",
        VARIANTS2[variant],
        PADDINGS[padding],
        hover && "transition-transform hover:-translate-y-[3px] hover:shadow-[var(--shadow-hover)]",
        className
      ),
      children
    }
  );
}

// components/EmptyState.tsx
import { jsx as jsx6, jsxs as jsxs5 } from "react/jsx-runtime";
var TONES = {
  primary: "bg-primary-50 text-primary-700",
  olive: "bg-olive-50 text-olive-700",
  accent: "bg-accent-50 text-accent-600",
  secondary: "bg-secondary-50 text-secondary-700"
};
function EmptyState({
  icon: Icon,
  title,
  description,
  ctaLabel,
  ctaHref,
  secondaryLabel,
  secondaryHref,
  variant = "default",
  tone = "primary"
}) {
  const isCompact = variant === "compact";
  return /* @__PURE__ */ jsxs5("div", { className: `text-center ${isCompact ? "py-6" : "py-12"} px-4`, children: [
    /* @__PURE__ */ jsx6("div", { className: `mx-auto rounded-full flex items-center justify-center mb-3 ${TONES[tone]} ${isCompact ? "w-12 h-12" : "w-16 h-16"}`, children: /* @__PURE__ */ jsx6(Icon, { size: isCompact ? 22 : 28, strokeWidth: 2 }) }),
    /* @__PURE__ */ jsx6("h3", { className: `font-serif text-ink-900 font-bold ${isCompact ? "text-base" : "text-lg"}`, children: title }),
    description && /* @__PURE__ */ jsx6("p", { className: `text-ink-500 mt-1 max-w-md mx-auto ${isCompact ? "text-xs" : "text-sm"}`, children: description }),
    (ctaLabel || secondaryLabel) && /* @__PURE__ */ jsxs5("div", { className: "mt-4 flex items-center justify-center gap-2 flex-wrap", children: [
      ctaLabel && ctaHref && /* @__PURE__ */ jsx6(Button, { href: ctaHref, size: "sm", shape: "pill", children: ctaLabel }),
      secondaryLabel && secondaryHref && /* @__PURE__ */ jsx6(
        next_link_default,
        {
          href: secondaryHref,
          className: "inline-flex items-center gap-1.5 bg-white border border-cream-300 hover:bg-cream-50 text-ink-700 px-4 py-2 rounded-full font-semibold text-sm",
          children: secondaryLabel
        }
      )
    ] })
  ] });
}

// components/seller/SellerPageTitle.tsx
import { jsx as jsx7, jsxs as jsxs6 } from "react/jsx-runtime";
function SellerPageTitle({ eyebrow, title, sub, action, className }) {
  return /* @__PURE__ */ jsxs6(
    "div",
    {
      className: cn(
        "mb-6 flex flex-wrap items-end justify-between gap-4",
        className
      ),
      children: [
        /* @__PURE__ */ jsxs6("div", { className: "flex items-stretch gap-3.5", children: [
          /* @__PURE__ */ jsx7(
            "span",
            {
              "aria-hidden": true,
              className: "w-1 shrink-0 rounded-full bg-gradient-to-b from-primary-500 to-secondary-600"
            }
          ),
          /* @__PURE__ */ jsxs6("div", { className: "min-w-0", children: [
            eyebrow && /* @__PURE__ */ jsx7("p", { className: "mb-1 text-xs font-bold uppercase tracking-[0.06em] text-primary-700", children: eyebrow }),
            /* @__PURE__ */ jsx7("h1", { className: "font-serif text-[30px] font-extrabold leading-[1.1] tracking-[-0.01em] text-ink-900", children: title }),
            sub && /* @__PURE__ */ jsx7("p", { className: "mt-1.5 text-sm leading-relaxed text-ink-500", children: sub })
          ] })
        ] }),
        action && /* @__PURE__ */ jsx7("div", { className: "flex flex-wrap items-center gap-2", children: action })
      ]
    }
  );
}

// tests/unit/aiuti/finti/next-navigation.mjs
var annota = (tipo) => (dove) => {
  if (Array.isArray(globalThis.__NAVIGAZIONI__)) globalThis.__NAVIGAZIONI__.push({ tipo, dove: String(dove) });
};
var rotta = { push: annota("push"), replace: annota("replace"), back() {
}, forward() {
}, refresh() {
}, prefetch() {
} };

// lib/consent.ts
var CONSENT_VERSION = 2;
var CONSENT_STORAGE = "mc_consent_v1";
var DEFAULT_STATE = {
  necessary: true,
  functional: false,
  analytics: false,
  marketing: false,
  ts: 0,
  version: CONSENT_VERSION
};
function readConsent() {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CONSENT_STORAGE);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.version !== CONSENT_VERSION) return null;
    return { ...DEFAULT_STATE, ...parsed, necessary: true };
  } catch {
    return null;
  }
}

// lib/funzioni-al-lancio.ts
var AI_NEGOZI_ACCESA = false;
var CARICAMENTO_DA_FILE_ACCESO = false;
var POSTHOG_ACCESO = false;

// lib/analytics/indirizzo-senza-dati-personali.ts
var CHIAVI_INNOCUE = /* @__PURE__ */ new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "page",
  "pagina",
  "sort",
  "ordina",
  "tab",
  "view",
  "vista"
]);
var VALORE_NASCOSTO = "***";
var LUNGHEZZA_MASSIMA = 500;
var BASE_FINTA = "http://indirizzo.interno";
function indirizzoSenzaDatiPersonali(grezzo) {
  if (typeof grezzo !== "string") return null;
  const testo = grezzo.trim();
  if (!testo) return null;
  if (testo.length > 4e3) return null;
  const schema = /^([a-z][a-z0-9+.-]*):/i.exec(testo)?.[1]?.toLowerCase() ?? null;
  if (schema && schema !== "http" && schema !== "https") return null;
  let url;
  try {
    url = new URL(testo, BASE_FINTA);
  } catch {
    return null;
  }
  const pezzi = [];
  for (const [chiave, valore] of url.searchParams) {
    const nome = encodeURIComponent(chiave.slice(0, 40));
    pezzi.push(
      CHIAVI_INNOCUE.has(chiave.toLowerCase()) ? `${nome}=${encodeURIComponent(valore.slice(0, 60))}` : `${nome}=${VALORE_NASCOSTO}`
    );
  }
  const domande = pezzi.length ? `?${pezzi.join("&")}` : "";
  const origine = schema ? url.origin : "";
  return (origine + url.pathname + domande).slice(0, LUNGHEZZA_MASSIMA);
}

// lib/analytics/filmato-senza-dati-personali.ts
var TIPI_RRWEB_CHE_PORTANO_IL_DOM = /* @__PURE__ */ new Set([2, 3]);
var UN_INDIRIZZO_DENTRO_IL_TESTO = /https?:\/\/[^\s"'<>()\\]+|\/[^\s"'<>()\\]*\?[^\s"'<>()\\]*/g;
var TESTO_TROPPO_LUNGO = 5e4;
var PROFONDITA_MASSIMA = 12;
var PEZZI_MASSIMI = 2e4;
function testoSenzaIndirizzi(testo) {
  if (!testo) return testo;
  if (testo.length > TESTO_TROPPO_LUNGO) return VALORE_NASCOSTO;
  if (!testo.includes("/")) return testo;
  return testo.replace(
    UN_INDIRIZZO_DENTRO_IL_TESTO,
    (indirizzo) => indirizzoSenzaDatiPersonali(indirizzo) ?? VALORE_NASCOSTO
  );
}
function strutturaSenzaIndirizzi(valore) {
  try {
    return ripulisci(valore, 0, { pezzi: 0 });
  } catch {
    return valore;
  }
}
function ripulisci(valore, profondita, conto) {
  if (valore === null || valore === void 0) return valore;
  const tipo = typeof valore;
  if (tipo !== "string" && tipo !== "object") return valore;
  conto.pezzi += 1;
  if (profondita > PROFONDITA_MASSIMA || conto.pezzi > PEZZI_MASSIMI) return VALORE_NASCOSTO;
  if (tipo === "string") return testoSenzaIndirizzi(valore);
  if (Array.isArray(valore)) return valore.map((v) => ripulisci(v, profondita + 1, conto));
  const dentro2 = valore;
  const pulito = {};
  for (const chiave of Object.keys(dentro2)) {
    pulito[chiave] = ripulisci(dentro2[chiave], profondita + 1, conto);
  }
  return pulito;
}
function sembraUnEventoDelFilmato(valore) {
  return !!valore && typeof valore === "object" && !Array.isArray(valore) && typeof valore.type === "number";
}
function filmatoSenzaDatiPersonali(datiDelFilmato) {
  try {
    return unPezzoDiFilmato(datiDelFilmato, 0, { pezzi: 0 });
  } catch {
    return datiDelFilmato;
  }
}
function unPezzoDiFilmato(valore, profondita, conto) {
  if (Array.isArray(valore)) return valore.map((v) => unPezzoDiFilmato(v, profondita + 1, conto));
  if (sembraUnEventoDelFilmato(valore)) {
    if (TIPI_RRWEB_CHE_PORTANO_IL_DOM.has(valore.type)) return valore;
    return { ...valore, data: ripulisci(valore.data, profondita + 1, conto) };
  }
  return ripulisci(valore, profondita, conto);
}

// lib/analytics/posthog.tsx
var POSTHOG_KEY = POSTHOG_ACCESO ? process.env.NEXT_PUBLIC_POSTHOG_KEY : void 0;
var POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";
if (typeof window !== "undefined" && POSTHOG_KEY && !/\.i\.posthog\.com\/?$/.test(POSTHOG_HOST)) {
  console.warn(
    `[analytics] NEXT_PUBLIC_POSTHOG_HOST vale "${POSTHOG_HOST}": non e' un indirizzo di raccolta eventi (deve finire per .i.posthog.com). Gli eventi non arriveranno.`
  );
}
var PAGINE_CON_DATI_DI_TERZI = [
  "/admin",
  "/seller",
  "/rider",
  "/orders",
  "/checkout",
  "/profile",
  "/messages",
  "/returns"
];
function laPaginaSiPuoFilmare(pathname) {
  if (!pathname) return true;
  const percorso = pathname.split("?")[0];
  return !PAGINE_CON_DATI_DI_TERZI.some(
    (p) => percorso === p || percorso.startsWith(`${p}/`)
  );
}
function opzioniRegistrazioneSchermo() {
  return {
    maskAllInputs: true,
    maskInputOptions: { password: true, email: true },
    maskTextSelector: "*"
  };
}
var PROPRIETA_CHE_SONO_INDIRIZZI = [
  "$current_url",
  "$referrer",
  "$pathname",
  "$initial_current_url",
  "$initial_referrer",
  "$initial_pathname",
  "$session_entry_url",
  "$session_entry_referrer",
  "$session_entry_pathname"
];
function indirizzoRipulito(valore) {
  if (typeof valore !== "string" || !valore) return valore;
  if (valore.startsWith("$")) return valore;
  return indirizzoSenzaDatiPersonali(valore) ?? VALORE_NASCOSTO;
}
var NOMI_CHE_SONO_INDIRIZZI = new Set(PROPRIETA_CHE_SONO_INDIRIZZI);
var IL_FILMATO = "$snapshot_data";
function contenutoSenzaIndirizzi(valore) {
  if (typeof valore === "string") return testoSenzaIndirizzi(valore);
  if (valore && typeof valore === "object") return strutturaSenzaIndirizzi(valore);
  return valore;
}
function borsaSenzaDatiPersonali(borsa) {
  const pulite = { ...borsa };
  for (const nome of PROPRIETA_CHE_SONO_INDIRIZZI) {
    if (nome in pulite) pulite[nome] = indirizzoRipulito(pulite[nome]);
  }
  if (IL_FILMATO in pulite) pulite[IL_FILMATO] = filmatoSenzaDatiPersonali(pulite[IL_FILMATO]);
  for (const nome of Object.keys(pulite)) {
    if (NOMI_CHE_SONO_INDIRIZZI.has(nome) || nome === IL_FILMATO) continue;
    if (nome === "$set" || nome === "$set_once") continue;
    pulite[nome] = contenutoSenzaIndirizzi(pulite[nome]);
  }
  return pulite;
}
function proprietaSenzaDatiPersonali(proprieta) {
  if (!proprieta || typeof proprieta !== "object") return {};
  const pulite = borsaSenzaDatiPersonali(proprieta);
  for (const contenitore of ["$set", "$set_once"]) {
    const dentro2 = pulite[contenitore];
    if (!dentro2 || typeof dentro2 !== "object" || Array.isArray(dentro2)) continue;
    pulite[contenitore] = borsaSenzaDatiPersonali(dentro2);
  }
  return pulite;
}
var EVENTI_DEI_CLIC = /* @__PURE__ */ new Set(["$autocapture", "$rageclick", "$dead_click", "$copy_autocapture"]);
function clicDaNonSpedire(evento) {
  if (!EVENTI_DEI_CLIC.has(evento.event)) return false;
  const dallEvento = evento.properties?.$pathname;
  const percorsi = [
    typeof dallEvento === "string" ? dallEvento : null,
    typeof window !== "undefined" ? window.location?.pathname ?? null : null
  ].filter((p) => !!p);
  if (percorsi.length === 0) return true;
  return percorsi.some((p) => !laPaginaSiPuoFilmare(p));
}
function eventoSenzaDatiPersonali(evento) {
  if (!evento) return evento;
  if (clicDaNonSpedire(evento)) return null;
  try {
    if (evento.properties) evento.properties = proprietaSenzaDatiPersonali(evento.properties);
    if (evento.$set) evento.$set = proprietaSenzaDatiPersonali(evento.$set);
    if (evento.$set_once) evento.$set_once = proprietaSenzaDatiPersonali(evento.$set_once);
  } catch {
  }
  return evento;
}
function opzioniIndirizzoIngressoMascherato(search = typeof window === "undefined" ? "" : window.location.search) {
  const nomi = /* @__PURE__ */ new Set(["q", "email", "phone", "telefono", "token", "code", "token_hash"]);
  try {
    for (const nome of new URLSearchParams(search).keys()) {
      if (!/^utm_/i.test(nome)) nomi.add(nome);
    }
  } catch {
  }
  return {
    mask_personal_data_properties: true,
    custom_personal_data_properties: [...nomi],
    disable_capture_url_hashes: true
  };
}
function indirizzoSenzaParametri(indirizzo) {
  try {
    const url = new URL(indirizzo);
    const parti = [];
    for (const [nome, valore] of url.searchParams) {
      parti.push(
        `${encodeURIComponent(nome)}=${/^utm_/i.test(nome) ? encodeURIComponent(valore) : "<masked>"}`
      );
    }
    return `${url.origin}${url.pathname}${parti.length ? `?${parti.join("&")}` : ""}`;
  } catch {
    return indirizzo.split(/[?#]/)[0];
  }
}
function ripulisciIndirizzoIngressoSalvato(istanza) {
  try {
    const persistenza = istanza?.persistence;
    const info = persistenza?.props?.["$initial_person_info"];
    if (!persistenza?.register || !info || typeof info.u !== "string") return;
    const pulito = indirizzoSenzaParametri(info.u);
    if (pulito !== info.u) persistenza.register({ $initial_person_info: { ...info, u: pulito } });
  } catch {
  }
}
var posthogInstance = null;
async function getPosthog() {
  if (!POSTHOG_KEY) return null;
  if (typeof window === "undefined") return null;
  const consented = !!readConsent()?.analytics;
  if (posthogInstance) {
    try {
      if (consented) posthogInstance.opt_in_capturing();
      else posthogInstance.opt_out_capturing();
    } catch {
    }
    return consented ? posthogInstance : null;
  }
  if (!consented) return null;
  const { default: posthog } = await import("posthog-js").catch(() => ({ default: null }));
  if (!posthog) return null;
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    person_profiles: "identified_only",
    capture_pageview: false,
    // gestiamo noi via useEffect
    capture_pageleave: true,
    // Il cancello sul DATO: ogni evento passa di qui prima di partire.
    before_send: eventoSenzaDatiPersonali,
    // La porta dei flag (`POST /flags/?v=2`) non passa da `before_send`: porta
    // `person_properties.$initial_current_url`, l'indirizzo d'ingresso. PostHog
    // lo maschera solo per NOME di parametro, quindi gli diamo i nomi presenti.
    ...opzioniIndirizzoIngressoMascherato(),
    // Chi aveva consentito prima ha l'indirizzo d'ingresso gia' salvato intero
    // (`register_once` non lo riscrive): lo ripuliamo qui, prima dei flag.
    loaded: ripulisciIndirizzoIngressoSalvato,
    session_recording: opzioniRegistrazioneSchermo(),
    autocapture: {
      dom_event_allowlist: ["click", "submit"]
    }
  });
  posthogInstance = posthog;
  return posthog;
}
async function track(event, properties) {
  const ph = await getPosthog();
  if (!ph) return;
  ph.capture(event, properties);
}

// lib/analytics/events.ts
function messaggioSenzaDatiPersonali(message) {
  return (message || "").replace(/Key\s*\([^)]*\)\s*=\s*\([^)]*\)/gi, "Key (\u2026)=(\u2026)").replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "<email>").replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<id>").replace(/\b\d{6,}\b/g, "<numero>").trim().slice(0, 40);
}
var trackErrorShown = (code, message, page) => track("error_shown", { code, message: messaggioSenzaDatiPersonali(message), page });

// lib/errors.ts
var SUPABASE_CODE_MAP = {
  "23505": "Questo valore \xE8 gi\xE0 stato usato. Prova con uno diverso.",
  "23503": "Impossibile completare: l'elemento collegato non esiste pi\xF9.",
  "23502": "Manca un dato obbligatorio.",
  "23514": "Il valore inserito non \xE8 valido.",
  "42501": "Non hai i permessi per questa azione.",
  "PGRST116": "Non trovato.",
  "PGRST204": "Nessun risultato.",
  "22P02": "Formato non valido."
};
var GENERIC_FALLBACK = "Qualcosa non ha funzionato. Riprova fra un momento.";
var PAROLE_DEL_MOTORE = /\b(syntax|constraint|relation|column|table|row|query|statement|varchar|varying|violates|null value|does not exist|out of range|deadlock|serializ|unrecognized|operator|integer|numeric|boolean|timestamp|jsonb|uuid|regclass)\b/i;
function traduciErroreAuth(msg) {
  const m = String(msg || "").toLowerCase();
  if (!m) return null;
  if (m.includes("captcha") || m.includes("turnstile"))
    return "Il controllo anti-bot \xE8 scaduto: \xE8 stato rigenerato, premi di nuovo.";
  if (m.includes("invalid login credentials")) return "Email o password non corrette";
  if (m.includes("email not confirmed"))
    return "Email non confermata. Controlla la posta e clicca sul link che ti abbiamo inviato.";
  if (m.includes("user not found")) return "Nessun account con questa email";
  if (m.includes("user already registered") || m.includes("already been registered"))
    return "Esiste gi\xE0 un account con questa email. Prova ad accedere.";
  if (m.includes("password should be at least")) {
    const n = m.match(/at least (\d+)/)?.[1];
    return n ? `La password deve essere di almeno ${n} caratteri` : "La password \xE8 troppo corta";
  }
  if (m.includes("unable to validate email address") || m.includes("invalid email"))
    return "Questa email non sembra valida. Controlla come l\u2019hai scritta.";
  if (m.includes("email rate limit exceeded"))
    return "Abbiamo gi\xE0 inviato troppe email a questo indirizzo. Riprova fra qualche minuto.";
  if (m.includes("new password should be different"))
    return "La password nuova deve essere diversa da quella attuale";
  if (m.includes("same password"))
    return "La password nuova deve essere diversa da quella attuale";
  return null;
}
function friendlyError(err, context) {
  if (!err) return GENERIC_FALLBACK;
  if (typeof err === "object" && err !== null) {
    const e = err;
    if (e.code && SUPABASE_CODE_MAP[e.code]) {
      trackErrorShown(e.code, e.message ?? "", context?.page);
      return SUPABASE_CODE_MAP[e.code];
    }
    if (e.message) {
      if (err instanceof SyntaxError || /json parse error|unexpected token|unexpected end of json|is not valid json/i.test(e.message)) {
        trackErrorShown("risposta_non_json", e.message, context?.page);
        return "Il server non ha risposto correttamente. Riprova fra qualche secondo.";
      }
      const inItaliano = traduciErroreAuth(e.message);
      if (inItaliano) {
        trackErrorShown(e.code ?? "auth", e.message, context?.page);
        return inItaliano;
      }
      if (/duplicate key value/i.test(e.message)) {
        trackErrorShown("duplicate_key", e.message, context?.page);
        return SUPABASE_CODE_MAP["23505"];
      }
      if (/foreign key constraint/i.test(e.message)) {
        trackErrorShown("foreign_key", e.message, context?.page);
        return SUPABASE_CODE_MAP["23503"];
      }
      if (/permission denied|insufficient_privilege|row.level security/i.test(e.message)) {
        trackErrorShown("permission_denied", e.message, context?.page);
        return "Non hai i permessi per questa azione.";
      }
      if (/canceling statement|statement timeout/i.test(e.message)) {
        trackErrorShown("tempo_scaduto", e.message, context?.page);
        return "Ci ha messo troppo e si e' fermato. Riprova fra qualche secondo.";
      }
      if (/network|fetch|timeout|aborted/i.test(e.message)) {
        trackErrorShown("network", e.message, context?.page);
        return "Problema di connessione. Controlla la rete e riprova.";
      }
      if (/rate.limit|too many/i.test(e.message)) {
        trackErrorShown("rate_limit", e.message, context?.page);
        return "Troppe richieste in poco tempo. Aspetta qualche secondo.";
      }
      if (e.status === 401 || /\bjwt\b|refresh token|token (is |has )?expired|session (is |has )?expired|not authenticated|unauthoriz/i.test(e.message)) {
        trackErrorShown("session_expired", e.message, context?.page);
        return "La sessione \xE8 scaduta. Accedi di nuovo.";
      }
      if (/mime type|invalid mime type/i.test(e.message)) {
        trackErrorShown("storage_formato", e.message, context?.page);
        return "Formato non accettato: usa una foto JPG, PNG o WEBP.";
      }
      if (/exceeded the maximum allowed size|payload too large/i.test(e.message)) {
        trackErrorShown("storage_troppo_pesante", e.message, context?.page);
        return "La foto \xE8 troppo pesante: il limite \xE8 10 MB. Riducila o scattane un'altra.";
      }
      if (/resource already exists/i.test(e.message)) {
        trackErrorShown("storage_gia_esiste", e.message, context?.page);
        return "Un file con questo nome c'\xE8 gi\xE0. Rinominalo e riprova.";
      }
      if (/value too long/i.test(e.message)) {
        trackErrorShown("testo_troppo_lungo", e.message, context?.page);
        return "Testo troppo lungo: accorcialo e riprova.";
      }
      if (/invalid input\b/i.test(e.message)) {
        trackErrorShown("valore_non_valido", e.message, context?.page);
        return "Uno dei dati inseriti non e' nel formato giusto: controlla numeri e date, poi riprova.";
      }
      trackErrorShown(e.code ?? "unknown", e.message, context?.page);
      const cleaned = e.message.replace(/\b[A-Z_]+\s*=\s*[^\s,]+/g, "").replace(/\(.*?\)/g, (parentesi) => parentesi.includes("\u20AC") ? parentesi : "").trim();
      if (cleaned.length > 0 && cleaned.length < 200 && !cleaned.includes("\n") && /^[a-zA-ZÀ-ſ]/.test(cleaned) && // ...e non parla come un motore. Vedi PAROLE_DEL_MOTORE in cima al file.
      !PAROLE_DEL_MOTORE.test(cleaned)) {
        return cleaned;
      }
    }
    if (e.status) {
      const statusLabel = e.status >= 500 ? "http_5xx" : `http_${e.status}`;
      trackErrorShown(statusLabel, `HTTP ${e.status}`, context?.page);
      if (e.status === 401) return "Devi accedere per continuare.";
      if (e.status === 403) return "Non hai i permessi per questa azione.";
      if (e.status === 404) return "Non trovato.";
      if (e.status === 429) return "Troppe richieste. Aspetta un attimo.";
      if (e.status >= 500) return "Problema del server. Riproveremo tra poco.";
    }
  }
  if (typeof err === "string") return err;
  return GENERIC_FALLBACK;
}

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

// lib/products/nascondi.ts
var STATO_NASCOSTO = "draft";
async function nascondiProdotto(client, opts) {
  let scrittura = client.from("products").update({ status: STATO_NASCOSTO }).eq("id", opts.id);
  if (opts.sellerId) scrittura = scrittura.eq("seller_id", opts.sellerId);
  const { error } = await scrittura;
  if (error) throw error;
}

// lib/products/salva-dal-browser.ts
init_supabase_client();
async function salvaProdottoDalBrowser(opts) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sessione scaduta: rientra e riprova.");
  const res = await fetch(`/api/seller/products/${encodeURIComponent(opts.prodottoId)}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.access_token}`
    },
    body: JSON.stringify({
      payload: opts.payload,
      origine: opts.origine,
      campiDallAi: opts.campiDallAi ?? []
    })
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error?.message ?? "Non sono riuscito a salvare. Riprova.");
  return json?.data?.campi ?? [];
}

// lib/paginazione.ts
var RIGHE_PER_PAGINA = 100;
function finestraDellaPagina(pagina, dimensione = RIGHE_PER_PAGINA) {
  const p = Math.max(0, Math.trunc(pagina));
  const da = p * dimensione;
  return [da, da + dimensione - 1];
}
function cEUnAltraPagina(righeTornate, dimensione = RIGHE_PER_PAGINA) {
  return righeTornate >= dimensione;
}
function pagineSuccessiva(righeUltimaPagina, pagineGiaLette, dimensione = RIGHE_PER_PAGINA) {
  return cEUnAltraPagina(righeUltimaPagina, dimensione) ? pagineGiaLette : void 0;
}
function unisciPagine(pagine) {
  const visti = /* @__PURE__ */ new Set();
  const fuori = [];
  for (const pagina of pagine) {
    for (const riga of pagina) {
      if (visti.has(riga.id)) continue;
      visti.add(riga.id);
      fuori.push(riga);
    }
  }
  return fuori;
}

// app/seller/products/page.tsx
import { Fragment as Fragment3, jsx as jsx8, jsxs as jsxs7 } from "react/jsx-runtime";
var SCORTA_CAMBIATA = /cambiata mentre modificavi/;
var TABS = [
  { key: "all", label: "Tutti", match: () => true },
  { key: "available", label: "In vendita", match: (s) => s === "available" },
  { key: "sold", label: "Esauriti", match: (s) => s === "sold" },
  { key: "draft", label: "Bozze", match: (s) => s === "draft" }
];
function SellerProductsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState("all");
  const queryProducts = useInfiniteQuery({
    queryKey: queryKeys.seller.products,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Non autenticato");
      const [da, a] = finestraDellaPagina(pageParam);
      const { data, error, count } = await supabase.from("products").select("id, name, price, status, images, stock, categories(name)", { count: "exact" }).eq("seller_id", user.id).order("created_at", { ascending: false }).order("id", { ascending: false }).range(da, a);
      if (error) throw error;
      return { righe: data ?? [], totale: count ?? null };
    },
    getNextPageParam: (ultima, tutte) => pagineSuccessiva(ultima.righe.length, tutte.length)
  });
  const products = unisciPagine((queryProducts.data?.pages ?? []).map((pagina) => pagina.righe));
  const totaleProdotti = queryProducts.data?.pages[0]?.totale ?? products.length;
  const idsInPagina = products.map((p) => p.id);
  const queryVenduti = useQuery({
    queryKey: [...queryKeys.seller.products, "venduti", idsInPagina.length],
    enabled: idsInPagina.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("venduti_per_prodotto", { p_products: idsInPagina });
      if (error) throw error;
      const map = {};
      for (const r of data ?? []) {
        map[r.product_id] = Number(r.venduti);
      }
      return map;
    }
  });
  const soldByProduct = queryVenduti.data ?? {};
  const vendutiIgnoti = queryVenduti.isError;
  const nascondi = useMutation({
    mutationFn: async (id) => {
      const { data: { user } } = await supabase.auth.getUser();
      await nascondiProdotto(supabase, { id, sellerId: user?.id });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.seller.products });
      toast.success("Prodotto nascosto: lo trovi fra le bozze");
    },
    onError: (err) => toast.error(friendlyError(err))
  });
  const toggleStatus = useMutation({
    mutationFn: async ({ id, status }) => {
      const newStatus = status === "available" ? "sold" : "available";
      await salvaProdottoDalBrowser({
        prodottoId: id,
        payload: { status: newStatus },
        origine: "venditore-elenco"
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.seller.products }),
    onError: (err) => toast.error(friendlyError(err))
  });
  const bulkSave = useMutation({
    mutationFn: async (edits2) => {
      const ids = Object.keys(edits2);
      for (const id of ids) {
        const e = edits2[id];
        const patch = {};
        if (e.price != null && e.price !== "") {
          const n = Number(e.price.replace(",", "."));
          if (Number.isFinite(n)) patch.price = n;
        }
        if (e.stock != null && e.stock !== "") {
          const n = Number(e.stock);
          if (Number.isFinite(n)) patch.stock = n;
          if (Number.isFinite(n) && typeof e.stockVisto === "number") patch.stock_visto = e.stockVisto;
        }
        if (Object.keys(patch).length === 0) continue;
        try {
          await salvaProdottoDalBrowser({
            prodottoId: id,
            payload: patch,
            origine: "venditore-elenco-blocco"
          });
        } catch (err) {
          const giaSalvati = ids.slice(0, ids.indexOf(id));
          const scortaMossa = "stock_visto" in patch && err instanceof Error && SCORTA_CAMBIATA.test(err.message);
          setEdits((attuali) => {
            const resto = { ...attuali };
            for (const s of giaSalvati) delete resto[s];
            if (scortaMossa && resto[id]) {
              const senzaScorta = { ...resto[id] };
              delete senzaScorta.stock;
              delete senzaScorta.stockVisto;
              if (senzaScorta.price != null && senzaScorta.price !== "") resto[id] = senzaScorta;
              else delete resto[id];
            }
            return resto;
          });
          throw err;
        }
      }
      return ids.length;
    },
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: queryKeys.seller.products });
      toast.success(`${n} ${n === 1 ? "prodotto aggiornato" : "prodotti aggiornati"}`);
      setBulk(false);
      setEdits({});
    },
    onError: (err) => {
      qc.invalidateQueries({ queryKey: queryKeys.seller.products });
      toast.error(friendlyError(err));
    }
  });
  const askDelete = async (p) => {
    const ok = await confirmDialog({
      title: "Nascondere il prodotto?",
      message: `"${p.name}" sparisce dalla vetrina e va fra le bozze. Resta negli ordini gi\xE0 fatti, con le sue recensioni: puoi rimetterlo in vendita quando vuoi.`,
      confirmLabel: "S\xEC, nascondi",
      danger: true,
      icon: EyeOff
    });
    if (ok) nascondi.mutate(p.id);
  };
  const [bulk, setBulk] = useState(false);
  const [edits, setEdits] = useState({});
  const editCount = Object.keys(edits).filter((id) => {
    const e = edits[id];
    return e.price != null && e.price !== "" || e.stock != null && e.stock !== "";
  }).length;
  const setField = (id, k, v, vista) => setEdits((e) => ({
    ...e,
    [id]: {
      ...e[id] ?? {},
      [k]: v,
      // Il numero a video al primo tasto, non quello di dopo un ricaricamento.
      ...k === "stock" && e[id]?.stockVisto === void 0 && typeof vista === "number" ? { stockVisto: vista } : {}
    }
  }));
  const valOf = (p, k) => {
    const e = edits[p.id];
    if (e && e[k] != null) return e[k];
    return k === "price" ? String(p.price).replace(".", ",") : String(p.stock ?? 0);
  };
  const cancelBulk = () => {
    setBulk(false);
    setEdits({});
  };
  const list = useMemo(() => {
    const matcher = TABS.find((t) => t.key === tab) ?? TABS[0];
    return products.filter((p) => matcher.match(p.status));
  }, [products, tab]);
  const vistaqueryProducts = vistaDaQuery(queryProducts, { quanti: products.length });
  if (vistaqueryProducts.mostraScheletro) return /* @__PURE__ */ jsx8(LoadingState, {});
  if (vistaqueryProducts.mostraErrore) {
    return /* @__PURE__ */ jsx8(
      ErrorState,
      {
        title: "Non sono riuscito a leggere il tuo catalogo",
        description: "La lettura non \xE8 riuscita, quindi non so cosa hai in catalogo. Non vuol dire che sia vuoto: riprova fra un momento.",
        onRetry: () => queryProducts.refetch()
      }
    );
  }
  return /* @__PURE__ */ jsxs7("div", { className: bulk ? "pb-24" : void 0, children: [
    /* @__PURE__ */ jsx8(
      SellerPageTitle,
      {
        eyebrow: "Catalogo",
        title: "Prodotti",
        sub: `${totaleProdotti} ${totaleProdotti === 1 ? "prodotto" : "prodotti"} a catalogo`,
        action: /* @__PURE__ */ jsxs7(Fragment3, { children: [
          bulk ? /* @__PURE__ */ jsx8(Button, { variant: "ghost", size: "sm", icon: X, onClick: cancelBulk, children: "Annulla" }) : /* @__PURE__ */ jsx8(Button, { variant: "secondary", size: "sm", icon: SlidersHorizontal, onClick: () => setBulk(true), children: "Modifica in blocco" }),
          AI_NEGOZI_ACCESA && /* @__PURE__ */ jsxs7(Button, { href: "/seller/products/ai-batch", variant: "secondary", size: "sm", children: [
            /* @__PURE__ */ jsx8(Sparkles, { size: 14, "aria-hidden": true }),
            " AI sul catalogo"
          ] }),
          CARICAMENTO_DA_FILE_ACCESO && /* @__PURE__ */ jsxs7(Button, { href: "/seller/products/import", variant: "secondary", size: "sm", children: [
            /* @__PURE__ */ jsx8(Download, { size: 14, "aria-hidden": true }),
            " Importa CSV"
          ] }),
          /* @__PURE__ */ jsx8(Button, { href: "/seller/products/new", size: "sm", icon: Plus, children: "Nuovo prodotto" })
        ] })
      }
    ),
    bulk && /* @__PURE__ */ jsxs7("div", { className: "mb-4 flex items-center gap-2 rounded-lg border border-primary-200 bg-primary-50 px-4 py-2.5 text-sm text-primary-800", children: [
      /* @__PURE__ */ jsx8(SlidersHorizontal, { size: 15, className: "shrink-0 text-primary-700", "aria-hidden": true }),
      "Modifica prezzo e scorte direttamente nella lista, poi salva tutto in una volta."
    ] }),
    /* @__PURE__ */ jsx8("div", { className: "mb-4 flex flex-wrap gap-1.5", children: TABS.map((t) => {
      const on = tab === t.key;
      return /* @__PURE__ */ jsx8(
        "button",
        {
          type: "button",
          onClick: () => setTab(t.key),
          "aria-pressed": on,
          className: `rounded-full px-3.5 py-2 text-[13px] font-semibold transition-colors ${on ? "bg-primary-700 text-white" : "bg-white text-ink-600 ring-1 ring-inset ring-cream-300 hover:bg-cream-50"}`,
          children: t.label
        },
        t.key
      );
    }) }),
    products.length === 0 ? /* @__PURE__ */ jsx8(Card, { variant: "bordered", padding: "none", children: /* @__PURE__ */ jsx8(
      EmptyState,
      {
        icon: Package,
        title: "Nessun prodotto a catalogo",
        description: "Pubblica il tuo primo prodotto: bastano una foto e un prezzo.",
        ctaLabel: "Nuovo prodotto",
        ctaHref: "/seller/products/new",
        secondaryLabel: CARICAMENTO_DA_FILE_ACCESO ? "Importa CSV" : void 0,
        secondaryHref: CARICAMENTO_DA_FILE_ACCESO ? "/seller/products/import" : void 0
      }
    ) }) : list.length === 0 ? /* @__PURE__ */ jsx8(Card, { variant: "bordered", padding: "none", children: /* @__PURE__ */ jsx8(EmptyState, { icon: Package, title: "Nessun prodotto in questa vista", description: "Cambia filtro per vedere gli altri prodotti.", variant: "compact" }) }) : /* @__PURE__ */ jsxs7(Card, { variant: "bordered", padding: "none", children: [
      /* @__PURE__ */ jsx8("div", { className: "hidden overflow-x-auto md:block", children: /* @__PURE__ */ jsxs7("table", { className: "w-full text-sm", children: [
        /* @__PURE__ */ jsx8("thead", { children: /* @__PURE__ */ jsx8("tr", { className: "border-b border-cream-300 bg-cream-50", children: ["Prodotto", "Prezzo", "Stock", "Venduti da sempre", "Stato", ""].map((h, i) => /* @__PURE__ */ jsx8(
          "th",
          {
            className: `px-4 py-3 text-[11px] font-bold uppercase tracking-[0.03em] text-ink-500 ${i > 0 && i < 5 ? "text-right" : "text-left"}`,
            children: h
          },
          h || i
        )) }) }),
        /* @__PURE__ */ jsx8("tbody", { children: list.map((p) => /* @__PURE__ */ jsxs7("tr", { className: "border-b border-cream-200 last:border-0 hover:bg-cream-50", children: [
          /* @__PURE__ */ jsx8("td", { className: "px-4 py-3", children: /* @__PURE__ */ jsxs7("div", { className: "flex items-center gap-3", children: [
            /* @__PURE__ */ jsx8("div", { className: "relative h-11 w-11 shrink-0 overflow-hidden rounded-md bg-cream-100", children: /* @__PURE__ */ jsx8(
              next_image_default,
              {
                src: sizedImage(p.images?.[0] ?? "https://placehold.co/100x100/eee/aaa?text=?", "thumb"),
                alt: p.name,
                fill: true,
                sizes: "44px",
                unoptimized: true,
                className: "object-cover"
              }
            ) }),
            /* @__PURE__ */ jsxs7("div", { className: "min-w-0", children: [
              /* @__PURE__ */ jsx8(next_link_default, { href: `/product/${p.id}`, className: "block truncate font-semibold text-ink-900 hover:text-primary-700", children: p.name }),
              /* @__PURE__ */ jsx8("p", { className: "truncate text-xs text-ink-400", children: p.categories?.name ?? "\u2014" })
            ] })
          ] }) }),
          /* @__PURE__ */ jsx8("td", { className: "px-4 py-3 text-right", children: bulk ? /* @__PURE__ */ jsx8(
            "input",
            {
              value: valOf(p, "price"),
              onChange: (e) => setField(p.id, "price", e.target.value),
              inputMode: "decimal",
              "aria-label": `Prezzo di ${p.name}`,
              className: "w-20 rounded-md border border-cream-300 px-2 py-1.5 text-right text-[13px] font-semibold text-ink-900 outline-none focus-visible:border-primary-400 focus-visible:ring-2 focus-visible:ring-primary-700"
            }
          ) : /* @__PURE__ */ jsx8("span", { className: "font-bold text-ink-900", children: formatPrice(Number(p.price)) }) }),
          /* @__PURE__ */ jsx8("td", { className: `px-4 py-3 text-right font-semibold ${(p.stock ?? 0) === 0 ? "text-secondary-600" : (p.stock ?? 0) <= 3 ? "text-accent-700" : "text-ink-700"}`, children: bulk ? /* @__PURE__ */ jsx8(
            "input",
            {
              value: valOf(p, "stock"),
              onChange: (e) => setField(p.id, "stock", e.target.value.replace(/[^0-9]/g, ""), p.stock),
              inputMode: "numeric",
              "aria-label": `Stock di ${p.name}`,
              className: "w-20 rounded-md border border-cream-300 px-2 py-1.5 text-right text-[13px] font-semibold text-ink-900 outline-none focus-visible:border-primary-400 focus-visible:ring-2 focus-visible:ring-primary-700"
            }
          ) : p.stock ?? 0 }),
          /* @__PURE__ */ jsx8("td", { className: "px-4 py-3 text-right font-semibold text-ink-700", children: soldByProduct[p.id] ? soldByProduct[p.id] : vendutiIgnoti ? /* @__PURE__ */ jsx8("span", { className: "font-normal text-ink-400", title: "Non sono riuscito a leggere i venduti", children: "?" }) : /* @__PURE__ */ jsx8("span", { className: "font-normal text-ink-400", children: "\u2014" }) }),
          /* @__PURE__ */ jsx8("td", { className: "px-4 py-3 text-right", children: /* @__PURE__ */ jsx8(StatusBadge, { status: p.status }) }),
          /* @__PURE__ */ jsx8("td", { className: "whitespace-nowrap px-4 py-3 text-right", children: /* @__PURE__ */ jsxs7("div", { className: "inline-flex items-center gap-1", children: [
            /* @__PURE__ */ jsx8(
              next_link_default,
              {
                href: `/seller/products/${p.id}/edit`,
                "aria-label": `Modifica ${p.name}`,
                title: "Modifica",
                className: "inline-flex items-center justify-center rounded-md p-1.5 text-ink-500 hover:bg-cream-100 hover:text-primary-700",
                children: /* @__PURE__ */ jsx8(Pencil, { size: 16, "aria-hidden": true })
              }
            ),
            /* @__PURE__ */ jsx8(
              next_link_default,
              {
                href: `/seller/products/new?from=${p.id}`,
                "aria-label": `Duplica ${p.name}`,
                title: "Duplica",
                className: "inline-flex items-center justify-center rounded-md p-1.5 text-ink-500 hover:bg-cream-100 hover:text-ink-800",
                children: /* @__PURE__ */ jsx8(Copy, { size: 16, "aria-hidden": true })
              }
            ),
            /* @__PURE__ */ jsx8(
              "button",
              {
                type: "button",
                onClick: () => toggleStatus.mutate({ id: p.id, status: p.status }),
                className: "rounded-md px-2 py-1.5 text-xs font-semibold text-ink-600 hover:bg-cream-100 hover:text-ink-900",
                children: p.status === "available" ? "Disattiva" : "Attiva"
              }
            ),
            /* @__PURE__ */ jsx8(
              "button",
              {
                type: "button",
                onClick: () => askDelete(p),
                "aria-label": `Nascondi ${p.name}`,
                title: "Nascondi",
                className: "inline-flex items-center justify-center rounded-md p-1.5 text-secondary-600 hover:bg-secondary-50",
                children: /* @__PURE__ */ jsx8(EyeOff, { size: 16, "aria-hidden": true })
              }
            )
          ] }) })
        ] }, p.id)) })
      ] }) }),
      /* @__PURE__ */ jsx8("div", { className: "divide-y divide-cream-200 md:hidden", children: list.map((p) => /* @__PURE__ */ jsxs7("div", { className: "p-3.5", children: [
        /* @__PURE__ */ jsxs7("div", { className: "flex gap-3", children: [
          /* @__PURE__ */ jsx8(next_link_default, { href: `/product/${p.id}`, className: "relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-cream-100", children: /* @__PURE__ */ jsx8(
            next_image_default,
            {
              src: sizedImage(p.images?.[0] ?? "https://placehold.co/100x100/eee/aaa?text=?", "thumb"),
              alt: p.name,
              fill: true,
              sizes: "64px",
              unoptimized: true,
              className: "object-cover"
            }
          ) }),
          /* @__PURE__ */ jsxs7("div", { className: "min-w-0 flex-1", children: [
            /* @__PURE__ */ jsxs7("div", { className: "flex items-start justify-between gap-2", children: [
              /* @__PURE__ */ jsx8(next_link_default, { href: `/product/${p.id}`, className: "line-clamp-2 font-semibold text-ink-900 hover:text-primary-700", children: p.name }),
              /* @__PURE__ */ jsx8(StatusBadge, { status: p.status })
            ] }),
            /* @__PURE__ */ jsx8("p", { className: "mt-0.5 text-xs text-ink-400", children: p.categories?.name ?? "\u2014" }),
            bulk ? /* @__PURE__ */ jsxs7("div", { className: "mt-2 flex flex-wrap items-center gap-3", children: [
              /* @__PURE__ */ jsxs7("label", { className: "flex items-center gap-1.5 text-xs text-ink-500", children: [
                "\u20AC",
                /* @__PURE__ */ jsx8(
                  "input",
                  {
                    value: valOf(p, "price"),
                    onChange: (e) => setField(p.id, "price", e.target.value),
                    inputMode: "decimal",
                    "aria-label": `Prezzo di ${p.name}`,
                    className: "w-20 rounded-md border border-cream-300 px-2 py-1 text-right text-[13px] font-semibold text-ink-900 outline-none focus-visible:border-primary-400 focus-visible:ring-2 focus-visible:ring-primary-700"
                  }
                )
              ] }),
              /* @__PURE__ */ jsxs7("label", { className: "flex items-center gap-1.5 text-xs text-ink-500", children: [
                "Stock",
                /* @__PURE__ */ jsx8(
                  "input",
                  {
                    value: valOf(p, "stock"),
                    onChange: (e) => setField(p.id, "stock", e.target.value.replace(/[^0-9]/g, ""), p.stock),
                    inputMode: "numeric",
                    "aria-label": `Stock di ${p.name}`,
                    className: "w-16 rounded-md border border-cream-300 px-2 py-1 text-right text-[13px] font-semibold text-ink-900 outline-none focus-visible:border-primary-400 focus-visible:ring-2 focus-visible:ring-primary-700"
                  }
                )
              ] })
            ] }) : /* @__PURE__ */ jsxs7("div", { className: "mt-1 flex flex-wrap items-center gap-2", children: [
              /* @__PURE__ */ jsx8("span", { className: "font-bold text-ink-900", children: formatPrice(Number(p.price)) }),
              /* @__PURE__ */ jsxs7("span", { className: "text-xs text-ink-500", children: [
                "\xB7 ",
                p.stock ?? 0,
                " pz"
              ] }),
              vendutiIgnoti ? /* @__PURE__ */ jsx8("span", { className: "text-xs text-ink-400", children: "\xB7 venduti non letti" }) : soldByProduct[p.id] ? /* @__PURE__ */ jsxs7("span", { className: "text-xs text-ink-500", children: [
                "\xB7 ",
                soldByProduct[p.id],
                " venduti da sempre"
              ] }) : null
            ] })
          ] })
        ] }),
        !bulk && /* @__PURE__ */ jsxs7("div", { className: "mt-3 flex items-center gap-2 border-t border-cream-100 pt-3", children: [
          /* @__PURE__ */ jsx8(
            next_link_default,
            {
              href: `/seller/products/${p.id}/edit`,
              className: "flex-1 rounded-lg bg-primary-50 py-2 text-center text-sm font-semibold text-primary-700",
              children: "Modifica"
            }
          ),
          /* @__PURE__ */ jsx8(
            "button",
            {
              type: "button",
              onClick: () => toggleStatus.mutate({ id: p.id, status: p.status }),
              className: "flex-1 rounded-lg bg-cream-100 py-2 text-center text-sm font-semibold text-ink-700",
              children: p.status === "available" ? "Disattiva" : "Attiva"
            }
          ),
          /* @__PURE__ */ jsx8(
            next_link_default,
            {
              href: `/seller/products/new?from=${p.id}`,
              "aria-label": "Duplica",
              className: "rounded-lg bg-cream-100 px-3 py-2 text-ink-700",
              children: /* @__PURE__ */ jsx8(Copy, { size: 16, "aria-hidden": true })
            }
          ),
          /* @__PURE__ */ jsx8(
            "button",
            {
              type: "button",
              onClick: () => askDelete(p),
              "aria-label": "Nascondi",
              className: "rounded-lg bg-secondary-50 px-3 py-2 text-secondary-600",
              children: /* @__PURE__ */ jsx8(EyeOff, { size: 16, "aria-hidden": true })
            }
          )
        ] })
      ] }, p.id)) }),
      /* @__PURE__ */ jsx8("p", { className: "border-t border-cream-200 px-4 py-3 text-xs leading-relaxed text-ink-500", children: "\xABVenduti\xBB sono i pezzi che hai gi\xE0 consegnato, da quando hai aperto il negozio. Nel cruscotto il riquadro \xABArticoli venduti\xBB conta un'altra cosa: quante volte un tuo prodotto \xE8 stato ordinato negli ultimi 30 giorni. Per questo i due numeri non coincidono." })
    ] }),
    queryProducts.hasNextPage && /* @__PURE__ */ jsxs7("div", { className: "pt-3 text-center", children: [
      /* @__PURE__ */ jsx8(
        "button",
        {
          type: "button",
          onClick: () => queryProducts.fetchNextPage(),
          disabled: queryProducts.isFetchingNextPage,
          className: "rounded-lg border border-cream-300 bg-white px-4 py-2 text-sm font-semibold text-ink-700 hover:border-primary-300 hover:text-primary-700 disabled:opacity-50",
          children: queryProducts.isFetchingNextPage ? "Carico\u2026" : `Carica altri ${RIGHE_PER_PAGINA} prodotti`
        }
      ),
      /* @__PURE__ */ jsxs7("p", { className: "mt-1 text-xs text-ink-400", children: [
        "Ne vedi ",
        products.length,
        " di ",
        totaleProdotti
      ] })
    ] }),
    bulk && /*
      6/9/2026 — La barra si incollava al bordo dello schermo senza tenere
      conto della striscia che iPhone si riserva in fondo per il gesto di
      uscita: gli ultimi 34 pixel di «Annulla» e «Salva modifiche» finivano
      sotto quella striscia e il tocco non arrivava al pulsante. Ora sotto
      c'e' sempre lo spazio del sistema, in piu' al padding normale.
    */
    /* @__PURE__ */ jsxs7("div", { className: "fixed inset-x-0 bottom-0 z-sticky flex items-center justify-between gap-3 border-t border-cream-300 bg-surface-0 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] pl-5 pr-24 shadow-warm-xl sm:pr-44", children: [
      /* @__PURE__ */ jsx8("span", { className: "min-w-0 truncate text-sm text-ink-600", children: editCount > 0 ? /* @__PURE__ */ jsxs7(Fragment3, { children: [
        /* @__PURE__ */ jsx8("strong", { className: "text-ink-900", children: editCount }),
        " ",
        editCount === 1 ? "prodotto modificato" : "prodotti modificati"
      ] }) : "Nessuna modifica" }),
      /* @__PURE__ */ jsxs7("div", { className: "flex shrink-0 gap-2", children: [
        /* @__PURE__ */ jsx8(Button, { variant: "ghost", size: "sm", onClick: cancelBulk, children: "Annulla" }),
        /* @__PURE__ */ jsx8(
          Button,
          {
            size: "sm",
            icon: Check2,
            loading: bulkSave.isPending,
            disabled: editCount === 0,
            onClick: () => bulkSave.mutate(edits),
            children: "Salva modifiche"
          }
        )
      ] })
    ] })
  ] });
}
var STATUS_META = {
  available: { label: "In vendita", cls: "bg-olive-100 text-olive-700" },
  sold: { label: "Esaurito", cls: "bg-secondary-50 text-secondary-600" },
  draft: { label: "Bozza", cls: "bg-cream-200 text-ink-500" }
};
function StatusBadge({ status }) {
  const m = STATUS_META[status] ?? { label: "In approvazione", cls: "bg-accent-100 text-accent-700" };
  return /* @__PURE__ */ jsx8("span", { className: `inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${m.cls}`, children: m.label });
}
export {
  SellerProductsPage as default
};
