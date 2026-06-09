'use client';

import { useState } from 'react';
import { ChevronUp, ChevronDown, Eye, EyeOff, Trash2, Plus, Settings2, Pencil, ArrowLeft } from 'lucide-react';
import { Input, Textarea, Checkbox } from '@/components/ui/Field';
import {
  newPage,
  slugify,
  RESERVED_SLUGS,
  MAX_PAGES,
  type StoreSite,
  type SitePage,
} from '@/lib/store-site';

/** Gestione delle pagine del sito: aggiungi, rinomina, slug, visibilità, riordino, elimina. */
export default function PageListEditor({
  site,
  activeId,
  onSelect,
  onChange,
}: {
  site: StoreSite;
  activeId: string;
  onSelect: (id: string) => void;
  onChange: (s: StoreSite) => void;
}) {
  const pages = site.pages;
  const homeId = pages.find((p) => p.slug === '')?.id ?? pages[0]?.id;
  const [settingsId, setSettingsId] = useState<string | null>(null);

  const update = (next: SitePage[]) => onChange({ ...site, pages: next });
  const setPage = (id: string, patch: Partial<SitePage>) =>
    update(pages.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    // L'indice 0 (home) resta fisso.
    if (i === 0 || j < 1 || j >= pages.length) return;
    const next = [...pages];
    [next[i], next[j]] = [next[j], next[i]];
    update(next);
  };

  const add = () => {
    if (pages.length >= MAX_PAGES) return;
    const p = newPage('Nuova pagina', site);
    update([...pages, p]);
    onSelect(p.id);
    setSettingsId(p.id);
  };

  const remove = (id: string) => {
    if (id === homeId) return;
    if (!window.confirm('Eliminare questa pagina e le sue sezioni?')) return;
    update(pages.filter((p) => p.id !== id));
    if (activeId === id) onSelect(homeId);
  };

  const slugError = (p: SitePage): string | undefined => {
    if (p.slug === '') return undefined;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(p.slug)) return 'Solo minuscole, numeri e trattini';
    if (RESERVED_SLUGS.has(p.slug)) return 'Slug riservato';
    if (pages.some((q) => q.id !== p.id && q.slug === p.slug)) return 'Slug già usato';
    return undefined;
  };

  return (
    <div className="space-y-2">
      {pages.map((p, i) => {
        const isHome = p.id === homeId;
        const isActive = p.id === activeId;
        const showSettings = settingsId === p.id;
        return (
          <div key={p.id} className={`rounded-xl border ${isActive ? 'border-primary-300 bg-primary-50/30' : 'border-cream-300 bg-white'}`}>
            <div className="flex items-center gap-1.5 px-3 py-2.5">
              <div className="flex flex-col -my-1">
                <button type="button" onClick={() => move(i, -1)} disabled={isHome || i <= 1} aria-label="Sposta su" className="p-0.5 text-ink-400 hover:text-ink-700 disabled:opacity-30">
                  <ChevronUp size={16} aria-hidden />
                </button>
                <button type="button" onClick={() => move(i, 1)} disabled={isHome || i === pages.length - 1} aria-label="Sposta giù" className="p-0.5 text-ink-400 hover:text-ink-700 disabled:opacity-30">
                  <ChevronDown size={16} aria-hidden />
                </button>
              </div>

              <button type="button" onClick={() => onSelect(p.id)} className="flex-1 min-w-0 text-left">
                <span className="font-medium text-ink-900">{p.title}</span>
                <span className="block text-xs text-ink-400 truncate">{isHome ? '/' : `/${p.slug}`}</span>
              </button>

              {isActive && <span className="text-[10px] uppercase tracking-wide bg-primary-100 text-primary-700 px-1.5 py-0.5 rounded">in modifica</span>}

              {!isHome && (
                <button type="button" onClick={() => setPage(p.id, { visibility: p.visibility === 'public' ? 'hidden' : 'public' })} aria-label={p.visibility === 'public' ? 'Nascondi pagina' : 'Mostra pagina'} title={p.visibility === 'public' ? 'Pubblica' : 'Nascosta'} className="p-1.5 text-ink-500 hover:text-ink-800">
                  {p.visibility === 'public' ? <Eye size={16} aria-hidden /> : <EyeOff size={16} aria-hidden />}
                </button>
              )}
              <button type="button" onClick={() => setSettingsId(showSettings ? null : p.id)} aria-label="Impostazioni pagina" title="Impostazioni" className="p-1.5 text-ink-500 hover:text-ink-800">
                <Settings2 size={16} aria-hidden />
              </button>
              {!isHome && (
                <button type="button" onClick={() => remove(p.id)} aria-label="Elimina pagina" title="Elimina" className="p-1.5 text-ink-400 hover:text-red-600">
                  <Trash2 size={16} aria-hidden />
                </button>
              )}
            </div>

            {showSettings && (
              <div className="border-t border-cream-200 px-4 py-4 space-y-3">
                <button
                  type="button"
                  onClick={() => setSettingsId(null)}
                  className="inline-flex items-center gap-1.5 -ml-1 text-sm font-semibold text-ink-600 hover:text-ink-900"
                >
                  <ArrowLeft size={16} aria-hidden /> Torna alle pagine
                </button>
                <Input label="Titolo" value={p.title} maxLength={60} onChange={(e) => setPage(p.id, { title: e.target.value })} />
                {!isHome && (
                  <>
                    <Input
                      label="Indirizzo pagina (slug)"
                      value={p.slug}
                      onChange={(e) => setPage(p.id, { slug: slugify(e.target.value) })}
                      error={slugError(p)}
                      hint={`La pagina sarà su /store/…/${p.slug || '…'}`}
                    />
                    <Checkbox
                      label="Pagina nascosta (raggiungibile solo con il link diretto, non nel menu)"
                      checked={p.visibility === 'hidden'}
                      onChange={(e) => setPage(p.id, { visibility: e.target.checked ? 'hidden' : 'public' })}
                    />
                  </>
                )}
                <Input label="Titolo SEO (opzionale)" value={p.seo?.title ?? ''} maxLength={70} onChange={(e) => setPage(p.id, { seo: { ...p.seo, title: e.target.value } })} />
                <Textarea label="Descrizione SEO (opzionale)" rows={2} maxLength={180} value={p.seo?.description ?? ''} onChange={(e) => setPage(p.id, { seo: { ...p.seo, description: e.target.value } })} />
                <div className="flex justify-between pt-1">
                  <button type="button" onClick={() => onSelect(p.id)} className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary-700 hover:underline">
                    <Pencil size={14} aria-hidden /> Modifica le sezioni
                  </button>
                  <button type="button" onClick={() => setSettingsId(null)} className="text-sm text-ink-500 hover:text-ink-800">Chiudi</button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      <button
        type="button"
        onClick={add}
        disabled={pages.length >= MAX_PAGES}
        className="inline-flex items-center gap-2 bg-cream-100 text-ink-800 hover:bg-cream-200 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-semibold"
      >
        <Plus size={16} aria-hidden /> Aggiungi pagina
      </button>
    </div>
  );
}
