'use client';

import Link from 'next/link';
import { ExternalLink, ChevronRight } from 'lucide-react';
import { CMS_PAGES } from '@/lib/cms-page';
import { AdminPageTitle } from '@/components/admin/AdminUI';

/** Admin: elenco delle pagine statiche editabili a blocchi. */
export default function AdminPagesPage() {
  return (
    <div className="space-y-6">
      <AdminPageTitle
        eyebrow="Contenuti"
        title="Pagine"
        sub="Pagine statiche e legali del sito, editabili a blocchi (testo, banner, galleria, video). Finché una pagina non è pubblicata con almeno un blocco, resta il contenuto predefinito."
      />

      <div className="space-y-2">
        {CMS_PAGES.map((p) => (
          <div key={p.slug} className="flex items-center gap-3 bg-white border border-cream-300 rounded-xl p-4 hover:border-primary-300 transition-colors">
            <Link href={`/admin/pages/${p.slug}`} className="flex-1 min-w-0">
              <span className="font-semibold text-ink-900 block">{p.label}</span>
              <span className="text-xs text-ink-500">{p.route}</span>
            </Link>
            <Link href={p.route} target="_blank" rel="noopener noreferrer" aria-label="Vedi pagina" className="p-2 text-ink-400 hover:text-primary-700">
              <ExternalLink size={16} aria-hidden />
            </Link>
            <Link href={`/admin/pages/${p.slug}`} aria-label="Modifica" className="p-1 text-ink-300 hover:text-primary-700">
              <ChevronRight size={20} aria-hidden />
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
