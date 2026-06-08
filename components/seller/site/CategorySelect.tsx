'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { queryKeys } from '@/lib/queries/keys';
import { Select } from '@/components/ui/Field';

type Cat = { id: string; name: string; slug: string; parent_id: string | null };

/** Select delle categorie del marketplace. valueKind decide se il valore è id o slug. */
export default function CategorySelect({
  valueKind,
  value,
  onChange,
  label,
}: {
  valueKind: 'id' | 'slug';
  value: string;
  onChange: (v: string) => void;
  label?: string;
}) {
  const { data: cats = [] } = useQuery({
    queryKey: queryKeys.categories.allList,
    queryFn: async (): Promise<Cat[]> => {
      const { data } = await supabase.from('categories').select('id, name, slug, parent_id').order('name');
      return (data ?? []) as Cat[];
    },
  });

  const parents = cats.filter((c) => !c.parent_id);
  const childrenOf = (id: string) => cats.filter((c) => c.parent_id === id);
  const orphans = cats.filter((c) => c.parent_id && !cats.some((x) => x.id === c.parent_id));

  const opt = (c: Cat, indent: boolean) => (
    <option key={c.id} value={valueKind === 'id' ? c.id : c.slug}>
      {indent ? '— ' : ''}
      {c.name}
    </option>
  );

  return (
    <Select label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Seleziona una categoria…</option>
      {parents.flatMap((p) => [opt(p, false), ...childrenOf(p.id).map((c) => opt(c, true))])}
      {orphans.map((c) => opt(c, false))}
    </Select>
  );
}
