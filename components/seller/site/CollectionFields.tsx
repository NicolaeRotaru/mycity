'use client';

import { Input, Select } from '@/components/ui/Field';
import FeaturedProductsPicker from '@/components/seller/FeaturedProductsPicker';
import type { SiteSection } from '@/lib/store-site';
import CategorySelect from './CategorySelect';

type CollectionSec = Extract<SiteSection, { type: 'collection' }>;
type Cfg = CollectionSec['config'];

/** Config del blocco "collezione prodotti": scelta manuale o per categoria + layout. */
export default function CollectionFields({ section, onChange }: { section: CollectionSec; onChange: (s: SiteSection) => void }) {
  const c = section.config;
  const set = (patch: Partial<Cfg>) => onChange({ ...section, config: { ...c, ...patch } });

  const currentLimit = c.source.kind === 'category' ? c.source.limit : 12;
  const currentCategory = c.source.kind === 'category' ? c.source.categoryId : '';

  return (
    <div className="space-y-4">
      <Input
        label="Titolo"
        value={c.heading ?? ''}
        maxLength={120}
        onChange={(e) => set({ heading: e.target.value })}
        placeholder="Es. I più venduti"
      />

      <Select
        label="Quali prodotti"
        value={c.source.kind}
        onChange={(e) => {
          if (e.target.value === 'manual') {
            set({ source: { kind: 'manual', productIds: c.source.kind === 'manual' ? c.source.productIds : [] } });
          } else {
            set({ source: { kind: 'category', categoryId: currentCategory, limit: currentLimit } });
          }
        }}
      >
        <option value="manual">Scelti a mano</option>
        <option value="category">Da una categoria</option>
      </Select>

      {c.source.kind === 'manual' ? (
        <FeaturedProductsPicker
          value={c.source.productIds}
          onChange={(ids) => set({ source: { kind: 'manual', productIds: ids } })}
        />
      ) : (
        <>
          <CategorySelect
            valueKind="id"
            label="Categoria"
            value={c.source.categoryId}
            onChange={(id) => set({ source: { kind: 'category', categoryId: id, limit: currentLimit } })}
          />
          <Select
            label="Numero massimo di prodotti"
            value={String(c.source.limit)}
            onChange={(e) => set({ source: { kind: 'category', categoryId: currentCategory, limit: Number(e.target.value) } })}
          >
            {[4, 8, 12, 16, 24].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </Select>
        </>
      )}

      <Select label="Layout" value={c.layout} onChange={(e) => set({ layout: e.target.value as Cfg['layout'] })}>
        <option value="grid">Griglia</option>
        <option value="carousel">Carosello</option>
      </Select>
    </div>
  );
}
