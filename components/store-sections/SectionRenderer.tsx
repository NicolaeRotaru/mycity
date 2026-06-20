'use client';

import { useId, useRef, useState } from 'react';
import type { SiteSection } from '@/lib/store-site';
import type { SectionContext } from './SectionContext';
import HeroSection from './HeroSection';
import ContactSection from './ContactSection';
import HoursSection from './HoursSection';
import ReviewsSection from './ReviewsSection';
import FeaturedSection from './FeaturedSection';
import PromotionsSection from './PromotionsSection';
import ProductGridSection from './ProductGridSection';
import RichTextSection from './RichTextSection';
import BannerSection from './BannerSection';
import CollectionSection from './CollectionSection';
import GallerySection from './GallerySection';
import VideoSection from './VideoSection';
import FaqSection from './FaqSection';

/** Mappa una singola sezione (unione discriminata) al suo componente. */
function RenderSection({ section, ctx }: { section: SiteSection; ctx: SectionContext }) {
  switch (section.type) {
    case 'hero':
      return <HeroSection config={section.config} ctx={ctx} />;
    case 'contact':
      return <ContactSection ctx={ctx} />;
    case 'hours':
      return <HoursSection ctx={ctx} />;
    case 'reviews':
      return <ReviewsSection ctx={ctx} />;
    case 'featured':
      return <FeaturedSection ctx={ctx} />;
    case 'promotions':
      return <PromotionsSection ctx={ctx} />;
    case 'productGrid':
      return <ProductGridSection ctx={ctx} />;
    case 'richText':
      return <RichTextSection config={section.config} />;
    case 'banner':
      return <BannerSection config={section.config} ctx={ctx} />;
    case 'collection':
      return <CollectionSection config={section.config} ctx={ctx} />;
    case 'gallery':
      return <GallerySection config={section.config} ctx={ctx} />;
    case 'video':
      return <VideoSection config={section.config} ctx={ctx} />;
    case 'faq':
      return <FaqSection config={section.config} ctx={ctx} />;
    default:
      // Tipo sconosciuto (forward-compat): salta silenziosamente.
      return null;
  }
}

/* ============================================================================
 * Raggruppamento in TAB — Prodotti / Info & orari / Recensioni
 *
 * Le tab sono una pura riorganizzazione di PRESENTAZIONE: la lista di sezioni
 * resta quella risolta e ORDINATA dal motore di configurazione (enabledSections).
 * Ogni sezione non-hero finisce in ESATTAMENTE una tab, così nessuna sezione
 * configurata viene persa. Le tab vuote si nascondono (es. pagine senza
 * recensioni). L'hero resta sempre sopra le tab.
 * ========================================================================== */

type TabKey = 'prodotti' | 'info' | 'recensioni';

/** A quale tab appartiene una sezione. Default: "prodotti" (contenuti/catalogo). */
function tabForSection(type: SiteSection['type']): TabKey {
  if (type === 'hours' || type === 'contact') return 'info';
  if (type === 'reviews') return 'recensioni';
  return 'prodotti';
}

const TAB_LABEL: Record<TabKey, string> = {
  prodotti: 'Prodotti',
  info: 'Info & orari',
  recensioni: 'Recensioni',
};

const TAB_ORDER: TabKey[] = ['prodotti', 'info', 'recensioni'];

function SectionTabs({ sections, ctx }: { sections: SiteSection[]; ctx: SectionContext }) {
  const baseId = useId();
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // Partiziona mantenendo l'ordine originale dentro ogni gruppo.
  const groups: Record<TabKey, SiteSection[]> = { prodotti: [], info: [], recensioni: [] };
  for (const s of sections) groups[tabForSection(s.type)].push(s);

  const visibleTabs = TAB_ORDER.filter((t) => groups[t].length > 0);

  const [active, setActive] = useState<TabKey>(visibleTabs[0] ?? 'prodotti');
  const current = visibleTabs.includes(active) ? active : (visibleTabs[0] ?? 'prodotti');

  // Una sola tab attiva: niente barra, rende direttamente le sezioni.
  if (visibleTabs.length <= 1) {
    return (
      <>
        {sections.map((s) => (
          <RenderSection key={s.id} section={s} ctx={ctx} />
        ))}
      </>
    );
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const idx = visibleTabs.indexOf(current);
    let next = idx;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (idx + 1) % visibleTabs.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (idx - 1 + visibleTabs.length) % visibleTabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = visibleTabs.length - 1;
    else return;
    e.preventDefault();
    const key = visibleTabs[next];
    setActive(key);
    tabRefs.current[key]?.focus();
  };

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Sezioni del negozio" className="flex gap-1 border-b border-cream-300">
        {visibleTabs.map((t) => {
          const selected = t === current;
          return (
            <button
              key={t}
              ref={(el) => {
                tabRefs.current[t] = el;
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${t}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${t}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(t)}
              onKeyDown={onKeyDown}
              className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-sans transition-colors ${
                selected
                  ? 'font-bold text-ink-900'
                  : 'border-transparent font-medium text-ink-500 hover:text-ink-800'
              }`}
              style={selected ? { borderColor: ctx.accent, color: ctx.accent } : undefined}
            >
              {TAB_LABEL[t]}
            </button>
          );
        })}
      </div>

      {visibleTabs.map((t) => (
        <div
          key={t}
          role="tabpanel"
          id={`${baseId}-panel-${t}`}
          aria-labelledby={`${baseId}-tab-${t}`}
          hidden={t !== current}
          // La tab "Info & orari" affianca Orari + Dove siamo in due colonne; le
          // altre impilano le sezioni rispettando lo spacing del contenitore.
          className={t === 'info' ? 'grid gap-4 sm:grid-cols-2 sm:items-start' : 'space-y-4'}
        >
          {groups[t].map((s) => (
            <RenderSection key={s.id} section={s} ctx={ctx} />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Renderizza in ordine le sezioni (già filtrate sulle attive) di una pagina vetrina.
 *
 * Con `tabs` (pagina home) le sezioni non-hero vengono raggruppate nelle tab
 * Prodotti / Info & orari / Recensioni — pura riorganizzazione di presentazione che
 * preserva ordine e visibilità decisi dal negozio. L'hero resta sempre in testa.
 * Senza `tabs` (pagine custom) il comportamento è quello classico: sezioni in
 * sequenza come figli diretti del contenitore (space-y) via Fragment.
 */
export default function SectionRenderer({
  sections,
  ctx,
  tabs = false,
}: {
  sections: SiteSection[];
  ctx: SectionContext;
  tabs?: boolean;
}) {
  if (!tabs) {
    return (
      <>
        {sections.map((s) => (
          <RenderSection key={s.id} section={s} ctx={ctx} />
        ))}
      </>
    );
  }

  const hero = sections.filter((s) => s.type === 'hero');
  const rest = sections.filter((s) => s.type !== 'hero');

  return (
    <>
      {hero.map((s) => (
        <RenderSection key={s.id} section={s} ctx={ctx} />
      ))}
      <SectionTabs sections={rest} ctx={ctx} />
    </>
  );
}
