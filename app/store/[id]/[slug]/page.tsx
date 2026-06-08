'use client';
import { use, type CSSProperties } from 'react';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Megaphone, EyeOff } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { announcementActive } from '@/lib/store-customization';
import { pageBySlug, enabledSections } from '@/lib/store-site';
import SectionRenderer from '@/components/store-sections/SectionRenderer';
import StoreNav from '@/components/store-sections/StoreNav';
import { useStorePageData } from '@/components/store-sections/useStorePageData';
import { LoadingState } from '@/components/ui/LoadingState';
import { Breadcrumb } from '@/components/ui/Breadcrumb';

export default function StoreCustomPage(props: { params: Promise<{ id: string; slug: string }> }) {
  const { id, slug } = use(props.params);
  const searchParams = useSearchParams();
  const preview = searchParams.get('preview') === '1';
  const data = useStorePageData(id);

  // Solo per l'anteprima del proprietario di pagine nascoste.
  const { data: viewerId } = useQuery({
    queryKey: ['store-viewer-uid'],
    queryFn: async () => (await supabase.auth.getUser()).data.user?.id ?? null,
    staleTime: 60_000,
  });

  if (data.isLoading) {
    return (
      <div className="container mx-auto px-4 py-16">
        <LoadingState />
      </div>
    );
  }

  const notFound = (
    <div className="container mx-auto px-4 py-16 text-center text-ink-500">Pagina non trovata.</div>
  );

  if (!data.approved || !data.ctx || !data.store) return notFound;

  const { store, custom, accent, site, ctx } = data;
  const page = pageBySlug(site, slug);
  // slug '' = home: non è una pagina custom valida qui.
  if (!page || page.slug === '') return notFound;

  const isOwner = Boolean(viewerId && viewerId === store.id);
  const hidden = page.visibility !== 'public';
  if (hidden && !(isOwner && preview)) return notFound;

  const showAnnouncement = announcementActive(custom);
  const sections = enabledSections(page);

  return (
    <div
      data-theme={site.theme}
      style={{ ['--store-accent']: accent } as CSSProperties}
      className="container mx-auto px-4 py-6 max-w-5xl space-y-4"
    >
      <Breadcrumb items={[
        { label: 'Home', href: '/' },
        { label: 'Negozi', href: '/stores' },
        { label: store.store_name ?? 'Negozio', href: `/store/${id}` },
        { label: page.title },
      ]} />

      <StoreNav site={site} storeId={ctx.storeId} />

      {hidden && (
        <div className="flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 px-4 py-2.5 text-sm text-amber-800">
          <EyeOff size={16} aria-hidden /> Anteprima: questa pagina è nascosta e non è visibile al pubblico.
        </div>
      )}

      {showAnnouncement && (
        <div role="status" className="flex items-start gap-3 rounded-xl bg-cream-50 border px-4 py-3" style={{ borderColor: accent }}>
          <Megaphone size={18} className="shrink-0 mt-0.5" style={{ color: accent }} aria-hidden />
          <p className="text-sm text-ink-800">{custom.announcement?.text}</p>
        </div>
      )}

      {sections.length > 0 ? (
        <SectionRenderer sections={sections} ctx={ctx} />
      ) : (
        <p className="text-center text-ink-400 py-12">
          Questa pagina non ha ancora contenuti.{' '}
          {isOwner && <Link href="/seller/site" className="text-primary-700 underline">Aggiungi sezioni</Link>}
        </p>
      )}
    </div>
  );
}
