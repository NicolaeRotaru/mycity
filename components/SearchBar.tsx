'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Search, X, Store, Tag } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { sizedImage } from '@/lib/image-url';
import { formatPrice } from '@/lib/format';
import { queryKeys } from '@/lib/queries/keys';

type Suggestion =
  | { kind: 'product'; id: string; name: string; price: number; image: string | null; store: string | null }
  | { kind: 'store'; id: string; name: string; logo: string | null }
  | { kind: 'category'; slug: string; name: string };

type Props = {
  className?: string;
  placeholder?: string;
  autoFocus?: boolean;
};

/**
 * Mega search bar con autocomplete:
 *  - mentre digiti, dopo 200ms di debounce, mostra suggerimenti combinati di
 *    prodotti (Postgres FTS + trigram fuzzy), negozi, categorie
 *  - tasto Esc chiude, Enter va al search /search?q=...
 *  - keyboard nav (arrow up/down + enter sui suggerimenti) — MVP: clic
 */
export default function SearchBar({ className = '', placeholder = 'Cerca prodotti, negozi, categorie...', autoFocus = false }: Props) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounce
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 220);
    return () => clearTimeout(id);
  }, [q]);

  const { data: suggestions = [] } = useQuery({
    queryKey: queryKeys.search.suggest(debounced),
    enabled: debounced.length >= 2,
    queryFn: async (): Promise<Suggestion[]> => {
      const term = debounced;
      const pattern = `%${term}%`;
      // 1) Prodotti via RPC smart (FTS italiano + trigram fallback). Più
      //    rilevante di ILIKE: matcha morfologicamente (es. "salumeria"
      //    matcha "salumerie") e ordina per ranking semantico.
      const [productsRes, storesRes, categoriesRes] = await Promise.all([
        supabase.rpc('search_products_smart', { q: term, lim: 6 }),
        supabase
          .from('profiles')
          .select('id, store_name, store_logo')
          .eq('role', 'seller')
          .eq('is_approved', true)
          .ilike('store_name', pattern)
          .limit(3),
        supabase
          .from('categories')
          .select('slug, name')
          .ilike('name', pattern)
          .limit(3),
      ]);

      type ProdSuggest = { id: string; name: string; price: number | string; images: string[] | null; store_name: string | null };
      type StoreSuggest = { id: string; store_name: string | null; store_logo: string | null };
      type CatSuggest = { slug: string; name: string };

      const products: Suggestion[] = ((productsRes.data ?? []) as ProdSuggest[]).map((p) => ({
        kind: 'product' as const,
        id: p.id,
        name: p.name,
        price: Number(p.price),
        image: Array.isArray(p.images) && p.images[0] ? p.images[0] : null,
        store: p.store_name ?? null,
      }));
      const stores: Suggestion[] = ((storesRes.data ?? []) as StoreSuggest[]).map((s) => ({
        kind: 'store' as const,
        id: s.id,
        name: s.store_name ?? 'Negozio',
        logo: s.store_logo ?? null,
      }));
      const cats: Suggestion[] = ((categoriesRes.data ?? []) as CatSuggest[]).map((c) => ({
        kind: 'category' as const,
        slug: c.slug,
        name: c.name,
      }));
      return [...products, ...stores, ...cats];
    },
  });

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    router.push(`/search?q=${encodeURIComponent(q.trim())}`);
    setOpen(false);
    inputRef.current?.blur();
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <form onSubmit={submit} className="relative">
        <Search size={18} strokeWidth={2.2} className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className="w-full bg-white border-2 border-transparent focus:border-primary-400 focus:bg-white text-ink-900 placeholder-ink-400 rounded-full pl-11 pr-11 py-2.5 text-sm font-medium focus:outline-none transition-colors shadow-sm"
        />
        {q && (
          <button
            type="button"
            onClick={() => { setQ(''); inputRef.current?.focus(); }}
            aria-label="Pulisci"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700"
          >
            <X size={16} strokeWidth={2.2} />
          </button>
        )}
      </form>

      {open && debounced.length >= 2 && (
        <div className="absolute left-0 right-0 top-full mt-2 bg-white rounded-2xl shadow-warm-lg ring-1 ring-ink-100 overflow-hidden z-50 max-h-[60vh] overflow-y-auto">
          {suggestions.length === 0 ? (
            <div className="p-6 text-center text-sm text-ink-500">
              Nessun risultato per &laquo;{debounced}&raquo;.
              <Link href={`/search?q=${encodeURIComponent(debounced)}`} className="block mt-2 text-primary-600 font-semibold hover:underline">
                Cerca comunque →
              </Link>
            </div>
          ) : (
            <ul className="divide-y divide-ink-50">
              {suggestions.map((s, i) => {
                if (s.kind === 'product') {
                  return (
                    <li key={`p-${s.id}`}>
                      <Link
                        href={`/product/${s.id}`}
                        onClick={() => setOpen(false)}
                        className="flex items-center gap-3 px-3 py-2.5 hover:bg-cream-100 transition-colors"
                      >
                        <div className="relative w-12 h-12 rounded-lg bg-cream-200 overflow-hidden shrink-0">
                          {s.image && (
                            <Image src={sizedImage(s.image, 'thumb')} alt="" fill sizes="48px" unoptimized className="object-cover" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-ink-900 truncate">{s.name}</p>
                          {s.store && <p className="text-xs text-ink-500 truncate">da {s.store}</p>}
                        </div>
                        <span className="text-sm font-bold text-primary-600 shrink-0">{formatPrice(s.price)}</span>
                      </Link>
                    </li>
                  );
                }
                if (s.kind === 'store') {
                  return (
                    <li key={`s-${s.id}`}>
                      <Link
                        href={`/store/${s.id}`}
                        onClick={() => setOpen(false)}
                        className="flex items-center gap-3 px-3 py-2.5 hover:bg-cream-100 transition-colors"
                      >
                        <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center shrink-0">
                          <Store size={18} className="text-primary-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-ink-900 truncate">{s.name}</p>
                          <p className="text-xs text-ink-500">Negozio</p>
                        </div>
                      </Link>
                    </li>
                  );
                }
                return (
                  <li key={`c-${s.slug}`}>
                    <Link
                      href={`/category/${s.slug}`}
                      onClick={() => setOpen(false)}
                      className="flex items-center gap-3 px-3 py-2.5 hover:bg-cream-100 transition-colors"
                    >
                      <div className="w-10 h-10 rounded-full bg-accent-100 flex items-center justify-center shrink-0">
                        <Tag size={18} className="text-accent-700" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-ink-900">{s.name}</p>
                        <p className="text-xs text-ink-500">Categoria</p>
                      </div>
                    </Link>
                  </li>
                );
              })}
              <li>
                <Link
                  href={`/search?q=${encodeURIComponent(debounced)}`}
                  onClick={() => setOpen(false)}
                  className="block text-center py-3 text-sm text-primary-600 hover:bg-cream-100 font-semibold"
                >
                  Vedi tutti i risultati per &laquo;{debounced}&raquo; →
                </Link>
              </li>
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
