'use client';

import { useQuery } from '@tanstack/react-query';
import HomeCtaLink from '@/components/home/HomeCtaLink';
import { supabase } from '@/lib/supabase/client';
import { domandaCategoriePiene } from '@/lib/queries/categorie-piene';

type Chip = { slug: string; label: string };
type Categoria = { id: string; slug: string };

/**
 * I chip di categoria dell'eroe: solo quelle con qualcosa dentro (stesse chiavi di menu, piede e
 * vetrina, quindi nessuna lettura in più). Finché non si sa quali sono piene, tutti, come prima;
 * se si sa ma manca l'elenco per riconoscerle, nessuno.
 */
export default function ChipDelleCategorie({ chips, heroVariant }: { chips: readonly Chip[]; heroVariant: string }) {
  const { data: categorie } = useQuery({
    queryKey: ['categories', 'tree'],
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<Categoria[]> => {
      const { data, error } = await supabase.from('categories').select('id, slug, name, parent_id, icon').order('name');
      if (error) throw error;
      return (data ?? []) as Categoria[];
    },
  });
  const piene = useQuery(domandaCategoriePiene(supabase));
  const pieneNote = piene.isError ? null : piene.data;
  const idDi = new Map((categorie ?? []).map((c) => [c.slug, c.id]));
  const visibili = pieneNote
    ? chips.filter((c) => pieneNote.includes(idDi.get(c.slug) ?? ''))
    : chips;
  if (visibili.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 pt-1">
      {visibili.map((cat) => (
        <HomeCtaLink
          key={cat.slug}
          href={`/category/${cat.slug}`}
          ctaId={`hero_chip_${cat.slug}`}
          location="hero_chips"
          variant={heroVariant}
          className="inline-flex items-center bg-white text-ink-700 hover:text-primary-700 border border-cream-300 hover:border-primary-300 px-3 py-1.5 rounded-full text-sm font-medium transition-colors"
        >
          {cat.label}
        </HomeCtaLink>
      ))}
    </div>
  );
}
