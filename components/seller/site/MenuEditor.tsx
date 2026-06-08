'use client';

import { ChevronUp, ChevronDown, Trash2, Plus } from 'lucide-react';
import { Input, Select, Checkbox } from '@/components/ui/Field';
import { newId, MAX_MENU_LINKS, type StoreSite, type MenuLink } from '@/lib/store-site';

type Target = MenuLink['target'];

/** Editor del menu di navigazione: abilita + lista link (home / pagina / esterno). */
export default function MenuEditor({ site, onChange }: { site: StoreSite; onChange: (s: StoreSite) => void }) {
  const menu = site.menu;
  const customPages = site.pages.filter((p) => p.slug !== '');
  const links = menu.links;

  const setMenu = (patch: Partial<StoreSite['menu']>) => onChange({ ...site, menu: { ...menu, ...patch } });
  const setLinks = (next: MenuLink[]) => setMenu({ links: next });
  const setLink = (i: number, patch: Partial<MenuLink>) => setLinks(links.map((l, k) => (k === i ? { ...l, ...patch } : l)));

  const addLink = () => {
    if (links.length >= MAX_MENU_LINKS) return;
    setLinks([...links, { id: newId(), label: '', target: { kind: 'home' } }]);
  };
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= links.length) return;
    const next = [...links];
    [next[i], next[j]] = [next[j], next[i]];
    setLinks(next);
  };
  const remove = (i: number) => setLinks(links.filter((_, k) => k !== i));

  const setKind = (i: number, kind: string) => {
    let target: Target;
    if (kind === 'home') target = { kind: 'home' };
    else if (kind === 'external') target = { kind: 'external', url: '' };
    else target = { kind: 'page', pageId: customPages[0]?.id ?? '' };
    setLink(i, { target });
  };

  return (
    <div className="space-y-3">
      <Checkbox
        label="Mostra un menu di navigazione sul sito"
        checked={menu.enabled}
        onChange={(e) => setMenu({ enabled: e.target.checked })}
      />

      {menu.enabled && (
        <>
          {links.length === 0 && <p className="text-sm text-ink-500">Nessun link. Aggiungine uno.</p>}
          {links.map((l, i) => (
            <div key={l.id} className="rounded-lg border border-cream-200 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <div className="flex flex-col -my-1">
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Su" className="p-0.5 text-ink-400 hover:text-ink-700 disabled:opacity-30"><ChevronUp size={14} aria-hidden /></button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === links.length - 1} aria-label="Giù" className="p-0.5 text-ink-400 hover:text-ink-700 disabled:opacity-30"><ChevronDown size={14} aria-hidden /></button>
                </div>
                <span className="text-xs font-medium text-ink-500 flex-1">Link {i + 1}</span>
                <button type="button" onClick={() => remove(i)} aria-label="Rimuovi link" className="text-ink-400 hover:text-red-600"><Trash2 size={14} aria-hidden /></button>
              </div>
              <Input label="Etichetta" value={l.label} maxLength={30} onChange={(e) => setLink(i, { label: e.target.value })} placeholder="Es. Chi siamo" />
              <Select label="Collega a" value={l.target.kind} onChange={(e) => setKind(i, e.target.value)}>
                <option value="home">Home della vetrina</option>
                <option value="page">Una pagina del sito</option>
                <option value="external">Link esterno</option>
              </Select>
              {l.target.kind === 'page' && (
                <Select label="Pagina" value={l.target.pageId} onChange={(e) => setLink(i, { target: { kind: 'page', pageId: e.target.value } })}>
                  <option value="">Seleziona…</option>
                  {customPages.map((p) => (
                    <option key={p.id} value={p.id}>{p.title}</option>
                  ))}
                </Select>
              )}
              {l.target.kind === 'external' && (
                <Input label="URL (https://…)" value={l.target.url} onChange={(e) => setLink(i, { target: { kind: 'external', url: e.target.value } })} placeholder="https://…" />
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={addLink}
            disabled={links.length >= MAX_MENU_LINKS}
            className="inline-flex items-center gap-2 bg-cream-100 text-ink-800 hover:bg-cream-200 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-semibold"
          >
            <Plus size={16} aria-hidden /> Aggiungi link
          </button>
        </>
      )}
    </div>
  );
}
