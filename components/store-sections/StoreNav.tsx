'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { resolveMenu, type StoreSite } from '@/lib/store-site';

/** Menu di navigazione del negozio (pagine + link esterni). Nullo se disabilitato/vuoto. */
export default function StoreNav({ site, storeId }: { site: StoreSite; storeId: string }) {
  const pathname = usePathname() ?? '';
  const links = resolveMenu(site, storeId);
  if (links.length === 0) return null;

  const base = `/store/${storeId}`;
  return (
    <nav aria-label="Menu del negozio" className="flex gap-1.5 overflow-x-auto scrollbar-hide -mx-1 px-1 py-0.5">
      {links.map((l) => {
        const active = !l.external && (l.slug === '' ? pathname === base : pathname === `${base}/${l.slug}`);
        const cls = `whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
          active ? 'bg-ink-900 text-white' : 'bg-cream-100 text-ink-700 hover:bg-cream-200'
        }`;
        return l.external ? (
          <a key={l.id} href={l.href} target="_blank" rel="noopener noreferrer nofollow" className={cls}>
            {l.label}
          </a>
        ) : (
          <Link key={l.id} href={l.href} className={cls}>
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
