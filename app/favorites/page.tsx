'use client';

import { useQuery } from '@tanstack/react-query';
import { Heart } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import ProductCard from '@/components/ProductCard';
import EmptyState from '@/components/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { LoadingState } from '@/components/ui/LoadingState';
import { queryKeys } from '@/lib/queries/keys';
import { leggiPreferiti, type Preferito } from '@/lib/queries/preferiti';

/**
 * 5/11/2026 — `null` = chi guarda non ha fatto l'accesso: non ha «nessun
 * preferito», non ne può avere. `salvati` è quanti cuoricini ha toccato, anche
 * su prodotti che oggi non si vedono (finiti per oggi, tolti dal negozio): la
 * regola di lettura dei prodotti li nasconde, ma non sono spariti.
 */
type Lettura = { prodotti: Preferito[]; salvati: number } | null;

export default function FavoritesPage() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: [...queryKeys.favorites.all, 'products'],
    queryFn: async (): Promise<Lettura> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      // 15/10/2026 (R3) — La lettura vive in lib/queries/preferiti.ts: agganciava il
      // negozio a `profiles`, e dopo la migrazione 161 la pagina si svuotava per ogni cliente.
      const prodotti = await leggiPreferiti(supabase, user.id);
      const { count, error } = await supabase
        .from('favorites')
        .select('product_id', { count: 'exact', head: true })
        .eq('user_id', user.id);
      if (error) throw error;
      return { prodotti, salvati: Math.max(count ?? 0, prodotti.length) };
    },
  });
  const products = data?.prodotti ?? [];
  const nascosti = data ? data.salvati - products.length : 0;

  if (isLoading) return <LoadingState />;

  if (isError) {
    return (
      <div className="py-8">
        <ErrorState
          title="Impossibile caricare i preferiti"
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  if (data === null) {
    return (
      <div className="py-8">
        <EmptyState
          icon={Heart}
          title="Accedi per vedere i tuoi preferiti"
          description="I prodotti che salvi col cuoricino restano legati al tuo account."
          ctaLabel="Accedi"
          ctaHref="/sign-in?returnTo=/favorites"
          secondaryLabel="Esplora i prodotti"
          secondaryHref="/search"
        />
      </div>
    );
  }

  if (products.length === 0 && nascosti > 0) {
    return (
      <div className="py-8">
        <EmptyState
          icon={Heart}
          title="I tuoi preferiti non sono disponibili in questo momento"
          description={nascosti === 1
            ? 'Il prodotto che hai salvato è finito per oggi o il negozio l’ha tolto: torna qui appena è di nuovo in vendita.'
            : `I ${nascosti} prodotti che hai salvato sono finiti per oggi o il negozio li ha tolti: tornano qui appena sono di nuovo in vendita.`}
          ctaLabel="Esplora i prodotti"
          ctaHref="/search"
        />
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="py-8">
        <EmptyState
          icon={Heart}
          title="Nessun preferito ancora"
          description="Tocca il cuoricino su un prodotto per salvarlo qui e ritrovarlo dopo."
          ctaLabel="Esplora i prodotti"
          ctaHref="/search"
          secondaryLabel="Negozi vicini"
          secondaryHref="/near"
        />
      </div>
    );
  }

  return (
    <div>
      <header className="mb-6">
        <p className="text-xs font-bold uppercase tracking-[0.05em] text-primary-700">Attività</p>
        <h1 className="mt-0.5 font-serif text-3xl font-extrabold leading-tight text-ink-900 sm:text-[32px]">
          I tuoi preferiti
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          {products.length === 1 ? '1 prodotto salvato' : `${products.length} prodotti salvati`}
          {nascosti > 0 && ` · ${nascosti === 1 ? '1 non disponibile ora' : `${nascosti} non disponibili ora`}`}
        </p>
      </header>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {products.map((p) => (
          <ProductCard
            key={p.id}
            id={p.id}
            name={p.name}
            description={p.description ?? ''}
            price={Number(p.price)}
            images={Array.isArray(p.images) ? p.images : []}
            stock={p.stock ?? undefined}
            hasVariants={p.has_variants ?? undefined}
            createdAt={p.created_at}
            storeName={p.profiles?.store_name ?? undefined}
            sellerId={p.seller_id ?? undefined}
          />
        ))}
      </div>
    </div>
  );
}
