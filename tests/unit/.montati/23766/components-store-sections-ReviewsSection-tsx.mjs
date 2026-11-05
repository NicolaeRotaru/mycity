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

// components/store-sections/ReviewsSection.tsx
import { Star as Star2, User, BadgeCheck, ThumbsUp } from "lucide-react";
import { toast } from "sonner";

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

// lib/storage/foto-di-casa.ts
function hostArchivio() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}
function fotoDiCasa(indirizzo) {
  if (typeof indirizzo !== "string" || indirizzo.length === 0) return false;
  let url;
  try {
    url = new URL(indirizzo);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const casa = hostArchivio();
  if (!casa) return true;
  return url.host === casa;
}

// components/ui/RatingStars.tsx
import { Star, StarHalf } from "lucide-react";
import { jsx } from "react/jsx-runtime";
function RatingStars({
  rating,
  size = 16,
  className = ""
}) {
  const full = Math.floor(rating);
  const hasHalf = rating - full >= 0.5;
  return /* @__PURE__ */ jsx(
    "span",
    {
      role: "img",
      "aria-label": `${rating.toFixed(1)} su 5 stelle`,
      className: `inline-flex items-center ${className}`,
      children: Array.from({ length: 5 }).map((_, i) => {
        if (i < full) {
          return /* @__PURE__ */ jsx(Star, { size, className: "fill-accent-700 text-accent-700", "aria-hidden": true }, i);
        }
        if (i === full && hasHalf) {
          return /* @__PURE__ */ jsx(StarHalf, { size, className: "fill-accent-700 text-accent-700", "aria-hidden": true }, i);
        }
        return /* @__PURE__ */ jsx(Star, { size, strokeWidth: 2.2, className: "fill-none text-ink-400", "aria-hidden": true }, i);
      })
    }
  );
}

// components/store-sections/ReviewsSection.tsx
import { jsx as jsx2, jsxs } from "react/jsx-runtime";
function ReviewItem({ r, accent }) {
  const author = r.author ?? null;
  const verified = r.order_id != null;
  const photos = (Array.isArray(r.photo_urls) ? r.photo_urls : []).filter(fotoDiCasa);
  const [hasVoted, setHasVoted] = useState(false);
  const [count, setCount] = useState(r.helpful_count ?? 0);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    setCount(r.helpful_count ?? 0);
  }, [r.helpful_count]);
  useEffect(() => {
    let active = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !active) return;
      const { data } = await supabase.from("review_helpful").select("review_id").eq("review_id", r.id).eq("user_id", user.id).maybeSingle();
      if (active) setHasVoted(!!data);
    })();
    return () => {
      active = false;
    };
  }, [r.id]);
  const toggleHelpful = async () => {
    if (pending) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast.error("Accedi per segnalare una recensione utile");
      return;
    }
    const next = !hasVoted;
    setHasVoted(next);
    setCount((c) => Math.max(0, c + (next ? 1 : -1)));
    setPending(true);
    try {
      if (next) {
        const { error } = await supabase.from("review_helpful").insert({ review_id: r.id, user_id: user.id });
        if (error) throw error;
      } else {
        const { error } = await supabase.from("review_helpful").delete().eq("review_id", r.id).eq("user_id", user.id);
        if (error) throw error;
      }
    } catch {
      setHasVoted(!next);
      setCount((c) => Math.max(0, c + (next ? -1 : 1)));
      toast.error("Non \xE8 stato possibile registrare il voto");
    } finally {
      setPending(false);
    }
  };
  return /* @__PURE__ */ jsxs("li", { className: "rounded-2xl border border-cream-300 bg-white p-4 shadow-warm-sm", children: [
    /* @__PURE__ */ jsxs("div", { className: "mb-1.5 flex items-center gap-2.5", children: [
      /* @__PURE__ */ jsx2("span", { className: "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cream-200 text-primary-700", children: /* @__PURE__ */ jsx2(User, { size: 16, "aria-hidden": true }) }),
      /* @__PURE__ */ jsxs("div", { className: "min-w-0 flex-1", children: [
        /* @__PURE__ */ jsxs("div", { className: "flex flex-wrap items-center gap-x-2 gap-y-1", children: [
          /* @__PURE__ */ jsx2("strong", { className: "text-sm text-ink-900", children: author ?? "Cliente" }),
          /* @__PURE__ */ jsx2(RatingStars, { rating: r.rating, size: 14 }),
          verified && /* @__PURE__ */ jsxs("span", { className: "inline-flex items-center gap-1 rounded-full bg-olive-50 px-2 py-0.5 text-[11px] font-bold text-olive-700", children: [
            /* @__PURE__ */ jsx2(BadgeCheck, { size: 11, "aria-hidden": true }),
            " Acquisto verificato"
          ] })
        ] }),
        /* @__PURE__ */ jsx2("span", { className: "text-xs text-ink-400", children: new Date(r.created_at).toLocaleDateString("it-IT") })
      ] })
    ] }),
    r.comment && /* @__PURE__ */ jsx2("p", { className: "text-sm leading-relaxed text-ink-700", children: r.comment }),
    photos.length > 0 && /* @__PURE__ */ jsx2("div", { className: "mt-2.5 flex flex-wrap gap-2", children: photos.slice(0, 4).map((url, i) => /* @__PURE__ */ jsx2(
      "a",
      {
        href: url,
        target: "_blank",
        rel: "noopener noreferrer",
        className: "block h-[72px] w-[72px] overflow-hidden rounded-lg bg-cream-100 transition-opacity hover:opacity-80",
        children: /* @__PURE__ */ jsx2(
          next_image_default,
          {
            src: sizedImage(url, "thumb"),
            alt: `Foto ${i + 1} della recensione`,
            width: 72,
            height: 72,
            className: "h-full w-full object-cover",
            loading: "lazy"
          }
        )
      },
      i
    )) }),
    r.seller_reply && /* @__PURE__ */ jsxs("div", { className: "mt-2.5 ml-3 rounded-r-lg border-l-2 border-primary-200 bg-cream-50 py-1.5 pl-3 pr-2", children: [
      /* @__PURE__ */ jsx2("p", { className: "text-xs font-semibold text-primary-700", children: "Risposta del negozio" }),
      /* @__PURE__ */ jsx2("p", { className: "whitespace-pre-wrap text-sm text-ink-700", children: r.seller_reply })
    ] }),
    /* @__PURE__ */ jsxs(
      "button",
      {
        type: "button",
        onClick: toggleHelpful,
        "aria-pressed": hasVoted,
        className: `mt-3 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${hasVoted ? "" : "border-cream-300 text-ink-500 hover:text-ink-800"}`,
        style: hasVoted ? {
          backgroundColor: `color-mix(in srgb, ${accent} 12%, white)`,
          // 6/9/2026 — qui c'era `color: accent`, cioe' l'accent puro sopra il
          // suo stesso velo al 12%: su tre preset degli otto il testo scendeva
          // sotto 4,5:1 (oliva 4,10 · terracotta 4,20 · senape 4,27) mentre e'
          // scritto a 12px in grassetto. Scurendolo verso l'inchiostro il
          // peggiore risale a 6,10:1 e il colore resta quello del negozio.
          // Il bordo tiene l'accent pieno: li' l'identita' si vede e basta.
          color: `color-mix(in srgb, ${accent} 70%, #1C1A18)`,
          borderColor: accent
        } : void 0,
        children: [
          /* @__PURE__ */ jsx2(ThumbsUp, { size: 13, "aria-hidden": true }),
          " Utile",
          count > 0 ? ` \xB7 ${count}` : ""
        ]
      }
    )
  ] });
}
function ReviewsSection({ ctx }) {
  const { reviews, accent } = ctx;
  if (reviews.length === 0) return null;
  const avgRating = reviews.reduce((s, r) => s + r.rating, 0) / reviews.length;
  return /* @__PURE__ */ jsxs("div", { children: [
    /* @__PURE__ */ jsxs("div", { className: "mb-4 flex flex-wrap items-center gap-3", children: [
      /* @__PURE__ */ jsxs("h2", { className: "flex items-center gap-2 font-serif text-xl font-bold text-ink-900", children: [
        /* @__PURE__ */ jsx2(Star2, { size: 18, className: "fill-accent-400 text-accent-500", "aria-hidden": true }),
        "Recensioni clienti"
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-1.5", children: [
        /* @__PURE__ */ jsx2(RatingStars, { rating: avgRating, size: 16 }),
        /* @__PURE__ */ jsxs("span", { className: "text-sm font-medium text-ink-600", children: [
          avgRating.toFixed(1).replace(".", ","),
          " (",
          reviews.length,
          ")"
        ] })
      ] })
    ] }),
    /* @__PURE__ */ jsx2("ul", { className: "space-y-3", children: reviews.slice(0, 6).map((r) => /* @__PURE__ */ jsx2(ReviewItem, { r, accent }, r.id)) })
  ] });
}
export {
  ReviewsSection as default
};
