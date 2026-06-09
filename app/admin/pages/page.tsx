'use client';

import Link from 'next/link';
import { ArrowLeft, FileText, ExternalLink, ChevronRight } from 'lucide-react';
import { CMS_PAGES } from '@/lib/cms-page';

/** Admin: elenco delle pagine statiche editabili a blocchi. */
export default function AdminPagesPage() {
  return (
    <div className="space-y-6">
      <header>
        <Link href="/admin" className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-primary-700 transition-colors">
          <ArrowLeft size={15} aria-hidden /> Dashboard admin
        </Link>
        <h1 className="text-2xl font-bold text-ink-900 flex items-center gap-2 mt-1">
          <FileText size={22} className="text-primary-700" strokeWidth={2.2} />
          Pagine
        </h1>
        <p className="text-sm text-ink-500 mt-1 max-w-xl">
          Modifica le pagine informative a blocchi (testo, banner, galleria, video).
          Finché una pagina non è <strong>pubblicata</strong> con almeno un blocco, resta il contenuto predefinito.
        </p>
      </header>

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
