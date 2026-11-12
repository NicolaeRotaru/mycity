'use client';
import { use } from 'react';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Megaphone, EyeOff, FileQuestion } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { announcementActive } from '@/lib/store-customization';
import { pageBySlug, enabledSections } from '@/lib/store-site';
import SectionRenderer from '@/components/store-sections/SectionRenderer';
import StoreNav from '@/components/store-sections/StoreNav';
import { useStorePageData } from '@/components/store-sections/useStorePageData';
import ScheletroNegozio from '@/components/store-sections/ScheletroNegozio';
import { CONTENITORE_PAGINA_NEGOZIO } from '@/components/store-sections/misure-vetrina';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import EmptyState from '@/components/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';

export default function StoreCustomPage(props: { params: Promise<{ id: string; slug: string }> }) {
  const { id, slug } = use(props.params);
  const data = useStorePageData(id);

  // Solo per gli avvisi al proprietario (pagina nascosta dal menu, «Aggiungi sezioni»).
  const { data: viewerId } = useQuery({
    queryKey: ['store-viewer-uid'],
    queryFn: async () => (await supabase.auth.getUser()).data.user?.id ?? null,
    staleTime: 60_000,
  });

  // 3/9/2026 — stessa malattia della home del negozio, un cartello più in là:
  // il cerchietto che gira era una terza impaginazione fra lo scheletro e la
  // pagina. Le pagine della stessa vetrina aspettano nello stesso modo.
  if (data.isLoading) {
    return <ScheletroNegozio />;
  }

  const notFound = (
    <div className="container mx-auto px-4 py-16 max-w-xl">
      <EmptyState
        icon={FileQuestion}
        title="Pagina non trovata"
        titoloCome="h1"
        description="Questa pagina non esiste o non è più disponibile."
        ctaLabel="Vedi tutti i negozi"
        ctaHref="/stores"
      />
    </div>
  );

  // 5/11/2026 — Come la pagina principale del negozio: se la domanda non è arrivata non si dice
  // «pagina non trovata», si offre «Riprova».
  if (data.isError) {
    return (
      <div className="container mx-auto px-4 py-16 max-w-xl">
        <ErrorState
          title="Non riesco a caricare questa pagina"
          description="Sembra un problema di collegamento. Riprova."
          retry={() => { void data.refetch(); }}
        />
      </div>
    );
  }

  if (!data.approved || !data.ctx || !data.store) return notFound;

  const { store, custom, accent, site, ctx } = data;
  const page = pageBySlug(site, slug);
  // slug '' = home: non è una pagina custom valida qui.
  if (!page || page.slug === '') return notFound;

  const isOwner = Boolean(viewerId && viewerId === store.id);
  // 12/11/2026 (R08-014) — «Nascosta» vuol dire fuori dal menu, non chiusa. La casella
  // dell'editor lo promette («raggiungibile solo con il link diretto, non nel menu»), e
  // il fornaio che manda il link della pagina «Ordini per le feste» ai clienti fedeli si
  // aspetta che la vedano. Prima chi non era il proprietario in anteprima riceveva «Pagina
  // non trovata». Il contenuto delle pagine nascoste era già pubblico (la vista
  // seller_public_profiles restituisce tutto store_site anche all'anonimo: prova in
  // tests/sql/rls/riparazione-r08-la-pagina-nascosta-e-gia-nei-dati-pubblici.test.sql),
  // quindi aprirla col link non espone niente di nuovo.
  const hidden = page.visibility !== 'public';

  const showAnnouncement = announcementActive(custom);
  const sections = enabledSections(page);

  return (
    <div
      data-theme={site.theme}
      className={CONTENITORE_PAGINA_NEGOZIO}
    >
      <Breadcrumb items={[
        { label: 'Home', href: '/' },
        { label: 'Negozi', href: '/stores' },
        { label: store.store_name ?? 'Negozio', href: `/store/${id}` },
        { label: page.title },
      ]} />

      <StoreNav site={site} storeId={ctx.storeId} />

      {/* 12/11/2026 (R08-003) — Il titolo principale della pagina. Prima non c'era: il
          primo titolo era quello del primo blocco (un h2), e il nome della pagina stava
          solo nelle briciole. Chi salta di titolo in titolo col lettore di schermo, e
          Google, non trovavano l'h1 di «Chi siamo», «Orari», «Contatti». */}
      {/* Con il blocco «Copertina» (hero) l'h1 c'è già: lo disegna HeroSection col nome del
          negozio. Un secondo h1 sarebbe un altro difetto; lì il titolo della pagina è un h2. */}
      {sections.some((s) => s.type === 'hero') ? (
        <h2 className="font-serif text-2xl md:text-3xl font-bold text-ink-900">{page.title}</h2>
      ) : (
        <h1 className="font-serif text-2xl md:text-3xl font-bold text-ink-900">{page.title}</h1>
      )}

      {hidden && isOwner && (
        <div className="flex items-center gap-2 rounded-xl bg-accent-50 border border-accent-200 px-4 py-2.5 text-sm text-accent-800">
          <EyeOff size={16} aria-hidden /> Questa pagina è nascosta dal menu: la vede solo chi ha il link.
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
