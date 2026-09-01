'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { LayoutGrid, Tag } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { LoadingState } from '@/components/ui/LoadingState';
import { ErrorState } from '@/components/ui/ErrorState';
import CollectionHeader from '@/components/CollectionHeader';
import { statoDellaVista } from '@/lib/stato-vista';

type Cat = { id: string; slug: string; name: string; icon: string | null; parent_id: string | null };

/**
 * Indice di tutte le categorie con le relative sottocategorie.
 * Sostituisce l'elenco lungo che prima stava nella CategoryBar.
 */
export default function CategoriePage() {
  const { data: cats = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['all-categories-tree'],
    queryFn: async (): Promise<Cat[]> => {
      const { data, error } = await supabase
        .from('categories')
        .select('id, slug, name, icon, parent_id')
        .order('name');
      if (error) throw error;
      return (data ?? []) as Cat[];
    },
  });

  /**
   * 27/8/2026 (R090) — QUI SI DISEGNAVA UNA GRIGLIA VUOTA SOTTO IL TITOLO «CATEGORIE».
   *
   * La pagina guardava solo `isLoading`: su una lettura fallita l'elenco restava vuoto e chi
   * arrivava da Google o dal piè di pagina vedeva un sito senza merce, senza nessun modo di sapere
   * che bastava ricaricare. Gli stati sono tre — carico · rotto · vuoto — ed è la stessa regola che
   * `components/CategoryShowcase.tsx` applica già da giorni.
   */
  const vista = statoDellaVista({ letto: !isLoading, caricando: isLoading, errore: isError || undefined, quanti: cats.length });

  if (vista.mostraScheletro) return <LoadingState />;
  if (vista.mostraErrore) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <ErrorState
          title="Non riesco a caricare le categorie"
          description="C'è stato un problema di collegamento. I negozi ci sono: riprova fra un attimo."
          onRetry={() => { void refetch(); }}
          backHref="/"
          backLabel="Torna alla home"
        />
      </div>
    );
  }

  const tops = cats.filter((c) => c.parent_id === null);
  const childrenOf = (id: string) => cats.filter((c) => c.parent_id === id);

  return (
    <div className="container mx-auto px-4 py-8 space-y-6 max-w-5xl">
      <CollectionHeader
        icon={LayoutGrid}
        eyebrow="Sfoglia per reparto"
        title="Categorie"
        blurb="Esplora tutte le categorie e le sottocategorie dei negozi di Piacenza."
        breadcrumb={[{ label: 'Home', href: '/' }, { label: 'Categorie' }]}
      />

      {tops.length === 0 && (
        <p className="rounded-2xl border border-cream-300 bg-white px-4 py-12 text-center text-sm text-ink-500">
          Non c&apos;è ancora nessuna categoria da sfogliare.{' '}
          <Link href="/" className="font-semibold text-primary-700 hover:underline">Torna alla home</Link>
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {tops.map((c) => {
          const subs = childrenOf(c.id);
          return (
            <div key={c.id} className="bg-white border border-cream-300 rounded-2xl p-5">
              <Link
                href={`/category/${c.slug}`}
                className="flex items-center gap-2 font-serif font-bold text-lg text-ink-900 hover:text-primary-700"
              >
                <span className="flex items-center text-2xl text-primary-600">{c.icon ?? <Tag size={24} strokeWidth={2.2} aria-hidden />}</span>
                {c.name}
              </Link>
              {subs.length > 0 ? (
                <div className="flex flex-wrap gap-2 mt-3">
                  {subs.map((s) => (
                    <Link
                      key={s.id}
                      href={`/category/${s.slug}`}
                      className="bg-cream-100 hover:bg-primary-50 hover:text-primary-700 text-ink-700 border border-cream-200 rounded-full px-3 py-1 text-sm font-medium"
                    >
                      {s.name}
                    </Link>
                  ))}
                </div>
              ) : (
                <Link href={`/category/${c.slug}`} className="text-sm text-primary-700 hover:underline mt-2 inline-block">
                  Vedi i prodotti →
                </Link>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
