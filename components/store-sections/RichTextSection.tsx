'use client';

import { sanitizeRichText } from '@/lib/sanitize-html';
import type { SectionConfig } from './SectionContext';

/** Testo ricco (titolo + corpo HTML sanitizzato). */
export default function RichTextSection({ config }: { config: SectionConfig<'richText'> }) {
  const heading = (config.heading ?? '').trim();
  const clean = sanitizeRichText(config.body);
  if (!heading && !clean) return null;

  return (
    <section className="bg-white border border-cream-300 rounded-2xl p-6">
      {heading && <h2 className="text-xl sm:text-2xl font-bold font-serif text-ink-900 mb-3">{heading}</h2>}
      {clean && (
        <div
          className="store-richtext text-ink-700 text-sm leading-relaxed"
          dangerouslySetInnerHTML={{ __html: clean }}
        />
      )}
    </section>
  );
}
