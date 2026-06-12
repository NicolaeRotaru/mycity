import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import ExperimentExposure from '@/components/home/ExperimentExposure';
import HomeSectionRenderer, { type HeroDefaults } from '@/components/home-sections/HomeSectionRenderer';
import { getServerSupabase } from '@/lib/supabase/server';
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
        della tua via in pochi tap e <strong className="text-ink-900">paghi alla consegna</strong>.
        A casa in 24-48h.
      </>
    ),
    ctaPrimary: 'Inizia a esplorare',
  },
  b: {
    eyebrow: 'Spesa, moda e casa · consegna a domicilio',
    headline: (
      <>
        Ordini dai negozi di Piacenza.<br />
        <span className="text-primary-700 italic">Paghi alla consegna.</span>
      </>
    ),
    subhead: (
      <>
        Niente carta, nessun rischio: scegli dai commercianti della tua città e
        paghi <strong className="text-ink-900">quando il rider arriva</strong>. A casa in 24-48h.
      </>
    ),
    ctaPrimary: 'Scopri cosa c’è oggi',
  },
};

// NB: ISR non applicabile. next-intl è cookie-based → tutte le rotte sono dinamiche
// per-request. La config della home (site_settings.home_site) è letta server-side a
// ogni richiesta (SELECT pubblica via RLS); dopo un salvataggio admin la home riflette
// subito le modifiche.

/**
 * Homepage MyCity — ora COMPONIBILE dall'admin (Home builder, /admin/home).
 * Il layout è guidato dai dati: `site_settings.home_site` definisce ordine e
 * visibilità delle sezioni. Se la config è assente/vuota, `normalizeHomeSite`
 * ritorna `defaultHomeSite()` che riproduce ESATTAMENTE il layout fisso storico
 * (hero → come funziona → categorie → drop → prodotti → live+trust → negozi →
 * newsletter → CTA venditore). Le sezioni strutturali riusano i componenti home
 * esistenti; i blocchi di contenuto (testo/banner/galleria/video) sono liberi.
 */
async function loadHomeSite() {
  try {
    const supa = await getServerSupabase();
    const { data } = await supa.from('site_settings').select('home_site').eq('id', 1).maybeSingle();
    return normalizeHomeSite((data as { home_site?: unknown } | null)?.home_site);
  } catch {
    return normalizeHomeSite(null);
  }
}

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

  return (
    <div className="bg-surface-50">
      <ExperimentExposure experiment="home_hero" variant={heroVariant} />
      <HomeSectionRenderer sections={sections} heroVariant={heroVariant} heroDefaults={heroDefaults} />
    </div>
  );
}
