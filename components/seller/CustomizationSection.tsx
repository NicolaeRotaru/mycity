'use client';

import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

interface Props {
  title: string;
  description?: string;
  icon?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}

/** Sezione collassabile per l'editor vetrina (native <details> = accessibile). */
export default function CustomizationSection({ title, description, icon, defaultOpen = false, children }: Props) {
  return (
    <details open={defaultOpen} className="group border border-cream-300 rounded-xl bg-white overflow-hidden">
      <summary className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden hover:bg-cream-50">
        {icon && <span className="text-primary-600 shrink-0">{icon}</span>}
        <span className="flex-1 min-w-0">
          <span className="block font-semibold text-ink-900">{title}</span>
          {description && <span className="block text-xs text-ink-500">{description}</span>}
        </span>
        <ChevronDown size={18} className="text-ink-400 transition-transform group-open:rotate-180 shrink-0" aria-hidden />
      </summary>
      <div className="px-4 pb-4 pt-3 border-t border-cream-200 space-y-4">{children}</div>
    </details>
  );
}
