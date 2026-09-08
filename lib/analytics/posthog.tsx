'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { readConsent } from '@/lib/consent';
import type { CaptureResult } from 'posthog-js';
import {
  indirizzoSenzaDatiPersonali,
  VALORE_NASCOSTO,
} from '@/lib/analytics/indirizzo-senza-dati-personali';
import { chiaveDellaPaginaVista } from '@/lib/analytics/tracciamento';
import {
  filmatoSenzaDatiPersonali,
  strutturaSenzaIndirizzi,
  testoSenzaIndirizzi,
} from '@/lib/analytics/filmato-senza-dati-personali';

/**
 * PostHog client wrapper.
 *
 * Esperti consultati:
 * - Data Analyst: "PostHog free fino 1M eventi/mese + session replay + funnel.
 *   Non si tocca un marketplace senza PostHog."
 * - Security Engineer: "Carica solo se NEXT_PUBLIC_POSTHOG_KEY è settata.
 *   Cookie consent rispettato via opt_in/opt_out."
 * - SRE: "Lazy import per non gonfiare bundle iniziale (PostHog ~50KB)."
 *
 * Setup (account MyCity = US):
 *   1. Account su https://us.posthog.com
 *   2. Copia Project API Key (phc_…)
 *   3. Vercel → Settings → Environment Variables: NEXT_PUBLIC_POSTHOG_KEY=phc_xxx
 *   4. Vercel → Settings → Environment Variables: NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
 */

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';

// #227 — L'indirizzo che riceve gli eventi finisce sempre per `.i.posthog.com`.
// Con l'indirizzo del pannello al posto suo, gli eventi partono e non arrivano
// da nessuna parte: nessun errore, solo silenzio. Meglio una riga in console
// subito che un mese di numeri a zero.
if (typeof window !== 'undefined' && POSTHOG_KEY && !/\.i\.posthog\.com\/?$/.test(POSTHOG_HOST)) {
  console.warn(
    `[analytics] NEXT_PUBLIC_POSTHOG_HOST vale "${POSTHOG_HOST}": non e' un indirizzo di raccolta eventi (deve finire per .i.posthog.com). Gli eventi non arriveranno.`,
  );
}

type PostHogLike = {
  capture: (event: string, props?: Record<string, unknown>) => void;
  identify: (userId: string, traits?: Record<string, unknown>) => void;
  reset: () => void;
  opt_in_capturing: () => void;
  opt_out_capturing: () => void;
  /** Proprieta' appiccicate a TUTTI gli eventi successivi (super-property). */
  register: (props: Record<string, unknown>) => void;
  /** Comandi della telecamera: possono mancare su versioni vecchie. */
  startSessionRecording?: () => void;
  stopSessionRecording?: () => void;
};

/**
 * 27/8/2026 (R055) — LE PAGINE DOVE LA TELECAMERA NON DEVE GIRARE.
 *
 * La registrazione della sessione fa un filmato di quello che appare sullo
 * schermo. Su queste pagine, sullo schermo ci sono i dati di ALTRE persone:
 * negli ordini del negozio ci sono nome, telefono e indirizzo di chi ha
 * comprato; nell'amministrazione c'e' l'elenco degli utenti; nei messaggi c'e'
 * quello che si sono scritti in due.
 *
 * Il consenso ai cookie lo ha dato il negoziante o l'amministratore. Il cliente
 * che compare sul loro schermo non lo ha dato a nessuno, e non sa nemmeno che
 * esista un filmato: e' un trasferimento dei suoi dati fuori dall'Unione senza
 * base giuridica e senza informativa. E' anche l'unico punto in cui indirizzi e
 * numeri di telefono escono dal database e finiscono in un video su un servizio
 * di un altro.
 *
 * Sono percorsi INTERI, confrontati per segmento: «/sellers-del-mese» non e'
 * «/seller».
 */
export const PAGINE_CON_DATI_DI_TERZI = [
  '/admin',
  '/seller',
  '/rider',
  '/orders',
  '/checkout',
  '/profile',
  '/messages',
  '/returns',
] as const;

/** Si puo' filmare questa pagina senza riprendere i dati di qualcun altro? */
export function laPaginaSiPuoFilmare(pathname: string | null | undefined): boolean {
  if (!pathname) return true;
  const percorso = pathname.split('?')[0];
  return !PAGINE_CON_DATI_DI_TERZI.some(
    (p) => percorso === p || percorso.startsWith(`${p}/`),
  );
}

/**
 * 6/9/2026 — CHI APRE MYCITY DALL'ICONA IN HOME ERA INDISTINGUIBILE DA CHI LA APRE DAL BROWSER.
 *
 * IL DIFETTO CHE QUESTA FUNZIONE CHIUDE. Il banner invita a installare, ma nessun numero diceva se
 * qualcuno installava davvero, né se chi ha l'icona in Home torna di più. «App nativa? Non ora, la
 * PWA basta» è una decisione che si prende con due numeri — quanti la installano e se tornano dopo
 * una settimana — e nessuno dei due si poteva calcolare: `display-mode` veniva letto solo per
 * nascondere il banner, e non partiva mai verso la raccolta eventi.
 *
 * DUE MODI DI SAPERLO, PERCHÉ UNO SOLO NON BASTA. `display-mode: standalone` è la verità del
 * momento, ma non risponde in un caso che conta: le schede aperte da un link condiviso dentro
 * l'app. Il manifesto dichiara `start_url: "/?source=pwa"`, quindi la prima pagina di ogni
 * sessione partita dall'icona porta quel marcatore. Se uno dei due dice «Home», è Home.
 */
export function comeSiApre(standalone: boolean, sorgente: string | null | undefined): 'standalone' | 'browser' {
  return standalone || sorgente === 'pwa' ? 'standalone' : 'browser';
}

/**
 * Come si registra lo schermo.
 *
 * Prima c'erano i soli `maskAllInputs` + `maskInputOptions`: mascherano quello
 * che la persona STA SCRIVENDO, non quello che e' gia' scritto nella pagina. E
 * i dati dei clienti nella pagina di un negoziante non li scrive nessuno: ci
 * sono gia'. `maskTextSelector: '*'` copre ogni testo della pagina.
 */
export function opzioniRegistrazioneSchermo() {
  return {
    maskAllInputs: true,
    maskInputOptions: { password: true, email: true },
    maskTextSelector: '*',
  } as const;
}

/** Spegne la telecamera sulle pagine con dati di terzi, la riaccende altrove. */
export function applicaRegistrazioneSchermo(ph: PostHogLike, pathname: string | null | undefined): void {
  try {
    if (laPaginaSiPuoFilmare(pathname)) ph.startSessionRecording?.();
    else ph.stopSessionRecording?.();
  } catch {
    // La telemetria non deve mai far cadere una pagina.
  }
}

/**
 * 3/9/2026 — QUI L'INDIRIZZO DELLA PAGINA LO COMPILAVA LA LIBRERIA, DA
 * `window.location.href`, CON DENTRO LA RICERCA.
 *
 * `ph.capture('$pageview')` non passa `$current_url`: è una scelta scritta e
 * motivata più sotto (senza, dominio, pagina d'ingresso e pagina d'uscita
 * uscivano monchi). Solo che quando lo compila la libreria ci mette l'indirizzo
 * INTERO — «/search?q=ordine di mario.rossi@gmail.com» — e quello parte verso
 * un servizio che sta negli Stati Uniti.
 *
 * La regola non si riscrive qui: è la stessa che usano il beacon delle visite e
 * il registratore degli errori (`indirizzoSenzaDatiPersonali`). Questa funzione
 * la applica a ogni proprietà che contiene un indirizzo, compreso quello che
 * PostHog si porta dietro come proprietà della persona (`$set`, `$set_once`).
 *
 * Va agganciata a `before_send` in `init`, che PostHog chiama su OGNI evento
 * appena prima di spedirlo: così non c'è un evento da ricordarsi di ripulire a
 * mano, nemmeno quelli che manda la libreria per conto suo.
 *
 * ⚠️ Non `sanitize_properties`: nella versione installata è deprecata e stampa
 * un errore in console a OGNI evento («sanitize_properties is deprecated. Use
 * before_send instead»). Funziona ancora, ma riempirebbe la console di rumore.
 */
const PROPRIETA_CHE_SONO_INDIRIZZI = [
  '$current_url',
  '$referrer',
  '$pathname',
  '$initial_current_url',
  '$initial_referrer',
  '$initial_pathname',
  '$session_entry_url',
  '$session_entry_referrer',
  '$session_entry_pathname',
] as const;

function indirizzoRipulito(valore: unknown): unknown {
  if (typeof valore !== 'string' || !valore) return valore;
  // `$direct`, `$organic`… non sono indirizzi: sono i segnaposti di PostHog.
  if (valore.startsWith('$')) return valore;
  return indirizzoSenzaDatiPersonali(valore) ?? VALORE_NASCOSTO;
}

const NOMI_CHE_SONO_INDIRIZZI = new Set<string>(PROPRIETA_CHE_SONO_INDIRIZZI);

/**
 * Dove il filmato dello schermo tiene i suoi fotogrammi. Non e' una proprieta'
 * come le altre: e' un pezzo di protocollo del registratore, e vuole una regola
 * sua (il DOM non si tocca) scritta in `filmato-senza-dati-personali.ts`.
 */
const IL_FILMATO = '$snapshot_data';

/**
 * 8/9/2026 — SOTTO L'ELENCO DEI NOMI ORA C'E' UNA RETE CHE GUARDA IL CONTENUTO.
 *
 * IL DIFETTO CHE QUESTA FUNZIONE CHIUDE. Fino a ieri qui si riscrivevano nove
 * proprieta' chiamate per nome, e basta. Chiudere per nome vuol dire che ogni
 * canale con un nome nuovo passa: il filmato dello schermo portava fuori
 * `/search?q=mario.rossi@gmail.com` intero — dentro `$snapshot_data`, che nome
 * non ne ha nessuno di quei nove — e gli eventi presi al volo dai clic portano
 * l'indirizzo del link in `$elements` e `$elements_chain`. Tre canali aperti
 * mentre la prova era verde, perche' la prova guardava i nomi anche lei.
 *
 * ORA SI GUARDA IL CONTENUTO, IN TRE STRATI.
 *   ① i nove nomi restano, con la regola severa: li' dentro tutto e' un
 *      indirizzo per contratto, e cio' che non lo e' si nasconde intero;
 *   ② il filmato passa dal suo cancello, che ripulisce i fotogrammi e lascia
 *      stare il DOM (gia' mascherato, e riscriverlo romperebbe la riproduzione);
 *   ③ tutto il resto — testi e strutture, a qualunque profondita' — viene
 *      guardato per quello che contiene: se dentro c'e' un indirizzo, quello
 *      esce ripulito dalla regola comune, e il resto del testo resta com'e'.
 *
 * Un canale che nessuno ha ancora scritto e' pulito il giorno in cui nasce.
 */
function contenutoSenzaIndirizzi(valore: unknown): unknown {
  if (typeof valore === 'string') return testoSenzaIndirizzi(valore);
  // Strutture (l'elenco degli elementi cliccati, i parametri annidati): stessa
  // rete, applicata in fondo. Non e' il filmato, quindi NIENTE eccezione del
  // DOM: una proprieta' qualunque che somigli a un fotogramma non deve poter
  // ereditare quel salvacondotto e passare intera.
  if (valore && typeof valore === 'object') return strutturaSenzaIndirizzi(valore);
  return valore;
}

/** Il cancello su una borsa di proprieta': i nove nomi, poi la rete sul contenuto. */
function borsaSenzaDatiPersonali(borsa: Record<string, unknown>): Record<string, unknown> {
  const pulite: Record<string, unknown> = { ...borsa };
  for (const nome of PROPRIETA_CHE_SONO_INDIRIZZI) {
    if (nome in pulite) pulite[nome] = indirizzoRipulito(pulite[nome]);
  }
  if (IL_FILMATO in pulite) pulite[IL_FILMATO] = filmatoSenzaDatiPersonali(pulite[IL_FILMATO]);
  for (const nome of Object.keys(pulite)) {
    if (NOMI_CHE_SONO_INDIRIZZI.has(nome) || nome === IL_FILMATO) continue;
    // Le proprieta' della persona hanno il loro giro qui sotto: la regola severa
    // sui nove nomi vale anche dentro di loro.
    if (nome === '$set' || nome === '$set_once') continue;
    pulite[nome] = contenutoSenzaIndirizzi(pulite[nome]);
  }
  return pulite;
}

export function proprietaSenzaDatiPersonali(
  proprieta: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!proprieta || typeof proprieta !== 'object') return {};
  const pulite = borsaSenzaDatiPersonali(proprieta);
  // Le stesse chiavi viaggiano anche dentro le proprietà della persona.
  for (const contenitore of ['$set', '$set_once'] as const) {
    const dentro = pulite[contenitore];
    if (!dentro || typeof dentro !== 'object' || Array.isArray(dentro)) continue;
    pulite[contenitore] = borsaSenzaDatiPersonali(dentro as Record<string, unknown>);
  }
  return pulite;
}

/**
 * Il cancello sul DATO: ogni evento passa di qui prima di partire, compresi
 * quelli che la libreria manda da sola (pageleave, autocapture, telecamera).
 * Non lancia mai: la telemetria non deve poter rompere una pagina.
 */
export function eventoSenzaDatiPersonali(evento: CaptureResult | null): CaptureResult | null {
  if (!evento) return evento;
  try {
    if (evento.properties) evento.properties = proprietaSenzaDatiPersonali(evento.properties);
    if (evento.$set) evento.$set = proprietaSenzaDatiPersonali(evento.$set);
    if (evento.$set_once) evento.$set_once = proprietaSenzaDatiPersonali(evento.$set_once);
  } catch {
    /* meglio l'evento com'era che una pagina caduta */
  }
  return evento;
}

let posthogInstance: PostHogLike | null = null;

async function getPosthog() {
  if (!POSTHOG_KEY) return null;
  if (typeof window === 'undefined') return null;
  // GDPR: nessun tracking analytics senza consenso esplicito dell'utente.
  // Fonte di verità unica: readConsent().analytics (lib/consent.ts). Se il
  // consenso cambia a runtime applichiamo opt-in/opt-out sull'istanza già
  // caricata, così una revoca ha effetto immediato senza reload.
  const consented = !!readConsent()?.analytics;
  if (posthogInstance) {
    try {
      if (consented) posthogInstance.opt_in_capturing();
      else posthogInstance.opt_out_capturing();
    } catch {}
    return consented ? posthogInstance : null;
  }
  if (!consented) return null;
  // Lazy import per non gonfiare bundle
  const { default: posthog } = await import('posthog-js').catch(() => ({ default: null }));
  if (!posthog) return null;
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    person_profiles: 'identified_only',
    capture_pageview: false, // gestiamo noi via useEffect
    capture_pageleave: true,
    // Il cancello sul DATO: ogni evento passa di qui prima di partire.
    before_send: eventoSenzaDatiPersonali,
    session_recording: opzioniRegistrazioneSchermo(),
    autocapture: {
      dom_event_allowlist: ['click', 'submit'],
    },
  });
  posthogInstance = posthog;
  return posthog;
}

/**
 * Track event arbitrario. Es:
 *   track('product_viewed', { product_id, price, category });
 */
export async function track(event: string, properties?: Record<string, unknown>) {
  const ph = await getPosthog();
  if (!ph) return;
  ph.capture(event, properties);
}

/**
 * Identifica un utente (al signup/signin). Linka tutti gli eventi anonimi
 * precedenti al user_id.
 */
export async function identify(userId: string, traits?: Record<string, unknown>) {
  const ph = await getPosthog();
  if (!ph) return;
  ph.identify(userId, traits);
}

/**
 * #215 — Attacca una proprieta' a tutti gli eventi successivi di questa
 * sessione. Serve al test A/B: senza questo la variante viveva su un evento
 * solo (l'esposizione) e non su quelli che contano — carrello, acquisto — e
 * quindi l'esperimento non era misurabile.
 */
export async function registraProprietaPersistenti(props: Record<string, unknown>) {
  const ph = await getPosthog();
  if (!ph) return;
  try { ph.register(props); } catch { /* telemetria best-effort */ }
}

export async function resetUser() {
  const ph = await getPosthog();
  if (!ph) return;
  ph.reset();
}

/**
 * Mount component invisibile in app/layout.tsx. Track pageview ad ogni
 * navigazione client-side (Next.js router).
 */
export default function PostHogProvider() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Applica subito il consenso quando cambia (opt-in se accetta, opt-out se
  // revoca) senza aspettare la navigazione successiva.
  useEffect(() => {
    if (!POSTHOG_KEY) return;
    const onConsentChange = () => {
      void getPosthog().then((ph) => {
        if (!ph) return;
        // Emette la pagina CORRENTE appena arriva il consenso.
        //
        // Il difetto: qui si faceva solo `getPosthog()` — si accendeva la
        // raccolta e si aspettava. Ma l'effetto che registra la pagina dipende
        // da percorso e parametri, che dopo un clic sul banner non cambiano:
        // la prima pagina — quella da cui la persona è arrivata, cioè la piu'
        // importante per capire da dove viene il traffico — non veniva mai
        // registrata. Si vedeva la seconda.
        // #222 — Chi accetta i cookie mentre e' gia' entrato restava anonimo
        // fino al ricaricamento della pagina: l'identificazione avviene al
        // montaggio del profilo, che dopo un clic sul banner non si rimonta.
        // Risultato: gli eventi piu' interessanti — quelli subito dopo il
        // consenso — restavano staccati dalla persona.
        void (async () => {
          try {
            const { supabase } = await import('@/lib/supabase/client');
            const { data } = await supabase.auth.getUser();
            if (data.user?.id) ph.identify(data.user.id);
          } catch { /* niente identita': gli eventi restano anonimi */ }
        })();
        // 22/8/2026 — `$current_url` E' UN CAMPO RISERVATO E VUOLE L'INDIRIZZO
        // INTERO. Qui si passava solo il percorso («/product/123»), e PostHog
        // ci costruisce sopra dominio, pagina di ingresso e pagina di uscita:
        // su ogni singola visita quei campi erano monchi, e ogni analisi di
        // percorso — da dove entrano, dove escono — leggeva un indirizzo che
        // non esiste. Senza passarlo, la libreria lo compila da sola e giusto.
        // 27/8/2026 (R055) — chi accetta i cookie stando gia' dentro una pagina
        // con dati di altri (un negoziante sui suoi ordini) accendeva la
        // telecamera proprio li'. La pagina corrente si legge dal browser: la
        // variabile di questo effetto e' ferma al primo montaggio.
        applicaRegistrazioneSchermo(ph, window.location.pathname);
        ph.capture('$pageview');
      });
    };
    window.addEventListener('mc:consent-change', onConsentChange);
    return () => window.removeEventListener('mc:consent-change', onConsentChange);
  }, []);

  // 6/9/2026 (R171, il terzo sensore) — QUI OGNI TOCCO A UN FILTRO ERA UNA PAGINA NUOVA.
  //
  // La pagina dei risultati riscrive l'indirizzo a ogni cambio di filtro — categoria, prezzo,
  // stelle, ordinamento, «solo aperti», «solo in promozione», «solo disponibili». Quel cambio
  // muove `searchParams`, che stava fra le dipendenze di questo effetto: sette tocchi, otto
  // pagine viste per una ricerca sola. E si gonfiava proprio la pagina dove la gente ha piu'
  // intenzione di comprare, cioe' il denominatore di ogni tasso di conversione.
  //
  // Gli altri due sensori — il beacon delle attivita' e Google Analytics — erano gia' stati
  // curati il 27/8 con `chiaveDellaPaginaVista`: percorso piu' la sola ricerca, i filtri no.
  // PostHog era rimasto indietro, quindi la stessa navigazione veniva contata in due modi
  // diversi da due sistemi che poi si confrontano fra loro.
  //
  // Stessa chiave e stesso schema del beacon (`components/ActivityTracker.tsx`): una `ref`
  // ricorda l'ultima pagina dichiarata e taglia corto se non e' cambiata. Le dipendenze
  // restano percorso e parametri — l'effetto puo' scattare quanto vuole, la telemetria parte
  // solo quando la pagina e' davvero un'altra.
  const ultimaPaginaVista = useRef<string | null>(null);
  useEffect(() => {
    if (!POSTHOG_KEY) return;
    const pagina = chiaveDellaPaginaVista(pathname ?? '/', searchParams);
    if (ultimaPaginaVista.current === pagina) return;
    ultimaPaginaVista.current = pagina;
    // Il percorso serve solo a far scattare l'effetto al cambio pagina: non si
    // passa a mano, per la ragione scritta qui sopra.
    getPosthog().then((ph) => {
      if (!ph) return;
      // 27/8/2026 (R055) — prima di registrare qualsiasi cosa, decidi se questa
      // pagina si puo' filmare. La decisione va presa a ogni navigazione: si
      // entra negli ordini del negozio da un link, non ricaricando il sito.
      applicaRegistrazioneSchermo(ph, pathname);
      ph.capture('$pageview');
    });
  }, [pathname, searchParams]);

  // 6/9/2026 — DA DOVE È STATA APERTA MYCITY: DALL'ICONA IN HOME O DAL BROWSER.
  //
  // È una proprietà appiccicata a TUTTI gli eventi della sessione (super-property), non un evento
  // a sé: solo così si possono separare gli utenti attivi che usano l'app installata e misurarne
  // il ritorno a 7 e a 30 giorni. Con un evento isolato quel confronto non si fa.
  //
  // Si rifà anche al consenso, e non solo al montaggio: chi accetta i cookie stando già dentro
  // una pagina non rimonta questo componente, e senza il secondo giro la sua sessione partirebbe
  // senza la proprietà — cioè finirebbe fra i «browser» qualunque cosa stia usando.
  useEffect(() => {
    if (!POSTHOG_KEY) return;
    if (typeof window === 'undefined') return;
    const modo = comeSiApre(
      window.matchMedia('(display-mode: standalone)').matches,
      new URLSearchParams(window.location.search).get('source'),
    );
    const dichiara = () => { void registraProprietaPersistenti({ display_mode: modo }); };
    dichiara();
    // Il momento esatto in cui l'installazione va a buon fine: è il numeratore del tasso di
    // installazione, e prima non lo ascoltava nessuno.
    const installata = () => { void track('pwa_installata', { display_mode: modo }); };
    window.addEventListener('appinstalled', installata);
    window.addEventListener('mc:consent-change', dichiara);
    return () => {
      window.removeEventListener('appinstalled', installata);
      window.removeEventListener('mc:consent-change', dichiara);
    };
  }, []);

  // Capture Web Vitals (Core Web Vitals: LCP, FID/INP, CLS)
  useEffect(() => {
    if (!POSTHOG_KEY) return;
    let cancelled = false;
    (async () => {
      const mod = await import('web-vitals').catch(() => null);
      if (!mod || cancelled) return;
      const sendVital = (name: string) => (metric: { value: number; rating: string }) => {
        track('web_vital', { metric: name, value: metric.value, rating: metric.rating });
      };
      mod.onCLS(sendVital('CLS'));
      mod.onLCP(sendVital('LCP'));
      mod.onINP(sendVital('INP'));
      mod.onFCP(sendVital('FCP'));
      mod.onTTFB(sendVital('TTFB'));
    })();
    return () => { cancelled = true; };
  }, []);

  return null;
}
