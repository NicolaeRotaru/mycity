'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Breadcrumb primitive — navigazione gerarchica + Schema.org JSON-LD per SEO.
 *
 * Esperti consultati:
 * - SEO Specialist: "Schema BreadcrumbList obbligatorio per rich results Google."
 * - Senior UX Designer: "Ultimo item NON è link (current page), aria-current page."
 * - Accessibility: "nav role + aria-label, ol semantica, separator aria-hidden."
 */

type Crumb = { label: string; href?: string };

type Props = {
  items: Crumb[];
  className?: string;
};

export function Breadcrumb({ items, className }: Props) {
  // Build Schema.org BreadcrumbList JSON-LD (filter only those with href)
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, idx) => ({
      '@type': 'ListItem',
      position: idx + 1,
      name: item.label,
      ...(item.href && { item: item.href }),
    })),
  };

  return (
    <>
      <nav aria-label="Breadcrumb" className={cn('text-sm text-ink-500', className)}>
        <ol className="flex items-center flex-wrap gap-1">
          {items.map((item, idx) => {
            const isLast = idx === items.length - 1;
            return (
              <li key={idx} className="flex items-center gap-1">
                {idx > 0 && (
                  <ChevronRight size={12} className="text-ink-300 flex-shrink-0" aria-hidden />
                )}
                {item.href && !isLast ? (
                  <Link href={item.href} className="hover:text-primary-700 hover:underline">
                    {item.label}
                  </Link>
                ) : (
                  <span className="text-ink-700 font-medium" aria-current={isLast ? 'page' : undefined}>
                    {item.label}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
      />
    </>
  );
}
