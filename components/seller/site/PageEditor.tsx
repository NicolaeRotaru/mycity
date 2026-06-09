'use client';

import { useState } from 'react';
import { ArrowLeft, ChevronDown } from 'lucide-react';
import { Input, Textarea, Checkbox } from '@/components/ui/Field';
import { slugify, RESERVED_SLUGS, homePage, type StoreSite, type SitePage } from '@/lib/store-site';
import PageSectionsEditor from './PageSectionsEditor';

/**
 * Schermata di editing di una singola pagina: freccia indietro alla panoramica,
 * impostazioni della pagina (titolo, slug, visibilità, SEO) in un pannello
 * collassabile e l'editor delle sezioni. Usata da SiteEditor quando si "entra" in
 * una pagina (vista a schermate separate).
 */
export default function PageEditor({
  site,
  page,
  onChange,
  onBack,
}: {
  site: StoreSite;
  page: SitePage;
  onChange: (p: SitePage) => void;
  onBack: () => void;
}) {
  const isHome = homePage(site).id === page.id;
  const [showSettings, setShowSettings] = useState(false);
  const setPage = (patch: Partial<SitePage>) => onChange({ ...page, ...patch });

  const slugError = (): string | undefined => {
    if (isHome || page.slug === '') return undefined;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(page.slug)) return 'Solo minuscole, numeri e trattini';
    if (RESERVED_SLUGS.has(page.slug)) return 'Slug riservato';
    if (site.pages.some((q) => q.id !== page.id && q.slug === page.slug)) return 'Slug già usato';
    return undefined;
  };

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 -ml-1 text-sm font-semibold text-ink-600 hover:text-ink-900"
      >
        <ArrowLeft size={16} aria-hidden /> Tutte le pagine
      </button>

      <div className="flex items-baseline gap-2 flex-wrap">
        <h2 className="text-xl font-bold font-serif text-ink-900">{page.title || 'Pagina'}</h2>
        <span className="text-xs text-ink-400">{isHome ? '/' : `/${page.slug}`}</span>
      </div>

      {/* Impostazioni pagina — collassabili, così non rubano spazio all'editing delle sezioni */}
      <div className="bg-white border border-cream-300 rounded-2xl shadow-warm overflow-hidden">
        <button
          type="button"
          onClick={() => setShowSettings((s) => !s)}
          aria-expanded={showSettings}
          className="w-full flex items-center justify-between gap-2 px-5 py-4 text-left"
        >
          <span className="font-semibold text-ink-900">Impostazioni pagina</span>
          <ChevronDown size={18} className={`text-ink-400 transition-transform ${showSettings ? 'rotate-180' : ''}`} aria-hidden />
        </button>
        {showSettings && (
          <div className="border-t border-cream-200 px-5 py-4 space-y-3">
            <Input label="Titolo" value={page.title} maxLength={60} onChange={(e) => setPage({ title: e.target.value })} />
            {!isHome && (
              <>
                <Input
                  label="Indirizzo pagina (slug)"
                  value={page.slug}
                  onChange={(e) => setPage({ slug: slugify(e.target.value) })}
                  error={slugError()}
                  hint={`La pagina sarà su /store/…/${page.slug || '…'}`}
                />
                <Checkbox
                  label="Pagina nascosta (raggiungibile solo con il link diretto, non nel menu)"
                  checked={page.visibility === 'hidden'}
                  onChange={(e) => setPage({ visibility: e.target.checked ? 'hidden' : 'public' })}
                />
              </>
            )}
            <Input label="Titolo SEO (opzionale)" value={page.seo?.title ?? ''} maxLength={70} onChange={(e) => setPage({ seo: { ...page.seo, title: e.target.value } })} />
            <Textarea label="Descrizione SEO (opzionale)" rows={2} maxLength={180} value={page.seo?.description ?? ''} onChange={(e) => setPage({ seo: { ...page.seo, description: e.target.value } })} />
          </div>
        )}
      </div>

      {/* Sezioni della pagina */}
      <div className="bg-white border border-cream-300 rounded-2xl shadow-warm p-6">
        <h2 className="font-semibold text-ink-900 mb-1">Sezioni</h2>
        <p className="text-sm text-ink-500 mb-4">Aggiungi, riordina, mostra/nascondi e configura i blocchi di questa pagina.</p>
        <PageSectionsEditor page={page} onChange={onChange} />
      </div>
    </div>
  );
}
