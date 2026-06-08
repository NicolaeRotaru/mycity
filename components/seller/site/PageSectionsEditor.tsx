'use client';

import { useState } from 'react';
import { ChevronUp, ChevronDown, Eye, EyeOff, Trash2, Plus } from 'lucide-react';
import {
  sectionLabel,
  newSection,
  SECTION_CATALOG,
  MAX_SECTIONS_PER_PAGE,
  type SitePage,
  type SiteSection,
  type SectionType,
} from '@/lib/store-site';
import SectionConfigForm from './SectionConfigForm';

function AddSectionMenu({ onAdd, disabled }: { onAdd: (t: SectionType) => void; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const groups = [
    { label: 'Struttura', items: SECTION_CATALOG.filter((s) => s.group === 'struttura') },
    { label: 'Contenuto', items: SECTION_CATALOG.filter((s) => s.group === 'contenuto') },
  ];
  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 bg-primary-50 text-primary-800 hover:bg-primary-100 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-semibold"
      >
        <Plus size={16} aria-hidden /> Aggiungi sezione
      </button>
      {open && !disabled && (
        <div className="absolute z-20 mt-2 w-72 max-h-80 overflow-y-auto rounded-xl border border-cream-300 bg-white shadow-warm-lg p-2">
          {groups.map((g) => (
            <div key={g.label}>
              <p className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-ink-400">{g.label}</p>
              {g.items.map((it) => (
                <button
                  key={it.type}
                  type="button"
                  onClick={() => {
                    onAdd(it.type);
                    setOpen(false);
                  }}
                  className="w-full text-left rounded-lg px-2 py-2 hover:bg-cream-50"
                >
                  <span className="block text-sm font-medium text-ink-800">{it.label}</span>
                  <span className="block text-xs text-ink-500">{it.description}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Lista ordinata delle sezioni di una pagina: riordino, on/off, config, rimozione. */
export default function PageSectionsEditor({ page, onChange }: { page: SitePage; onChange: (p: SitePage) => void }) {
  const sections = page.sections;
  const [openId, setOpenId] = useState<string | null>(null);
  const update = (next: SiteSection[]) => onChange({ ...page, sections: next });

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= sections.length) return;
    const next = [...sections];
    [next[i], next[j]] = [next[j], next[i]];
    update(next);
  };
  const toggle = (i: number) => update(sections.map((s, k) => (k === i ? { ...s, enabled: !s.enabled } : s)));
  const remove = (i: number) => update(sections.filter((_, k) => k !== i));
  const setSection = (i: number, s: SiteSection) => update(sections.map((x, k) => (k === i ? s : x)));
  const add = (t: SectionType) => {
    if (sections.length >= MAX_SECTIONS_PER_PAGE) return;
    const s = newSection(t);
    update([...sections, s]);
    setOpenId(s.id);
  };

  return (
    <div className="space-y-3">
      {sections.length === 0 && (
        <p className="text-sm text-ink-500">Nessuna sezione. Aggiungine una per iniziare a comporre la pagina.</p>
      )}

      {sections.map((s, i) => {
        const isOpen = openId === s.id;
        return (
          <div key={s.id} className={`rounded-xl border ${s.enabled ? 'border-cream-300 bg-white' : 'border-cream-200 bg-cream-50/60'}`}>
            <div className="flex items-center gap-1.5 px-3 py-2.5">
              <div className="flex flex-col -my-1">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Sposta su" className="p-0.5 text-ink-400 hover:text-ink-700 disabled:opacity-30">
                  <ChevronUp size={16} aria-hidden />
                </button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === sections.length - 1} aria-label="Sposta giù" className="p-0.5 text-ink-400 hover:text-ink-700 disabled:opacity-30">
                  <ChevronDown size={16} aria-hidden />
                </button>
              </div>
              <button type="button" onClick={() => setOpenId(isOpen ? null : s.id)} className="flex-1 min-w-0 text-left">
                <span className="font-medium text-ink-900">{sectionLabel(s.type)}</span>
                {!s.enabled && <span className="ml-2 text-xs text-ink-400">nascosta</span>}
              </button>
              <button type="button" onClick={() => toggle(i)} aria-label={s.enabled ? 'Nascondi sezione' : 'Mostra sezione'} title={s.enabled ? 'Nascondi' : 'Mostra'} className="p-1.5 text-ink-500 hover:text-ink-800">
                {s.enabled ? <Eye size={16} aria-hidden /> : <EyeOff size={16} aria-hidden />}
              </button>
              <button type="button" onClick={() => setOpenId(isOpen ? null : s.id)} className="px-2 py-1 text-xs font-semibold text-primary-700 hover:underline">
                {isOpen ? 'Chiudi' : 'Modifica'}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm('Rimuovere questa sezione?')) remove(i);
                }}
                aria-label="Rimuovi sezione"
                title="Rimuovi"
                className="p-1.5 text-ink-400 hover:text-red-600"
              >
                <Trash2 size={16} aria-hidden />
              </button>
            </div>
            {isOpen && (
              <div className="border-t border-cream-200 px-4 py-4">
                <SectionConfigForm section={s} onChange={(ns) => setSection(i, ns)} />
              </div>
            )}
          </div>
        );
      })}

      <AddSectionMenu onAdd={add} disabled={sections.length >= MAX_SECTIONS_PER_PAGE} />
    </div>
  );
}
