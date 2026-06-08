'use client';

import { Tag } from 'lucide-react';
import type { SectionContext } from './SectionContext';

/** Promozioni attive del negozio (badge sconto + scadenza). */
export default function PromotionsSection({ ctx }: { ctx: SectionContext }) {
  const { promos } = ctx;
  if (promos.length === 0) return null;

  return (
    <div className="rounded-2xl bg-rose-50 border border-rose-200 p-4 sm:p-5">
      <h2 className="font-semibold text-ink-900 flex items-center gap-2 mb-3">
        <Tag size={18} className="text-rose-600" aria-hidden />
        Promozioni attive
      </h2>
      <div className="flex flex-wrap gap-2">
        {promos.map((p) => (
          <span
            key={p.id}
            className="inline-flex items-center gap-2 bg-white border border-rose-200 rounded-full pl-2 pr-3 py-1.5 text-sm"
          >
            <span className="bg-rose-600 text-white font-bold rounded-full px-2 py-0.5 text-xs">-{p.discount_percent}%</span>
            <span className="font-medium text-ink-800">{p.title}</span>
            <span className="text-ink-400 text-xs whitespace-nowrap">
              fino al {new Date(p.ends_at).toLocaleDateString('it-IT')}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
