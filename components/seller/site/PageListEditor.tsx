'use client';

import { ChevronUp, ChevronDown, ChevronRight, Eye, EyeOff, Trash2, Plus, Home, FileText } from 'lucide-react';
import { newPage, MAX_PAGES, type StoreSite, type SitePage } from '@/lib/store-site';

/**
 * Lista delle pagine del sito (schermata panoramica): seleziona una pagina per
 * aprirla (onOpen → schermata di editing), oppure agisci al volo su riordino,
 * visibilità ed eliminazione. Le impostazioni di dettaglio (titolo, slug, SEO)
 * stanno nella schermata della pagina (PageEditor). La home è sempre prima,
 * non eliminabile, non nascondibile, non spostabile.
 */
export default function PageListEditor({
  site,
  onChange,
  onOpen,
}: {
  site: StoreSite;
  onChange: (s: StoreSite) => void;
  onOpen: (id: string) => void;
}) {
  const pages = site.pages;
  const homeId = pages.find((p) => p.slug === '')?.id ?? pages[0]?.id;

  const update = (next: SitePage[]) => onChange({ ...site, pages: next });
  const setPage = (id: string, patch: Partial<SitePage>) =>
    update(pages.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (i === 0 || j < 1 || j >= pages.length) return; // la home (indice 0) resta fissa
    const next = [...pages];
    [next[i], next[j]] = [next[j], next[i]];
    update(next);
  };

  const add = () => {
    if (pages.length >= MAX_PAGES) return;
    const p = newPage('Nuova pagina', site);
    update([...pages, p]);
    onOpen(p.id); // entra subito nella nuova pagina
  };

  const remove = (id: string) => {
    if (id === homeId) return;
    if (!window.confirm('Eliminare questa pagina e le sue sezioni?')) return;
    update(pages.filter((p) => p.id !== id));
  };

  return (
    <div className="space-y-2">
      {pages.map((p, i) => {
        const isHome = p.id === homeId;
        const isHidden = p.visibility === 'hidden';
        return (
          <div key={p.id} className="group rounded-xl border border-cream-300 bg-white hover:border-primary-200 transition-colors">
            <div className="flex items-center gap-2 px-2.5 py-2.5 sm:px-3">
              <div className="flex flex-col -my-1">
                <button type="button" onClick={() => move(i, -1)} disabled={isHome || i <= 1} aria-label="Sposta su" className="p-0.5 text-ink-400 hover:text-ink-700 disabled:opacity-30">
                  <ChevronUp size={16} aria-hidden />
                </button>
                <button type="button" onClick={() => move(i, 1)} disabled={isHome || i === pages.length - 1} aria-label="Sposta giù" className="p-0.5 text-ink-400 hover:text-ink-700 disabled:opacity-30">
                  <ChevronDown size={16} aria-hidden />
                </button>
              </div>

              <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${isHidden ? 'bg-cream-100 text-ink-400' : 'bg-primary-50 text-primary-700'}`}>
                {isHome ? <Home size={16} aria-hidden /> : <FileText size={16} aria-hidden />}
              </div>

              <button type="button" onClick={() => onOpen(p.id)} className="flex-1 min-w-0 text-left">
                <span className="font-medium text-ink-900 flex items-center gap-1.5">
                  <span className="truncate">{p.title}</span>
                  {isHome && <span className="text-[10px] uppercase tracking-wide font-bold bg-primary-100 text-primary-700 rounded px-1.5 py-0.5 shrink-0">Home</span>}
                  {isHidden && <span className="text-[10px] uppercase tracking-wide font-bold bg-cream-200 text-ink-500 rounded px-1.5 py-0.5 shrink-0">Nascosta</span>}
                </span>
                <span className="block text-xs text-ink-400 truncate">{isHome ? '/' : `/${p.slug}`}</span>
              </button>

              {!isHome && (
                <button
                  type="button"
                  onClick={() => setPage(p.id, { visibility: p.visibility === 'public' ? 'hidden' : 'public' })}
                  aria-label={p.visibility === 'public' ? 'Nascondi pagina' : 'Mostra pagina'}
                  title={p.visibility === 'public' ? 'Pubblica' : 'Nascosta'}
                  className="p-1.5 text-ink-500 hover:text-ink-800"
                >
                  {p.visibility === 'public' ? <Eye size={16} aria-hidden /> : <EyeOff size={16} aria-hidden />}
                </button>
              )}
              {!isHome && (
                <button type="button" onClick={() => remove(p.id)} aria-label="Elimina pagina" title="Elimina" className="p-1.5 text-ink-400 hover:text-red-600">
                  <Trash2 size={16} aria-hidden />
                </button>
              )}
              <button type="button" onClick={() => onOpen(p.id)} aria-label="Apri e modifica la pagina" className="p-1.5 text-ink-300 group-hover:text-primary-700 transition-colors">
                <ChevronRight size={18} aria-hidden />
              </button>
            </div>
          </div>
        );
      })}

      <button
        type="button"
        onClick={add}
        disabled={pages.length >= MAX_PAGES}
        className="w-full inline-flex items-center justify-center gap-2 border-2 border-dashed border-cream-300 text-ink-700 hover:border-primary-300 hover:text-primary-700 disabled:opacity-50 disabled:hover:border-cream-300 disabled:hover:text-ink-700 px-4 py-3 rounded-xl text-sm font-semibold transition-colors"
      >
        <Plus size={16} aria-hidden /> Aggiungi pagina
        <span className="text-ink-400 font-normal">({pages.length}/{MAX_PAGES})</span>
      </button>
    </div>
  );
}
