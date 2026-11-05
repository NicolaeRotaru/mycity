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
var stato = /* @__PURE__ */ new WeakMap();
function use(promessa) {
  if (!promessa || typeof promessa.then !== "function") return promessa;
  const noto = stato.get(promessa);
  if (noto?.esito === "fatto") return noto.valore;
  if (noto?.esito === "errore") throw noto.errore;
  if (!noto) {
    const riga = { esito: "in-corso" };
    stato.set(promessa, riga);
    promessa.then(
      (v) => {
        riga.esito = "fatto";
        riga.valore = v;
      },
      (e) => {
        riga.esito = "errore";
        riga.errore = e;
      }
    );
  }
  throw promessa;
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
var useRouter = () => rotta;

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

// app/seller/products/[id]/edit/page.tsx
init_supabase_client();
import { toast as toast11 } from "sonner";

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
var VELOCE_IN_MINUTI = `veloce in ${EXPRESS_ETA_MIN}-${EXPRESS_ETA_MAX} minuti`;
var ORE_DELLA_VELOCE = `dalle ${APERTURA_EXPRESS} alle ${CHIUSURA_EXPRESS}`;
var QUANDO_SI_PUO_LA_VELOCE = `${ORE_DELLA_VELOCE}, a negozi aperti, con un fattorino in servizio`;
var CONSEGNA_O_VELOCE_ADESSO = `Consegna a casa all'ora che scegli, oppure ${VELOCE_IN_MINUTI}`;
var CONSEGNA_FRASE_INTERA = `${CONSEGNA_O_VELOCE_ADESSO}, ${QUANDO_SI_PUO_LA_VELOCE}`;

// components/seller/ProductForm.tsx
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast as toast10 } from "sonner";
import { Eye as Eye2, Image as ImageIcon, ScanLine as ScanLine2, Trash2, Save, FileText, Bike, Truck, Wand2 as Wand22, ArrowUpDown, Loader2 as Loader28 } from "lucide-react";

// components/seller/PhotoFillButton.tsx
init_supabase_client();
import { toast } from "sonner";
import { Camera as Camera2, ImagePlus } from "lucide-react";

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
var TRADUCI_ACCESO = false;
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
function apiErrorMessage(body, fallback = "Operazione non riuscita") {
  if (!body || typeof body !== "object") return fallback;
  const e = body.error;
  if (typeof e === "string" && e.trim()) return e;
  if (e && typeof e === "object" && "message" in e) {
    const m = e.message;
    if (typeof m === "string" && m.trim()) return m;
  }
  return fallback;
}

// lib/image-resize.ts
var DEFAULT_MAX_DIMENSION = 1024;
async function drawToCanvas(file, maxDimension) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Lettura file fallita"));
    reader.readAsDataURL(file);
  });
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Immagine non valida"));
    i.src = dataUrl;
  });
  const ratio = Math.min(1, maxDimension / Math.max(img.width, img.height));
  const w = Math.round(img.width * ratio);
  const h = Math.round(img.height * ratio);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas non supportato");
  ctx.drawImage(img, 0, 0, w, h);
  return canvas;
}
async function resizeImageToBase64(file, maxDimension = DEFAULT_MAX_DIMENSION, quality = 0.85) {
  const canvas = await drawToCanvas(file, maxDimension);
  const outDataUrl = canvas.toDataURL("image/jpeg", quality);
  const base64 = outDataUrl.split(",")[1] ?? "";
  return { base64, mediaType: "image/jpeg" };
}
async function resizeImageToFile(file, maxDimension = 1600, quality = 0.85) {
  const canvas = await drawToCanvas(file, maxDimension);
  const blob = await new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/jpeg", quality);
  });
  if (!blob) throw new Error("Compressione immagine fallita");
  const baseName = file.name.replace(/\.[^.]+$/, "") || "foto";
  return new File([blob], `${baseName}.jpg`, { type: "image/jpeg" });
}

// components/seller/CameraCapture.tsx
import { Camera, RefreshCw, ImageOff } from "lucide-react";

// components/ui/Modal.tsx
import { createPortal } from "react-dom";
import { X } from "lucide-react";

// lib/cn.ts
function cn(...classes) {
  return classes.filter(Boolean).join(" ");
}

// components/ui/Modal.tsx
import { jsx, jsxs } from "react/jsx-runtime";
var SIZES = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-md",
  lg: "sm:max-w-lg",
  xl: "sm:max-w-2xl"
};
function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  closeOnBackdrop = true,
  closeOnEsc = true
}) {
  const dialogRef = useRef(null);
  const autoId = useId();
  const previousActiveElement = useRef(null);
  useEffect(() => {
    if (!open) return;
    previousActiveElement.current = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    setTimeout(() => {
      const first = dialogRef.current?.querySelector(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      first?.focus();
    }, 10);
    return () => {
      document.body.style.overflow = prevOverflow;
      previousActiveElement.current?.focus?.();
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (e.key === "Tab" && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);
  useEffect(() => {
    if (!open || !closeOnEsc) return;
    const handler = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, closeOnEsc, onClose]);
  if (!open) return null;
  if (typeof document === "undefined") return null;
  const titleId = `modal-title-${autoId}`;
  const descId = description ? `${titleId}-desc` : void 0;
  return createPortal(
    /* @__PURE__ */ jsx(
      "div",
      {
        onClick: closeOnBackdrop ? onClose : void 0,
        className: "fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4 animate-fade-in",
        children: /* @__PURE__ */ jsxs(
          "div",
          {
            ref: dialogRef,
            role: "dialog",
            "aria-modal": "true",
            "aria-labelledby": titleId,
            "aria-describedby": descId,
            onClick: (e) => e.stopPropagation(),
            className: cn(
              "bg-white w-full rounded-t-2xl sm:rounded-2xl shadow-warm-xl overflow-hidden max-h-[90vh] flex flex-col animate-slide-up",
              SIZES[size]
            ),
            children: [
              /* @__PURE__ */ jsxs("header", { className: "px-5 py-4 border-b border-cream-200 flex items-center justify-between flex-shrink-0", children: [
                /* @__PURE__ */ jsxs("div", { className: "flex-1 min-w-0", children: [
                  /* @__PURE__ */ jsx("h2", { id: titleId, className: "text-lg sm:text-xl font-bold text-ink-900 truncate", children: title }),
                  description && /* @__PURE__ */ jsx("p", { id: descId, className: "text-xs text-ink-500 mt-0.5", children: description })
                ] }),
                /* @__PURE__ */ jsx(
                  "button",
                  {
                    type: "button",
                    onClick: onClose,
                    "aria-label": "Chiudi",
                    className: "text-ink-500 hover:text-ink-900 hover:bg-cream-100 rounded-full p-2 transition-colors flex-shrink-0 ml-3",
                    children: /* @__PURE__ */ jsx(X, { size: 20 })
                  }
                )
              ] }),
              /* @__PURE__ */ jsx("div", { className: "flex-1 overflow-y-auto p-5", children }),
              footer && /* @__PURE__ */ jsx("footer", { className: "px-5 py-4 border-t border-cream-200 flex items-center justify-end gap-2 flex-shrink-0", children: footer })
            ]
          }
        )
      }
    ),
    document.body
  );
}

// components/seller/CameraCapture.tsx
import { jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
function CameraCapture({ open, onClose, onCapture }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const fallbackInputRef = useRef(null);
  const [facing, setFacing] = useState("environment");
  const [error, setError] = useState(null);
  const [ready, setReady] = useState(false);
  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);
  const start = useCallback(async (mode) => {
    setReady(false);
    setError(null);
    stopStream();
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("La fotocamera non \xE8 disponibile su questo dispositivo o browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: mode }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false
      });
      streamRef.current = stream;
      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        try {
          await v.play();
        } catch {
        }
      }
      setReady(true);
    } catch (e) {
      const name = e instanceof DOMException ? e.name : "";
      if (name === "NotAllowedError") setError("Permesso fotocamera negato.");
      else if (name === "NotFoundError" || name === "OverconstrainedError") setError("Nessuna fotocamera trovata.");
      else setError("Impossibile avviare la fotocamera.");
    }
  }, [stopStream]);
  useEffect(() => {
    if (open) void start(facing);
    return () => stopStream();
  }, [open]);
  const close = () => {
    stopStream();
    onClose();
  };
  const switchCamera = () => {
    const next = facing === "environment" ? "user" : "environment";
    setFacing(next);
    void start(next);
  };
  const capture = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const side = Math.min(v.videoWidth, v.videoHeight);
    const sx = (v.videoWidth - side) / 2;
    const sy = (v.videoHeight - side) / 2;
    const canvas = document.createElement("canvas");
    canvas.width = side;
    canvas.height = side;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, sx, sy, side, side, 0, 0, side, side);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `camera-${Date.now()}.jpg`, { type: "image/jpeg" });
        stopStream();
        onCapture(file);
        onClose();
      },
      "image/jpeg",
      0.9
    );
  };
  return /* @__PURE__ */ jsx2(
    Modal,
    {
      open,
      onClose: close,
      title: "Scatta foto al prodotto",
      description: "Centra il prodotto nel riquadro",
      size: "xl",
      closeOnBackdrop: false,
      children: error ? /* @__PURE__ */ jsxs2("div", { className: "text-center py-6 space-y-4", children: [
        /* @__PURE__ */ jsx2(ImageOff, { className: "mx-auto text-ink-400", size: 40, strokeWidth: 1.6, "aria-hidden": true }),
        /* @__PURE__ */ jsx2("p", { className: "text-sm text-ink-600", children: error }),
        /* @__PURE__ */ jsxs2(
          "button",
          {
            type: "button",
            onClick: () => fallbackInputRef.current?.click(),
            className: "inline-flex items-center gap-2 bg-primary-600 text-white px-4 py-2.5 rounded-lg font-semibold hover:bg-primary-700",
            children: [
              /* @__PURE__ */ jsx2(Camera, { size: 18, strokeWidth: 2.2, "aria-hidden": true }),
              " Usa la fotocamera del telefono"
            ]
          }
        ),
        /* @__PURE__ */ jsx2(
          "input",
          {
            ref: fallbackInputRef,
            type: "file",
            accept: "image/*",
            capture: "environment",
            className: "sr-only",
            onChange: (e) => {
              const f = e.target.files?.[0];
              if (f) {
                onCapture(f);
                onClose();
              }
            }
          }
        )
      ] }) : /* @__PURE__ */ jsxs2("div", { className: "space-y-3", children: [
        /* @__PURE__ */ jsxs2("div", { className: "relative mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-xl bg-black", children: [
          /* @__PURE__ */ jsx2("video", { ref: videoRef, autoPlay: true, muted: true, playsInline: true, className: "h-full w-full object-cover" }),
          /* @__PURE__ */ jsx2("div", { className: "pointer-events-none absolute inset-0 flex items-center justify-center", children: /* @__PURE__ */ jsxs2("div", { className: "relative h-[78%] w-[78%] rounded-lg border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]", children: [
            /* @__PURE__ */ jsx2("div", { className: "absolute inset-y-0 left-1/3 w-px bg-white/30" }),
            /* @__PURE__ */ jsx2("div", { className: "absolute inset-y-0 left-2/3 w-px bg-white/30" }),
            /* @__PURE__ */ jsx2("div", { className: "absolute inset-x-0 top-1/3 h-px bg-white/30" }),
            /* @__PURE__ */ jsx2("div", { className: "absolute inset-x-0 top-2/3 h-px bg-white/30" })
          ] }) }),
          !ready && /* @__PURE__ */ jsx2("div", { className: "absolute inset-0 flex items-center justify-center text-sm text-white/80", children: "Avvio fotocamera\u2026" })
        ] }),
        /* @__PURE__ */ jsx2("p", { className: "text-center text-xs text-ink-500", children: "Buona luce, prodotto centrato. Lo sfondo lo puoi pulire dopo con \u201CSfondo bianco\u201D." }),
        /* @__PURE__ */ jsxs2("div", { className: "flex items-center justify-center gap-3", children: [
          /* @__PURE__ */ jsxs2(
            "button",
            {
              type: "button",
              onClick: switchCamera,
              className: "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-ink-700 ring-1 ring-cream-300 hover:bg-cream-50",
              children: [
                /* @__PURE__ */ jsx2(RefreshCw, { size: 16, strokeWidth: 2.2, "aria-hidden": true }),
                " Cambia"
              ]
            }
          ),
          /* @__PURE__ */ jsxs2(
            "button",
            {
              type: "button",
              onClick: capture,
              disabled: !ready,
              className: "inline-flex items-center gap-2 rounded-full bg-primary-600 px-6 py-3 font-semibold text-white shadow-md hover:bg-primary-700 disabled:opacity-50",
              children: [
                /* @__PURE__ */ jsx2(Camera, { size: 20, strokeWidth: 2.2, "aria-hidden": true }),
                " Scatta"
              ]
            }
          )
        ] })
      ] })
    }
  );
}

// components/seller/PhotoFillButton.tsx
import { Fragment as Fragment2, jsx as jsx3, jsxs as jsxs3 } from "react/jsx-runtime";
var PhotoFillButton = ({ onFilled, onImages }) => {
  const [state, setState] = useState("idle");
  const [cameraOpen, setCameraOpen] = useState(false);
  const inputRef = useRef(null);
  const analyzeFiles = async (files) => {
    const list = files.slice(0, 4);
    if (list.length === 0) return;
    setState("analyzing");
    try {
      const images = await Promise.all(
        list.map(async (f) => {
          const { base64, mediaType } = await resizeImageToBase64(f);
          return { image_base64: base64, media_type: mediaType };
        })
      );
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/vision/extract-product", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...session?.access_token ? { authorization: `Bearer ${session.access_token}` } : {}
        },
        body: JSON.stringify({ images })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(apiErrorMessage(data, "Errore sconosciuto"));
      }
      onFilled(data);
      onImages?.(list);
      if (!data.category_id) {
        toast.success("Campi compilati. Seleziona manualmente la categoria.");
      } else {
        toast.success("Campi compilati. Controlla e modifica se serve.");
      }
      const q = data.image_quality;
      if (q && typeof q.score === "number" && q.score < 0.5) {
        const why = q.issues?.length ? ` (${q.issues.slice(0, 2).join(", ")})` : "";
        toast(`Foto poco chiara${why}: valuta di rifarla con pi\xF9 luce e sfondo pulito.`, { icon: /* @__PURE__ */ jsx3(Camera2, { size: 16 }) });
      }
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : "Estrazione fallita. Riprova.";
      toast.error(msg);
    } finally {
      setState("idle");
    }
  };
  const handleFile = (e) => {
    const input = e.target;
    const files = Array.from(input.files ?? []);
    void analyzeFiles(files).finally(() => {
      input.value = "";
    });
  };
  const busy = state === "analyzing";
  return /* @__PURE__ */ jsxs3("div", { className: "bg-gradient-to-r from-primary-600 to-secondary-600 text-white rounded-lg p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4", children: [
    /* @__PURE__ */ jsxs3("div", { className: "flex-1", children: [
      /* @__PURE__ */ jsxs3("p", { className: "font-bold text-base sm:text-lg flex items-center gap-2", children: [
        /* @__PURE__ */ jsx3(Camera2, { size: 20, "aria-hidden": true }),
        /* @__PURE__ */ jsx3("span", { children: "Compila con una foto" })
      ] }),
      /* @__PURE__ */ jsx3("p", { className: "text-sm text-primary-100", children: "Scatta o carica 2\u20134 foto (fronte + etichetta) e l'AI compila nome, descrizione, categoria, prezzo e caratteristiche per te." })
    ] }),
    /* @__PURE__ */ jsxs3("div", { className: "flex items-center gap-2 w-full sm:w-auto", children: [
      /* @__PURE__ */ jsx3(
        "button",
        {
          type: "button",
          onClick: () => setCameraOpen(true),
          disabled: busy,
          className: "flex-1 sm:flex-none bg-white text-primary-800 hover:bg-primary-50 disabled:opacity-60 px-4 py-2.5 rounded-md font-semibold whitespace-nowrap shadow-md flex items-center justify-center gap-2",
          children: busy ? /* @__PURE__ */ jsxs3(Fragment2, { children: [
            /* @__PURE__ */ jsx3("span", { className: "inline-block w-4 h-4 border-2 border-primary-700/30 border-t-primary-700 rounded-full animate-spin" }),
            /* @__PURE__ */ jsx3("span", { children: "Analizzo..." })
          ] }) : /* @__PURE__ */ jsxs3(Fragment2, { children: [
            /* @__PURE__ */ jsx3(Camera2, { size: 18, strokeWidth: 2.2, "aria-hidden": true }),
            /* @__PURE__ */ jsx3("span", { children: "Scatta foto" })
          ] })
        }
      ),
      /* @__PURE__ */ jsxs3(
        "button",
        {
          type: "button",
          onClick: () => inputRef.current?.click(),
          disabled: busy,
          className: "bg-white/15 hover:bg-white/25 text-white disabled:opacity-60 px-4 py-2.5 rounded-md font-semibold whitespace-nowrap flex items-center justify-center gap-2 ring-1 ring-white/40",
          children: [
            /* @__PURE__ */ jsx3(ImagePlus, { size: 18, strokeWidth: 2.2, "aria-hidden": true }),
            /* @__PURE__ */ jsx3("span", { children: "Galleria" })
          ]
        }
      )
    ] }),
    /* @__PURE__ */ jsx3(
      "input",
      {
        ref: inputRef,
        type: "file",
        accept: "image/*",
        multiple: true,
        onChange: handleFile,
        className: "hidden"
      }
    ),
    /* @__PURE__ */ jsx3(
      CameraCapture,
      {
        open: cameraOpen,
        onClose: () => setCameraOpen(false),
        onCapture: (file) => {
          void analyzeFiles([file]);
        }
      }
    )
  ] });
};
var PhotoFillButton_default = PhotoFillButton;

// components/seller/ProductChatAssistant.tsx
init_supabase_client();
import { Sparkles, Loader2, Send, X as X2, Check, AlertCircle } from "lucide-react";
import { toast as toast2 } from "sonner";

// lib/category-attributes.ts
var NESSUN_ALLERGENE = "Nessuno dei 14 allergeni";
var CATEGORY_ATTRIBUTES = {
  alimentari: [
    { key: "marca", label: "Marca", type: "text", placeholder: "Es. Barilla, Mulino Bianco" },
    { key: "peso", label: "Peso / Quantit\xE0", type: "text", placeholder: "Es. 500g, 1L, 6 pezzi", variantable: true },
    { key: "confezione", label: "Tipo di confezione", type: "select", options: ["Busta", "Barattolo", "Bottiglia", "Scatola", "Vasetto", "Sottovuoto", "Lattina", "Brick", "Sfuso"] },
    { key: "origine", label: "Origine", type: "text", placeholder: "Es. Italia, Sicilia, Piacenza" },
    { key: "bio", label: "Biologico", type: "checkbox" },
    { key: "senza_glutine", label: "Senza glutine", type: "checkbox" },
    { key: "senza_lattosio", label: "Senza lattosio", type: "checkbox" },
    { key: "vegano", label: "Vegano", type: "checkbox" },
    {
      key: "allergeni",
      label: "Allergeni",
      type: "text",
      required: true,
      placeholder: "Es. Glutine, lattosio, frutta a guscio",
      helpText: `Obbligatorio. Se il prodotto non ne contiene nessuno, scrivi \xAB${NESSUN_ALLERGENE}\xBB.`
    },
    { key: "ingredienti", label: "Ingredienti", type: "textarea", required: true, placeholder: "Lista degli ingredienti" },
    { key: "valori_nutrizionali", label: "Valori nutrizionali (per 100g)", type: "textarea", placeholder: "Energia, grassi, carboidrati, proteine, sale" },
    { key: "conservazione", label: "Conservazione", type: "select", options: ["Temperatura ambiente", "Frigorifero", "Freezer", "Luogo fresco e asciutto"] },
    { key: "scadenza", label: "Scadenza", type: "date" },
    { key: "ean", label: "Codice EAN", type: "text", placeholder: "8001234567890" }
  ],
  abbigliamento: [
    { key: "marca", label: "Marca", type: "text", placeholder: "Es. Nike, Zara, Levi's" },
    { key: "taglia", label: "Taglia", type: "select", options: ["XS", "S", "M", "L", "XL", "XXL", "3XL", "36", "38", "40", "42", "44", "46", "48", "50", "Unica"], variantable: true },
    { key: "colore", label: "Colore", type: "text", placeholder: "Es. Nero, Blu navy, Verde militare", variantable: true },
    { key: "genere", label: "Genere", type: "select", options: ["Donna", "Uomo", "Unisex", "Bambina", "Bambino", "Neonato"] },
    { key: "tipo_capo", label: "Tipo di capo", type: "text", placeholder: "Es. T-shirt, Jeans, Giacca, Felpa" },
    { key: "materiale", label: "Materiale", type: "text", placeholder: "Es. Cotone, Lana, Pelle" },
    { key: "composizione", label: "Composizione", type: "text", placeholder: "Es. 80% cotone, 20% poliestere" },
    { key: "vestibilita", label: "Vestibilit\xE0", type: "select", options: ["Slim", "Regular", "Oversize", "Aderente", "Comoda"] },
    { key: "maniche", label: "Maniche", type: "select", options: ["Corte", "Lunghe", "Tre quarti", "Senza maniche"] },
    { key: "scollo", label: "Scollo", type: "select", options: ["Girocollo", "A V", "A barca", "Dolcevita", "Con cappuccio", "Camicia"] },
    { key: "stagione", label: "Stagione", type: "select", options: ["Primavera / Estate", "Autunno / Inverno", "Tutte le stagioni"] },
    { key: "lavaggio", label: "Cura del capo", type: "text", placeholder: "Es. Lavabile in lavatrice 30\xB0" },
    { key: "ean", label: "Codice EAN", type: "text", placeholder: "8001234567890" }
  ],
  casa: [
    { key: "marca", label: "Marca", type: "text", placeholder: "Es. IKEA, Bialetti" },
    { key: "tipo_prodotto", label: "Tipo di prodotto", type: "text", placeholder: "Es. Sedia, Pentola, Lampada, Tappeto" },
    { key: "dimensioni", label: "Dimensioni (LxPxA)", type: "text", placeholder: "Es. 60x40x30 cm", variantable: true },
    { key: "peso", label: "Peso", type: "text", placeholder: "Es. 1.2 kg" },
    { key: "capacita", label: "Capacit\xE0", type: "text", placeholder: "Es. 1.5 L, 24 cm" },
    { key: "materiale", label: "Materiale", type: "text", placeholder: "Es. Legno di rovere, ceramica, vetro" },
    { key: "colore", label: "Colore", type: "text", variantable: true },
    { key: "stile", label: "Stile", type: "select", options: ["Moderno", "Classico", "Industriale", "Scandinavo", "Rustico", "Vintage", "Minimal"] },
    { key: "numero_pezzi", label: "Numero di pezzi", type: "number", placeholder: "Es. 4" },
    { key: "montaggio", label: "Montaggio richiesto", type: "checkbox" },
    { key: "alimentazione", label: "Alimentazione", type: "select", options: ["Nessuna", "Elettrica", "A batteria", "Manuale", "Gas", "USB"] },
    { key: "potenza_watt", label: "Potenza (W)", type: "number", placeholder: "Es. 1200" },
    { key: "ean", label: "Codice EAN", type: "text", placeholder: "8001234567890" }
  ],
  elettronica: [
    { key: "marca", label: "Marca", type: "text", placeholder: "Es. Apple, Samsung, Sony" },
    { key: "modello", label: "Modello", type: "text", placeholder: "Es. iPhone 15 Pro, Galaxy S24" },
    { key: "colore", label: "Colore", type: "text", variantable: true },
    { key: "memoria", label: "Memoria / Storage", type: "text", placeholder: "Es. 128GB, 1TB", variantable: true },
    { key: "ram", label: "RAM", type: "text", placeholder: "Es. 8GB" },
    { key: "display", label: "Display", type: "text", placeholder: 'Es. 6.1" OLED 120Hz' },
    { key: "connettivita", label: "Connettivit\xE0", type: "text", placeholder: "Es. Wi-Fi 6, Bluetooth 5.3, 5G" },
    { key: "batteria", label: "Batteria / Autonomia", type: "text", placeholder: "Es. 5000 mAh, fino a 20h" },
    { key: "sistema_operativo", label: "Sistema operativo", type: "text", placeholder: "Es. iOS 18, Android 14" },
    { key: "alimentazione", label: "Alimentazione", type: "select", options: ["Batteria ricaricabile", "A batterie", "Rete elettrica", "USB-C", "USB"] },
    { key: "garanzia_mesi", label: "Garanzia (mesi)", type: "number", placeholder: "24" },
    { key: "accessori", label: "Accessori inclusi", type: "text", placeholder: "Es. Caricabatterie, custodia, cavo USB" },
    { key: "ean", label: "Codice EAN", type: "text", placeholder: "8001234567890" }
  ],
  libri: [
    { key: "autore", label: "Autore", type: "text" },
    { key: "editore", label: "Editore", type: "text", placeholder: "Es. Einaudi, Mondadori" },
    { key: "genere_letterario", label: "Genere", type: "select", options: ["Romanzo", "Saggistica", "Giallo / Thriller", "Fantasy / Fantascienza", "Biografia", "Storico", "Crescita personale", "Bambini / Ragazzi", "Fumetti / Manga", "Cucina", "Arte", "Scolastico", "Altro"] },
    { key: "formato", label: "Formato", type: "select", options: ["Brossura", "Cartonato", "Tascabile", "Audiolibro", "Ebook"], variantable: true },
    { key: "lingua", label: "Lingua", type: "text", placeholder: "Italiano" },
    { key: "anno", label: "Anno di pubblicazione", type: "number", placeholder: "2024" },
    { key: "pagine", label: "Numero di pagine", type: "number" },
    { key: "collana", label: "Collana", type: "text" },
    { key: "edizione", label: "Edizione", type: "text", placeholder: "Es. Prima edizione" },
    { key: "isbn", label: "ISBN", type: "text", placeholder: "978-..." }
  ],
  giardino: [
    { key: "marca", label: "Marca", type: "text" },
    { key: "tipo", label: "Tipo prodotto", type: "select", options: ["Pianta da interno", "Pianta da esterno", "Semi", "Attrezzo", "Vaso / Fioriera", "Concime / Terriccio", "Arredo da giardino", "Irrigazione", "Altro"] },
    { key: "specie", label: "Specie / Variet\xE0", type: "text", placeholder: "Es. Phalaenopsis, Basilico Genovese" },
    { key: "dimensioni", label: "Dimensioni", type: "text", placeholder: "Es. Vaso 14 cm, pianta H 60 cm", variantable: true },
    { key: "colore", label: "Colore", type: "text", variantable: true },
    { key: "materiale", label: "Materiale", type: "text", placeholder: "Es. Terracotta, plastica, metallo" },
    { key: "uso", label: "Uso", type: "select", options: ["Interno", "Esterno", "Interno ed esterno"] },
    { key: "esposizione", label: "Esposizione consigliata", type: "select", options: ["Pieno sole", "Mezz'ombra", "Ombra", "Sole filtrato"] },
    { key: "irrigazione", label: "Irrigazione", type: "select", options: ["Frequente", "Moderata", "Scarsa"] },
    { key: "stagione", label: "Stagione", type: "select", options: ["Primavera", "Estate", "Autunno", "Inverno", "Tutto l'anno"] },
    { key: "ean", label: "Codice EAN", type: "text", placeholder: "8001234567890" }
  ],
  bellezza: [
    { key: "marca", label: "Marca", type: "text" },
    { key: "tipo_prodotto", label: "Tipo di prodotto", type: "select", options: ["Crema viso", "Crema corpo", "Siero", "Detergente", "Shampoo", "Balsamo", "Profumo", "Make-up", "Smalto", "Olio", "Maschera", "Integratore", "Altro"] },
    { key: "volume", label: "Volume / Quantit\xE0", type: "text", placeholder: "Es. 50ml, 100g", variantable: true },
    { key: "colore", label: "Colore / Tonalit\xE0", type: "text", placeholder: "Es. Rosso 01, Nude", variantable: true },
    { key: "profumo", label: "Profumo / Fragranza", type: "text", placeholder: "Es. Lavanda, agrumi, floreale", variantable: true },
    { key: "tipo_pelle", label: "Tipo di pelle", type: "select", options: ["Tutte", "Secca", "Grassa", "Mista", "Sensibile", "Matura"] },
    { key: "ingredienti_chiave", label: "Ingredienti chiave", type: "text", placeholder: "Es. Acido ialuronico, vitamina C" },
    { key: "bio_naturale", label: "Bio / Naturale", type: "checkbox" },
    { key: "vegano", label: "Vegano", type: "checkbox" },
    { key: "cruelty_free", label: "Cruelty free", type: "checkbox" },
    { key: "scadenza", label: "Scadenza", type: "date" },
    { key: "pao", label: "PAO (mesi dall'apertura)", type: "number", placeholder: "12" },
    { key: "ean", label: "Codice EAN", type: "text", placeholder: "8001234567890" }
  ],
  sport: [
    { key: "marca", label: "Marca", type: "text" },
    { key: "tipo_prodotto", label: "Tipo di prodotto", type: "text", placeholder: "Es. Scarpe running, Tappetino, Manubri" },
    { key: "taglia", label: "Taglia", type: "text", placeholder: "Es. M, 42, Unica", variantable: true },
    { key: "colore", label: "Colore", type: "text", variantable: true },
    { key: "tipo_attivita", label: "Attivit\xE0", type: "select", options: ["Running", "Yoga", "Palestra", "Calcio", "Tennis", "Trekking", "Ciclismo", "Nuoto", "Outdoor", "Fitness", "Altro"] },
    { key: "genere", label: "Genere", type: "select", options: ["Donna", "Uomo", "Unisex", "Bambino"] },
    { key: "livello", label: "Livello", type: "select", options: ["Principiante", "Intermedio", "Avanzato", "Professionale"] },
    { key: "materiale", label: "Materiale", type: "text", placeholder: "Es. Poliestere tecnico, neoprene" },
    { key: "peso", label: "Peso", type: "text", placeholder: "Es. 250g, 5 kg" },
    { key: "dimensioni", label: "Dimensioni", type: "text", placeholder: "Es. 180x60 cm" },
    { key: "ean", label: "Codice EAN", type: "text", placeholder: "8001234567890" }
  ]
};
var AI_ATTR_TO_FIELD = {
  marca: "marca",
  modello: "modello",
  colore: "colore",
  taglia: "taglia",
  materiale: "materiale",
  peso: "peso",
  dimensioni: "dimensioni",
  origine: "origine",
  allergeni: "allergeni",
  ingredienti: "ingredienti",
  scadenza: "scadenza",
  ean: "ean",
  autore: "autore",
  editore: "editore",
  anno: "anno",
  pagine: "pagine",
  lingua: "lingua",
  isbn: "isbn",
  formato: "formato"
};
function findLabelForKey(key) {
  for (const fields of Object.values(CATEGORY_ATTRIBUTES)) {
    const f = fields.find((field) => field.key === key);
    if (f) return f.label;
  }
  return key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, " ");
}
function attributoSpuntato(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const parola = value.trim().toLowerCase();
    return parola === "1" || PAROLE_DEL_SI.has(parola);
  }
  return false;
}
var PAROLE_DEL_SI = /* @__PURE__ */ new Set(["true", "s\xEC", "si", "yes", "vero"]);
var CHIAVI_FUORI_DALLA_GRIGLIA = Object.freeze(["alt_text"]);
function getAttributesForCategory(categories, categoryId) {
  if (!categoryId) return { fields: [], topSlug: null };
  let cur = categories.find((c) => c.id === categoryId);
  while (cur?.parent_id) {
    const parent = categories.find((c) => c.id === cur.parent_id);
    if (!parent) break;
    cur = parent;
  }
  if (!cur) return { fields: [], topSlug: null };
  return { fields: CATEGORY_ATTRIBUTES[cur.slug] ?? [], topSlug: cur.slug };
}

// lib/products/schema.ts
import * as z from "zod";
var PRODUCT_UNITS = ["pezzo", "kg", "g", "l", "ml", "confezione", "paio", "m"];
var UNIT_OPTIONS = [
  { value: "pezzo", label: "\u20AC / pezzo" },
  { value: "kg", label: "\u20AC / kg" },
  { value: "g", label: "\u20AC / 100 g" },
  { value: "l", label: "\u20AC / litro" },
  { value: "ml", label: "\u20AC / 100 ml" },
  { value: "confezione", label: "\u20AC / confezione" },
  { value: "paio", label: "\u20AC / paio" },
  { value: "m", label: "\u20AC / metro" }
];
var UNIT_SUFFIX = {
  pezzo: "",
  kg: "/kg",
  g: "/100g",
  l: "/L",
  ml: "/100ml",
  confezione: "/conf.",
  paio: "/paio",
  m: "/m"
};
var CONDITION_LABELS = {
  nuovo: "Nuovo",
  usato: "Usato",
  ricondizionato: "Ricondizionato"
};
var CONDIZIONI_DA_SCEGLIERE = ["nuovo"];
function condizioneDaScegliere(c) {
  return typeof c === "string" && CONDIZIONI_DA_SCEGLIERE.includes(c);
}
function normalizeCondition(s) {
  const t = s.toLowerCase();
  if (t.includes("ricond")) return "ricondizionato";
  if (t.includes("usat")) return "usato";
  if (t.includes("nuov")) return "nuovo";
  return "";
}
function condizioneDalSuggerimento(s) {
  const c = normalizeCondition(s);
  if (c === "") return "";
  return condizioneDaScegliere(c) ? c : null;
}
var SELLER_STATUSES = ["available", "draft", "sold"];
function createProductSchema(opts) {
  const minDesc = opts?.minDescription ?? 10;
  return z.object({
    name: z.string().min(3, "Almeno 3 caratteri"),
    description: z.string().min(
      minDesc,
      minDesc >= 30 ? "Descrivi bene il prodotto: almeno 30 caratteri (materiali, taglia, condizione\u2026)" : `Almeno ${minDesc} caratteri`
    ),
    price: z.coerce.number().positive("Inserisci un prezzo valido"),
    // Prezzo pieno barrato: opzionale. Stringa vuota → undefined.
    compareAtPrice: z.preprocess(
      (v) => v === "" || v === null || v === void 0 ? void 0 : Number(v),
      z.number().positive("Inserisci un importo valido").optional()
    ),
    // Disabilitato quando "illimitato" è attivo → RHF lo esclude (undefined).
    stock: z.coerce.number().int("Numero intero").min(0, "Non pu\xF2 essere negativo").optional(),
    category_id: z.string().min(1, "Seleziona una categoria")
  }).refine(
    (d) => d.compareAtPrice == null || d.compareAtPrice > d.price,
    { path: ["compareAtPrice"], message: "Il prezzo pieno deve superare il prezzo di vendita" }
  );
}
function buildProductPayload(input) {
  const { values, imageUrls, attributes, unit, condition, tags, expressEnabled, unlimitedStock, status } = input;
  return {
    name: values.name.trim(),
    description: values.description.trim(),
    price: values.price,
    compare_at_price: values.compareAtPrice != null && !Number.isNaN(values.compareAtPrice) ? values.compareAtPrice : null,
    unit,
    condition: condition || null,
    stock: unlimitedStock ? null : values.stock ?? 0,
    category_id: values.category_id,
    images: imageUrls,
    attributes,
    tags,
    express_enabled: expressEnabled,
    status
  };
}
function scortaCambiata(scritta, vista) {
  if (vista === void 0) return true;
  if (scritta === null || vista === null) return scritta !== vista;
  const a = Number(scritta);
  const b = Number(vista);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return true;
  return a !== b;
}

// lib/products/aiPatch.ts
var CAMPI_DICHIARATIVI = [
  "allergeni",
  "ingredienti",
  "valori_nutrizionali",
  "senza_glutine",
  "senza_lattosio",
  "vegano",
  "bio",
  "origine",
  "scadenza"
];
function chiaveCampo(chiaveAi) {
  const norm = String(chiaveAi).trim().toLowerCase().replace(/[\s-]+/g, "_");
  return AI_ATTR_TO_FIELD[norm] ?? norm;
}
function eCampoDichiarativo(chiaveAi) {
  return CAMPI_DICHIARATIVI.includes(chiaveCampo(chiaveAi));
}
function separaCampiDichiarativi(patch) {
  return separaCampi(patch, eCampoDichiarativo);
}
function separaCampi(patch, daSeparare) {
  const scartati = [];
  const sorgente = patch;
  let fuori = null;
  const attrs = sorgente.attributes;
  if (attrs && typeof attrs === "object" && !Array.isArray(attrs)) {
    const tenuti = {};
    let tolto = false;
    for (const [k, v] of Object.entries(attrs)) {
      if (!daSeparare(k)) {
        tenuti[k] = v;
        continue;
      }
      tolto = true;
      const valore = voceComeTesto(v ?? "").trim();
      if (valore) {
        const chiave = chiaveCampo(k);
        scartati.push({ chiave, etichetta: findLabelForKey(chiave), azione: "scrivi", valore });
      }
    }
    if (tolto) {
      fuori = { ...sorgente };
      if (Object.keys(tenuti).length > 0) fuori.attributes = tenuti;
      else delete fuori.attributes;
    }
  }
  const via = sorgente.attributes_remove;
  if (Array.isArray(via)) {
    const tenute = via.filter((k) => !daSeparare(voceComeTesto(k)));
    if (tenute.length !== via.length) {
      for (const k of via) {
        const testo = voceComeTesto(k);
        if (!daSeparare(testo)) continue;
        const chiave = chiaveCampo(testo);
        scartati.push({ chiave, etichetta: findLabelForKey(chiave), azione: "togli" });
      }
      fuori = fuori ?? { ...sorgente };
      if (tenute.length > 0) fuori.attributes_remove = tenute;
      else delete fuori.attributes_remove;
    }
  }
  return { patch: fuori ?? sorgente, scartati };
}
function senzaDichiarazioniFuoriScheda(patch, campi) {
  if (campi === null) return patch;
  return separaCampi(patch, (k) => eCampoDichiarativo(k) && !campi.some((f) => f.key === chiaveCampo(k))).patch;
}
function motivoDichiarazioneRifiutata(s) {
  return s.azione === "togli" ? `${s.etichetta} NON tolto: lo decidi tu nella scheda del prodotto` : `${s.etichetta} NON compilato dall'assistente: lo scrivi tu nella scheda (proposta: \xAB${s.valore ?? ""}\xBB)`;
}
var REGOLA_CAMPI_DICHIARATIVI = `CAMPI CHE NON TOCCHI MAI: ${CAMPI_DICHIARATIVI.join(", ")}. Sono la dichiarazione del venditore su un alimento (allergeni, ingredienti e simili): non compilarli, non cambiarli e non toglierli, nemmeno se ti sembrano ovvi dal nome o dalla foto. Se mancano, dillo al venditore e lascia che li scriva lui nella scheda del prodotto.`;
function voceComeTesto(v) {
  try {
    return String(v);
  } catch {
    return "";
  }
}
var eTesto = (v) => typeof v === "string";
var eNumero = (v) => typeof v === "number";
var TIPI_DEI_CAMPI = {
  name: eTesto,
  description: eTesto,
  unit: eTesto,
  status: eTesto,
  subcategory_name: eTesto,
  condition: (v) => v === null || eTesto(v),
  compare_at_price: (v) => v === null || eNumero(v),
  price: eNumero,
  stock: eNumero,
  unlimited_stock: (v) => typeof v === "boolean"
};
function propostaLeggibile(proposta) {
  const fuori = { ...proposta };
  for (const [campo, buono] of Object.entries(TIPI_DEI_CAMPI)) {
    if (campo in fuori && !buono(fuori[campo])) delete fuori[campo];
  }
  for (const elenco of ["attributes_remove", "tags"]) {
    if (!(elenco in fuori)) continue;
    const lette = vociComeTesto(fuori[elenco]);
    if (lette === null) delete fuori[elenco];
    else fuori[elenco] = lette;
  }
  return fuori;
}
function vociComeTesto(voci) {
  if (!Array.isArray(voci)) return null;
  const lette = voci.map(voceComeTesto).filter((v) => v !== "");
  return voci.length > 0 && lette.length === 0 ? null : lette;
}
function campiDopoLaProposta(categorie, proposta, categoriaAttuale) {
  const nuova = proposta.category_slug ? resolveCategoryId(categorie, proposta.category_slug, proposta.subcategory_name) : null;
  const { fields, topSlug } = getAttributesForCategory(categorie, nuova ?? categoriaAttuale ?? null);
  return topSlug === null ? null : fields;
}
function resolveCategoryId(categories, slug, subName) {
  const top = categories.find((c) => !c.parent_id && c.slug === slug);
  if (!top) return null;
  if (subName) {
    const norm = subName.trim().toLowerCase();
    const sub = categories.find(
      (c) => c.parent_id === top.id && c.name.toLowerCase() === norm
    );
    if (sub) return sub.id;
  }
  return top.id;
}
var BANDA_PREZZO_AI = 0.3;
function prezzoAiFuoriBanda(proposto, attuale) {
  const partenza = Number(attuale ?? 0);
  if (!(partenza > 0)) return false;
  return Math.abs(proposto - partenza) / partenza > BANDA_PREZZO_AI;
}
function motivoPrezzoRifiutato(proposto, attuale) {
  const partenza = Number(attuale ?? 0);
  return `prezzo NON applicato (${partenza.toFixed(2)} \u2192 ${proposto.toFixed(2)} \u20AC: oltre il ${Math.round(
    BANDA_PREZZO_AI * 100
  )}%, va deciso a mano)`;
}
function patchAiPerIlForm(patch, opts) {
  const rifiutati = [];
  const { patch: senzaDichiarazioni, scartati } = separaCampiDichiarativi(patch);
  const proposte = [];
  for (const s of scartati) {
    const motivo = motivoDichiarazioneRifiutata(s);
    rifiutati.push(motivo);
    if (s.azione === "scrivi" && s.valore) proposte.push({ chiave: s.chiave, valore: s.valore, motivo });
  }
  if (typeof senzaDichiarazioni.price === "number" && senzaDichiarazioni.price > 0 && prezzoAiFuoriBanda(senzaDichiarazioni.price, opts.prezzoAttuale)) {
    rifiutati.unshift(motivoPrezzoRifiutato(senzaDichiarazioni.price, opts.prezzoAttuale));
    const { price: _scartato, ...resto } = senzaDichiarazioni;
    return { patch: resto, rifiutati, proposte };
  }
  return { patch: senzaDichiarazioni, rifiutati, proposte };
}
function propostaPerIlModulo(proposta, campi) {
  const campo = campi.find((f) => f.key === proposta.chiave);
  if (!campo) return { motivo: proposta.motivo };
  const valore = campo.type === "checkbox" ? attributoSpuntato(proposta.valore) : proposta.valore.trim();
  return { motivo: proposta.motivo, valore };
}
function unisciVociDaControllare(prima, nuove) {
  const ultime = /* @__PURE__ */ new Map();
  for (const v of nuove) {
    ultime.delete(v.id);
    ultime.set(v.id, v);
  }
  return [...prima.filter((v) => !ultime.has(v.id)), ...ultime.values()];
}
function dichiarazioniDaRivedere(proposta) {
  const { scartati } = separaCampiDichiarativi(proposta);
  const attributi = {};
  const daTogliere = [];
  for (const s of scartati) {
    if (s.azione === "scrivi" && s.valore) attributi[s.chiave] = s.valore;
    else if (s.azione === "togli" && !daTogliere.includes(s.chiave)) daTogliere.push(s.chiave);
  }
  const fuori = {};
  if (Object.keys(attributi).length > 0) fuori.attributes = attributi;
  if (daTogliere.length > 0) fuori.attributes_remove = daTogliere;
  return fuori;
}
function pianoPatchPerIlModulo(suggerimento, ctx) {
  const letta = propostaLeggibile(suggerimento);
  const campi = campiDopoLaProposta(ctx.categorie, letta, ctx.categoriaAttuale);
  const fields = campi ?? [];
  const proposta = senzaDichiarazioniFuoriScheda(letta, campi);
  const { patch, rifiutati, proposte } = patchAiPerIlForm(proposta, { prezzoAttuale: ctx.prezzoAttuale });
  const motiviConProposta = new Set(proposte.map((p) => p.motivo));
  const avvisi = rifiutati.filter((m) => !motiviConProposta.has(m));
  const scritture = [];
  if (typeof patch.name === "string" && patch.name.trim()) {
    scritture.push({ campo: "name", valore: patch.name.trim(), etichetta: "nome" });
  }
  if (typeof patch.description === "string" && patch.description.trim()) {
    scritture.push({ campo: "description", valore: patch.description.trim(), etichetta: "descrizione" });
  }
  if (typeof patch.price === "number" && patch.price > 0) {
    scritture.push({ campo: "price", valore: patch.price, etichetta: "prezzo" });
  }
  if ("compare_at_price" in patch) {
    if (patch.compare_at_price == null) {
      scritture.push({ campo: "compareAtPrice", valore: null, etichetta: "prezzo pieno" });
    }
  }
  if (patch.unit && PRODUCT_UNITS.includes(patch.unit)) {
    scritture.push({ campo: "unit", valore: patch.unit, etichetta: "unit\xE0" });
  }
  if ("condition" in patch) {
    const valore = patch.condition == null ? "" : condizioneDalSuggerimento(String(patch.condition));
    if (valore !== null) scritture.push({ campo: "condition", valore, etichetta: "condizione" });
  }
  if (patch.unlimited_stock === true) {
    scritture.push({ campo: "stock", valore: null, etichetta: "disponibilit\xE0" });
  } else if (typeof patch.stock === "number" && patch.stock >= 0) {
    scritture.push({ campo: "stock", valore: Math.trunc(patch.stock), etichetta: "disponibilit\xE0" });
  }
  if (patch.category_slug) {
    const risolta = resolveCategoryId(ctx.categorie, patch.category_slug, patch.subcategory_name);
    if (risolta) scritture.push({ campo: "category_id", valore: risolta, etichetta: "categoria" });
  }
  if (Array.isArray(patch.tags)) {
    const next = [];
    for (const raw of patch.tags) {
      const t = String(raw).trim().toLowerCase().replace(/,+$/, "");
      if (t && !next.includes(t) && next.length < 15) next.push(t);
    }
    scritture.push({ campo: "tags", valore: next, etichetta: "tag" });
  }
  if (patch.attributes && typeof patch.attributes === "object") {
    for (const [aiKey, rawValue] of Object.entries(patch.attributes)) {
      const value = typeof rawValue === "string" ? rawValue.trim() : "";
      if (!value) continue;
      const targetKey = AI_ATTR_TO_FIELD[aiKey] ?? aiKey;
      const field = fields.find((f) => f.key === targetKey);
      if (!field) continue;
      if (field.type === "select" && !(field.options ?? []).includes(value)) continue;
      const valore = field.type === "checkbox" ? attributoSpuntato(value) : value;
      scritture.push({ campo: "attributo", chiave: targetKey, valore, etichetta: field.label });
    }
  }
  if (Array.isArray(patch.attributes_remove)) {
    for (const key of patch.attributes_remove) {
      const targetKey = AI_ATTR_TO_FIELD[key] ?? key;
      scritture.push({ campo: "attributo", chiave: targetKey, valore: "", etichetta: `rimosso ${targetKey}` });
    }
  }
  if (ctx.modo === "edit" && patch.status && SELLER_STATUSES.includes(patch.status)) {
    scritture.push({ campo: "status", valore: patch.status, etichetta: "stato" });
  }
  const proposteDelModulo = proposte.map((p) => ({ chiave: p.chiave, ...propostaPerIlModulo(p, fields) }));
  const dichiarazioniDellaCategoria = CAMPI_DICHIARATIVI.flatMap((chiave) => {
    const campo = fields.find((f) => f.key === chiave);
    return campo ? [campo.label] : [];
  });
  const motivoPrezzo = typeof proposta.price === "number" && proposta.price > 0 && patch.price === void 0 ? motivoPrezzoRifiutato(proposta.price, ctx.prezzoAttuale) : null;
  const daControllare = unisciVociDaControllare(
    [],
    [
      ...avvisi.map((motivo) => ({ id: motivo === motivoPrezzo ? "prezzo" : `avviso:${motivo}`, motivo })),
      ...proposteDelModulo.map(
        ({ chiave, motivo, valore }) => valore === void 0 ? { id: `proposta:${chiave}`, motivo } : { id: `proposta:${chiave}`, motivo, chiave, valore }
      )
    ]
  );
  return {
    patch,
    scritture,
    cambiati: scritture.map((s) => s.etichetta),
    avvisi,
    proposte: proposteDelModulo,
    daControllare,
    daRivedere: dichiarazioniDaRivedere(proposta),
    dichiarazioniDellaCategoria
  };
}
function esitoDelPiano(piano) {
  return {
    cambiati: piano.cambiati,
    inSospeso: piano.daControllare.length,
    daControllare: piano.daControllare,
    daRivedere: piano.daRivedere,
    dichiarazioniDellaCategoria: piano.dichiarazioniDellaCategoria
  };
}
function restaDaRivedere(patch) {
  return !!patch && Object.keys(patch).length > 0;
}
function avvisoDopoIlPatch(esito, testi, dove = "riquadro") {
  const n = esito.inSospeso;
  const rimando = dove === "qui-sotto" ? n === 1 ? "\xE8 scritta qui sotto" : "sono scritte qui sotto" : n === 1 ? "la trovi nel riquadro \xABDa controllare\xBB" : "le trovi nel riquadro \xABDa controllare\xBB";
  if (esito.cambiati.length > 0) {
    if (n <= 0) return { tono: "successo", testo: testi.applicato };
    const coda = n === 1 ? `C'\xE8 anche una proposta da controllare: ${rimando}` : `Ci sono anche ${n} proposte da controllare: ${rimando}`;
    return { tono: "successo", testo: `${testi.applicato}. ${coda}` };
  }
  if (n > 0) {
    return {
      tono: "da-controllare",
      testo: n === 1 ? `C'\xE8 una proposta da controllare: ${rimando}` : `Ci sono ${n} proposte da controllare: ${rimando}`
    };
  }
  return { tono: "neutro", testo: testi.niente };
}
function messaggioDellaChatDopoIlPatch(risposta, esito) {
  const aggiornato = esito.cambiati.length > 0;
  if (esito.daControllare.length === 0) return { testo: risposta, nonScritto: [], aggiornato };
  return {
    testo: aggiornato ? `Campi cambiati nella scheda: ${esito.cambiati.join(", ")}. Il resto della proposta NON \xE8 stato scritto.` : "Nella scheda non \xE8 cambiato niente: la proposta NON \xE8 stata scritta.",
    nonScritto: esito.daControllare.map(
      (v) => v.valore === void 0 ? v.motivo : `${v.motivo}. Se \xE8 giusto, lo confermi tu con \xABUsa questo valore\xBB, nel riquadro \xABDa controllare\xBB`
    ),
    aggiornato
  };
}

// components/seller/ProductChatAssistant.tsx
import { jsx as jsx4, jsxs as jsxs4 } from "react/jsx-runtime";
var NIENTE = { cambiati: [], daControllare: [] };
var WELCOME = "Ciao! Posso guardare le foto e cercare online per capire qual \xE8 davvero il prodotto, poi sistemare la scheda: nome, descrizione, prezzo, categoria, attributi, tag\u2026 Scrivi pure in modo naturale.";
function ProductChatAssistant({
  product,
  attributeSchema,
  topCategories,
  imageUrls,
  onApplyPatch,
  disabled = false
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef(null);
  useEffect(() => {
    if (open) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, open]);
  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    const nextMessages = [...messages, { role: "user", content: text }];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        toast2.error("Sessione scaduta");
        return;
      }
      const history = nextMessages.map((m) => ({ role: m.role, content: m.content }));
      const res = await fetch("/api/ai/product-chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ history, product, attributeSchema, topCategories, imageUrls })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(apiErrorMessage(json, "Errore"));
      const patch = json.patch ?? {};
      const esito = Object.keys(patch).length > 0 ? onApplyPatch(patch) : NIENTE;
      const msg = messaggioDellaChatDopoIlPatch(json.reply ?? "Fatto.", esito);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: msg.testo, applied: msg.aggiornato, nonScritto: msg.nonScritto }
      ]);
      if (msg.aggiornato) toast2.success("Campi aggiornati nel form");
    } catch (err) {
      toast2.error(friendlyError(err));
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Ops, qualcosa \xE8 andato storto. Riprova." }
      ]);
    } finally {
      setLoading(false);
    }
  };
  if (!open) {
    return /* @__PURE__ */ jsxs4(
      "button",
      {
        type: "button",
        onClick: () => setOpen(true),
        disabled,
        className: "inline-flex items-center gap-2 rounded-lg border border-secondary-200 bg-secondary-50 px-3 py-2 text-sm font-semibold text-secondary-800 transition-colors hover:bg-secondary-100 disabled:opacity-50",
        children: [
          /* @__PURE__ */ jsx4(Sparkles, { size: 16, strokeWidth: 2.2, "aria-hidden": true }),
          " Modifica con l'AI"
        ]
      }
    );
  }
  return /* @__PURE__ */ jsxs4("div", { className: "rounded-lg border border-secondary-200 bg-white shadow-warm", children: [
    /* @__PURE__ */ jsxs4("div", { className: "flex items-center justify-between border-b border-cream-200 px-3 py-2", children: [
      /* @__PURE__ */ jsxs4("span", { className: "inline-flex items-center gap-1.5 text-sm font-semibold text-secondary-800", children: [
        /* @__PURE__ */ jsx4(Sparkles, { size: 15, strokeWidth: 2.4, "aria-hidden": true }),
        " Assistente prodotto"
      ] }),
      /* @__PURE__ */ jsx4(
        "button",
        {
          type: "button",
          onClick: () => setOpen(false),
          "aria-label": "Chiudi assistente",
          className: "text-ink-400 hover:text-ink-700",
          children: /* @__PURE__ */ jsx4(X2, { size: 18, "aria-hidden": true })
        }
      )
    ] }),
    /* @__PURE__ */ jsxs4("div", { ref: scrollRef, className: "max-h-72 space-y-2 overflow-y-auto p-3", children: [
      messages.length === 0 && /* @__PURE__ */ jsx4("p", { className: "rounded-lg bg-cream-50 px-3 py-2 text-sm text-ink-500", children: WELCOME }),
      messages.map((m, i) => /* @__PURE__ */ jsx4(
        "div",
        {
          className: m.role === "user" ? "flex justify-end" : "flex justify-start",
          children: /* @__PURE__ */ jsxs4(
            "div",
            {
              className: m.role === "user" ? "max-w-[85%] rounded-2xl rounded-br-sm bg-primary-600 px-3 py-2 text-sm text-white" : "max-w-[85%] rounded-2xl rounded-bl-sm bg-cream-100 px-3 py-2 text-sm text-ink-800",
              children: [
                m.content,
                m.applied && /* @__PURE__ */ jsxs4("span", { className: "mt-1 flex items-center gap-1 text-xs font-semibold text-emerald-600", children: [
                  /* @__PURE__ */ jsx4(Check, { size: 12, strokeWidth: 2.6, "aria-hidden": true }),
                  " Campi aggiornati nel form"
                ] }),
                m.nonScritto && m.nonScritto.length > 0 && /* @__PURE__ */ jsx4("ul", { className: "mt-1.5 space-y-1 border-t border-accent-200 pt-1.5", children: m.nonScritto.map((riga, j) => /* @__PURE__ */ jsxs4("li", { className: "flex gap-1 text-xs font-semibold text-accent-800", children: [
                  /* @__PURE__ */ jsx4(AlertCircle, { size: 12, strokeWidth: 2.6, className: "mt-0.5 shrink-0", "aria-hidden": true }),
                  /* @__PURE__ */ jsx4("span", { children: riga })
                ] }, j)) })
              ]
            }
          )
        },
        i
      )),
      loading && /* @__PURE__ */ jsx4("div", { className: "flex justify-start", children: /* @__PURE__ */ jsx4("div", { className: "rounded-2xl rounded-bl-sm bg-cream-100 px-3 py-2 text-sm text-ink-500", children: /* @__PURE__ */ jsx4(Loader2, { size: 14, className: "animate-spin", strokeWidth: 2.4, "aria-hidden": true }) }) })
    ] }),
    /* @__PURE__ */ jsxs4("div", { className: "flex items-end gap-2 border-t border-cream-200 p-2", children: [
      /* @__PURE__ */ jsx4(
        "textarea",
        {
          value: input,
          onChange: (e) => setInput(e.target.value),
          onKeyDown: (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          },
          rows: 1,
          placeholder: "Es. metti il prezzo a 4,90 e aggiungi il tag spezie",
          className: "flex-1 resize-none rounded-lg border border-cream-300 px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-primary-700 focus:outline-none focus:ring-1 focus:ring-primary-200"
        }
      ),
      /* @__PURE__ */ jsx4(
        "button",
        {
          type: "button",
          onClick: () => void send(),
          disabled: loading || !input.trim(),
          "aria-label": "Invia",
          className: "inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary-600 text-white transition-colors hover:bg-primary-700 disabled:opacity-40",
          children: loading ? /* @__PURE__ */ jsx4(Loader2, { size: 18, className: "animate-spin" }) : /* @__PURE__ */ jsx4(Send, { size: 18 })
        }
      )
    ] })
  ] });
}

// components/seller/ImproveAllPanel.tsx
init_supabase_client();
import { Wand2, Loader2 as Loader22, X as X3, Check as Check2, TrendingUp, Tag, Camera as Camera3, AlertCircle as AlertCircle2 } from "lucide-react";
import { toast as toast4 } from "sonner";

// lib/format.ts
var PREZZO_IT = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });
var formatPrice = (n) => PREZZO_IT.format(Number(n));

// components/seller/dilloDopoIlPatch.ts
import { toast as toast3 } from "sonner";
function dilloDopoIlPatch(esito, testi, opzioni) {
  const avviso = avvisoDopoIlPatch(esito, testi);
  if (avviso.tono === "successo") toast3.success(avviso.testo, opzioni);
  else if (avviso.tono === "da-controllare") toast3.warning(avviso.testo, opzioni);
  else toast3(avviso.testo, opzioni);
  return avviso;
}

// components/seller/ImproveAllPanel.tsx
import { Fragment as Fragment3, jsx as jsx5, jsxs as jsxs5 } from "react/jsx-runtime";
var TESTI_APPLICA = {
  applicato: "Modifiche applicate al form \u2014 controlla e salva",
  niente: "Niente da cambiare: la scheda \xE8 gi\xE0 a posto"
};
var FIELD_LABELS = {
  name: "Nome",
  description: "Descrizione",
  price: "Prezzo",
  compare_at_price: "Prezzo pieno",
  unit: "Unit\xE0",
  condition: "Condizione",
  category_slug: "Categoria",
  subcategory_name: "Sottocategoria",
  tags: "Tag",
  attributes: "Caratteristiche"
};
function fieldLabel(field) {
  return FIELD_LABELS[field] ?? field.charAt(0).toUpperCase() + field.slice(1).replace(/_/g, " ");
}
function scoreColor(score) {
  if (score >= 75) return "text-olive-600";
  if (score >= 50) return "text-accent-700";
  return "text-secondary-600";
}
function scoreBar(score) {
  if (score >= 75) return "bg-olive-600";
  if (score >= 50) return "bg-accent-500";
  return "bg-secondary-600";
}
function ImproveAllPanel({
  product,
  attributeSchema,
  topCategories,
  imageUrls,
  onApplyPatch,
  disabled = false
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [esito, setEsito] = useState(null);
  const run = async () => {
    setOpen(true);
    setLoading(true);
    setResult(null);
    setEsito(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        toast4.error("Sessione scaduta");
        setOpen(false);
        return;
      }
      const res = await fetch("/api/ai/improve-product", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ product, attributeSchema, topCategories, imageUrls })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(apiErrorMessage(json, "Errore"));
      setResult(json);
    } catch (err) {
      toast4.error(friendlyError(err));
      setOpen(false);
    } finally {
      setLoading(false);
    }
  };
  const apply = () => {
    if (!result) return;
    const fatto = onApplyPatch(result.patch);
    setEsito(fatto);
    dilloDopoIlPatch(fatto, TESTI_APPLICA);
  };
  const rivedi = () => {
    if (!esito || !restaDaRivedere(esito.daRivedere)) return;
    dilloDopoIlPatch(onApplyPatch(esito.daRivedere), TESTI_APPLICA);
  };
  const dopoApplica = esito ? avvisoDopoIlPatch(esito, { ...TESTI_APPLICA, applicato: "Applicato al form \u2014 controlla e salva" }, "qui-sotto") : null;
  const hasPatch = !!result && Object.keys(result.patch ?? {}).length > 0;
  const delta = result ? result.quality.after - result.quality.before : 0;
  if (!open) {
    return /* @__PURE__ */ jsxs5(
      "button",
      {
        type: "button",
        onClick: () => void run(),
        disabled,
        className: "inline-flex items-center gap-2 rounded-lg border border-primary-200 bg-gradient-to-r from-primary-50 to-secondary-50 px-3 py-2 text-sm font-semibold text-primary-800 transition-colors hover:from-primary-100 hover:to-secondary-100 disabled:opacity-50",
        children: [
          /* @__PURE__ */ jsx5(Wand2, { size: 16, strokeWidth: 2.2, "aria-hidden": true }),
          " Migliora tutto con l'AI"
        ]
      }
    );
  }
  return /* @__PURE__ */ jsxs5("div", { className: "rounded-lg border border-primary-200 bg-white shadow-warm", children: [
    /* @__PURE__ */ jsxs5("div", { className: "flex items-center justify-between border-b border-cream-200 px-4 py-2.5", children: [
      /* @__PURE__ */ jsxs5("span", { className: "inline-flex items-center gap-1.5 text-sm font-semibold text-primary-800", children: [
        /* @__PURE__ */ jsx5(Wand2, { size: 15, strokeWidth: 2.4, "aria-hidden": true }),
        " Migliora tutto"
      ] }),
      /* @__PURE__ */ jsx5(
        "button",
        {
          type: "button",
          onClick: () => setOpen(false),
          "aria-label": "Chiudi",
          className: "text-ink-400 hover:text-ink-700",
          children: /* @__PURE__ */ jsx5(X3, { size: 18, "aria-hidden": true })
        }
      )
    ] }),
    /* @__PURE__ */ jsxs5("div", { className: "max-h-[28rem] overflow-y-auto p-4", children: [
      loading && /* @__PURE__ */ jsxs5("div", { className: "flex items-center gap-2 py-6 text-sm text-ink-500", children: [
        /* @__PURE__ */ jsx5(Loader22, { size: 18, className: "animate-spin", strokeWidth: 2.4, "aria-hidden": true }),
        "Sto analizzando il prodotto, guardo le foto e cerco online\u2026"
      ] }),
      result && !loading && /* @__PURE__ */ jsxs5("div", { className: "space-y-4", children: [
        result.summary && /* @__PURE__ */ jsx5("p", { className: "text-sm text-ink-700", children: result.summary }),
        /* @__PURE__ */ jsxs5("div", { className: "rounded-lg bg-cream-50 p-3", children: [
          /* @__PURE__ */ jsxs5("div", { className: "mb-2 flex items-center justify-between", children: [
            /* @__PURE__ */ jsx5("span", { className: "text-xs font-semibold uppercase tracking-wide text-ink-500", children: "Qualit\xE0 scheda" }),
            /* @__PURE__ */ jsxs5("span", { className: "inline-flex items-center gap-1 text-sm", children: [
              /* @__PURE__ */ jsx5("span", { className: "text-ink-400", children: result.quality.before }),
              /* @__PURE__ */ jsx5(TrendingUp, { size: 14, className: "text-olive-600", "aria-hidden": true }),
              /* @__PURE__ */ jsx5("span", { className: `font-bold ${scoreColor(result.quality.after)}`, children: result.quality.after }),
              /* @__PURE__ */ jsx5("span", { className: "text-xs text-ink-400", children: "/100" }),
              delta > 0 && /* @__PURE__ */ jsxs5("span", { className: "ml-1 rounded-full bg-olive-100 px-1.5 py-0.5 text-xs font-semibold text-olive-700", children: [
                "+",
                delta
              ] })
            ] })
          ] }),
          /* @__PURE__ */ jsx5("div", { className: "space-y-1.5", children: result.quality.dimensions.map((d) => /* @__PURE__ */ jsxs5("div", { className: "flex items-center gap-2", children: [
            /* @__PURE__ */ jsx5("span", { className: "w-20 shrink-0 text-xs capitalize text-ink-500", children: d.label }),
            /* @__PURE__ */ jsx5("div", { className: "h-1.5 flex-1 overflow-hidden rounded-full bg-cream-200", children: /* @__PURE__ */ jsx5(
              "div",
              {
                className: `h-full rounded-full ${scoreBar(d.score)}`,
                style: { width: `${Math.min(100, d.score / (d.max || 100) * 100)}%` }
              }
            ) }),
            d.note && /* @__PURE__ */ jsx5("span", { className: "hidden text-xs text-ink-400 sm:inline", children: d.note })
          ] }, d.key)) })
        ] }),
        result.pricing && result.pricing.suggested != null && /* @__PURE__ */ jsxs5("div", { className: "rounded-lg border border-olive-200 bg-olive-50 p-3", children: [
          /* @__PURE__ */ jsxs5("div", { className: "flex items-center gap-2 text-sm font-semibold text-olive-800", children: [
            /* @__PURE__ */ jsx5(Tag, { size: 15, strokeWidth: 2.4, "aria-hidden": true }),
            " Prezzo consigliato:",
            " ",
            formatPrice(result.pricing.suggested)
          ] }),
          result.pricing.netToSeller != null && /* @__PURE__ */ jsxs5("p", { className: "mt-1 text-xs text-olive-700", children: [
            "Incassi netti stimati dopo la commissione:",
            " ",
            /* @__PURE__ */ jsx5("strong", { children: formatPrice(result.pricing.netToSeller) })
          ] }),
          result.pricing.rationale && /* @__PURE__ */ jsx5("p", { className: "mt-1 text-xs text-ink-600", children: result.pricing.rationale })
        ] }),
        result.fieldNotes.length > 0 && /* @__PURE__ */ jsxs5("div", { children: [
          /* @__PURE__ */ jsx5("p", { className: "mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500", children: "Cosa miglioro" }),
          /* @__PURE__ */ jsx5("ul", { className: "space-y-1", children: result.fieldNotes.map((n, i) => /* @__PURE__ */ jsxs5("li", { className: "flex gap-2 text-sm text-ink-700", children: [
            /* @__PURE__ */ jsx5(Check2, { size: 15, className: "mt-0.5 shrink-0 text-olive-600", strokeWidth: 2.6, "aria-hidden": true }),
            /* @__PURE__ */ jsxs5("span", { children: [
              /* @__PURE__ */ jsxs5("strong", { className: "font-semibold", children: [
                fieldLabel(n.field),
                ":"
              ] }),
              " ",
              n.note
            ] })
          ] }, i)) })
        ] }),
        result.quality.missing.length > 0 && /* @__PURE__ */ jsxs5("div", { className: "rounded-lg border border-accent-200 bg-accent-50 p-3", children: [
          /* @__PURE__ */ jsxs5("p", { className: "mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-accent-700", children: [
            /* @__PURE__ */ jsx5(Camera3, { size: 13, strokeWidth: 2.6, "aria-hidden": true }),
            " Cosa puoi fare tu"
          ] }),
          /* @__PURE__ */ jsx5("ul", { className: "space-y-1", children: result.quality.missing.map((m, i) => /* @__PURE__ */ jsxs5("li", { className: "flex gap-2 text-sm text-ink-700", children: [
            /* @__PURE__ */ jsx5(AlertCircle2, { size: 14, className: "mt-0.5 shrink-0 text-accent-700", "aria-hidden": true }),
            m
          ] }, i)) })
        ] })
      ] })
    ] }),
    result && !loading && /* @__PURE__ */ jsx5("div", { className: "flex flex-wrap items-center justify-end gap-2 border-t border-cream-200 p-3", children: esito && dopoApplica ? /* @__PURE__ */ jsxs5(Fragment3, { children: [
      /* @__PURE__ */ jsxs5(
        "span",
        {
          className: `inline-flex items-center gap-1.5 text-sm font-semibold ${dopoApplica.tono === "da-controllare" ? "text-accent-700" : dopoApplica.tono === "successo" ? "text-olive-600" : "text-ink-500"}`,
          children: [
            dopoApplica.tono === "da-controllare" ? /* @__PURE__ */ jsx5(AlertCircle2, { size: 16, strokeWidth: 2.6, className: "shrink-0", "aria-hidden": true }) : /* @__PURE__ */ jsx5(Check2, { size: 16, strokeWidth: 2.6, className: "shrink-0", "aria-hidden": true }),
            dopoApplica.testo
          ]
        }
      ),
      restaDaRivedere(esito.daRivedere) && /* @__PURE__ */ jsx5(
        "button",
        {
          type: "button",
          onClick: rivedi,
          className: "shrink-0 rounded-lg border border-accent-200 px-3 py-2 text-sm font-semibold text-accent-700 transition-colors hover:bg-accent-50",
          children: "Rivedi le proposte"
        }
      ),
      esito.daControllare.length > 0 && /* @__PURE__ */ jsx5("ul", { className: "basis-full space-y-1", children: esito.daControllare.map((v) => /* @__PURE__ */ jsxs5("li", { className: "flex gap-1.5 text-xs text-ink-700", children: [
        /* @__PURE__ */ jsx5(AlertCircle2, { size: 13, className: "mt-0.5 shrink-0 text-accent-700", "aria-hidden": true }),
        v.motivo
      ] }, v.id)) })
    ] }) : /* @__PURE__ */ jsxs5(Fragment3, { children: [
      /* @__PURE__ */ jsx5(
        "button",
        {
          type: "button",
          onClick: () => setOpen(false),
          className: "rounded-lg px-3 py-2 text-sm font-medium text-ink-500 hover:text-ink-700",
          children: "Annulla"
        }
      ),
      /* @__PURE__ */ jsxs5(
        "button",
        {
          type: "button",
          onClick: apply,
          disabled: !hasPatch,
          className: "inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-700 disabled:opacity-40",
          children: [
            /* @__PURE__ */ jsx5(Wand2, { size: 15, strokeWidth: 2.4, "aria-hidden": true }),
            hasPatch ? "Applica tutto" : "Gi\xE0 a posto"
          ]
        }
      )
    ] }) })
  ] });
}

// components/seller/QuickAiTools.tsx
init_supabase_client();
import { toast as toast5 } from "sonner";
import { Search, Languages, Stethoscope, Loader2 as Loader23, Check as Check3, X as X4, AlertTriangle } from "lucide-react";
import { jsx as jsx6, jsxs as jsxs6 } from "react/jsx-runtime";
var LANGS = [
  { code: "en", label: "Inglese" },
  { code: "fr", label: "Francese" },
  { code: "de", label: "Tedesco" },
  { code: "es", label: "Spagnolo" },
  { code: "ro", label: "Rumeno" },
  { code: "ar", label: "Arabo" },
  { code: "zh", label: "Cinese" }
];
var NIENTE2 = { cambiati: [], inSospeso: 0, daControllare: [], daRivedere: {}, dichiarazioniDellaCategoria: [] };
var SEV_COLOR = {
  alta: "bg-rose-100 text-rose-700",
  media: "bg-amber-100 text-amber-700",
  bassa: "bg-cream-200 text-ink-600"
};
function QuickAiTools({
  product,
  attributeSchema,
  topCategories,
  imageUrls,
  onApplyPatch,
  disabled = false,
  accesa = AI_NEGOZI_ACCESA
}) {
  const [busy, setBusy] = useState(null);
  const [lang, setLang] = useState("en");
  const [diag, setDiag] = useState(null);
  const [diagApplicata, setDiagApplicata] = useState(false);
  const callAi = async (path, extra = {}) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      toast5.error("Sessione scaduta");
      return null;
    }
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ product, attributeSchema, topCategories, imageUrls, ...extra })
    });
    const json = await res.json();
    if (!res.ok) throw new Error(apiErrorMessage(json, "Errore"));
    return json;
  };
  const runSeo = async () => {
    setBusy("seo");
    try {
      const json = await callAi("/api/ai/seo");
      if (!json) return;
      const esito = json.patch ? onApplyPatch(json.patch) : NIENTE2;
      dilloDopoIlPatch(esito, { applicato: "Titolo e tag ottimizzati nel form", niente: "Gi\xE0 ottimizzato" });
    } catch (err) {
      toast5.error(friendlyError(err));
    } finally {
      setBusy(null);
    }
  };
  const runTranslate = async () => {
    setBusy("translate");
    try {
      const json = await callAi("/api/ai/translate", { targetLang: lang });
      if (!json) return;
      const esito = json.patch ? onApplyPatch(json.patch) : NIENTE2;
      dilloDopoIlPatch(esito, { applicato: "Annuncio tradotto nel form \u2014 controlla e salva", niente: "Niente da tradurre" });
    } catch (err) {
      toast5.error(friendlyError(err));
    } finally {
      setBusy(null);
    }
  };
  const runDiagnose = async () => {
    setBusy("diagnose");
    setDiag(null);
    setDiagApplicata(false);
    try {
      const json = await callAi("/api/ai/diagnose");
      if (!json) return;
      setDiag(json);
    } catch (err) {
      toast5.error(friendlyError(err));
    } finally {
      setBusy(null);
    }
  };
  const applyDiagnosePatch = () => {
    if (!diag) return;
    const esito = onApplyPatch(diag.patch);
    dilloDopoIlPatch(esito, { applicato: "Correzioni applicate al form \u2014 controlla e salva", niente: "Niente da applicare" });
    setDiag((d) => d ? { ...d, patch: esito.daRivedere } : d);
    setDiagApplicata(true);
  };
  const hasDiagPatch = !!diag && restaDaRivedere(diag.patch);
  if (!accesa) return null;
  return /* @__PURE__ */ jsxs6("div", { className: "rounded-lg border border-cream-200 bg-cream-50 p-3", children: [
    /* @__PURE__ */ jsx6("p", { className: "mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500", children: "Strumenti AI" }),
    /* @__PURE__ */ jsxs6("div", { className: "flex flex-wrap items-center gap-2", children: [
      /* @__PURE__ */ jsxs6(
        "button",
        {
          type: "button",
          onClick: () => void runSeo(),
          disabled: disabled || busy !== null,
          className: "inline-flex items-center gap-1.5 rounded-lg border border-cream-300 bg-white px-3 py-2 text-sm font-medium text-ink-700 transition-colors hover:bg-cream-100 disabled:opacity-50",
          children: [
            busy === "seo" ? /* @__PURE__ */ jsx6(Loader23, { size: 15, className: "animate-spin", "aria-hidden": true }) : /* @__PURE__ */ jsx6(Search, { size: 15, "aria-hidden": true }),
            "Ottimizza per la ricerca"
          ]
        }
      ),
      /* @__PURE__ */ jsxs6(
        "button",
        {
          type: "button",
          onClick: () => void runDiagnose(),
          disabled: disabled || busy !== null,
          className: "inline-flex items-center gap-1.5 rounded-lg border border-cream-300 bg-white px-3 py-2 text-sm font-medium text-ink-700 transition-colors hover:bg-cream-100 disabled:opacity-50",
          children: [
            busy === "diagnose" ? /* @__PURE__ */ jsx6(Loader23, { size: 15, className: "animate-spin", "aria-hidden": true }) : /* @__PURE__ */ jsx6(Stethoscope, { size: 15, "aria-hidden": true }),
            "Perch\xE9 non vende?"
          ]
        }
      ),
      TRADUCI_ACCESO && /* @__PURE__ */ jsxs6("span", { className: "inline-flex items-center gap-1 rounded-lg border border-cream-300 bg-white pl-2", children: [
        /* @__PURE__ */ jsx6(Languages, { size: 15, className: "text-ink-400", "aria-hidden": true }),
        /* @__PURE__ */ jsx6(
          "select",
          {
            value: lang,
            onChange: (e) => setLang(e.target.value),
            disabled: disabled || busy !== null,
            "aria-label": "Lingua di traduzione",
            className: "bg-transparent py-2 pr-1 text-sm text-ink-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 rounded",
            children: LANGS.map((l) => /* @__PURE__ */ jsx6("option", { value: l.code, children: l.label }, l.code))
          }
        ),
        /* @__PURE__ */ jsx6(
          "button",
          {
            type: "button",
            onClick: () => void runTranslate(),
            disabled: disabled || busy !== null,
            className: "rounded-r-lg px-2.5 py-2 text-sm font-medium text-primary-700 hover:bg-cream-100 disabled:opacity-50",
            children: busy === "translate" ? /* @__PURE__ */ jsx6(Loader23, { size: 15, className: "animate-spin", "aria-hidden": true }) : "Traduci"
          }
        )
      ] })
    ] }),
    diag && /* @__PURE__ */ jsxs6("div", { className: "mt-3 rounded-lg border border-cream-200 bg-white p-3", children: [
      /* @__PURE__ */ jsxs6("div", { className: "mb-1 flex items-center justify-between", children: [
        /* @__PURE__ */ jsx6("span", { className: "text-sm font-semibold text-ink-800", children: "Diagnosi" }),
        /* @__PURE__ */ jsxs6("div", { className: "flex items-center gap-2", children: [
          typeof diag.score === "number" && /* @__PURE__ */ jsxs6("span", { className: "rounded-full bg-cream-100 px-2 py-0.5 text-xs font-semibold text-ink-600", children: [
            "Vendibilit\xE0 ",
            diag.score,
            "/100"
          ] }),
          /* @__PURE__ */ jsx6("button", { type: "button", onClick: () => setDiag(null), "aria-label": "Chiudi", className: "text-ink-400 hover:text-ink-700", children: /* @__PURE__ */ jsx6(X4, { size: 16, "aria-hidden": true }) })
        ] })
      ] }),
      diag.summary && /* @__PURE__ */ jsx6("p", { className: "text-sm text-ink-700", children: diag.summary }),
      diag.issues.length > 0 && /* @__PURE__ */ jsx6("ul", { className: "mt-2 space-y-1.5", children: diag.issues.map((it, i) => /* @__PURE__ */ jsxs6("li", { className: "flex gap-2 text-sm text-ink-700", children: [
        /* @__PURE__ */ jsxs6("span", { className: `mt-0.5 inline-flex h-fit shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold capitalize ${SEV_COLOR[it.severity] ?? SEV_COLOR.bassa}`, children: [
          it.severity === "alta" && /* @__PURE__ */ jsx6(AlertTriangle, { size: 11, "aria-hidden": true }),
          it.area
        ] }),
        /* @__PURE__ */ jsx6("span", { children: it.fix })
      ] }, i)) }),
      hasDiagPatch && !diagApplicata && /* @__PURE__ */ jsxs6(
        "button",
        {
          type: "button",
          onClick: applyDiagnosePatch,
          className: "mt-3 inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-700",
          children: [
            /* @__PURE__ */ jsx6(Check3, { size: 15, strokeWidth: 2.4, "aria-hidden": true }),
            " Applica le correzioni"
          ]
        }
      ),
      hasDiagPatch && diagApplicata && /* @__PURE__ */ jsxs6(
        "button",
        {
          type: "button",
          onClick: applyDiagnosePatch,
          className: "mt-3 inline-flex items-center gap-1.5 rounded-lg border border-accent-200 px-3 py-2 text-sm font-semibold text-accent-700 transition-colors hover:bg-accent-50",
          children: [
            /* @__PURE__ */ jsx6(AlertTriangle, { size: 15, strokeWidth: 2.4, "aria-hidden": true }),
            " Rivedi le proposte"
          ]
        }
      )
    ] })
  ] });
}

// components/seller/VoiceProductButton.tsx
init_supabase_client();
import { toast as toast6 } from "sonner";
import { Mic, Loader2 as Loader24, Square, Send as Send2 } from "lucide-react";

// lib/products/avvisoDellaDettatura.ts
var TESTI_DELLA_DETTATURA = {
  applicato: "Compilato dalla tua descrizione \u2014 controlla e salva",
  niente: "Nella scheda non ho scritto niente"
};
var MAX_DETTATO = 2e3;
var MAX_RISPOSTA = 1e3;
function fraseSulleDichiarazioni(etichette) {
  const nomi = etichette.map((e) => e.replace(/\s*\(.*?\)/g, "").trim()).filter(Boolean);
  if (nomi.length === 0) return null;
  const minuscolo = (s) => s.charAt(0).toLowerCase() + s.slice(1);
  const elenco = nomi.length === 1 ? nomi[0] : nomi.length === 2 ? `${nomi[0]} e ${minuscolo(nomi[1])}` : `${nomi[0]}, ${minuscolo(nomi[1])} e le altre dichiarazioni`;
  return `${elenco} non li scrive l'assistente: se li hai detti, scrivili tu nella scheda prima di salvare.`;
}
function avvisoDopoLaDettatura(opts) {
  const { tono, testo } = avvisoDopoIlPatch(opts.esito, TESTI_DELLA_DETTATURA);
  const dichiarazioni = fraseSulleDichiarazioni(opts.esito.dichiarazioniDellaCategoria);
  const lasciatoFuori = opts.esito.inSospeso > 0;
  const risposta = !lasciatoFuori && typeof opts.risposta === "string" ? opts.risposta.trim().slice(0, MAX_RISPOSTA) : "";
  return {
    tono: tono === "successo" && (dichiarazioni !== null || lasciatoFuori) ? "da-controllare" : tono,
    esito: testo,
    dichiarazioni,
    dettato: `Hai detto: \xAB${opts.dettato.trim().slice(0, MAX_DETTATO)}\xBB`,
    risposta: risposta ? `L'assistente dice: \xAB${risposta}\xBB` : null
  };
}

// components/seller/VoiceProductButton.tsx
import { Fragment as Fragment4, jsx as jsx7, jsxs as jsxs7 } from "react/jsx-runtime";
function getRecognitionCtor() {
  if (typeof window === "undefined") return null;
  const w = window;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}
function VoiceProductButton({
  attributeSchema,
  topCategories,
  onApplyPatch,
  disabled = false
}) {
  const [state, setState] = useState("idle");
  const [manual, setManual] = useState("");
  const [avviso, setAvviso] = useState(null);
  const recRef = useRef(null);
  const supported = getRecognitionCtor() !== null;
  const process2 = async (transcript) => {
    const text = transcript.trim();
    if (text.length < 3) {
      setState("idle");
      return;
    }
    setState("processing");
    setAvviso(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        toast6.error("Sessione scaduta");
        return;
      }
      const res = await fetch("/api/ai/voice-product", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          transcript: text,
          attributeSchema,
          topCategories: topCategories.map((c) => ({ name: c.name, slug: c.slug }))
        })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(apiErrorMessage(json, "Errore"));
      const patch = json.patch && typeof json.patch === "object" && !Array.isArray(json.patch) ? json.patch : {};
      const esito = onApplyPatch(patch);
      setAvviso(avvisoDopoLaDettatura({ esito, dettato: text, risposta: json.reply }));
      setManual("");
    } catch (err) {
      toast6.error(friendlyError(err));
    } finally {
      setState("idle");
    }
  };
  const startListening = () => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    try {
      const rec = new Ctor();
      rec.lang = "it-IT";
      rec.interimResults = false;
      rec.continuous = false;
      rec.maxAlternatives = 1;
      rec.onresult = (e) => {
        const transcript = e.results?.[0]?.[0]?.transcript ?? "";
        void process2(transcript);
      };
      rec.onerror = (e) => {
        setState("idle");
        if (e.error !== "aborted") {
          toast6.error(e.error === "not-allowed" ? "Permesso microfono negato." : "Non ho sentito bene, riprova.");
        }
      };
      rec.onend = () => setState((s) => s === "listening" ? "idle" : s);
      recRef.current = rec;
      setState("listening");
      rec.start();
    } catch {
      toast6.error("Microfono non disponibile.");
      setState("idle");
    }
  };
  const stopListening = () => {
    recRef.current?.stop();
    setState("idle");
  };
  const coloreAvviso = avviso?.tono === "successo" ? "border-emerald-200 bg-emerald-50" : avviso?.tono === "da-controllare" ? "border-accent-200 bg-accent-50" : "border-cream-300 bg-cream-50";
  const riquadroAvviso = /* @__PURE__ */ jsx7("div", { role: "status", "aria-live": "polite", "data-avviso": "dettatura", children: avviso && /* @__PURE__ */ jsxs7("div", { className: `mt-2 space-y-1 rounded-lg border p-3 text-sm text-ink-800 ${coloreAvviso}`, children: [
    avviso.dichiarazioni && /* @__PURE__ */ jsx7("p", { className: "font-semibold text-accent-800", children: avviso.dichiarazioni }),
    /* @__PURE__ */ jsx7("p", { className: "font-semibold", children: avviso.esito }),
    /* @__PURE__ */ jsx7("p", { className: "break-words text-ink-700", children: avviso.dettato }),
    avviso.risposta && /* @__PURE__ */ jsx7("p", { className: "break-words text-ink-700", children: avviso.risposta }),
    /* @__PURE__ */ jsx7(
      "button",
      {
        type: "button",
        onClick: () => setAvviso(null),
        className: "mt-1 rounded-lg border border-cream-300 bg-white px-3 py-1.5 text-xs font-semibold text-ink-700 hover:bg-cream-100",
        children: "Ho letto"
      }
    )
  ] }) });
  if (!supported) {
    return /* @__PURE__ */ jsxs7("div", { className: "rounded-lg border border-cream-200 bg-cream-50 p-3", children: [
      /* @__PURE__ */ jsxs7("p", { className: "mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500", children: [
        /* @__PURE__ */ jsx7(Mic, { size: 13, "aria-hidden": true }),
        " Descrivi il prodotto a parole"
      ] }),
      /* @__PURE__ */ jsxs7("div", { className: "flex items-end gap-2", children: [
        /* @__PURE__ */ jsx7(
          "textarea",
          {
            value: manual,
            onChange: (e) => setManual(e.target.value),
            rows: 2,
            disabled: disabled || state === "processing",
            placeholder: "Es. tre magliette rosse di cotone taglia M a 15 euro l'una",
            className: "flex-1 resize-none rounded-lg border border-cream-300 px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-primary-700 focus:outline-none"
          }
        ),
        /* @__PURE__ */ jsx7(
          "button",
          {
            type: "button",
            onClick: () => void process2(manual),
            disabled: disabled || state === "processing" || manual.trim().length < 3,
            "aria-label": "Crea dalla descrizione",
            className: "inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-40",
            children: state === "processing" ? /* @__PURE__ */ jsx7(Loader24, { size: 18, className: "animate-spin" }) : /* @__PURE__ */ jsx7(Send2, { size: 18 })
          }
        )
      ] }),
      riquadroAvviso
    ] });
  }
  const listening = state === "listening";
  const processing = state === "processing";
  return /* @__PURE__ */ jsxs7("div", { children: [
    /* @__PURE__ */ jsx7(
      "button",
      {
        type: "button",
        onClick: listening ? stopListening : startListening,
        disabled: disabled || processing,
        className: `inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${listening ? "border-rose-300 bg-rose-50 text-rose-700" : "border-secondary-200 bg-secondary-50 text-secondary-800 hover:bg-secondary-100"}`,
        children: processing ? /* @__PURE__ */ jsxs7(Fragment4, { children: [
          /* @__PURE__ */ jsx7(Loader24, { size: 16, className: "animate-spin", "aria-hidden": true }),
          " Compilo\u2026"
        ] }) : listening ? /* @__PURE__ */ jsxs7(Fragment4, { children: [
          /* @__PURE__ */ jsx7(Square, { size: 15, strokeWidth: 2.4, "aria-hidden": true }),
          " Sto ascoltando\u2026 tocca per fermare"
        ] }) : /* @__PURE__ */ jsxs7(Fragment4, { children: [
          /* @__PURE__ */ jsx7(Mic, { size: 16, strokeWidth: 2.2, "aria-hidden": true }),
          " Detta il prodotto a voce"
        ] })
      }
    ),
    riquadroAvviso
  ] });
}

// components/seller/ProductImagesField.tsx
import { useDropzone } from "react-dropzone";
import { Camera as Camera4, Sparkles as Sparkles2, Star, ChevronLeft, ChevronRight } from "lucide-react";
import { toast as toast8 } from "sonner";

// lib/products/uploadImages.ts
init_supabase_client();

// lib/storage/percorso-caricamento.ts
var CARTELLA_STAFF = "home";
var SECCHIO_PUBBLICO = "products";
function percorsoAmmesso(percorso, {
  userId,
  staff = false,
  /**
   * 8/9/2026 — L'ECCEZIONE DELLO STAFF NON VALE SU TUTTI I MAGAZZINI.
   *
   * La cartella `home` la concede una policy sola, quella del secchio `products`
   * (`migrations/114_hardening_radiografia.sql`). Su `reviews`, `stories` e `cod-proof` il
   * database pretende l'identificativo di chi carica e basta: un caricamento dello staff li'
   * dentro sarebbe partito dal codice e sarebbe stato respinto dal deposito.
   *
   * Il difetto resta `true` di serie perche' `products` e' il magazzino di serie e perche' i
   * chiamanti che gia' c'erano non devono cambiare. Chi conosce il magazzino — cioe'
   * `caricaImmagine` — passa il valore vero, che legge da `lib/storage/regole-secchi.ts`.
   */
  cartellaStaffAmmessa = true
}) {
  const pulito = String(percorso ?? "").replace(/^\/+/, "");
  if (!pulito) return { ammesso: false, motivo: "percorso vuoto" };
  const prima = pulito.split("/")[0];
  if (!pulito.includes("/")) {
    return {
      ammesso: false,
      motivo: `\xAB${pulito}\xBB \xE8 un file nella radice del secchio: la regola pretende una prima cartella`
    };
  }
  if (userId && prima === userId) {
    return { ammesso: true, motivo: "la prima cartella \xE8 chi carica" };
  }
  if (prima === CARTELLA_STAFF) {
    if (!cartellaStaffAmmessa) {
      return {
        ammesso: false,
        motivo: `questo magazzino non concede la cartella \xAB${CARTELLA_STAFF}\xBB: la sua regola vuole l'identificativo di chi carica come prima cartella, e il database rifiuterebbe`
      };
    }
    return staff ? { ammesso: true, motivo: "cartella dello staff, e chi carica \xE8 staff" } : { ammesso: false, motivo: `la cartella \xAB${CARTELLA_STAFF}\xBB la scrive solo lo staff` };
  }
  return {
    ammesso: false,
    motivo: `la prima cartella \xE8 \xAB${prima}\xBB: il database accetta solo l'identificativo di chi carica o \xAB${CARTELLA_STAFF}\xBB per lo staff. Un nome di comodo qui fa rifiutare ogni caricamento.`
  };
}
function suffisso(quando, caso) {
  return `${quando}-${caso}`;
}
function estensioneDi(nomeFile, difetto = "bin") {
  const e = String(nomeFile ?? "").split(".").pop();
  if (!e || e === nomeFile || !/^[a-z0-9]{1,8}$/i.test(e)) return difetto;
  return e.toLowerCase();
}
function percorsoUtente(userId, cartella, nomeFile, { quando, caso }) {
  if (!userId) throw new Error("percorsoUtente senza identificativo: il database lo rifiuterebbe");
  const dentro2 = String(cartella ?? "").replace(/^\/+|\/+$/g, "");
  const coda = `${suffisso(quando, caso)}.${estensioneDi(nomeFile)}`;
  return dentro2 ? `${userId}/${dentro2}/${coda}` : `${userId}/${coda}`;
}
function percorsoStaff(cartella, nomeFile, { quando, caso }) {
  const grezzo = String(cartella ?? "").replace(/^\/+|\/+$/g, "");
  const dentro2 = grezzo === CARTELLA_STAFF ? "" : grezzo;
  const coda = `${suffisso(quando, caso)}.${estensioneDi(nomeFile)}`;
  return dentro2 ? `${CARTELLA_STAFF}/${dentro2}/${coda}` : `${CARTELLA_STAFF}/${coda}`;
}
function casoNuovo() {
  return Math.random().toString(36).slice(2, 8);
}

// lib/storage/regole-secchi.ts
var TIPI_IMMAGINE = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/heic",
  "image/heif"
];
var DIECI_MIB = 10 * 1024 * 1024;
var REGOLE = {
  // Le foto di prodotto, i loghi, le copertine, le immagini della home.
  products: {
    nome: "products",
    tipiAmmessi: TIPI_IMMAGINE,
    maxByte: DIECI_MIB,
    // L'unica eccezione scritta in tutto il sistema: le immagini della home le carica lo staff.
    cartellaStaffAmmessa: true,
    pubblico: true,
    tettoNelDeposito: true
  },
  // Le foto che un cliente allega a una recensione.
  reviews: {
    nome: "reviews",
    tipiAmmessi: TIPI_IMMAGINE,
    maxByte: DIECI_MIB,
    cartellaStaffAmmessa: false,
    pubblico: true,
    tettoNelDeposito: true
  },
  // Le storie del negoziante, che durano 24 ore.
  stories: {
    nome: "stories",
    tipiAmmessi: TIPI_IMMAGINE,
    maxByte: DIECI_MIB,
    // La scheda del difetto diceva che qui non c'e' vincolo di cartella. Era vero nella 035; la
    // `migrations/119_radiografia_18_agosto.sql` l'ha chiuso: prima cartella = chi carica, come
    // gli altri. Comanda il codice del database, non la scheda.
    cartellaStaffAmmessa: false,
    pubblico: true,
    tettoNelDeposito: true
  },
  // La foto dei contanti e quella del pacco consegnato. Magazzino PRIVATO: si legge con un link a
  // scadenza, mai con un indirizzo pubblico.
  "cod-proof": {
    nome: "cod-proof",
    tipiAmmessi: TIPI_IMMAGINE,
    maxByte: DIECI_MIB,
    cartellaStaffAmmessa: false,
    pubblico: false,
    // ⚠️ QUI IL DEPOSITO E' NUDO. La 114 crea il secchio senza `file_size_limit` ne'
    // `allowed_mime_types`: finche' la migrazione qui sotto non e' applicata, l'unica cosa che
    // ferma un file da 300 MB e' il controllo di `caricaImmagine`.
    tettoNelDeposito: false,
    migrazioneCheLoDara: "157_il_magazzino_delle_prove_di_incasso_ha_un_tetto.sql"
  }
};
function regolaDelSecchio(nome) {
  const r = REGOLE[String(nome)];
  if (!r) {
    throw new Error(
      `magazzino \xAB${nome}\xBB senza regola dichiarata: aggiungila in lib/storage/regole-secchi.ts (tipi ammessi, tetto di peso, cartella dello staff) prima di caricarci dentro.`
    );
  }
  return r;
}

// lib/storage/carica-immagine.ts
var ANNO_IN_SECONDI = "31536000";
function pesoDi(file) {
  const c = file;
  if (typeof c?.size === "number") return c.size;
  if (typeof c?.byteLength === "number") return c.byteLength;
  return null;
}
async function caricaImmagine(client, richiesta) {
  const {
    file,
    userId,
    cartella = "",
    staff = false,
    secchio = SECCHIO_PUBBLICO,
    upsert = false,
    cacheControl = ANNO_IN_SECONDI,
    etichetta,
    contentType,
    quando = Date.now(),
    caso = casoNuovo()
  } = richiesta;
  if (!file) throw new Error("caricaImmagine senza file");
  const regola = regolaDelSecchio(secchio);
  const tipoDichiarato = String(contentType || file.type || "").toLowerCase();
  if (tipoDichiarato.startsWith("image/") && !regola.tipiAmmessi.includes(tipoDichiarato)) {
    throw new Error("Formato non accettato: usa una foto JPG, PNG o WEBP.");
  }
  const peso = pesoDi(file);
  if (peso !== null && peso > regola.maxByte) {
    const mb = Math.round(regola.maxByte / (1024 * 1024));
    throw new Error(`La foto \xE8 troppo pesante: il limite \xE8 ${mb} MB. Riducila o scattane un'altra.`);
  }
  if (staff && !regola.cartellaStaffAmmessa) {
    throw new Error(
      `il magazzino \xAB${regola.nome}\xBB non ha una cartella dello staff: ogni file va sotto l'identificativo di chi carica`
    );
  }
  const codaPulita = String(etichetta ?? "").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  const marchio = codaPulita ? `${caso}-${codaPulita}` : caso;
  const percorso = staff ? percorsoStaff(cartella, file.name, { quando, caso: marchio }) : percorsoUtente(String(userId ?? ""), cartella, file.name, { quando, caso: marchio });
  const v = percorsoAmmesso(percorso, {
    userId,
    staff,
    cartellaStaffAmmessa: regola.cartellaStaffAmmessa
  });
  if (!v.ammesso) throw new Error(`percorso non ammesso (${v.motivo})`);
  const opzioni = { upsert };
  const tipo = contentType || file.type;
  if (tipo) opzioni.contentType = tipo;
  if (cacheControl) opzioni.cacheControl = cacheControl;
  const { error } = await client.storage.from(secchio).upload(percorso, file, opzioni);
  if (error) throw error;
  const publicUrl = regola.pubblico ? client.storage.from(secchio).getPublicUrl(percorso).data.publicUrl : "";
  return { percorso, publicUrl };
}

// lib/products/uploadImages.ts
var ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
var MAX_BYTES = 5 * 1024 * 1024;
var LATO_MINIMO_CONSIGLIATO = 800;
async function fotoTroppoPiccole(files) {
  if (typeof createImageBitmap !== "function") return [];
  const piccole = [];
  for (const file of files) {
    try {
      const bitmap = await createImageBitmap(file);
      const latoLungo = Math.max(bitmap.width, bitmap.height);
      bitmap.close?.();
      if (latoLungo > 0 && latoLungo < LATO_MINIMO_CONSIGLIATO) piccole.push(file.name);
    } catch {
    }
  }
  return piccole;
}
async function uploadProductImages(files) {
  if (files.length === 0) return [];
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Non autenticato");
  const uploaded = [];
  for (const original of files) {
    if (!ALLOWED_IMAGE_TYPES.includes(original.type)) {
      throw new Error(`Formato non valido per "${original.name}"`);
    }
    let file = original;
    if (file.size > MAX_BYTES) {
      file = await resizeImageToFile(original, 1600, 0.85);
      if (file.size > MAX_BYTES) file = await resizeImageToFile(original, 1280, 0.7);
    }
    const safeName = file.name.toLowerCase().replace(/[^a-z0-9.\-_]/g, "_").slice(-80);
    const { publicUrl } = await caricaImmagine(supabase, {
      file,
      userId: user.id,
      etichetta: safeName,
      cacheControl: ANNO_IN_SECONDI
    });
    uploaded.push(publicUrl);
  }
  return uploaded;
}

// components/ui/LoadingState.tsx
import { Loader2 as Loader25 } from "lucide-react";

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

// components/ui/LoadingState.tsx
import { jsx as jsx8, jsxs as jsxs8 } from "react/jsx-runtime";
function LoadingState({ variant = "spinner", message, description, rows = 3, cards = 8, className }) {
  const t = useTranslations("states");
  const msg = message ?? t("loading");
  if (variant === "inline") {
    return /* @__PURE__ */ jsxs8("span", { role: "status", "aria-live": "polite", className: cn("inline-flex items-center gap-2 text-sm text-ink-500", className), children: [
      /* @__PURE__ */ jsx8(Loader25, { size: 14, className: "animate-spin", "aria-hidden": true }),
      msg
    ] });
  }
  if (variant === "spinner") {
    return /* @__PURE__ */ jsxs8("div", { role: "status", "aria-live": "polite", className: cn("py-12 text-center", className), children: [
      /* @__PURE__ */ jsx8(Loader25, { size: 32, className: "animate-spin text-primary-700 mx-auto mb-2", strokeWidth: 2.2, "aria-hidden": true }),
      /* @__PURE__ */ jsx8("p", { className: "text-sm text-ink-500", children: msg })
    ] });
  }
  if (variant === "cards") {
    return /* @__PURE__ */ jsxs8("div", { role: "status", "aria-busy": "true", "aria-live": "polite", className: cn("text-center", className), children: [
      /* @__PURE__ */ jsx8(Loader25, { size: 40, className: "animate-spin text-primary-700 mx-auto mb-5", strokeWidth: 2.2, "aria-hidden": true }),
      /* @__PURE__ */ jsx8("h2", { className: "font-serif text-2xl font-bold text-ink-900 mb-1.5", children: msg }),
      description && /* @__PURE__ */ jsx8("p", { className: "text-base text-ink-600 mb-8", children: description }),
      /* @__PURE__ */ jsx8("div", { className: "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 text-left", children: Array.from({ length: cards }).map((_, i) => /* @__PURE__ */ jsxs8("div", { className: "bg-white border border-cream-300 rounded-2xl overflow-hidden", "aria-hidden": true, children: [
        /* @__PURE__ */ jsx8("div", { className: "skeleton aspect-square" }),
        /* @__PURE__ */ jsx8("div", { className: "skeleton h-3 rounded m-2.5" }),
        /* @__PURE__ */ jsx8("div", { className: "skeleton h-3 rounded m-2.5 w-1/2" })
      ] }, i)) })
    ] });
  }
  return /* @__PURE__ */ jsx8("div", { role: "status", "aria-live": "polite", "aria-label": msg, className: cn("space-y-3", className), children: Array.from({ length: rows }).map((_, i) => /* @__PURE__ */ jsx8(
    "div",
    {
      className: "skeleton h-4 rounded",
      style: { width: `${100 - i * 15}%` }
    },
    i
  )) });
}

// components/seller/BackgroundRemovalPreview.tsx
init_supabase_client();
import { Check as Check4 } from "lucide-react";
import { toast as toast7 } from "sonner";
import { Fragment as Fragment5, jsx as jsx9, jsxs as jsxs9 } from "react/jsx-runtime";
var MAX_DIMENSION = 2048;
function BackgroundRemovalPreview({ open, url, onClose, onReplaced }) {
  const [state, setState] = useState("processing");
  const [resultDataUrl, setResultDataUrl] = useState(null);
  const [resultBase64, setResultBase64] = useState(null);
  const [resultMime, setResultMime] = useState("image/png");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open || !url) return;
    let cancelled = false;
    (async () => {
      setState("processing");
      setResultDataUrl(null);
      setResultBase64(null);
      try {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error("Impossibile leggere l\u2019immagine.");
        const blob = await resp.blob();
        const { base64, mediaType } = await resizeImageToBase64(blob, MAX_DIMENSION);
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch("/api/image/remove-bg", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...session?.access_token ? { authorization: `Bearer ${session.access_token}` } : {}
          },
          body: JSON.stringify({ image_base64: base64, media_type: mediaType })
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(apiErrorMessage(body, "Rimozione sfondo non riuscita."));
        if (cancelled) return;
        const outB64 = body.image_base64 ?? "";
        const outMime = body.media_type || "image/png";
        setResultBase64(outB64);
        setResultMime(outMime);
        setResultDataUrl(`data:${outMime};base64,${outB64}`);
        setState("ready");
      } catch (err) {
        if (cancelled) return;
        setState("error");
        toast7.error(err instanceof Error ? err.message : "Rimozione sfondo non riuscita.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, url]);
  const useResult = async () => {
    if (!resultBase64) return;
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Non autenticato");
      const bytes = Uint8Array.from(atob(resultBase64), (c) => c.charCodeAt(0));
      const ext = resultMime === "image/png" ? "png" : resultMime === "image/webp" ? "webp" : "jpg";
      const file = new File([bytes], `bg-white.${ext}`, { type: resultMime });
      const { publicUrl } = await caricaImmagine(supabase, {
        file,
        userId: user.id,
        etichetta: "bg-white",
        cacheControl: "3600",
        contentType: resultMime
      });
      onReplaced(publicUrl);
      toast7.success("Sfondo rimosso");
      onClose();
    } catch (err) {
      toast7.error(friendlyError(err));
    } finally {
      setSaving(false);
    }
  };
  return /* @__PURE__ */ jsx9(
    Modal,
    {
      open,
      onClose,
      title: "Sfondo bianco",
      description: "Confronta e conferma prima di sostituire la foto",
      size: "lg",
      footer: state === "ready" ? /* @__PURE__ */ jsxs9(Fragment5, { children: [
        /* @__PURE__ */ jsx9(
          "button",
          {
            type: "button",
            onClick: onClose,
            disabled: saving,
            className: "rounded-lg px-4 py-2 text-sm font-medium text-ink-700 ring-1 ring-cream-300 hover:bg-cream-50 disabled:opacity-50",
            children: "Annulla"
          }
        ),
        /* @__PURE__ */ jsxs9(
          "button",
          {
            type: "button",
            onClick: useResult,
            disabled: saving,
            className: "inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50",
            children: [
              /* @__PURE__ */ jsx9(Check4, { size: 16, strokeWidth: 2.4, "aria-hidden": true }),
              " ",
              saving ? "Salvataggio\u2026" : "Usa questa"
            ]
          }
        )
      ] }) : void 0,
      children: /* @__PURE__ */ jsxs9("div", { className: "grid grid-cols-2 gap-3", children: [
        /* @__PURE__ */ jsxs9("figure", { className: "space-y-1", children: [
          /* @__PURE__ */ jsx9("figcaption", { className: "text-xs font-medium text-ink-500", children: "Prima" }),
          /* @__PURE__ */ jsx9("div", { className: "aspect-square overflow-hidden rounded-lg border border-cream-200 bg-cream-100", children: url && /* @__PURE__ */ jsx9("img", { src: url, alt: "Foto originale", className: "h-full w-full object-cover" }) })
        ] }),
        /* @__PURE__ */ jsxs9("figure", { className: "space-y-1", children: [
          /* @__PURE__ */ jsx9("figcaption", { className: "text-xs font-medium text-ink-500", children: "Dopo \u2014 sfondo bianco" }),
          /* @__PURE__ */ jsxs9("div", { className: "aspect-square overflow-hidden rounded-lg border border-cream-200 bg-white flex items-center justify-center", children: [
            state === "processing" && /* @__PURE__ */ jsxs9("span", { className: "inline-flex items-center gap-2 text-sm text-ink-500", children: [
              /* @__PURE__ */ jsx9("span", { className: "inline-block h-4 w-4 animate-spin rounded-full border-2 border-primary-300 border-t-primary-600" }),
              "Rimuovo lo sfondo\u2026"
            ] }),
            state === "ready" && resultDataUrl && // eslint-disable-next-line @next/next/no-img-element
            /* @__PURE__ */ jsx9("img", { src: resultDataUrl, alt: "Prodotto su sfondo bianco", className: "h-full w-full object-contain" }),
            state === "error" && /* @__PURE__ */ jsx9("span", { className: "px-3 text-center text-sm text-rose-600", children: "Non riuscito. Chiudi e riprova." })
          ] })
        ] })
      ] })
    }
  );
}

// components/seller/ProductImagesField.tsx
import { Fragment as Fragment6, jsx as jsx10, jsxs as jsxs10 } from "react/jsx-runtime";
function ProductImagesField({
  value,
  onChange,
  error,
  onUploadingChange,
  onUploadSuccess,
  label = "Foto del prodotto",
  dropzoneHint = "Trascina qui le foto o clicca per selezionarle",
  hint,
  showCoverBadge = true,
  maxFiles = 8
}) {
  const [uploading, setUploadingState] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [bgIndex, setBgIndex] = useState(null);
  const setUploading = useCallback(
    (b) => {
      setUploadingState(b);
      onUploadingChange?.(b);
    },
    [onUploadingChange]
  );
  const uploadFiles = useCallback(
    async (files) => {
      if (files.length === 0) return;
      setUploading(true);
      const misura = fotoTroppoPiccole(files).catch(() => []);
      try {
        const uploaded = await uploadProductImages(files);
        onChange([...value, ...uploaded]);
        onUploadSuccess?.();
        toast8.success("Immagini caricate");
        const piccole = await misura;
        if (piccole.length === 1) {
          toast8.warning(
            `\xAB${piccole[0]}\xBB \xE8 una foto piccola: sulla scheda si vedr\xE0 sgranata. Se puoi, caricane una pi\xF9 grande.`
          );
        } else if (piccole.length > 1) {
          toast8.warning(
            `${piccole.length} foto sono piccole: sulla scheda si vedranno sgranate. Se puoi, caricane di pi\xF9 grandi.`
          );
        }
      } catch (err) {
        toast8.error(friendlyError(err));
      } finally {
        setUploading(false);
      }
    },
    [value, onChange, onUploadSuccess, setUploading]
  );
  const move = (from, to) => {
    if (to < 0 || to >= value.length || from === to) return;
    const next = value.slice();
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
  };
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: {
      "image/jpeg": [".jpg", ".jpeg"],
      "image/png": [".png"],
      "image/webp": [".webp"]
    },
    // Limite generoso: le foto oltre i 5 MB vengono ricompresse lato client in
    // fase di upload (vedi uploadProductImages), non rifiutate. Qui blocchiamo
    // solo i file abnormi che non avrebbe senso provare a comprimere.
    maxSize: 30 * 1024 * 1024,
    maxFiles,
    onDropRejected: (rejections) => {
      const reason = rejections[0]?.errors[0]?.code;
      if (reason === "file-too-large") toast8.error("File troppo grande (max 30 MB)");
      else if (reason === "file-invalid-type") toast8.error("Formato non supportato (solo JPG, PNG, WEBP)");
      else if (reason === "too-many-files") toast8.error(`Massimo ${maxFiles} foto per upload`);
      else toast8.error("File non valido");
    },
    onDrop: (files) => {
      void uploadFiles(files);
    }
  });
  return /* @__PURE__ */ jsxs10("div", { id: "image-dropzone", children: [
    /* @__PURE__ */ jsx10("label", { className: "block text-sm font-medium mb-1", children: label }),
    /* @__PURE__ */ jsxs10("div", { className: "mb-2 flex items-center gap-2", children: [
      /* @__PURE__ */ jsxs10(
        "button",
        {
          type: "button",
          onClick: () => setCameraOpen(true),
          className: "inline-flex items-center gap-2 rounded-lg border border-cream-300 bg-white px-3 py-2 text-sm font-semibold text-ink-700 hover:border-primary-300 hover:bg-primary-50",
          children: [
            /* @__PURE__ */ jsx10(Camera4, { size: 16, strokeWidth: 2.2, "aria-hidden": true }),
            " Scatta foto"
          ]
        }
      ),
      /* @__PURE__ */ jsx10("span", { className: "text-xs text-ink-400", children: "oppure carica dalla galleria" })
    ] }),
    /* @__PURE__ */ jsxs10(
      "div",
      {
        ...getRootProps({ role: "button", "aria-label": "Carica le foto del prodotto: trascina i file o premi Invio" }),
        className: `border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${error ? "border-rose-300 bg-rose-50" : isDragActive ? "border-primary-400 bg-primary-50" : "border-cream-300 hover:border-primary-400"}`,
        children: [
          /* @__PURE__ */ jsx10("input", { ...getInputProps({ "aria-label": "Carica le foto del prodotto" }) }),
          uploading ? /* @__PURE__ */ jsx10(LoadingState, { variant: "inline" }) : /* @__PURE__ */ jsx10("p", { className: "text-ink-500", children: dropzoneHint })
        ]
      }
    ),
    hint && /* @__PURE__ */ jsx10("p", { className: "text-xs text-ink-400 mt-1", children: hint }),
    error && /* @__PURE__ */ jsx10("p", { role: "alert", className: "text-sm font-medium text-secondary-600 mt-1", children: error }),
    value.length > 0 && /* @__PURE__ */ jsxs10(Fragment6, { children: [
      value.length > 1 && /* @__PURE__ */ jsxs10("p", { className: "text-xs text-ink-400 mt-3", children: [
        "Trascina o usa le frecce per riordinare. La ",
        /* @__PURE__ */ jsx10("strong", { children: "prima foto \xE8 la copertina" }),
        "."
      ] }),
      /* @__PURE__ */ jsx10("div", { className: "grid grid-cols-3 sm:grid-cols-4 gap-2 mt-2", children: value.map((url, i) => /* @__PURE__ */ jsxs10(
        "div",
        {
          draggable: true,
          onDragStart: (e) => e.dataTransfer.setData("text/plain", String(i)),
          onDragOver: (e) => e.preventDefault(),
          onDrop: (e) => {
            e.preventDefault();
            const from = Number(e.dataTransfer.getData("text/plain"));
            if (!Number.isNaN(from)) move(from, i);
          },
          className: "group",
          children: [
            /* @__PURE__ */ jsxs10("div", { className: "relative aspect-square", children: [
              /* @__PURE__ */ jsx10("img", { src: url, alt: "", loading: "lazy", className: "w-full h-full object-cover rounded" }),
              /* @__PURE__ */ jsx10(
                "button",
                {
                  type: "button",
                  onClick: () => onChange(value.filter((_, j) => j !== i)),
                  "aria-label": "Rimuovi immagine",
                  className: "absolute top-1 right-1 bg-red-500 text-white rounded-full w-6 h-6 text-xs leading-none",
                  children: "\xD7"
                }
              ),
              showCoverBadge && i === 0 && /* @__PURE__ */ jsxs10("span", { className: "absolute top-1 left-1 inline-flex items-center gap-0.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-white", children: [
                /* @__PURE__ */ jsx10(Star, { size: 9, strokeWidth: 2.6, className: "fill-white", "aria-hidden": true }),
                " Copertina"
              ] })
            ] }),
            /* @__PURE__ */ jsxs10("div", { className: "mt-1 flex items-center justify-between gap-1", children: [
              /* @__PURE__ */ jsx10(
                "button",
                {
                  type: "button",
                  onClick: () => move(i, i - 1),
                  disabled: i === 0,
                  "aria-label": "Sposta a sinistra",
                  className: "rounded p-1 text-ink-500 hover:bg-cream-100 disabled:opacity-30",
                  children: /* @__PURE__ */ jsx10(ChevronLeft, { size: 14, strokeWidth: 2.4, "aria-hidden": true })
                }
              ),
              /* @__PURE__ */ jsx10(
                "button",
                {
                  type: "button",
                  onClick: () => move(i, 0),
                  disabled: i === 0,
                  "aria-label": "Imposta come copertina",
                  title: "Imposta come copertina",
                  className: "rounded p-1 text-ink-500 hover:bg-cream-100 disabled:opacity-30",
                  children: /* @__PURE__ */ jsx10(Star, { size: 14, strokeWidth: 2.4, className: i === 0 ? "fill-amber-400 text-amber-500" : "", "aria-hidden": true })
                }
              ),
              /* @__PURE__ */ jsx10(
                "button",
                {
                  type: "button",
                  onClick: () => move(i, i + 1),
                  disabled: i === value.length - 1,
                  "aria-label": "Sposta a destra",
                  className: "rounded p-1 text-ink-500 hover:bg-cream-100 disabled:opacity-30",
                  children: /* @__PURE__ */ jsx10(ChevronRight, { size: 14, strokeWidth: 2.4, "aria-hidden": true })
                }
              )
            ] }),
            /* @__PURE__ */ jsxs10(
              "button",
              {
                type: "button",
                onClick: () => setBgIndex(i),
                className: "mt-1 w-full inline-flex items-center justify-center gap-1 rounded bg-black/70 px-1.5 py-1 text-[10px] font-semibold text-white hover:bg-black/85",
                children: [
                  /* @__PURE__ */ jsx10(Sparkles2, { size: 11, strokeWidth: 2.4, "aria-hidden": true }),
                  " Sfondo bianco"
                ]
              }
            )
          ]
        },
        url
      )) })
    ] }),
    /* @__PURE__ */ jsx10(
      CameraCapture,
      {
        open: cameraOpen,
        onClose: () => setCameraOpen(false),
        onCapture: (file) => {
          void uploadFiles([file]);
        }
      }
    ),
    /* @__PURE__ */ jsx10(
      BackgroundRemovalPreview,
      {
        open: bgIndex !== null,
        url: bgIndex !== null ? value[bgIndex] ?? null : null,
        onClose: () => setBgIndex(null),
        onReplaced: (newUrl) => {
          if (bgIndex === null) return;
          onChange(value.map((u, j) => j === bgIndex ? newUrl : u));
        }
      }
    )
  ] });
}

// components/seller/AttributesFields.tsx
import { Plus, Layers } from "lucide-react";
import { jsx as jsx11, jsxs as jsxs11 } from "react/jsx-runtime";
var AttributesFields = ({
  fields,
  values,
  onChange,
  categoryLabel,
  variantAxes,
  onToggleVariant,
  onAxisValuesChange
}) => {
  const [drafts, setDrafts] = useState({});
  if (fields.length === 0) {
    return /* @__PURE__ */ jsx11("p", { className: "text-sm text-ink-500 italic", children: "Seleziona una categoria per vedere le caratteristiche specifiche del prodotto." });
  }
  const axisValues = (key) => variantAxes?.[key] ?? [];
  const isAxis = (key) => !!variantAxes && key in variantAxes;
  const canVary = (f) => !!f.variantable && !!onToggleVariant;
  const addAxisValue = (key, raw) => {
    const v = raw.trim();
    setDrafts((d) => ({ ...d, [key]: "" }));
    if (!v || !onAxisValuesChange) return;
    const cur = axisValues(key);
    if (cur.some((x) => x.toLowerCase() === v.toLowerCase())) return;
    onAxisValuesChange(key, [...cur, v]);
  };
  const removeAxisValue = (key, val) => onAxisValuesChange?.(key, axisValues(key).filter((x) => x !== val));
  const renderAxis = (f) => {
    const vals = axisValues(f.key);
    const remainingOptions = (f.options ?? []).filter((o) => !vals.includes(o));
    return /* @__PURE__ */ jsxs11(
      "div",
      {
        className: "sm:col-span-2 rounded-lg border border-primary-200 bg-primary-50/40 p-3 space-y-2",
        children: [
          /* @__PURE__ */ jsxs11("div", { className: "flex items-center justify-between", children: [
            /* @__PURE__ */ jsxs11("span", { className: "inline-flex items-center gap-1.5 text-sm font-semibold text-ink-700", children: [
              /* @__PURE__ */ jsx11(Layers, { size: 14, strokeWidth: 2.2, "aria-hidden": true }),
              " ",
              f.label,
              " \xB7 varianti"
            ] }),
            /* @__PURE__ */ jsx11(
              "button",
              {
                type: "button",
                onClick: () => onToggleVariant?.(f.key, false),
                className: "text-xs font-medium text-ink-500 hover:text-ink-800",
                children: "\u21A9 Valore singolo"
              }
            )
          ] }),
          /* @__PURE__ */ jsxs11("div", { className: "flex flex-wrap items-center gap-1.5 rounded-lg border border-cream-300 bg-white p-2", children: [
            vals.map((v) => /* @__PURE__ */ jsxs11(
              "span",
              {
                className: "inline-flex items-center gap-1 rounded-full bg-primary-100 px-2 py-0.5 text-xs font-semibold text-primary-800",
                children: [
                  v,
                  /* @__PURE__ */ jsx11(
                    "button",
                    {
                      type: "button",
                      onClick: () => removeAxisValue(f.key, v),
                      "aria-label": `Rimuovi ${v}`,
                      className: "text-primary-500 hover:text-primary-900",
                      children: "\xD7"
                    }
                  )
                ]
              },
              v
            )),
            /* @__PURE__ */ jsx11(
              "input",
              {
                value: drafts[f.key] ?? "",
                onChange: (e) => setDrafts((d) => ({ ...d, [f.key]: e.target.value })),
                onKeyDown: (e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addAxisValue(f.key, drafts[f.key] ?? "");
                  }
                },
                onBlur: () => addAxisValue(f.key, drafts[f.key] ?? ""),
                placeholder: vals.length === 0 ? `Aggiungi ${f.label.toLowerCase()} (es. S, M, L)\u2026` : "Aggiungi\u2026",
                "aria-label": `Aggiungi ${f.label}`,
                className: "min-w-[8rem] flex-1 border-0 p-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-inset"
              }
            )
          ] }),
          remainingOptions.length > 0 && /* @__PURE__ */ jsx11("div", { className: "flex flex-wrap gap-1.5", children: remainingOptions.map((o) => /* @__PURE__ */ jsxs11(
            "button",
            {
              type: "button",
              onClick: () => onAxisValuesChange?.(f.key, [...vals, o]),
              className: "inline-flex items-center gap-1 rounded-lg border border-cream-300 bg-white px-2 py-0.5 text-xs font-medium text-ink-600 hover:border-primary-300 hover:bg-primary-50",
              children: [
                /* @__PURE__ */ jsx11(Plus, { size: 11, strokeWidth: 2.6, "aria-hidden": true }),
                " ",
                o
              ]
            },
            o
          )) }),
          /* @__PURE__ */ jsx11("p", { className: "text-xs text-ink-400", children: "Imposterai la disponibilit\xE0 di ogni combinazione qui sotto." })
        ]
      },
      f.key
    );
  };
  const renderInput = (f) => {
    const value = values[f.key];
    const id = `attr-${f.key}`;
    if (f.type === "textarea") {
      return /* @__PURE__ */ jsx11(
        "textarea",
        {
          id,
          rows: 2,
          value: value ?? "",
          onChange: (e) => onChange(f.key, e.target.value),
          placeholder: f.placeholder,
          className: "w-full border p-2 rounded focus:outline-none focus:ring-2 focus:ring-primary-700"
        }
      );
    }
    if (f.type === "number") {
      return /* @__PURE__ */ jsx11(
        "input",
        {
          id,
          type: "number",
          value: value ?? "",
          onChange: (e) => onChange(f.key, e.target.value === "" ? void 0 : Number(e.target.value)),
          placeholder: f.placeholder,
          className: "w-full border p-2 rounded focus:outline-none focus:ring-2 focus:ring-primary-700"
        }
      );
    }
    if (f.type === "select") {
      return /* @__PURE__ */ jsxs11(
        "select",
        {
          id,
          value: value ?? "",
          onChange: (e) => onChange(f.key, e.target.value || void 0),
          className: "w-full border p-2 rounded bg-white focus:outline-none focus:ring-2 focus:ring-primary-700",
          children: [
            /* @__PURE__ */ jsx11("option", { value: "", children: "\u2014" }),
            f.options?.map((opt) => /* @__PURE__ */ jsx11("option", { value: opt, children: opt }, opt))
          ]
        }
      );
    }
    if (f.type === "date") {
      return /* @__PURE__ */ jsx11(
        "input",
        {
          id,
          type: "date",
          value: value ?? "",
          onChange: (e) => onChange(f.key, e.target.value || void 0),
          className: "w-full border p-2 rounded focus:outline-none focus:ring-2 focus:ring-primary-700"
        }
      );
    }
    return /* @__PURE__ */ jsx11(
      "input",
      {
        id,
        type: "text",
        value: value ?? "",
        onChange: (e) => onChange(f.key, e.target.value),
        placeholder: f.placeholder,
        className: "w-full border p-2 rounded focus:outline-none focus:ring-2 focus:ring-primary-700"
      }
    );
  };
  return /* @__PURE__ */ jsxs11("div", { className: "space-y-4", children: [
    /* @__PURE__ */ jsxs11("div", { className: "flex items-center justify-between flex-wrap gap-2", children: [
      /* @__PURE__ */ jsxs11("h3", { className: "font-bold text-ink-800", children: [
        "Caratteristiche",
        categoryLabel ? ` \xB7 ${categoryLabel}` : ""
      ] }),
      /* @__PURE__ */ jsx11("span", { className: "text-xs text-ink-500", children: "Tutti i campi sono opzionali" })
    ] }),
    /* @__PURE__ */ jsx11("div", { className: "grid grid-cols-1 sm:grid-cols-2 gap-4", children: fields.map((f) => {
      if (isAxis(f.key)) return renderAxis(f);
      const id = `attr-${f.key}`;
      if (f.type === "checkbox") {
        return /* @__PURE__ */ jsxs11("div", { className: "flex items-center gap-2 pt-6", children: [
          /* @__PURE__ */ jsx11(
            "input",
            {
              id,
              type: "checkbox",
              checked: attributoSpuntato(values[f.key]),
              onChange: (e) => onChange(f.key, e.target.checked),
              className: "w-4 h-4 text-primary-700 rounded focus:ring-primary-700"
            }
          ),
          /* @__PURE__ */ jsx11("label", { htmlFor: id, className: "text-sm text-ink-700", children: f.label })
        ] }, f.key);
      }
      return /* @__PURE__ */ jsxs11("div", { className: f.type === "textarea" ? "sm:col-span-2" : void 0, children: [
        /* @__PURE__ */ jsxs11("label", { htmlFor: id, className: "block text-sm font-medium text-ink-700 mb-1", children: [
          f.label,
          f.required && /* @__PURE__ */ jsx11("span", { className: "ml-1 text-secondary-700", title: "Obbligatorio", children: "*" }),
          f.unit && /* @__PURE__ */ jsxs11("span", { className: "text-ink-400 ml-1", children: [
            "(",
            f.unit,
            ")"
          ] })
        ] }),
        renderInput(f),
        f.helpText && /* @__PURE__ */ jsx11("p", { className: "text-xs text-ink-400 mt-1", children: f.helpText }),
        canVary(f) && /* @__PURE__ */ jsxs11(
          "button",
          {
            type: "button",
            onClick: () => onToggleVariant?.(f.key, true),
            className: "mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-primary-700 hover:text-primary-900",
            children: [
              /* @__PURE__ */ jsx11(Plus, { size: 12, strokeWidth: 2.6, "aria-hidden": true }),
              " Pi\xF9 ",
              f.label.toLowerCase(),
              " (varianti)"
            ]
          }
        )
      ] }, f.key);
    }) })
  ] });
};
var AttributesFields_default = AttributesFields;

// components/seller/BarcodeScanner.tsx
import { ScanLine } from "lucide-react";
import { jsx as jsx12, jsxs as jsxs12 } from "react/jsx-runtime";
function BarcodeScanner({ open, onClose, onDetected }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const detectorRef = useRef(null);
  const [error, setError] = useState(null);
  const [unsupported, setUnsupported] = useState(false);
  const [manual, setManual] = useState("");
  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);
  const finish = useCallback(
    (code) => {
      stop();
      onDetected(code);
      onClose();
    },
    [stop, onDetected, onClose]
  );
  const start = useCallback(async () => {
    setError(null);
    const Ctor = window.BarcodeDetector;
    if (!Ctor || typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setUnsupported(true);
      return;
    }
    try {
      detectorRef.current = new Ctor({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"] });
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false
      });
      streamRef.current = stream;
      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        try {
          await v.play();
        } catch {
        }
      }
      const tick = async () => {
        const video = videoRef.current;
        const det = detectorRef.current;
        if (!video || !det || !streamRef.current) return;
        try {
          if (video.readyState >= 2) {
            const codes = await det.detect(video);
            const hit = codes.find((c) => c.rawValue);
            if (hit) {
              finish(hit.rawValue.replace(/\s/g, ""));
              return;
            }
          }
        } catch {
        }
        rafRef.current = requestAnimationFrame(() => {
          void tick();
        });
      };
      rafRef.current = requestAnimationFrame(() => {
        void tick();
      });
    } catch (e) {
      const name = e instanceof DOMException ? e.name : "";
      setError(name === "NotAllowedError" ? "Permesso fotocamera negato." : "Impossibile avviare la fotocamera.");
    }
  }, [finish]);
  useEffect(() => {
    if (open) {
      setUnsupported(false);
      setError(null);
      setManual("");
      void start();
    }
    return () => stop();
  }, [open]);
  const close = () => {
    stop();
    onClose();
  };
  const submitManual = () => {
    const v = manual.trim();
    if (v) finish(v);
  };
  return /* @__PURE__ */ jsx12(
    Modal,
    {
      open,
      onClose: close,
      title: "Scansiona il codice a barre",
      description: "Inquadra l'EAN sul retro della confezione",
      size: "lg",
      closeOnBackdrop: false,
      children: unsupported || error ? /* @__PURE__ */ jsxs12("div", { className: "space-y-3 py-2 text-center", children: [
        /* @__PURE__ */ jsx12(ScanLine, { className: "mx-auto text-ink-400", size: 36, strokeWidth: 1.6, "aria-hidden": true }),
        /* @__PURE__ */ jsx12("p", { className: "text-sm text-ink-600", children: error ?? "La scansione automatica non \xE8 supportata su questo browser. Inserisci il codice a mano." }),
        /* @__PURE__ */ jsx12(ManualEntry, { value: manual, onChange: setManual, onSubmit: submitManual })
      ] }) : /* @__PURE__ */ jsxs12("div", { className: "space-y-3", children: [
        /* @__PURE__ */ jsxs12("div", { className: "relative mx-auto aspect-[4/3] w-full max-w-sm overflow-hidden rounded-xl bg-black", children: [
          /* @__PURE__ */ jsx12("video", { ref: videoRef, autoPlay: true, muted: true, playsInline: true, className: "h-full w-full object-cover" }),
          /* @__PURE__ */ jsx12("div", { className: "pointer-events-none absolute inset-0 flex items-center justify-center", children: /* @__PURE__ */ jsx12("div", { className: "h-20 w-[82%] rounded-lg border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" }) })
        ] }),
        /* @__PURE__ */ jsx12("p", { className: "text-center text-xs text-ink-500", children: "Tieni il codice a fuoco e ben illuminato." }),
        /* @__PURE__ */ jsx12(ManualEntry, { value: manual, onChange: setManual, onSubmit: submitManual })
      ] })
    }
  );
}
function ManualEntry({
  value,
  onChange,
  onSubmit
}) {
  return /* @__PURE__ */ jsxs12("div", { className: "flex items-center gap-2", children: [
    /* @__PURE__ */ jsx12(
      "input",
      {
        value,
        onChange: (e) => onChange(e.target.value),
        onKeyDown: (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onSubmit();
          }
        },
        inputMode: "numeric",
        placeholder: "Inserisci EAN a mano",
        className: "flex-1 rounded-lg border border-cream-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-700"
      }
    ),
    /* @__PURE__ */ jsx12(
      "button",
      {
        type: "button",
        onClick: onSubmit,
        className: "rounded-lg bg-primary-600 px-3 py-2 text-sm font-semibold text-white hover:bg-primary-700",
        children: "OK"
      }
    )
  ] });
}

// components/AIDescriptionButton.tsx
init_supabase_client();
import { Sparkles as Sparkles3, Loader2 as Loader26 } from "lucide-react";
import { toast as toast9 } from "sonner";
import { jsx as jsx13, jsxs as jsxs13 } from "react/jsx-runtime";
function AIDescriptionButton({ productName, categoryName, currentText, onResult }) {
  const [loading, setLoading] = useState(false);
  const generate = async () => {
    if (!productName.trim()) {
      toast9.error("Scrivi prima il nome del prodotto");
      return;
    }
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        toast9.error("Sessione scaduta");
        return;
      }
      const res = await fetch("/api/ai/description", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ name: productName, current: currentText, category: categoryName })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(apiErrorMessage(json, "Errore"));
      onResult(json.description);
      toast9.success("Descrizione generata \u2014 modifica come preferisci");
    } catch (err) {
      toast9.error(friendlyError(err));
    } finally {
      setLoading(false);
    }
  };
  return /* @__PURE__ */ jsxs13(
    "button",
    {
      type: "button",
      onClick: generate,
      disabled: loading,
      className: "inline-flex items-center gap-1.5 text-xs font-semibold bg-secondary-50 hover:bg-secondary-100 text-secondary-800 border border-secondary-200 px-2.5 py-1 rounded-full transition-colors disabled:opacity-50",
      children: [
        loading ? /* @__PURE__ */ jsx13(Loader26, { size: 12, className: "animate-spin", strokeWidth: 2.4 }) : /* @__PURE__ */ jsx13(Sparkles3, { size: 12, strokeWidth: 2.4 }),
        loading ? "Scrivendo\u2026" : "Genera con AI"
      ]
    }
  );
}

// components/ui/Button.tsx
import { Loader2 as Loader27 } from "lucide-react";
import { Fragment as Fragment7, jsx as jsx14, jsxs as jsxs14 } from "react/jsx-runtime";
var VARIANTS = {
  primary: "bg-primary-700 hover:bg-primary-800 text-white shadow-warm-sm",
  // CTA d'acquisto (mostarda): alta visibilità sul canvas neutro.
  accent: "bg-accent-400 hover:bg-accent-500 text-ink-900 shadow-sm hover:shadow-warm",
  secondary: "bg-white border border-cream-300 hover:bg-cream-50 text-ink-900",
  ghost: "text-primary-700 hover:bg-primary-50",
  danger: "bg-red-600 hover:bg-red-700 text-white",
  success: "bg-olive-600 hover:bg-olive-700 text-white"
};
var SIZES2 = {
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
  const classes = cn(BASE, VARIANTS[variant], SIZES2[size], SHAPES[shape], fullWidth && "w-full", className);
  const iconSize = size === "sm" ? 12 : size === "lg" ? 18 : 14;
  const content = /* @__PURE__ */ jsxs14(Fragment7, { children: [
    loading && /* @__PURE__ */ jsx14(Loader27, { size: iconSize, className: "animate-spin", "aria-hidden": true }),
    !loading && Icon && /* @__PURE__ */ jsx14(Icon, { size: iconSize, strokeWidth: 2.4, "aria-hidden": true }),
    children,
    !loading && IconRight && /* @__PURE__ */ jsx14(IconRight, { size: iconSize, strokeWidth: 2.4, "aria-hidden": true })
  ] });
  if ("href" in rest && rest.href) {
    const { href, target, rel } = rest;
    return /* @__PURE__ */ jsx14(next_link_default, { href, target, rel, className: classes, children: content });
  }
  const { disabled: disabledProp, type: typeProp, ...restButtonProps } = rest;
  return /* @__PURE__ */ jsx14(
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

// components/ui/Field.tsx
import { ChevronDown, Eye, EyeOff } from "lucide-react";
import { jsx as jsx15, jsxs as jsxs15 } from "react/jsx-runtime";
var CONTROL_BASE = "w-full rounded-lg border bg-white text-base text-ink-900 placeholder:text-ink-400 transition-colors focus:outline-none focus-visible:ring-2 disabled:opacity-60 disabled:cursor-not-allowed";
var CONTROL_OK = "border-cream-300 focus-visible:ring-primary-700 focus-visible:border-primary-700";
var CONTROL_ERR = "border-secondary-400 focus-visible:ring-secondary-400 focus-visible:border-secondary-400";
var PAD = "px-3 py-2.5";
function Field({ id, label, required, hint, error, className, labelAction, children }) {
  return /* @__PURE__ */ jsxs15("div", { className: cn("space-y-1", className), children: [
    (label || labelAction) && /* @__PURE__ */ jsxs15("div", { className: "flex items-center justify-between gap-2", children: [
      label ? /* @__PURE__ */ jsxs15("label", { htmlFor: id, className: "block text-sm font-medium text-ink-700", children: [
        label,
        required && /* @__PURE__ */ jsx15("span", { className: "text-secondary-600", "aria-hidden": true, children: " *" })
      ] }) : /* @__PURE__ */ jsx15("span", {}),
      labelAction
    ] }),
    children,
    hint && !error && /* @__PURE__ */ jsx15("p", { id: `${id}-hint`, className: "text-xs text-ink-500", children: hint }),
    error && // 131 — Senza `role="alert"` l'errore compariva a video e basta: chi usa
    // un lettore di schermo premeva «Invia», non succedeva niente di
    // udibile, e non aveva modo di sapere perché. È la correzione col
    // rapporto impatto/righe più alto dell'audit, perché questa primitiva
    // serve OGNI form del sito: accesso, registrazione, indirizzi,
    // checkout, area venditore.
    /* @__PURE__ */ jsx15("p", { id: `${id}-error`, role: "alert", className: "text-xs font-medium text-secondary-600", children: error })
  ] });
}
function describedBy(id, hint, error) {
  return cn(error ? `${id}-error` : "", hint && !error ? `${id}-hint` : "") || void 0;
}
var Input = forwardRef(function Input2({ label, hint, error, required, id, className, containerClassName, labelAction, leading, trailing, ...props }, ref) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const control = /* @__PURE__ */ jsx15(
    "input",
    {
      ref,
      id: fieldId,
      required,
      "aria-invalid": error ? true : void 0,
      "aria-describedby": describedBy(fieldId, hint, error),
      className: cn(CONTROL_BASE, PAD, leading ? "pl-10" : "", trailing ? "pr-11" : "", error ? CONTROL_ERR : CONTROL_OK, className),
      ...props
    }
  );
  return /* @__PURE__ */ jsx15(Field, { id: fieldId, label, required, hint, error, className: containerClassName, labelAction, children: leading || trailing ? /* @__PURE__ */ jsxs15("div", { className: "relative", children: [
    leading && /* @__PURE__ */ jsx15("span", { className: "absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none", children: leading }),
    control,
    trailing && /* @__PURE__ */ jsx15("span", { className: "absolute right-1.5 top-1/2 -translate-y-1/2", children: trailing })
  ] }) : control });
});
var PasswordInput = forwardRef(function PasswordInput2(props, ref) {
  const [show, setShow] = useState(false);
  return /* @__PURE__ */ jsx15(
    Input,
    {
      ref,
      type: show ? "text" : "password",
      trailing: /* @__PURE__ */ jsx15(
        "button",
        {
          type: "button",
          onClick: () => setShow((v) => !v),
          "aria-label": show ? "Nascondi password" : "Mostra password",
          "aria-pressed": show,
          className: "text-ink-500 hover:text-ink-700 hover:bg-cream-100 rounded-md p-2 transition-colors",
          children: show ? /* @__PURE__ */ jsx15(EyeOff, { size: 18, "aria-hidden": true }) : /* @__PURE__ */ jsx15(Eye, { size: 18, "aria-hidden": true })
        }
      ),
      ...props
    }
  );
});
var Textarea = forwardRef(function Textarea2({ label, hint, error, required, id, className, containerClassName, labelAction, ...props }, ref) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return /* @__PURE__ */ jsx15(Field, { id: fieldId, label, required, hint, error, className: containerClassName, labelAction, children: /* @__PURE__ */ jsx15(
    "textarea",
    {
      ref,
      id: fieldId,
      required,
      "aria-invalid": error ? true : void 0,
      "aria-describedby": describedBy(fieldId, hint, error),
      className: cn(CONTROL_BASE, PAD, error ? CONTROL_ERR : CONTROL_OK, className),
      ...props
    }
  ) });
});
var Select = forwardRef(function Select2({ label, hint, error, required, id, className, containerClassName, labelAction, children, ...props }, ref) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return /* @__PURE__ */ jsx15(Field, { id: fieldId, label, required, hint, error, className: containerClassName, labelAction, children: /* @__PURE__ */ jsxs15("div", { className: "relative", children: [
    /* @__PURE__ */ jsx15(
      "select",
      {
        ref,
        id: fieldId,
        required,
        "aria-invalid": error ? true : void 0,
        "aria-describedby": describedBy(fieldId, hint, error),
        className: cn(CONTROL_BASE, PAD, "appearance-none pr-10", error ? CONTROL_ERR : CONTROL_OK, className),
        ...props,
        children
      }
    ),
    /* @__PURE__ */ jsx15(
      ChevronDown,
      {
        size: 18,
        strokeWidth: 2.2,
        "aria-hidden": true,
        className: "pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-primary-700"
      }
    )
  ] }) });
});
var Checkbox = forwardRef(function Checkbox2({ label, id, error, className, containerClassName, ...props }, ref) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return /* @__PURE__ */ jsxs15("div", { className: containerClassName, children: [
    /* @__PURE__ */ jsxs15("label", { htmlFor: fieldId, className: "flex items-start gap-2 text-sm text-ink-700 cursor-pointer", children: [
      /* @__PURE__ */ jsx15(
        "input",
        {
          ref,
          id: fieldId,
          type: "checkbox",
          "aria-invalid": error ? true : void 0,
          "aria-describedby": error ? `${fieldId}-error` : void 0,
          className: cn(
            "mt-0.5 h-4 w-4 rounded border-cream-300 text-primary-700 accent-primary-600 focus-visible:ring-2 focus-visible:ring-primary-700",
            className
          ),
          ...props
        }
      ),
      label && /* @__PURE__ */ jsx15("span", { children: label })
    ] }),
    error && // 22/8/2026 — mancava `role="alert"`, che venti righe sopra c'è.
    // L'errore di ogni altro campo viene letto a voce; quello delle
    // caselle di consenso restava muto — e sono proprio quelle su cui ci
    // si blocca in registrazione, senza capire perché il pulsante non fa
    // niente.
    /* @__PURE__ */ jsx15("p", { id: `${fieldId}-error`, role: "alert", className: "text-xs font-medium text-secondary-600 mt-1", children: error })
  ] });
});

// components/seller/ProductForm.tsx
init_supabase_client();

// lib/products/salvataggio-tracciato.ts
var COLONNE_DEL_VENDITORE = [
  "name",
  "description",
  "price",
  "compare_at_price",
  "unit",
  "condition",
  "stock",
  "category_id",
  "images",
  "attributes",
  "tags",
  "express_enabled",
  "status"
];
var COLONNE_DA_RILEGGERE = ["id", "seller_id", ...COLONNE_DEL_VENDITORE].join(", ");
function colonneDelPatchAi(patch) {
  if (!patch || typeof patch !== "object") return [];
  const mappa = {
    name: "name",
    description: "description",
    price: "price",
    compare_at_price: "compare_at_price",
    unit: "unit",
    condition: "condition",
    stock: "stock",
    unlimited_stock: "stock",
    category_id: "category_id",
    category_slug: "category_id",
    subcategory_name: "category_id",
    tags: "tags",
    attributes: "attributes",
    attributes_remove: "attributes",
    images: "images",
    status: "status"
  };
  const colonne = [];
  for (const [chiave, valore] of Object.entries(patch)) {
    if (valore === void 0) continue;
    const colonna = mappa[chiave];
    if (colonna && !colonne.includes(colonna)) colonne.push(colonna);
  }
  return colonne;
}
var DaCompletare = class extends Error {
  constructor(messaggio, mancanti) {
    super(messaggio);
    this.name = "DaCompletare";
    this.mancanti = mancanti;
  }
};

// lib/hooks/useFormAutosave.ts
function useFormAutosave(key, value, opts) {
  const enabled = opts?.enabled ?? true;
  const delay = opts?.delay ?? 600;
  const timer = useRef(null);
  useEffect(() => {
    if (!enabled) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
      }
    }, delay);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [key, value, enabled, delay]);
}

// lib/products/variants.ts
var MAX_VARIANTS = 100;
var MAX_OPTION_TYPES = 3;
var MAX_OPTION_VALUES = 30;
function buildVariantLabel(options) {
  return Object.values(options).map((v) => v.trim()).filter(Boolean).join(" \xB7 ");
}
function optionsKey(options) {
  return Object.keys(options).sort().map((k) => `${k}=${options[k]}`).join("|");
}
function dedupe(arr) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const x of arr) {
    const k = x.toLowerCase();
    if (k && !seen.has(k)) {
      seen.add(k);
      out.push(x);
    }
  }
  return out;
}
function buildCombinations(types) {
  const clean = types.map((t) => ({ name: t.name.trim(), values: dedupe(t.values.map((v) => v.trim()).filter(Boolean)) })).filter((t) => t.name && t.values.length > 0).slice(0, MAX_OPTION_TYPES);
  if (clean.length === 0) return [];
  let combos = [{}];
  for (const t of clean) {
    const next = [];
    for (const c of combos) {
      for (const v of t.values.slice(0, MAX_OPTION_VALUES)) next.push({ ...c, [t.name]: v });
    }
    combos = next;
  }
  return combos.slice(0, MAX_VARIANTS);
}
function reconcileVariants(types, existing) {
  const byKey = new Map(existing.map((v) => [optionsKey(v.options), v]));
  return buildCombinations(types).map((options, i) => {
    const prev = byKey.get(optionsKey(options));
    return {
      id: prev?.id,
      options,
      label: buildVariantLabel(options),
      stock: prev?.stock ?? 0,
      position: i
    };
  });
}
function deriveOptionGroups(variants) {
  const order = [];
  const map = /* @__PURE__ */ new Map();
  for (const v of variants) {
    for (const [k, val] of Object.entries(v.options)) {
      if (!map.has(k)) {
        map.set(k, []);
        order.push(k);
      }
      const list = map.get(k);
      if (!list.includes(val)) list.push(val);
    }
  }
  return order.map((name) => ({ name, values: map.get(name) }));
}
function totalVariantStock(variants) {
  return variants.reduce((s, v) => s + (Number.isFinite(v.stock) ? Math.max(0, v.stock) : 0), 0);
}
function normalizeVariants(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r;
    const options = o.options && typeof o.options === "object" && !Array.isArray(o.options) ? o.options : {};
    const stockNum = Number(o.stock);
    out.push({
      id: typeof o.id === "string" ? o.id : void 0,
      options,
      label: typeof o.label === "string" && o.label ? o.label : buildVariantLabel(options),
      stock: Number.isFinite(stockNum) ? Math.max(0, Math.trunc(stockNum)) : 0,
      position: typeof o.position === "number" ? o.position : void 0
    });
  }
  return out;
}

// components/seller/ProductForm.tsx
import { Fragment as Fragment8, jsx as jsx16, jsxs as jsxs16 } from "react/jsx-runtime";
function ProductForm({
  mode,
  categories,
  initialValues,
  submitting = false,
  onSubmit,
  onDelete,
  deleteLabel = "Elimina prodotto",
  deleting = false,
  onDiscard,
  recessoSegnabile = false,
  productId,
  sellerOffersExpress = false,
  consegnaDelNegozioNonLetta = false,
  autosaveKey,
  aiAccesa = AI_NEGOZI_ACCESA
}) {
  const schema = useMemo(
    () => createProductSchema({ minDescription: mode === "create" ? 30 : 10 }),
    [mode]
  );
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    getValues,
    formState: { errors }
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      name: initialValues?.name ?? "",
      description: initialValues?.description ?? "",
      price: initialValues?.price ?? void 0,
      compareAtPrice: initialValues?.compareAtPrice ?? void 0,
      stock: initialValues?.stock === null ? void 0 : initialValues?.stock ?? 1,
      category_id: initialValues?.category_id ?? ""
    }
  });
  const [imageUrls, setImageUrls] = useState(initialValues?.images ?? []);
  const [imageError, setImageError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [attributes, setAttributes] = useState(initialValues?.attributes ?? {});
  const [tags, setTags] = useState(initialValues?.tags ?? []);
  const idTag = useId();
  const [tagInput, setTagInput] = useState("");
  const [unit, setUnit] = useState(initialValues?.unit ?? "pezzo");
  const [condition, setCondition] = useState(initialValues?.condition ?? "");
  const [unlimitedStock, setUnlimitedStock] = useState(initialValues?.stock === null);
  const [fastDelivery, setFastDelivery] = useState(
    initialValues?.expressEnabled === true ? true : initialValues?.expressEnabled === false ? false : Boolean(sellerOffersExpress)
  );
  const [consegnaSceltaDalNegoziante, setConsegnaSceltaDalNegoziante] = useState(false);
  const scegliTempoDiConsegna = (veloce) => {
    setFastDelivery(veloce);
    setConsegnaSceltaDalNegoziante(true);
  };
  const [status, setStatus] = useState(initialValues?.status ?? "available");
  const recedibileAllApertura = initialValues?.nonRecedibile === true;
  const [nonRecedibile, setNonRecedibile] = useState(recedibileAllApertura);
  const [variants, setVariants] = useState(initialValues?.variants ?? []);
  const [variantAxes, setVariantAxes] = useState(
    () => Object.fromEntries(deriveOptionGroups(initialValues?.variants ?? []).map((g) => [g.name, g.values]))
  );
  const [scanOpen, setScanOpen] = useState(false);
  const [aiVariantsBusy, setAiVariantsBusy] = useState(false);
  const [aiPhotosBusy, setAiPhotosBusy] = useState(false);
  const [daControllare, setDaControllare] = useState([]);
  const idDaControllare = useId();
  const hasVariants = variants.length > 0;
  const scortaAllApertura = useRef({
    prodotto: initialValues?.stock,
    varianti: Object.fromEntries(
      (initialValues?.variants ?? []).filter((v) => v.id).map((v) => [v.id, v.stock])
    )
  });
  const currentCategoryId = watch("category_id") || "";
  const topCategories = useMemo(() => categories.filter((c) => !c.parent_id), [categories]);
  const resolveTop = (catId) => {
    let cur = categories.find((c) => c.id === catId);
    while (cur?.parent_id) {
      const parent = categories.find((c) => c.id === cur.parent_id);
      if (!parent) break;
      cur = parent;
    }
    return cur?.id ?? "";
  };
  const currentTopId = currentCategoryId ? resolveTop(currentCategoryId) : "";
  const subcategories = useMemo(
    () => currentTopId ? categories.filter((c) => c.parent_id === currentTopId) : [],
    [categories, currentTopId]
  );
  const topName = categories.find((c) => c.id === currentTopId)?.name;
  const { fields: attrFields, topSlug } = getAttributesForCategory(categories, currentCategoryId);
  const topCategoryLabel = topSlug ? categories.find((c) => c.slug === topSlug)?.name : void 0;
  const hasEanField = attrFields.some((f) => f.key === "ean");
  const setAttribute = (key, value) => {
    setAttributes((prev) => {
      const next = { ...prev };
      if (value === void 0 || value === "" || value === null) delete next[key];
      else next[key] = value;
      return next;
    });
  };
  const applyAxes = (next) => {
    setVariantAxes(next);
    const order = attrFields.map((f) => f.key);
    const types = Object.entries(next).filter(([, vals]) => vals.length > 0).sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])).map(([name, values]) => ({ name, values }));
    setVariants((cur) => reconcileVariants(types, cur));
  };
  const toggleVariantAxis = (key, on) => {
    const next = { ...variantAxes };
    if (on) {
      next[key] = next[key] ?? [];
      setAttribute(key, "");
    } else {
      delete next[key];
    }
    applyAxes(next);
  };
  const setAxisValues = (key, values) => applyAxes({ ...variantAxes, [key]: values });
  const setVariantStock = (idx, stock) => setVariants(
    (prev) => prev.map((v, i) => i === idx ? { ...v, stock: Math.max(0, Math.trunc(stock || 0)) } : v)
  );
  const watched = watch();
  const snapshot = useMemo(
    () => ({ ...watched, imageUrls, attributes, tags, unit, condition, fastDelivery, unlimitedStock }),
    [watched, imageUrls, attributes, tags, unit, condition, fastDelivery, unlimitedStock]
  );
  useFormAutosave(autosaveKey ?? "mc_product_unused", snapshot, {
    enabled: mode === "create" && !!autosaveKey
  });
  const handlePhotoImages = async (files) => {
    if (files.length === 0) return;
    setUploading(true);
    try {
      const urls = await uploadProductImages(files);
      if (urls.length) {
        setImageUrls((prev) => [...prev, ...urls]);
        setImageError(null);
        toast10.success("Foto aggiunte al prodotto");
      }
    } catch (err) {
      toast10.error(friendlyError(err));
    } finally {
      setUploading(false);
    }
  };
  const campiDallAi = useRef(/* @__PURE__ */ new Set());
  const segnaCampiDallAi = (colonne) => {
    for (const c of colonne) campiDallAi.current.add(c);
  };
  const handleExtracted = (data) => {
    if (data.name) setValue("name", data.name, { shouldValidate: true });
    if (data.description) setValue("description", data.description, { shouldValidate: true });
    const { patch: dallaFoto, rifiutati: prezzoScartato } = patchAiPerIlForm(
      { price: data.suggested_price && data.suggested_price > 0 ? data.suggested_price : void 0 },
      { prezzoAttuale: getValues("price") }
    );
    if (typeof dallaFoto.price === "number") {
      setValue("price", dallaFoto.price, { shouldValidate: true });
    }
    for (const motivo of prezzoScartato) toast10.warning(motivo);
    segnaCampiDallAi(
      colonneDelPatchAi({
        name: data.name,
        description: data.description,
        price: dallaFoto.price,
        category_id: data.subcategory_id ?? data.category_id,
        tags: Array.isArray(data.tags) && data.tags.length > 0 ? data.tags : void 0,
        attributes: data.attributes
      })
    );
    const resolvedCategory = data.subcategory_id ?? data.category_id;
    if (resolvedCategory) setValue("category_id", resolvedCategory, { shouldValidate: true });
    if (Array.isArray(data.tags) && data.tags.length > 0) {
      setTags((prev) => {
        const next = [...prev];
        for (const raw of data.tags) {
          const t = String(raw).trim().toLowerCase().replace(/,+$/, "");
          if (t && !next.includes(t) && next.length < 15) next.push(t);
        }
        return next;
      });
    }
    if (data.attributes) {
      const cond = data.attributes["condizione"];
      if (typeof cond === "string") {
        const norm = condizioneDalSuggerimento(cond);
        if (norm) setCondition(norm);
      }
      if (data.category_id) {
        const { fields } = getAttributesForCategory(categories, data.category_id);
        for (const [aiKey, rawValue] of Object.entries(data.attributes)) {
          if (aiKey === "condizione") continue;
          const value = typeof rawValue === "string" ? rawValue.trim() : typeof rawValue === "number" ? String(rawValue) : "";
          if (!value) continue;
          const targetKey = AI_ATTR_TO_FIELD[aiKey] ?? aiKey;
          const field = fields.find((f) => f.key === targetKey);
          if (!field) continue;
          if (field.type === "select") {
            const opt = (field.options ?? []).find((o) => o.toLowerCase() === value.toLowerCase());
            if (!opt) continue;
            setAttribute(targetKey, opt);
          } else if (field.type === "checkbox") {
            setAttribute(targetKey, attributoSpuntato(value));
          } else {
            setAttribute(targetKey, value);
          }
        }
      }
    }
    if (data.alt_text) setAttribute("alt_text", data.alt_text);
  };
  const chatSnapshot = {
    name: watch("name") ?? "",
    description: watch("description") ?? "",
    price: Number(watch("price")) || null,
    compareAtPrice: Number(watch("compareAtPrice")) || null,
    unit,
    condition,
    stock: unlimitedStock ? null : Number(watch("stock")) || null,
    unlimitedStock,
    categorySlug: categories.find((c) => c.id === currentTopId)?.slug ?? null,
    subcategoryName: currentCategoryId && currentCategoryId !== currentTopId ? categories.find((c) => c.id === currentCategoryId)?.name ?? null : null,
    tags,
    attributes,
    status
  };
  const applyPatch = (proposta) => {
    const piano = pianoPatchPerIlModulo(proposta, {
      prezzoAttuale: getValues("price"),
      categorie: categories,
      categoriaAttuale: currentCategoryId,
      modo: mode
    });
    setDaControllare((prima) => unisciVociDaControllare(prima, piano.daControllare));
    segnaCampiDallAi(colonneDelPatchAi(piano.patch));
    for (const s of piano.scritture) {
      switch (s.campo) {
        case "name":
        case "description":
          setValue(s.campo, s.valore, { shouldValidate: true });
          break;
        case "price":
          setValue("price", s.valore, { shouldValidate: true });
          break;
        case "compareAtPrice":
          setValue("compareAtPrice", s.valore ?? void 0, { shouldValidate: true });
          break;
        case "unit":
          setUnit(s.valore);
          break;
        case "condition":
          if (condizioneDaScegliere(s.valore)) setCondition(s.valore);
          break;
        case "stock":
          if (s.valore === null) {
            setUnlimitedStock(true);
          } else {
            setUnlimitedStock(false);
            setValue("stock", s.valore, { shouldValidate: true });
          }
          break;
        case "category_id":
          setValue("category_id", s.valore, { shouldValidate: true });
          break;
        case "tags":
          setTags(s.valore);
          break;
        case "attributo":
          setAttribute(s.chiave, s.valore);
          break;
        case "status":
          setStatus(s.valore);
          break;
      }
    }
    return esitoDelPiano(piano);
  };
  const togliDaControllare = (id) => setDaControllare((prima) => prima.filter((v) => v.id !== id));
  const usaProposta = (voce) => {
    if (voce.chiave === void 0 || voce.valore === void 0) return;
    setAttribute(voce.chiave, voce.valore);
    togliDaControllare(voce.id);
  };
  const handleBarcodeDetected = async (code) => {
    setAttribute("ean", code);
    if (!aiAccesa) {
      toast10.success("Codice EAN salvato");
      return;
    }
    const tid = toast10.loading("Cerco il prodotto dal codice EAN\u2026");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        toast10.dismiss(tid);
        return;
      }
      const res = await fetch("/api/ai/barcode-lookup", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          ean: code,
          attributeSchema: attrFields,
          topCategories: topCategories.map((c) => ({ name: c.name, slug: c.slug }))
        })
      });
      const json = await res.json();
      if (res.ok && json.found && json.patch) {
        const esito = applyPatch(json.patch);
        dilloDopoIlPatch(
          esito,
          { applicato: "Compilato dal codice EAN \u2014 controlla e salva", niente: "Codice EAN salvato" },
          { id: tid }
        );
      } else {
        toast10("Codice EAN salvato. Non ho trovato il prodotto online: compila a mano.", { id: tid });
      }
    } catch {
      toast10.dismiss(tid);
    }
  };
  const variantableFields = useMemo(() => attrFields.filter((f) => f.variantable), [attrFields]);
  const handleSuggestVariants = async () => {
    if (variantableFields.length === 0) {
      toast10("Questa categoria non ha campi che diventano varianti.");
      return;
    }
    setAiVariantsBusy(true);
    const tid = toast10.loading("Cerco le varianti adatte\u2026");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        toast10.dismiss(tid);
        return;
      }
      const res = await fetch("/api/ai/variants", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          product: chatSnapshot,
          imageUrls,
          variantableFields: variantableFields.map((f) => ({ key: f.key, label: f.label, type: f.type, options: f.options }))
        })
      });
      const json = await res.json();
      if (res.ok && Array.isArray(json.axes) && json.axes.length > 0) {
        const next = { ...variantAxes };
        for (const a of json.axes) next[a.key] = a.values;
        applyAxes(next);
        toast10.success(`Proposte ${json.axes.length} varianti \u2014 controlla le combinazioni e lo stock`, { id: tid });
      } else {
        toast10("Nessuna variante sensata per questo prodotto.", { id: tid });
      }
    } catch (err) {
      toast10.dismiss(tid);
      toast10.error(friendlyError(err));
    } finally {
      setAiVariantsBusy(false);
    }
  };
  const handleOrderPhotos = async () => {
    if (imageUrls.length < 2) return;
    setAiPhotosBusy(true);
    const tid = toast10.loading("Scelgo copertina e ordine\u2026");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        toast10.dismiss(tid);
        return;
      }
      const res = await fetch("/api/vision/photo-order", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ imageUrls })
      });
      const json = await res.json();
      if (res.ok && Array.isArray(json.order)) {
        const reordered = json.order.map((i) => imageUrls[i]).filter((u) => !!u);
        if (reordered.length === imageUrls.length) setImageUrls(reordered);
        const tip = Array.isArray(json.tips) && json.tips.length ? ` Consiglio: ${json.tips[0]}` : "";
        toast10.success(`Foto riordinate, copertina scelta.${tip}`, { id: tid });
      } else {
        toast10.dismiss(tid);
      }
    } catch (err) {
      toast10.dismiss(tid);
      toast10.error(friendlyError(err));
    } finally {
      setAiPhotosBusy(false);
    }
  };
  const addTag = (raw) => {
    const t = raw.trim().replace(/,+$/, "").toLowerCase();
    if (!t) return;
    if (tags.includes(t)) {
      setTagInput("");
      return;
    }
    if (tags.length >= 15) {
      toast10("Massimo 15 tag");
      return;
    }
    setTags([...tags, t]);
    setTagInput("");
  };
  const makeSubmit = (intent) => handleSubmit((values) => {
    if (imageUrls.length === 0) {
      setImageError("Aggiungi almeno una foto: senza immagini il prodotto non vende.");
      document.getElementById("image-dropzone")?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    const finalStatus = mode === "create" ? intent === "draft" ? "draft" : "available" : status;
    if (finalStatus !== "draft") {
      const mancanti = attrFields.filter((f) => f.required && !String(attributes[f.key] ?? "").trim()).map((f) => f.label);
      if (mancanti.length > 0) {
        toast10.error(
          mancanti.length === 1 ? `Prima di pubblicare devi compilare \xAB${mancanti[0]}\xBB.` : `Prima di pubblicare devi compilare: ${mancanti.join(", ")}.`
        );
        document.getElementById("attributi-categoria")?.scrollIntoView({ block: "center", behavior: "smooth" });
        return;
      }
    }
    const payload = buildProductPayload({
      values,
      imageUrls,
      attributes,
      unit,
      condition,
      tags,
      expressEnabled: fastDelivery,
      // Con varianti lo stock prodotto è la SOMMA delle varianti (e mai illimitato):
      // viene comunque riallineato dal trigger DB dopo l'insert delle varianti.
      unlimitedStock: hasVariants ? false : unlimitedStock,
      status: finalStatus
    });
    if (hasVariants) payload.stock = totalVariantStock(variants);
    if (recessoSegnabile && nonRecedibile !== recedibileAllApertura) payload.non_recedibile = nonRecedibile;
    if (mode === "edit" && !scortaCambiata(payload.stock, scortaAllApertura.current.prodotto)) {
      delete payload.stock;
    }
    if (mode === "edit" && hasVariants) delete payload.stock;
    if (mode === "edit" && "stock" in payload && typeof scortaAllApertura.current.prodotto === "number") {
      payload.stock_visto = scortaAllApertura.current.prodotto;
    }
    if (consegnaDelNegozioNonLetta && !consegnaSceltaDalNegoziante) {
      delete payload.express_enabled;
    }
    onSubmit(payload, {
      intent,
      variants,
      campiDallAi: [...campiDallAi.current],
      scorteViste: { ...scortaAllApertura.current.varianti }
    });
  });
  const priceNum = Number(watch("price")) || 0;
  const cmpNum = Number(watch("compareAtPrice")) || 0;
  const hasDiscount = cmpNum > priceNum && priceNum > 0;
  const discountPct = hasDiscount ? Math.round((1 - priceNum / cmpNum) * 100) : 0;
  const busy = submitting || uploading;
  const primaryIntent = mode === "create" ? "publish" : "save";
  return /* @__PURE__ */ jsxs16("div", { className: "space-y-6", children: [
    aiAccesa && /* @__PURE__ */ jsxs16(Fragment8, { children: [
      /* @__PURE__ */ jsx16(PhotoFillButton_default, { onFilled: handleExtracted, onImages: (files) => void handlePhotoImages(files) }),
      /* @__PURE__ */ jsx16(
        VoiceProductButton,
        {
          attributeSchema: attrFields,
          topCategories: topCategories.map((c) => ({ name: c.name, slug: c.slug })),
          onApplyPatch: applyPatch
        }
      ),
      /* @__PURE__ */ jsx16(
        ImproveAllPanel,
        {
          product: chatSnapshot,
          attributeSchema: attrFields,
          topCategories: topCategories.map((c) => ({ name: c.name, slug: c.slug })),
          imageUrls,
          onApplyPatch: applyPatch,
          disabled: !(watch("name") ?? "").trim() && imageUrls.length === 0
        }
      ),
      /* @__PURE__ */ jsx16(
        QuickAiTools,
        {
          product: chatSnapshot,
          attributeSchema: attrFields,
          topCategories: topCategories.map((c) => ({ name: c.name, slug: c.slug })),
          imageUrls,
          onApplyPatch: applyPatch,
          disabled: !(watch("name") ?? "").trim() && imageUrls.length === 0,
          accesa: aiAccesa
        }
      ),
      /* @__PURE__ */ jsx16(
        ProductChatAssistant,
        {
          product: chatSnapshot,
          attributeSchema: attrFields,
          topCategories: topCategories.map((c) => ({ name: c.name, slug: c.slug })),
          imageUrls,
          onApplyPatch: applyPatch
        }
      )
    ] }),
    daControllare.length > 0 && /* @__PURE__ */ jsxs16(
      "section",
      {
        "aria-labelledby": `${idDaControllare}-titolo`,
        className: "rounded-lg border border-accent-200 bg-accent-50 p-3",
        children: [
          /* @__PURE__ */ jsx16("h2", { id: `${idDaControllare}-titolo`, className: "text-sm font-semibold text-accent-700", children: "Da controllare" }),
          /* @__PURE__ */ jsx16("p", { className: "mt-0.5 text-xs text-ink-600", children: "L'assistente proponeva queste cose, ma nella scheda NON sono state scritte. Decidi tu." }),
          /* @__PURE__ */ jsx16("ul", { className: "mt-2 space-y-2", children: daControllare.map((v, i) => /* @__PURE__ */ jsxs16("li", { className: "flex flex-wrap items-center gap-2 text-sm text-ink-800", children: [
            /* @__PURE__ */ jsx16("span", { id: `${idDaControllare}-${i}`, className: "min-w-0 flex-1", children: v.motivo }),
            v.valore !== void 0 && /* @__PURE__ */ jsx16(
              "button",
              {
                type: "button",
                onClick: () => usaProposta(v),
                "aria-describedby": `${idDaControllare}-${i}`,
                className: "shrink-0 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-primary-700",
                children: "Usa questo valore"
              }
            ),
            /* @__PURE__ */ jsx16(
              "button",
              {
                type: "button",
                onClick: () => togliDaControllare(v.id),
                "aria-describedby": `${idDaControllare}-${i}`,
                className: "shrink-0 rounded-lg border border-accent-200 px-3 py-1.5 text-xs font-semibold text-accent-700 transition-colors hover:bg-accent-100",
                children: v.valore !== void 0 ? "Non usarlo" : "Ho capito"
              }
            )
          ] }, v.id)) })
        ]
      }
    ),
    /* @__PURE__ */ jsxs16("form", { onSubmit: makeSubmit(primaryIntent), className: "bg-white border rounded-lg p-6 space-y-4", children: [
      /* @__PURE__ */ jsx16(
        Input,
        {
          label: "Nome prodotto",
          ...register("name"),
          placeholder: "Es. Pomodori biologici",
          error: typeof errors.name?.message === "string" ? errors.name.message : void 0
        }
      ),
      /* @__PURE__ */ jsx16(
        Textarea,
        {
          label: "Descrizione",
          labelAction: aiAccesa ? /* @__PURE__ */ jsx16(
            AIDescriptionButton,
            {
              productName: watch("name") ?? "",
              categoryName: categories.find((c) => c.id === currentCategoryId)?.name,
              currentText: watch("description") ?? "",
              onResult: (text) => setValue("description", text, { shouldValidate: true })
            }
          ) : void 0,
          ...register("description"),
          rows: 4,
          placeholder: "Cosa \xE8, materiali, dimensioni/taglia, condizione, cosa lo rende speciale\u2026",
          error: typeof errors.description?.message === "string" ? errors.description.message : void 0
        }
      ),
      /* @__PURE__ */ jsxs16("div", { className: "grid grid-cols-2 gap-4", children: [
        /* @__PURE__ */ jsx16(
          Input,
          {
            label: "Prezzo (\u20AC)",
            type: "number",
            step: "0.01",
            inputMode: "decimal",
            ...register("price"),
            error: typeof errors.price?.message === "string" ? errors.price.message : void 0
          }
        ),
        /* @__PURE__ */ jsx16(Select, { label: "Unit\xE0", value: unit, onChange: (e) => setUnit(e.target.value), children: UNIT_OPTIONS.map((o) => /* @__PURE__ */ jsx16("option", { value: o.value, children: o.label }, o.value)) })
      ] }),
      /* @__PURE__ */ jsxs16("div", { className: "grid grid-cols-2 gap-4", children: [
        /* @__PURE__ */ jsx16(
          Input,
          {
            label: "Prezzo pieno (barrato)",
            type: "number",
            step: "0.01",
            inputMode: "decimal",
            placeholder: "Opzionale",
            hint: "Mostra lo sconto rispetto a questo prezzo",
            ...register("compareAtPrice"),
            error: typeof errors.compareAtPrice?.message === "string" ? errors.compareAtPrice.message : void 0
          }
        ),
        /* @__PURE__ */ jsxs16(Select, { label: "Condizione", value: condition, onChange: (e) => setCondition(e.target.value), children: [
          /* @__PURE__ */ jsx16("option", { value: "", children: "\u2014 non specificata" }),
          condition && !condizioneDaScegliere(condition) && /* @__PURE__ */ jsx16("option", { value: condition, children: CONDITION_LABELS[condition] ?? condition }),
          CONDIZIONI_DA_SCEGLIERE.map((c) => /* @__PURE__ */ jsx16("option", { value: c, children: CONDITION_LABELS[c] }, c))
        ] })
      ] }),
      hasVariants ? /* @__PURE__ */ jsxs16("p", { className: "rounded-lg bg-cream-50 px-3 py-2.5 text-sm text-ink-600", children: [
        "Disponibilit\xE0 gestita per variante (totale: ",
        /* @__PURE__ */ jsxs16("strong", { children: [
          totalVariantStock(variants),
          " pezzi"
        ] }),
        ")."
      ] }) : /* @__PURE__ */ jsxs16("div", { className: "grid grid-cols-2 gap-4 items-start", children: [
        /* @__PURE__ */ jsx16(
          Input,
          {
            label: "Disponibilit\xE0 (pezzi)",
            type: "number",
            inputMode: "numeric",
            disabled: unlimitedStock,
            ...register("stock"),
            error: typeof errors.stock?.message === "string" ? errors.stock.message : void 0
          }
        ),
        /* @__PURE__ */ jsx16("div", { className: "pt-7", children: /* @__PURE__ */ jsx16(
          Checkbox,
          {
            label: "Disponibilit\xE0 illimitata",
            checked: unlimitedStock,
            onChange: (e) => setUnlimitedStock(e.target.checked)
          }
        ) })
      ] }),
      recessoSegnabile && /* @__PURE__ */ jsx16(
        Checkbox,
        {
          label: "Escluso dal recesso: fresco che si deteriora in fretta, o fatto su ordinazione",
          checked: nonRecedibile,
          onChange: (e) => setNonRecedibile(e.target.checked)
        }
      ),
      /* @__PURE__ */ jsxs16("div", { className: "grid grid-cols-1 sm:grid-cols-2 gap-4", children: [
        /* @__PURE__ */ jsxs16(
          Select,
          {
            label: "Categoria",
            value: currentTopId,
            onChange: (e) => setValue("category_id", e.target.value, { shouldValidate: true }),
            error: typeof errors.category_id?.message === "string" ? errors.category_id.message : void 0,
            children: [
              /* @__PURE__ */ jsx16("option", { value: "", children: "Seleziona..." }),
              topCategories.map((c) => /* @__PURE__ */ jsx16("option", { value: c.id, children: c.name }, c.id))
            ]
          }
        ),
        currentTopId && subcategories.length > 0 && /* @__PURE__ */ jsxs16(
          Select,
          {
            label: "Sottocategoria (opzionale)",
            value: currentCategoryId !== currentTopId ? currentCategoryId : "",
            onChange: (e) => setValue("category_id", e.target.value || currentTopId, { shouldValidate: true }),
            children: [
              /* @__PURE__ */ jsxs16("option", { value: "", children: [
                "\u2014 tutta \xAB",
                topName,
                "\xBB"
              ] }),
              subcategories.map((s) => /* @__PURE__ */ jsx16("option", { value: s.id, children: s.name }, s.id))
            ]
          }
        )
      ] }),
      /* @__PURE__ */ jsxs16("div", { id: "attributi-categoria", className: "border-t pt-4 space-y-3", children: [
        hasEanField && /* @__PURE__ */ jsxs16(
          "button",
          {
            type: "button",
            onClick: () => setScanOpen(true),
            className: "inline-flex items-center gap-2 rounded-lg border border-cream-300 bg-white px-3 py-2 text-sm font-semibold text-ink-700 hover:border-primary-300 hover:bg-primary-50",
            children: [
              /* @__PURE__ */ jsx16(ScanLine2, { size: 16, strokeWidth: 2.2, "aria-hidden": true }),
              " Scansiona codice EAN"
            ]
          }
        ),
        aiAccesa && variantableFields.length > 0 && /* @__PURE__ */ jsxs16(
          "button",
          {
            type: "button",
            onClick: () => void handleSuggestVariants(),
            disabled: aiVariantsBusy,
            className: "inline-flex items-center gap-2 rounded-lg border border-secondary-200 bg-secondary-50 px-3 py-2 text-sm font-semibold text-secondary-800 hover:bg-secondary-100 disabled:opacity-50",
            children: [
              aiVariantsBusy ? /* @__PURE__ */ jsx16(Loader28, { size: 16, className: "animate-spin", "aria-hidden": true }) : /* @__PURE__ */ jsx16(Wand22, { size: 16, strokeWidth: 2.2, "aria-hidden": true }),
              "Suggerisci varianti con l'AI"
            ]
          }
        ),
        /* @__PURE__ */ jsx16(
          AttributesFields_default,
          {
            fields: attrFields,
            values: attributes,
            onChange: setAttribute,
            categoryLabel: topCategoryLabel,
            variantAxes,
            onToggleVariant: toggleVariantAxis,
            onAxisValuesChange: setAxisValues
          }
        ),
        variants.length > 0 && /* @__PURE__ */ jsxs16("div", { className: "rounded-lg border border-cream-300 overflow-hidden", children: [
          /* @__PURE__ */ jsxs16("div", { className: "flex items-center justify-between bg-cream-50 px-3 py-2 text-xs font-semibold text-ink-600", children: [
            /* @__PURE__ */ jsx16("span", { children: "Variante" }),
            /* @__PURE__ */ jsx16("span", { children: "Disponibilit\xE0" })
          ] }),
          /* @__PURE__ */ jsx16("div", { className: "divide-y divide-cream-200", children: variants.map((v, idx) => /* @__PURE__ */ jsxs16("div", { className: "flex items-center justify-between gap-3 px-3 py-2", children: [
            /* @__PURE__ */ jsx16("span", { className: "text-sm font-medium text-ink-800", children: v.label || "\u2014" }),
            /* @__PURE__ */ jsx16(
              "input",
              {
                type: "number",
                inputMode: "numeric",
                min: 0,
                value: v.stock,
                onChange: (e) => setVariantStock(idx, Number(e.target.value)),
                "aria-label": `Disponibilit\xE0 ${v.label}`,
                className: "w-24 rounded-lg border border-cream-300 px-2 py-1 text-sm text-right focus-visible:ring-2 focus-visible:ring-primary-700 focus:outline-none focus:ring-1 focus:ring-primary-200"
              }
            )
          ] }, v.label || idx)) }),
          /* @__PURE__ */ jsxs16("div", { className: "flex items-center justify-between bg-cream-50 px-3 py-2 text-sm font-semibold text-ink-700", children: [
            /* @__PURE__ */ jsx16("span", { children: "Totale" }),
            /* @__PURE__ */ jsxs16("span", { children: [
              totalVariantStock(variants),
              " pezzi"
            ] })
          ] })
        ] })
      ] }),
      /* @__PURE__ */ jsxs16("div", { className: "border-t pt-4", children: [
        /* @__PURE__ */ jsx16("label", { htmlFor: idTag, className: "block text-sm font-medium text-ink-700 mb-1", children: "Tag / parole chiave" }),
        /* @__PURE__ */ jsxs16("div", { className: "flex flex-wrap items-center gap-1.5 rounded-lg border border-cream-300 p-2", children: [
          tags.map((t) => /* @__PURE__ */ jsxs16("span", { className: "inline-flex items-center gap-1 rounded-full bg-primary-50 px-2 py-0.5 text-xs font-semibold text-primary-700", children: [
            t,
            /* @__PURE__ */ jsx16("button", { type: "button", onClick: () => setTags(tags.filter((x) => x !== t)), "aria-label": `Rimuovi ${t}`, className: "text-primary-500 hover:text-primary-800", children: "\xD7" })
          ] }, t)),
          /* @__PURE__ */ jsx16(
            "input",
            {
              id: idTag,
              value: tagInput,
              onChange: (e) => setTagInput(e.target.value),
              onKeyDown: (e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  addTag(tagInput);
                } else if (e.key === "Backspace" && !tagInput && tags.length) setTags(tags.slice(0, -1));
              },
              onBlur: () => addTag(tagInput),
              placeholder: tags.length === 0 ? "Es. regalo, artigianale, bio\u2026" : "Aggiungi tag",
              className: "flex-1 min-w-[8rem] border-0 p-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-inset"
            }
          )
        ] }),
        /* @__PURE__ */ jsx16("p", { className: "text-xs text-ink-400 mt-1", children: "Invio o virgola per aggiungere. Aiutano i clienti a trovarti." })
      ] }),
      /* @__PURE__ */ jsxs16("div", { className: "border-t pt-4", children: [
        /* @__PURE__ */ jsx16("p", { className: "text-sm font-medium text-ink-700 mb-2", children: "Tempo di consegna" }),
        /* @__PURE__ */ jsxs16("div", { className: "grid grid-cols-1 sm:grid-cols-2 gap-2", children: [
          /* @__PURE__ */ jsxs16(
            "button",
            {
              type: "button",
              onClick: () => scegliTempoDiConsegna(true),
              "aria-pressed": fastDelivery,
              className: cn(
                "flex items-start gap-2.5 rounded-lg border-2 p-3 text-left transition",
                fastDelivery ? "border-primary-500 bg-primary-50" : "border-cream-300 bg-white hover:border-primary-300"
              ),
              children: [
                /* @__PURE__ */ jsx16(Bike, { size: 18, strokeWidth: 2.2, className: "mt-0.5 shrink-0 text-primary-600", "aria-hidden": true }),
                /* @__PURE__ */ jsxs16("span", { children: [
                  /* @__PURE__ */ jsx16("span", { className: "block text-sm font-semibold text-ink-800", children: "Consegna veloce" }),
                  /* @__PURE__ */ jsx16("span", { className: "block text-xs text-ink-500", children: "Se c'\xE8 un fattorino in servizio" })
                ] })
              ]
            }
          ),
          /* @__PURE__ */ jsxs16(
            "button",
            {
              type: "button",
              onClick: () => scegliTempoDiConsegna(false),
              "aria-pressed": !fastDelivery,
              className: cn(
                "flex items-start gap-2.5 rounded-lg border-2 p-3 text-left transition",
                !fastDelivery ? "border-primary-500 bg-primary-50" : "border-cream-300 bg-white hover:border-primary-300"
              ),
              children: [
                /* @__PURE__ */ jsx16(Truck, { size: 18, strokeWidth: 2.2, className: "mt-0.5 shrink-0 text-ink-500", "aria-hidden": true }),
                /* @__PURE__ */ jsxs16("span", { children: [
                  /* @__PURE__ */ jsx16("span", { className: "block text-sm font-semibold text-ink-800", children: "Fascia oraria" }),
                  /* @__PURE__ */ jsx16("span", { className: "block text-xs text-ink-500", children: "All'ora che sceglie il cliente" })
                ] })
              ]
            }
          )
        ] }),
        /* @__PURE__ */ jsxs16("p", { className: "text-xs text-ink-500 mt-1.5", children: [
          "Per ora questa scelta non cambia cosa vede il cliente: in cassa sceglie l'ora della consegna, e la ",
          VELOCE_IN_MINUTI,
          " gliela proponiamo solo ",
          QUANDO_SI_PUO_LA_VELOCE,
          "."
        ] }),
        consegnaDelNegozioNonLetta ? /* @__PURE__ */ jsx16("p", { className: "text-xs text-amber-700 mt-1.5", children: "Non riesco a leggere le impostazioni di consegna del tuo negozio. Il resto lo salvi tranquillo: il tempo di consegna di questo prodotto resta com'\xE8, a meno che tu non scelga qui sopra. Per vederlo giusto, ricarica la pagina." }) : fastDelivery && !sellerOffersExpress && /* @__PURE__ */ jsxs16("p", { className: "text-xs text-ink-400 mt-1.5", children: [
          "La consegna veloce richiede l'Express attivo per il negozio: attivalo dal",
          " ",
          /* @__PURE__ */ jsx16(next_link_default, { href: "/seller/profile", className: "text-primary-700 hover:underline", children: "profilo negozio" }),
          "."
        ] })
      ] }),
      /* @__PURE__ */ jsx16(
        ProductImagesField,
        {
          value: imageUrls,
          onChange: setImageUrls,
          error: imageError,
          onUploadingChange: setUploading,
          onUploadSuccess: () => setImageError(null),
          label: /* @__PURE__ */ jsxs16(Fragment8, { children: [
            "Foto del prodotto ",
            /* @__PURE__ */ jsx16("span", { className: "text-ink-400 font-normal", children: "\u2014 almeno 1, consigliate 3" })
          ] }),
          dropzoneHint: "Trascina qui le foto o clicca per selezionarle",
          hint: "Luce naturale, sfondo pulito, prodotto centrato \u2014 \xE8 la prima cosa che convince chi compra.",
          showCoverBadge: true
        }
      ),
      aiAccesa && imageUrls.length >= 2 && /* @__PURE__ */ jsxs16(
        "button",
        {
          type: "button",
          onClick: () => void handleOrderPhotos(),
          disabled: aiPhotosBusy,
          className: "inline-flex items-center gap-2 rounded-lg border border-secondary-200 bg-secondary-50 px-3 py-2 text-sm font-semibold text-secondary-800 hover:bg-secondary-100 disabled:opacity-50",
          children: [
            aiPhotosBusy ? /* @__PURE__ */ jsx16(Loader28, { size: 16, className: "animate-spin", "aria-hidden": true }) : /* @__PURE__ */ jsx16(ArrowUpDown, { size: 16, strokeWidth: 2.2, "aria-hidden": true }),
            "Ordina foto e scegli la copertina con l'AI"
          ]
        }
      ),
      /* @__PURE__ */ jsxs16("div", { className: "border-t pt-4 space-y-2", children: [
        /* @__PURE__ */ jsxs16("h2", { className: "text-sm font-semibold text-ink-500 flex items-center gap-1.5", children: [
          /* @__PURE__ */ jsx16(Eye2, { size: 15, strokeWidth: 2.2, "aria-hidden": true }),
          " Anteprima \u2014 come la vede il cliente"
        ] }),
        /* @__PURE__ */ jsxs16("div", { className: "bg-white border border-cream-300 rounded-xl overflow-hidden shadow-warm max-w-[16rem]", children: [
          /* @__PURE__ */ jsx16("div", { className: "aspect-square bg-cream-100", children: imageUrls[0] ? (
            // eslint-disable-next-line @next/next/no-img-element
            /* @__PURE__ */ jsx16("img", { src: imageUrls[0], alt: typeof attributes.alt_text === "string" ? attributes.alt_text : "", className: "w-full h-full object-cover" })
          ) : /* @__PURE__ */ jsx16("div", { className: "w-full h-full flex items-center justify-center text-ink-300", children: /* @__PURE__ */ jsx16(ImageIcon, { size: 40, strokeWidth: 1.5, "aria-hidden": true }) }) }),
          /* @__PURE__ */ jsxs16("div", { className: "p-3", children: [
            /* @__PURE__ */ jsx16("p", { className: "font-semibold text-ink-900 line-clamp-1", children: watch("name") || "Nome prodotto" }),
            /* @__PURE__ */ jsx16("p", { className: "text-sm text-ink-500 line-clamp-2 mt-0.5", children: watch("description") || "La descrizione apparir\xE0 qui\u2026" }),
            /* @__PURE__ */ jsxs16("p", { className: "mt-1.5 flex items-baseline gap-1.5", children: [
              /* @__PURE__ */ jsxs16("span", { className: "font-bold text-primary-700", children: [
                priceNum ? formatPrice(priceNum) : "\u20AC\u2014",
                /* @__PURE__ */ jsx16("span", { className: "text-xs font-normal text-ink-400", children: UNIT_SUFFIX[unit] })
              ] }),
              hasDiscount && /* @__PURE__ */ jsx16("span", { className: "text-xs text-ink-400 line-through", children: formatPrice(cmpNum) }),
              hasDiscount && /* @__PURE__ */ jsxs16("span", { className: "text-xs font-bold text-secondary-600", children: [
                "-",
                discountPct,
                "%"
              ] })
            ] })
          ] })
        ] })
      ] }),
      mode === "create" ? /* @__PURE__ */ jsxs16("div", { className: "flex flex-col sm:flex-row gap-2", children: [
        /* @__PURE__ */ jsx16(Button, { type: "submit", loading: submitting, disabled: busy, fullWidth: true, size: "lg", children: "Pubblica prodotto" }),
        /* @__PURE__ */ jsxs16(
          "button",
          {
            type: "button",
            onClick: makeSubmit("draft"),
            disabled: busy,
            className: "sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-semibold text-ink-700 bg-white border-2 border-cream-300 hover:bg-cream-50 disabled:opacity-50",
            children: [
              /* @__PURE__ */ jsx16(FileText, { size: 16, "aria-hidden": true }),
              " Salva come bozza"
            ]
          }
        ),
        onDiscard && /* @__PURE__ */ jsxs16(
          "button",
          {
            type: "button",
            onClick: onDiscard,
            disabled: busy,
            className: "sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-semibold text-rose-700 bg-white border-2 border-rose-200 hover:bg-rose-50 disabled:opacity-50",
            children: [
              /* @__PURE__ */ jsx16(Trash2, { size: 16, "aria-hidden": true }),
              " Elimina"
            ]
          }
        )
      ] }) : /* @__PURE__ */ jsxs16("div", { className: "flex flex-col gap-3 pt-2 border-t", children: [
        /* @__PURE__ */ jsxs16(Select, { label: "Stato", value: status, onChange: (e) => setStatus(e.target.value), children: [
          /* @__PURE__ */ jsx16("option", { value: "available", children: "In vendita" }),
          /* @__PURE__ */ jsx16("option", { value: "draft", children: "Bozza (non visibile)" }),
          /* @__PURE__ */ jsx16("option", { value: "sold", children: "Esaurito" })
        ] }),
        /* @__PURE__ */ jsxs16("div", { className: "flex flex-col-reverse sm:flex-row gap-2", children: [
          onDelete && /* @__PURE__ */ jsxs16(
            "button",
            {
              type: "button",
              onClick: onDelete,
              disabled: deleting,
              className: "sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-semibold text-rose-700 bg-white border-2 border-rose-200 hover:bg-rose-50 disabled:opacity-50",
              children: [
                /* @__PURE__ */ jsx16(Trash2, { size: 16, "aria-hidden": true }),
                " ",
                deleteLabel
              ]
            }
          ),
          /* @__PURE__ */ jsxs16(
            "button",
            {
              type: "submit",
              disabled: busy,
              className: "flex-1 inline-flex items-center justify-center gap-2 bg-gradient-to-r from-primary-600 to-secondary-600 hover:from-primary-700 hover:to-secondary-700 disabled:opacity-40 text-white py-3 rounded-lg font-bold shadow",
              children: [
                /* @__PURE__ */ jsx16(Save, { size: 18, "aria-hidden": true }),
                " ",
                submitting ? "Salvataggio\u2026" : "Salva modifiche"
              ]
            }
          )
        ] })
      ] })
    ] }),
    productId && /* @__PURE__ */ jsxs16(
      next_link_default,
      {
        href: `/product/${productId}`,
        target: "_blank",
        rel: "noopener noreferrer",
        className: "text-sm inline-flex items-center gap-1.5 text-primary-700 hover:underline",
        children: [
          /* @__PURE__ */ jsx16(Eye2, { size: 15, strokeWidth: 2.2, "aria-hidden": true }),
          " Apri l'anteprima cliente"
        ]
      }
    ),
    /* @__PURE__ */ jsx16(
      BarcodeScanner,
      {
        open: scanOpen,
        onClose: () => setScanOpen(false),
        onDetected: (code) => void handleBarcodeDetected(code)
      }
    )
  ] });
}

// components/ConfirmDialog.tsx
import { AlertTriangle as AlertTriangle2, Check as Check5 } from "lucide-react";
import { jsx as jsx17, jsxs as jsxs17 } from "react/jsx-runtime";
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

// lib/queries/consegna-veloce-del-negozio.ts
init_supabase_client();
var chiaveConsegnaVeloceDelNegozio = [...queryKeys.seller.profile, "offers-express"];
async function leggiSeIlNegozioOffreLaConsegnaVeloce() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Sessione non ancora pronta");
  const { data, error } = await supabase.from("profiles").select("offers_express").eq("id", user.id).single();
  if (error) throw error;
  return Boolean(data?.offers_express);
}
function useConsegnaVeloceDelNegozio() {
  const { data, isLoading, isError } = useQuery({
    queryKey: chiaveConsegnaVeloceDelNegozio,
    queryFn: leggiSeIlNegozioOffreLaConsegnaVeloce
  });
  return { offre: data, inLettura: isLoading, nonLetta: isError };
}

// lib/products/persistVariants.ts
init_supabase_client();

// lib/products/persistVariantsServer.ts
async function saveProductVariantsServer(supabase2, productId, variants, scorteViste) {
  const { data: existing, error: loadErr } = await supabase2.from("product_variants").select("id, stock").eq("product_id", productId);
  if (loadErr) throw loadErr;
  const existingIds = new Set((existing ?? []).map((r) => r.id));
  const scortaInBanca = new Map((existing ?? []).map((r) => [r.id, r.stock]));
  const keepIds = /* @__PURE__ */ new Set();
  const toInsert = [];
  const toUpdate = [];
  variants.forEach((v, i) => {
    const row = {
      product_id: productId,
      options: v.options,
      label: v.label,
      stock: Math.max(0, Math.trunc(v.stock || 0)),
      position: i
    };
    if (v.id && existingIds.has(v.id)) {
      keepIds.add(v.id);
      const vista2 = scorteViste?.[v.id];
      if (vista2 !== void 0 && Math.max(0, Math.trunc(vista2 || 0)) === row.stock) delete row.stock;
      const adesso = scortaInBanca.get(v.id);
      if ("stock" in row && vista2 !== void 0 && typeof adesso === "number" && adesso !== vista2) {
        throw scortaVarianteCambiata(v.label, vista2, adesso);
      }
      const condizionata = "stock" in row && vista2 !== void 0 && typeof adesso === "number";
      toUpdate.push({ id: v.id, row, label: v.label, ...condizionata ? { vista: vista2 } : {} });
    } else {
      toInsert.push(row);
    }
  });
  const vista = (id) => scorteViste === void 0 || Object.prototype.hasOwnProperty.call(scorteViste, id);
  const toDelete = [...existingIds].filter((id) => !keepIds.has(id) && vista(id));
  if (toDelete.length > 0) {
    const { error } = await supabase2.from("product_variants").delete().in("id", toDelete);
    if (error) throw error;
  }
  for (const u of toUpdate) {
    if (u.vista === void 0) {
      const { error: error2 } = await supabase2.from("product_variants").update(u.row).eq("id", u.id);
      if (error2) throw error2;
      continue;
    }
    const { data, error } = await supabase2.from("product_variants").update(u.row).eq("id", u.id).eq("stock", u.vista).select("id");
    if (error) throw error;
    if (!data || data.length === 0) throw scortaVarianteCambiata(u.label, u.vista, void 0);
  }
  if (toInsert.length > 0) {
    const { error } = await supabase2.from("product_variants").insert(toInsert);
    if (error) throw error;
  }
}
function scortaVarianteCambiata(label, vista, adesso) {
  const ora = typeof adesso === "number" ? `ora sono ${adesso}` : "nel frattempo \xE8 cambiata";
  return new DaCompletare(
    `La scorta di \xAB${label}\xBB \xE8 cambiata mentre modificavi: avevi davanti ${vista} pezzi, ${ora}. Riapri il prodotto, controlla il numero e salva di nuovo.`,
    ["scorta"]
  );
}

// lib/products/persistVariants.ts
async function loadProductVariants(productId) {
  const { data, error } = await supabase.from("product_variants").select("id, options, label, stock, position").eq("product_id", productId).order("position", { ascending: true });
  if (error) throw error;
  return normalizeVariants(data ?? []);
}

// app/seller/products/[id]/edit/page.tsx
import { AlertTriangle as AlertTriangle3, EyeOff as EyeOff2 } from "lucide-react";

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

// lib/ordini/recesso.ts
function colonnaDelRecessoPresente(riga) {
  return !!riga && typeof riga === "object" && "non_recedibile" in riga;
}

// app/seller/products/[id]/edit/page.tsx
import { jsx as jsx18, jsxs as jsxs18 } from "react/jsx-runtime";
var RECESSO_SEGNABILE = "__recessoSegnabile";
function EditProductPage(props) {
  const { id } = use(props.params);
  const router = useRouter();
  const qc = useQueryClient();
  const { data: product, isLoading, error, isFetching: prodottoInLettura, isFetchedAfterMount: prodottoRiletto } = useQuery({
    queryKey: queryKeys.seller.product(id),
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Non autenticato");
      const { data, error: error2 } = await supabase.from("products").select("id, name, description, price, compare_at_price, unit, condition, stock, category_id, images, attributes, tags, express_enabled, seller_id, status").eq("id", id).single();
      if (error2) throw error2;
      if (data.seller_id !== user.id) {
        throw new Error("Non puoi modificare un prodotto che non \xE8 tuo");
      }
      const { data: recesso, error: erroreRecesso } = await supabase.from("products").select("*").eq("id", id).maybeSingle();
      if (erroreRecesso) throw erroreRecesso;
      const nonRecedibile = recesso?.non_recedibile === true;
      return {
        ...data,
        non_recedibile: nonRecedibile,
        [RECESSO_SEGNABILE]: colonnaDelRecessoPresente(recesso)
      };
    },
    // 31/10/2026 — IL MODULO SI APRE SOLO CON LA SCORTA DELLA BANCA DATI.
    // Il modulo tiene la scorta vista all'apertura e la manda accanto a quella
    // nuova: se partisse dalla copia in memoria (letta minuti prima, prima di
    // una vendita) ogni «Salva» direbbe «la scorta e' cambiata», anche dopo
    // aver riaperto il prodotto come chiede il messaggio. Si rilegge sempre,
    // e il modulo aspetta che quella lettura finisca (sotto, prima del modulo).
    refetchOnMount: "always"
  });
  const { data: variants = [], error: erroreVarianti, isLoading: variantsLoading, isFetching: varianteInLettura, isFetchedAfterMount: variantiRilette } = useQuery({
    queryKey: [...queryKeys.seller.product(id), "variants"],
    queryFn: () => loadProductVariants(id),
    refetchOnMount: "always"
  });
  const { data: categories = [] } = useQuery({
    queryKey: queryKeys.categories.form,
    queryFn: async () => {
      const { data, error: error2 } = await supabase.from("categories").select("id, name, slug, parent_id").order("name");
      if (error2) throw error2;
      return data ?? [];
    }
  });
  const {
    offre: offersExpress,
    inLettura: consegnaInLettura,
    nonLetta: consegnaNonLetta
  } = useConsegnaVeloceDelNegozio();
  const update = useMutation({
    mutationFn: async ({
      payload,
      variants: nextVariants,
      campiDallAi,
      scorteViste
    }) => {
      await salvaProdottoDalBrowser({
        prodottoId: id,
        payload,
        origine: "venditore-modulo",
        campiDallAi
      });
      await saveProductVariantsServer(supabase, id, nextVariants, scorteViste);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.seller.products });
      qc.invalidateQueries({ queryKey: queryKeys.seller.product(id) });
      qc.invalidateQueries({ queryKey: queryKeys.products.detail(id) });
      toast11.success("Modifiche salvate");
      router.push("/seller/products");
    },
    onError: (err) => toast11.error(friendlyError(err))
  });
  const nascondiIlProdotto = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Non autenticato");
      await nascondiProdotto(supabase, { id, sellerId: user.id });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.seller.products });
      qc.invalidateQueries({ queryKey: queryKeys.seller.product(id) });
      toast11.success("Prodotto nascosto: lo trovi fra le bozze");
      router.push("/seller/products");
    },
    onError: (err) => toast11.error(friendlyError(err))
  });
  if (isLoading || variantsLoading || prodottoInLettura && !prodottoRiletto || varianteInLettura && !variantiRilette || consegnaInLettura) return /* @__PURE__ */ jsx18(LoadingState, {});
  if (error || erroreVarianti || !product) {
    return /* @__PURE__ */ jsxs18("div", { className: "bg-rose-50 border border-rose-200 rounded-xl p-6 text-rose-900 max-w-2xl", children: [
      /* @__PURE__ */ jsxs18("p", { className: "font-bold mb-1 flex items-center gap-1.5", children: [
        /* @__PURE__ */ jsx18(AlertTriangle3, { size: 16, "aria-hidden": true }),
        " Errore"
      ] }),
      /* @__PURE__ */ jsx18("p", { className: "text-sm mb-3", children: error instanceof Error ? error.message : erroreVarianti ? "Non riesco a leggere le taglie e le varianti di questo prodotto. Ricarica la pagina prima di modificarlo: salvando adesso le varianti andrebbero perse." : "Prodotto non trovato" }),
      /* @__PURE__ */ jsx18(next_link_default, { href: "/seller/products", className: "text-sm font-semibold text-rose-700 hover:underline", children: "\u2190 Torna ai miei prodotti" })
    ] });
  }
  const attrs = product.attributes ?? {};
  const legacyStato = typeof attrs.stato === "string" ? attrs.stato : "";
  const initialValues = {
    name: product.name ?? "",
    description: product.description ?? "",
    price: product.price ?? void 0,
    compareAtPrice: product.compare_at_price ?? void 0,
    unit: product.unit ?? "pezzo",
    condition: product.condition ?? (normalizeCondition(legacyStato) || null),
    stock: product.stock ?? null,
    category_id: product.category_id ?? "",
    images: Array.isArray(product.images) ? product.images : [],
    attributes: attrs,
    tags: Array.isArray(product.tags) ? product.tags : [],
    expressEnabled: product.express_enabled ?? null,
    status: product.status ?? "available",
    variants,
    nonRecedibile: product.non_recedibile === true
  };
  const recessoSegnabile = product[RECESSO_SEGNABILE] === true;
  const status = product.status;
  return /* @__PURE__ */ jsxs18("div", { className: "max-w-2xl space-y-6", children: [
    /* @__PURE__ */ jsxs18("div", { children: [
      /* @__PURE__ */ jsx18(next_link_default, { href: "/seller/products", className: "text-sm text-primary-700 hover:underline", children: "\u2190 I miei prodotti" }),
      /* @__PURE__ */ jsx18("h1", { className: "text-2xl font-bold mt-1", children: "Modifica prodotto" }),
      status === "sold" && /* @__PURE__ */ jsxs18("p", { className: "text-xs text-accent-700 bg-accent-50 inline-flex items-center gap-1 px-2 py-0.5 rounded mt-1", children: [
        /* @__PURE__ */ jsx18(AlertTriangle3, { size: 12, strokeWidth: 2.4, "aria-hidden": true }),
        " Segnato come esaurito \u2014 non \xE8 visibile ai clienti"
      ] }),
      status === "draft" && /* @__PURE__ */ jsx18("p", { className: "text-xs text-ink-600 bg-cream-100 inline-flex items-center gap-1 px-2 py-0.5 rounded mt-1", children: "Bozza \u2014 non \xE8 ancora visibile ai clienti" })
    ] }),
    /* @__PURE__ */ jsx18(
      ProductForm,
      {
        mode: "edit",
        categories,
        initialValues,
        submitting: update.isPending,
        deleteLabel: "Nascondi prodotto",
        deleting: nascondiIlProdotto.isPending,
        productId: id,
        recessoSegnabile,
        sellerOffersExpress: offersExpress,
        consegnaDelNegozioNonLetta: consegnaNonLetta,
        onSubmit: (payload, ctx) => update.mutate({
          payload,
          variants: ctx.variants,
          campiDallAi: ctx.campiDallAi,
          scorteViste: ctx.scorteViste
        }),
        onDelete: async () => {
          const ok = await confirmDialog({
            title: "Nascondere il prodotto?",
            message: `"${product.name}" sparisce dalla vetrina e va fra le bozze. Resta negli ordini gi\xE0 fatti, con le sue recensioni: puoi rimetterlo in vendita quando vuoi.`,
            confirmLabel: "S\xEC, nascondi",
            danger: true,
            icon: EyeOff2
          });
          if (ok) nascondiIlProdotto.mutate();
        }
      }
    )
  ] });
}
export {
  EditProductPage as default
};
