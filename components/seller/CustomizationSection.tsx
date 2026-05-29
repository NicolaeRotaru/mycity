'use client';

import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

interface Props {
  id?: string;
  title: string;
  description?: string;
  icon?: ReactNode;
  defaultOpen?: boolean;
  /** Modalità controllata: se definito, sovrascrive defaultOpen. */
  open?: boolean;
  onToggle?: (open: boolean) => void;
  /** Evidenzia la testata quando la sezione contiene errori. */
  hasError?: boolean;
  children: ReactNode;
}

/** Sezione collassabile per l'editor vetrina (native <details> = accessibile). */
export default function CustomizationSection({
  id,
  title,
  description,
  icon,
  defaultOpen = false,
  open,
  onToggle,
  hasError = false,
  children,
}: Props) {
  const controlled = open !== undefined;
  return (
    <details
      id={id}
      {...(controlled ? { open } : { open: defaultOpen })}
      onToggle={(e) => onToggle?.((e.currentTarget as HTMLDetailsElement).open)}
      className={`group border rounded-xl bg-white overflow-hidden ${hasError ? 'border-red-300' : 'border-cream-300'}`}
    >
      <summary className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden hover:bg-cream-50">
        {icon && <span className={`shrink-0 ${hasError ? 'text-red-500' : 'text-primary-600'}`}>{icon}</span>}
        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-2 font-semibold text-ink-900">
            {title}
            {hasError && (
              <span className="inline-flex items-center text-[11px] font-medium text-red-600 bg-red-50 border border-red-200 rounded-full px-1.5 py-0.5">
                Da correggere
              </span>
            )}
          </span>
          {description && <span className="block text-xs text-ink-500">{description}</span>}
        </span>
        <ChevronDown size={18} className="text-ink-400 transition-transform group-open:rotate-180 shrink-0" aria-hidden />
      </summary>
      <div className="px-4 pb-4 pt-3 border-t border-cream-200 space-y-4">{children}</div>
    </details>
  );
}
