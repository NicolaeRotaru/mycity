'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { sizedImage } from '@/lib/image-url';
import { formatPrice } from '@/lib/format';
import { queryKeys } from '@/lib/queries/keys';
import { MAX_FEATURED } from '@/lib/store-customization';
import { LoadingState } from '@/components/ui/LoadingState';

type Row = { id: string; name: string; price: number | string; status: string; images: string[] | null };

interface Props {
  value?: string[];
  onChange: (next: string[]) => void;
}

/** Selezione (ordinata) dei prodotti da mettere in evidenza nella vetrina. */
export default function FeaturedProductsPicker({ value = [], onChange }: Props) {
  const [q, setQ] = useState('');

  const { data: products = [], isLoading } = useQuery({
    queryKey: queryKeys.seller.products,
    queryFn: async (): Promise<Row[]> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const { data, error } = await supabase
        .from('products')
        .select('id, name, price, status, images')
        .eq('seller_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  const toggle = (id: string) => {
    if (value.includes(id)) onChange(value.filter((x) => x !== id));
    else if (value.length < MAX_FEATURED) onChange([...value, id]);
  };

  if (isLoading) return <LoadingState variant="inline" />;
  if (products.length === 0) {
    return <p className="text-sm text-ink-500">Pubblica dei prodotti per poterli mettere in evidenza.</p>;
  }

  const filtered = q ? products.filter((p) => p.name.toLowerCase().includes(q.toLowerCase())) : products;

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-500">
        Scegli fino a {MAX_FEATURED} prodotti da mostrare in cima alla vetrina. Selezionati: {value.length}/{MAX_FEATURED}.
      </p>
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" aria-hidden />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Cerca un prodotto…"
          className="w-full border rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
        />
      </div>
      <ul className="max-h-72 overflow-y-auto divide-y divide-cream-100 border border-cream-200 rounded-lg">
        {filtered.map((p) => {
          const selected = value.includes(p.id);
          const order = value.indexOf(p.id) + 1;
          const disabled = !selected && value.length >= MAX_FEATURED;
          const img = sizedImage(p.images?.[0] ?? 'https://placehold.co/100x100/FBF7F0/C0492C?text=Foto', 'thumb');
          return (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => toggle(p.id)}
                disabled={disabled}
                className={`w-full flex items-center gap-3 p-2 text-left transition-colors ${
                  selected ? 'bg-primary-50' : 'hover:bg-cream-50'
                } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
              >
                <span className={`relative w-12 h-12 rounded-md overflow-hidden shrink-0 ${selected ? 'ring-2 ring-primary-500' : ''}`}>
                  <Image src={img} alt="" fill sizes="48px" unoptimized className="object-cover" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-ink-800 truncate">{p.name}</span>
                  <span className="block text-xs text-ink-500">
                    {formatPrice(Number(p.price))}
                    {p.status !== 'available' && ' · non disponibile'}
                  </span>
                </span>
                {selected ? (
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary-600 text-white text-xs font-bold shrink-0">
                    {order}
                  </span>
                ) : (
                  <span className="w-6 h-6 rounded-full border border-cream-300 shrink-0" aria-hidden />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
