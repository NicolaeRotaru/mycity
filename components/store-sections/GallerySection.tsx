'use client';

import Image from 'next/image';
import { sizedImage } from '@/lib/image-url';
import SectionHeading from './SectionHeading';
import type { SectionConfig, SectionContext } from './SectionContext';

/** Galleria di immagini (griglia responsive). */
export default function GallerySection({
  config,
  ctx,
}: {
  config: SectionConfig<'gallery'>;
  ctx: SectionContext;
}) {
  const items = config.items ?? [];
  if (items.length === 0) return null;

  return (
    <section>
      {config.heading && <SectionHeading accent={ctx.accent}>{config.heading}</SectionHeading>}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {items.map((it, i) => (
          <div
            key={i}
            className="relative aspect-square rounded-xl overflow-hidden bg-cream-100 border border-cream-200"
          >
            <Image
              src={sizedImage(it.url, 'card')}
              alt={it.alt ?? ''}
              fill
              sizes="(max-width: 640px) 50vw, 33vw"
              className="object-cover"
              loading="lazy"
            />
          </div>
        ))}
      </div>
    </section>
  );
}
