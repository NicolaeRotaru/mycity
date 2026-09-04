import { frasePagamento } from '@/lib/promesse-pubbliche';
import { EXPRESS_ETA_LABEL } from '@/lib/delivery';
import { headers } from 'next/headers';
import { HydrationBoundary } from '@tanstack/react-query';
import { unstable_cache } from 'next/cache';
import { precaricaHome } from '@/lib/queries/precarico';
import { SECONDI_CATALOGO_FRESCO } from '@/lib/queries/cache-pubblica';
import ExperimentExposure from '@/components/home/ExperimentExposure';
import HomeSectionRenderer, { type HeroDefaults } from '@/components/home-sections/HomeSectionRenderer';
import { creaClientAnonimo } from '@/lib/supabase/anonimo';
import { normalizeHomeSite, homeEnabledSections } from '@/lib/home-site';
import { EXPERIMENTS, expHeaderName, resolveVariant } from '@/lib/experiments';

/**
 * Contenuti dell'hero per variante (A/B test `home_hero`).
 *  - A (controllo): claim "negozi veri" + ingresso alla scoperta.
 *  - B (test): leva sul rischio-zero (paghi alla consegna) come gancio primario.
 * Sono i DEFAULT dell'hero: l'admin può sovrascriverli dalla sezione hero del
 * Home builder (se lascia i campi vuoti, vince la variante dell'esperimento).
 */
const HERO_VARIANTS: Record<string, HeroDefaults> = {
  a: {
    eyebrow: 'Il marketplace dei negozi di Piacenza',
    headline: (
      <>
        I negozi <span className="text-primary-700 italic">veri</span> di Piacenza,<br />
        ora a casa tua.
      </>
    ),
    subhead: (
      <>
        Alimentari, abbigliamento, casa, elettronica: ordini dai commercianti
        della tua via in pochi tap e <strong className="text-ink-900">puoi pagare alla consegna</strong>.
        A casa in 30-60 minuti.
      </>
    ),
    ctaPrimary: 'Inizia a esplorare',
  },
  b: {
    eyebrow: 'Spesa, moda e casa · consegna a domicilio',
    headline: (
      <>
        Ordini dai negozi di Piacenza.<br />
        <span className="text-primary-700 italic">Paghi come vuoi.</span>
      </>
    ),
    subhead: (
      <>
        {/* La carta alla consegna non esiste: al checkout la carta si paga subito, su Stripe.
            La frase nasce dall'elenco dei metodi, e i minuti da lib/delivery. */}
        Scegli dai commercianti della tua città e
        <strong className="text-ink-900"> {frasePagamento().toLowerCase()}</strong>. A casa in {EXPRESS_ETA_LABEL}.
      </>
    ),
    ctaPrimary: 'Scopri cosa c’è oggi',
  },
};

// NB: ISR non applicabile. next-intl è cookie-based → tutte le rotte sono dinamiche
// per-request: l'HTML della home NON si può mettere in una cache condivisa, perché
// cambia con i cookie di chi la chiede (lingua, variante dell'esperimento, accesso).
//
// 3/9/2026 — quello che si può tenere è la parte che NON dipende da chi chiede: la
// composizione della pagina e le categorie, uguali per tutti. Sono dietro una memoria
// di 60 secondi (vedi sotto), non più rilette a ogni singola visita. Dopo un
// salvataggio dal pannello la home riflette la modifica entro un minuto — prima era
// istantaneo, ed è il prezzo dichiarato di questo cambio.

/**
 * Homepage MyCity — ora COMPONIBILE dall'admin (Home builder, /admin/home).
 * Il layout è guidato dai dati: `site_settings.home_site` definisce ordine e
 * visibilità delle sezioni. Se la config è assente/vuota, `normalizeHomeSite`
 * ritorna `defaultHomeSite()` che riproduce ESATTAMENTE il layout fisso storico
 * (hero → come funziona → categorie → drop → prodotti → live+trust → negozi →
 * newsletter → CTA venditore). Le sezioni strutturali riusano i componenti home
 * esistenti; i blocchi di contenuto (testo/banner/galleria/video) sono liberi.
 */
async function leggiConfigurazioneHome() {
  try {
    // Client ANONIMO, non quello con i cookie della richiesta. Due ragioni, e la
    // seconda è vincolante: ① la composizione della home è pubblica, la legge
    // uguale chiunque, quindi la sessione non c'entra; ② una lettura tenuta in
    // memoria per sessanta secondi non può guardare i cookie di UNA richiesta —
    // sarebbe la risposta di una persona riusata per la successiva. Next lo
    // vieta e ferma la pagina, ed è giusto che la fermi.
    const supa = creaClientAnonimo();
    const { data } = await supa.from('site_settings').select('home_site').eq('id', 1).maybeSingle();
    return normalizeHomeSite((data as { home_site?: unknown } | null)?.home_site);
  } catch {
    return normalizeHomeSite(null);
  }
}

/**
 * 3/9/2026 — LA HOME RILEGGEVA IL DATABASE A OGNI SINGOLA VISITA.
 *
 * Il precarico ha tolto i viaggi di rete del BROWSER: la pagina parte già piena.
 * Ma le due letture ci sono ancora — le fa il server al posto del telefono — e
 * le rifaceva per ognuno che apriva la home: la composizione della pagina e
 * l'elenco delle categorie. Due risposte identiche per tutti, chieste una volta
 * a testa. Cento visite nello stesso minuto erano duecento letture per ottenere
 * due risultati.
 *
 * È la curva che fa male al conto: le letture crescono col numero di
 * VISITATORI, non col numero di ordini. Un articolo che finisce sui social e
 * porta diecimila curiosi in un pomeriggio costa come diecimila clienti, e non
 * ne ha portato nemmeno uno.
 *
 * Qui la risposta si tiene per sessanta secondi e si riusa per tutti. Sessanta
 * è lo stesso numero che va nell'intestazione delle rotte pubbliche di catalogo,
 * e viene dallo stesso file: se un domani si cambia idea, si cambia in un posto
 * solo. Chi pubblica un prodotto o ricompone la home dal pannello vede il
 * cambiamento entro un minuto.
 *
 * Il precarico resta quello che era — se non riesce, consegna uno stato vuoto e
 * il browser fa quello che faceva prima — quindi mettergli davanti la memoria
 * non aggiunge nessun modo nuovo di rompersi.
 */
const loadHomeSite = unstable_cache(
  leggiConfigurazioneHome,
  ['home-configurazione'],
  { revalidate: SECONDI_CATALOGO_FRESCO, tags: ['home-configurazione'] },
);

const precaricoDellaHome = unstable_cache(
  precaricaHome,
  ['home-precarico'],
  { revalidate: SECONDI_CATALOGO_FRESCO, tags: ['home-precarico'] },
);

export default async function Home() {
  // Home del marketplace, visibile a TUTTI — inclusi admin/seller/rider, che
  // possono così sfogliare e navigare il marketplace come un cliente. Nessun
  // redirect per ruolo qui: l'atterraggio sulla dashboard dopo il login è già
  // gestito dalla pagina di sign-in (dest = /admin · /seller/dashboard · /rider),
  // e per tornare alla propria area resta sempre il pulsante dedicato in navbar
  // (scudo/negozio/bici) e il menu account.

  // Variante hero assegnata dal middleware (header x-exp-home_hero); fallback al controllo.
  const heroVariant = resolveVariant(
    EXPERIMENTS.home_hero,
    (await headers()).get(expHeaderName('home_hero')),
  );
  const heroDefaults = HERO_VARIANTS[heroVariant] ?? HERO_VARIANTS.a;

  const site = await loadHomeSite();
  const sections = homeEnabledSections(site);

  /**
   * 30/8/2026 (R068) — LA HOME ARRIVAVA VUOTA NELL'HTML.
   *
   * Tutte le sezioni sono componenti del browser, ognuna con la sua lettura: il
   * telefono scaricava il codice, lo eseguiva, e solo allora cominciava a
   * chiedere i dati. Il primo contenuto vero — le categorie — compariva dopo due
   * viaggi di rete in fila.
   *
   * Qui il server legge PRIMA e mette la risposta dentro la pagina.
   * `HydrationBoundary` la consegna al browser gia' pronta: i componenti non
   * cambiano di una riga, fanno la loro stessa domanda e la trovano risposta.
   *
   * Sopra la piega oggi si precaricano le categorie. Il resto (prodotti
   * popolari, drop del giorno, attivita' dal vivo, vetrina negozi) continua a
   * riempirsi dal browser: la griglia dei prodotti e' una lettura a pagine, con
   * una chiave che dipende da una decina di filtri, e precaricarla vuol dire
   * ricostruire quella chiave identica sul server — se sbaglia, il browser
   * rilegge tutto e nessuno se ne accorge. E' il pezzo successivo, non questo.
   */
  const precarico = await precaricoDellaHome();

  return (
    <div className="bg-surface-50">
      <ExperimentExposure experiment="home_hero" variant={heroVariant} />
      <HydrationBoundary state={precarico}>
        <HomeSectionRenderer sections={sections} heroVariant={heroVariant} heroDefaults={heroDefaults} />
      </HydrationBoundary>
    </div>
  );
}
