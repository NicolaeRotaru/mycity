'use client';

import { useState } from 'react';
import {
  ChevronUp, ChevronDown, Eye, EyeOff, Trash2, Plus, X, GripVertical,
  Image as ImageIcon, Phone, Clock, Star, Sparkles, Megaphone, LayoutGrid,
  Type, Images, Film, HelpCircle, Tag, ShoppingBag, type LucideIcon,
} from 'lucide-react';
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

/** Icona per tipo di blocco (allineata al catalogo del mockup Vetrina). */
const SECTION_ICON: Record<SectionType, LucideIcon> = {
  hero: ImageIcon,
  contact: Phone,
  hours: Clock,
  reviews: Star,
  featured: Sparkles,
  promotions: Tag,
  productGrid: LayoutGrid,
  richText: Type,
  banner: Megaphone,
  collection: ShoppingBag,
  gallery: Images,
  video: Film,
  faq: HelpCircle,
};

function AddSectionPanel({ onAdd, disabled }: { onAdd: (t: SectionType) => void; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const groups = [
    { label: 'Struttura', items: SECTION_CATALOG.filter((s) => s.group === 'struttura') },
    { label: 'Contenuto', items: SECTION_CATALOG.filter((s) => s.group === 'contenuto') },
  ];
  return (
    <div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-full bg-primary-100 px-3.5 py-2 text-sm font-bold text-primary-700 hover:bg-primary-200 disabled:opacity-50"
      >
        {open ? <X size={15} aria-hidden /> : <Plus size={15} aria-hidden />} {open ? 'Chiudi' : 'Aggiungi blocco'}
      </button>
      {open && !disabled && (
        <div className="mt-3 space-y-3 rounded-xl border border-cream-200 bg-cream-50/60 p-3">
          {groups.map((g) => (
            <div key={g.label}>
              <p className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-ink-400">{g.label}</p>
              <div className="grid grid-cols-2 gap-2">
                {g.items.map((it) => {
                  const Icon = SECTION_ICON[it.type];
                  return (
                    <button
                      key={it.type}
                      type="button"
                      onClick={() => {
                        onAdd(it.type);
                        setOpen(false);
                      }}
                      title={it.description}
                      className="flex items-center gap-2 rounded-lg border border-cream-300 bg-white px-2.5 py-2 text-left text-[13px] text-ink-800 transition-colors hover:border-primary-300 hover:bg-primary-50/40"
                    >
                      <Icon size={15} className="shrink-0 text-primary-600" aria-hidden />
                      <span className="truncate font-medium">{it.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Lista ordinata dei blocchi di una pagina: riordino, on/off, config inline, rimozione.
 * La selezione (`selectedId`) viene risollevata al PageEditor per evidenziare il blocco
 * nell'anteprima dal vivo. Tutta la logica del motore (ordine, visibilità, schema delle
 * config) resta invariata: questo è un reskin.
 */
export default function PageSectionsEditor({
  page,
  onChange,
  selectedId,
  onSelect,
}: {
  page: SitePage;
  onChange: (p: SitePage) => void;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
}) {
  const sections = page.sections;
  const [openId, setOpenIdState] = useState<string | null>(null);
  const update = (next: SiteSection[]) => onChange({ ...page, sections: next });

  const setOpenId = (id: string | null) => {
    setOpenIdState(id);
    onSelect?.(id);
  };

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= sections.length) return;
    const next = [...sections];
    [next[i], next[j]] = [next[j], next[i]];
    update(next);
  };
  const toggle = (i: number) => update(sections.map((s, k) => (k === i ? { ...s, enabled: !s.enabled } : s)));
  const remove = (i: number) => {
    if (sections[i]?.id === openId) setOpenId(null);
    update(sections.filter((_, k) => k !== i));
  };
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
        <p className="text-sm text-ink-500">Nessun blocco. Aggiungine uno per iniziare a comporre la pagina.</p>
      )}

      <div className="space-y-2">
        {sections.map((s, i) => {
          const isOpen = openId === s.id;
          const isSelected = selectedId === s.id;
          const Icon = SECTION_ICON[s.type];
          return (
            <div
              key={s.id}
              className={`rounded-xl border transition-colors ${
                isOpen || isSelected
                  ? 'border-primary-300 bg-primary-50/40'
                  : s.enabled
                    ? 'border-cream-300 bg-white'
                    : 'border-cream-200 bg-cream-50/60'
              }`}
            >
              <div className="flex items-center gap-1 px-2.5 py-2.5 sm:gap-1.5">
                <GripVertical size={15} className="shrink-0 text-ink-300" aria-hidden />
                <Icon size={16} className={`shrink-0 ${s.enabled ? 'text-primary-600' : 'text-ink-300'}`} aria-hidden />
                <button
                  type="button"
                  onClick={() => setOpenId(isOpen ? null : s.id)}
                  className="flex-1 min-w-0 text-left"
                >
                  <span className={`truncate font-medium ${s.enabled ? 'text-ink-900' : 'text-ink-400'}`}>
                    {sectionLabel(s.type)}
                  </span>
                  {!s.enabled && <span className="ml-2 text-xs text-ink-400">nascosta</span>}
                </button>
                <div className="flex flex-col -my-1">
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Sposta su" className="p-0.5 text-ink-400 hover:text-ink-700 disabled:opacity-30">
                    <ChevronUp size={15} aria-hidden />
                  </button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === sections.length - 1} aria-label="Sposta giù" className="p-0.5 text-ink-400 hover:text-ink-700 disabled:opacity-30">
                    <ChevronDown size={15} aria-hidden />
                  </button>
                </div>
                <button type="button" onClick={() => toggle(i)} aria-label={s.enabled ? 'Nascondi blocco' : 'Mostra blocco'} title={s.enabled ? 'Nascondi' : 'Mostra'} className="p-1.5 text-ink-500 hover:text-ink-800">
                  {s.enabled ? <Eye size={15} className="text-olive-600" aria-hidden /> : <EyeOff size={15} aria-hidden />}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm('Rimuovere questo blocco?')) remove(i);
                  }}
                  aria-label="Rimuovi blocco"
                  title="Rimuovi"
                  className="p-1.5 text-ink-400 hover:text-red-600"
                >
                  <Trash2 size={15} aria-hidden />
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
      </div>

      <AddSectionPanel onAdd={add} disabled={sections.length >= MAX_SECTIONS_PER_PAGE} />
    </div>
  );
}
