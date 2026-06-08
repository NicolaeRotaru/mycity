'use client';

import { ChevronDown } from 'lucide-react';
import SectionHeading from './SectionHeading';
import type { SectionConfig, SectionContext } from './SectionContext';

/** FAQ: domande/risposte come accordion (native <details> = accessibile). */
export default function FaqSection({ config, ctx }: { config: SectionConfig<'faq'>; ctx: SectionContext }) {
  const items = config.items ?? [];
  if (items.length === 0) return null;

  return (
    <section>
      <SectionHeading accent={ctx.accent}>{config.heading || 'Domande frequenti'}</SectionHeading>
      <div className="space-y-2">
        {items.map((it, i) => (
          <details key={i} className="group bg-white border border-cream-300 rounded-xl overflow-hidden">
            <summary className="flex items-center justify-between gap-3 cursor-pointer list-none px-4 py-3 hover:bg-cream-50 font-medium text-ink-900">
              <span>{it.q}</span>
              <ChevronDown
                size={18}
                className="text-ink-400 transition-transform group-open:rotate-180 shrink-0"
                aria-hidden
              />
            </summary>
            <div className="px-4 pb-4 pt-2 text-sm text-ink-700 whitespace-pre-wrap border-t border-cream-200">
              {it.a}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
