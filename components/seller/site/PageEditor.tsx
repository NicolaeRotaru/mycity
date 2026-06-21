'use client';

import { useState } from 'react';
import { ArrowLeft, ChevronDown, Settings2 } from 'lucide-react';
import { Input, Textarea, Checkbox } from '@/components/ui/Field';
import { slugify, RESERVED_SLUGS, homePage, type StoreSite, type SitePage, type ThemeKey } from '@/lib/store-site';
import PageSectionsEditor from './PageSectionsEditor';
import SitePreview from './SitePreview';

/**
 * Schermata di editing di una singola pagina, in layout a due colonne (≥lg):
 *  - sinistra: freccia indietro, impostazioni pagina (collassabili) ed editor dei
 *    blocchi/sezioni;
 *  - destra: anteprima dal vivo (sticky) che rispecchia la bozza in tempo reale.
 *
 * Su mobile le due colonne si impilano (anteprima sotto l'editor). La sezione
 * selezionata nell'editor viene evidenziata nell'anteprima.
 */
export default function PageEditor({
  site,
  page,
  onChange,
  onBack,
  theme,
  accent,
  storeName,
  storeSlug,
}: {
  site: StoreSite;
  page: SitePage;
  onChange: (p: SitePage) => void;
  onBack: () => void;
  theme: ThemeKey;
  accent: string;
  storeName: string;
  storeSlug: string;
}) {
  const isHome = homePage(site).id === page.id;
  const [showSettings, setShowSettings] = useState(false);
  // Sezione "in modifica": evidenziata nell'anteprima (lifted da PageSectionsEditor).
  const [selectedId, setSelectedId] = useState<string | null>(null);
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

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(360px,440px)]">
        {/* ── Colonna editor ── */}
        <div className="space-y-4">
          {/* Impostazioni pagina — collassabili, così non rubano spazio ai blocchi */}
          <div className="bg-white border border-cream-300 rounded-2xl shadow-warm overflow-hidden">
            <button
              type="button"
              onClick={() => setShowSettings((s) => !s)}
              aria-expanded={showSettings}
              className="w-full flex items-center justify-between gap-2 px-5 py-4 text-left"
            >
              <span className="inline-flex items-center gap-2 font-semibold text-ink-900">
                <Settings2 size={16} className="text-ink-400" aria-hidden /> Impostazioni pagina
              </span>
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

          {/* Blocchi della pagina */}
          <div className="bg-white border border-cream-300 rounded-2xl shadow-warm p-5 sm:p-6">
            <h2 className="font-serif text-lg font-bold text-ink-900">Blocchi</h2>
            <p className="text-sm text-ink-500 mb-4">Aggiungi, riordina, mostra/nascondi e configura i blocchi di questa pagina.</p>
            <PageSectionsEditor page={page} onChange={onChange} selectedId={selectedId} onSelect={setSelectedId} />
          </div>
        </div>

        {/* ── Colonna anteprima ── */}
        <SitePreview
          page={page}
          theme={theme}
          accent={accent}
          storeName={storeName}
          storeSlug={storeSlug}
          selectedId={selectedId}
        />
      </div>
    </div>
  );
}
