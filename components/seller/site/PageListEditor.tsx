'use client';

import { ChevronUp, ChevronDown, ChevronRight, Eye, EyeOff, Trash2, Plus } from 'lucide-react';
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
        return (
          <div key={p.id} className="rounded-xl border border-cream-300 bg-white">
            <div className="flex items-center gap-1.5 px-3 py-2.5">
              <div className="flex flex-col -my-1">
                <button type="button" onClick={() => move(i, -1)} disabled={isHome || i <= 1} aria-label="Sposta su" className="p-0.5 text-ink-400 hover:text-ink-700 disabled:opacity-30">
                  <ChevronUp size={16} aria-hidden />
                </button>
                <button type="button" onClick={() => move(i, 1)} disabled={isHome || i === pages.length - 1} aria-label="Sposta giù" className="p-0.5 text-ink-400 hover:text-ink-700 disabled:opacity-30">
                  <ChevronDown size={16} aria-hidden />
                </button>
              </div>

              <button type="button" onClick={() => onOpen(p.id)} className="flex-1 min-w-0 text-left">
                <span className="font-medium text-ink-900">{p.title}</span>
                <span className="block text-xs text-ink-400 truncate">
                  {isHome ? '/' : `/${p.slug}`}
                  {p.visibility === 'hidden' && ' · nascosta'}
                </span>
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
              <button type="button" onClick={() => onOpen(p.id)} aria-label="Apri e modifica la pagina" className="p-1.5 text-ink-400 hover:text-primary-700">
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
        className="inline-flex items-center gap-2 bg-cream-100 text-ink-800 hover:bg-cream-200 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-semibold"
      >
        <Plus size={16} aria-hidden /> Aggiungi pagina
      </button>
    </div>
  );
}
