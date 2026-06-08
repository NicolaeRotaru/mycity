'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { Input, Textarea, Select } from '@/components/ui/Field';
import type { SiteSection } from '@/lib/store-site';
import { SingleImageUpload } from './ImageUpload';
import CategorySelect from './CategorySelect';

type BannerSec = Extract<SiteSection, { type: 'banner' }>;
type Cfg = BannerSec['config'];
type Target = NonNullable<Cfg['cta']>['target'];

/** Config del blocco "banner": immagine, testi, overlay e pulsante CTA. */
export default function BannerFields({ section, onChange }: { section: BannerSec; onChange: (s: SiteSection) => void }) {
  const c = section.config;
  const set = (patch: Partial<Cfg>) => onChange({ ...section, config: { ...c, ...patch } });

  const targetKind = c.cta?.target.kind ?? 'none';
  const setTargetKind = (kind: string) => {
    if (kind === 'none') return set({ cta: undefined });
    const target: Target =
      kind === 'external' ? { kind: 'external', url: '' }
      : kind === 'category' ? { kind: 'category', categorySlug: '' }
      : { kind: 'product', productId: '' };
    set({ cta: { label: c.cta?.label || 'Scopri', target } });
  };
  const setTarget = (target: Target) => set({ cta: { label: c.cta?.label || 'Scopri', target } });

  const { data: products = [] } = useQuery({
    queryKey: ['seller', 'products', 'min'],
    enabled: targetKind === 'product',
    queryFn: async (): Promise<{ id: string; name: string }[]> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data } = await supabase
        .from('products')
        .select('id, name')
        .eq('seller_id', user.id)
        .order('created_at', { ascending: false });
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-ink-700 mb-1">Immagine</label>
        <SingleImageUpload value={c.imageUrl} onChange={(url) => set({ imageUrl: url })} />
      </div>
      <Input
        label="Titolo"
        value={c.heading ?? ''}
        maxLength={120}
        onChange={(e) => set({ heading: e.target.value })}
        placeholder="Es. Saldi di stagione"
      />
      <Textarea
        label="Sottotitolo"
        value={c.subheading ?? ''}
        maxLength={200}
        rows={2}
        onChange={(e) => set({ subheading: e.target.value })}
        placeholder="Una frase breve di accompagnamento"
      />
      <Select label="Sfondo del testo" value={c.overlay} onChange={(e) => set({ overlay: e.target.value as Cfg['overlay'] })}>
        <option value="dark">Scuro (testo bianco)</option>
        <option value="light">Chiaro (testo scuro)</option>
        <option value="none">Nessuno</option>
      </Select>

      <div className="border-t border-cream-200 pt-4 space-y-3">
        <Select label="Pulsante (CTA)" value={targetKind} onChange={(e) => setTargetKind(e.target.value)}>
          <option value="none">Nessun pulsante</option>
          <option value="external">Link esterno</option>
          <option value="category">Categoria</option>
          <option value="product">Un mio prodotto</option>
        </Select>

        {c.cta && (
          <>
            <Input
              label="Testo del pulsante"
              value={c.cta.label}
              maxLength={40}
              onChange={(e) => set({ cta: { ...c.cta!, label: e.target.value } })}
              placeholder="Es. Scopri"
            />
            {c.cta.target.kind === 'external' && (
              <Input
                label="URL (https://…)"
                value={c.cta.target.url}
                onChange={(e) => setTarget({ kind: 'external', url: e.target.value })}
                placeholder="https://…"
              />
            )}
            {c.cta.target.kind === 'category' && (
              <CategorySelect
                valueKind="slug"
                label="Categoria"
                value={c.cta.target.categorySlug}
                onChange={(slug) => setTarget({ kind: 'category', categorySlug: slug })}
              />
            )}
            {c.cta.target.kind === 'product' && (
              <Select
                label="Prodotto"
                value={c.cta.target.productId}
                onChange={(e) => setTarget({ kind: 'product', productId: e.target.value })}
              >
                <option value="">Seleziona…</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </Select>
            )}
          </>
        )}
      </div>
    </div>
  );
}
