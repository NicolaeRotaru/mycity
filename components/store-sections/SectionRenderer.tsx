'use client';

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

/**
 * Renderizza in ordine le sezioni (già filtrate sulle attive) di una pagina vetrina.
 * I componenti sezione partecipano allo spacing del contenitore (space-y) come figli
 * diretti via Fragment trasparente.
 */
export default function SectionRenderer({ sections, ctx }: { sections: SiteSection[]; ctx: SectionContext }) {
  return (
    <>
      {sections.map((s) => (
        <RenderSection key={s.id} section={s} ctx={ctx} />
      ))}
    </>
  );
}
