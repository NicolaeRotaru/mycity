'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Save } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { friendlyError } from '@/lib/errors';
import { queryKeys } from '@/lib/queries/keys';
import { LoadingState } from '@/components/ui/LoadingState';
import { normalizeSite, storeSiteSchema, homePage, type StoreSite, type SitePage } from '@/lib/store-site';
import ThemePicker from './ThemePicker';
import PageListEditor from './PageListEditor';
import PageSectionsEditor from './PageSectionsEditor';
import MenuEditor from './MenuEditor';

/**
 * Editor del sito vetrina: tema, pagine (multi-pagina), menu di navigazione e
 * sezioni della pagina selezionata. Stato locale = StoreSite di lavoro, sub-editor
 * controllati, salvataggio via PUT /api/seller/site (validazione + sanitizzazione
 * server). Stesso pattern di VendorForm/seller/profile.
 */
export default function SiteEditor() {
  const qc = useQueryClient();

  const { data: profile, isLoading } = useQuery({
    queryKey: queryKeys.seller.profile,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const { data, error } = await supabase.from('profiles').select('id, is_approved, store_site').eq('id', user.id).single();
      if (error) throw error;
      return data;
    },
  });

  const initial = useMemo(() => (profile ? normalizeSite(profile.store_site) : null), [profile]);
  const [draft, setDraft] = useState<StoreSite | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const site = draft ?? initial;

  const save = useMutation({
    mutationFn: async (next: StoreSite) => {
      const parsed = storeSiteSchema.safeParse(next);
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Sito non valido');
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/seller/site', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ site: parsed.data }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error?.message ?? 'Errore di salvataggio');
      return json.data.site as StoreSite;
    },
    onSuccess: (saved) => {
      setDraft(saved);
      qc.invalidateQueries({ queryKey: queryKeys.seller.profile });
      if (profile?.id) qc.invalidateQueries({ queryKey: queryKeys.stores.detail(profile.id) });
      toast.success('Sito salvato!');
    },
    onError: (e: unknown) => toast.error(friendlyError(e)),
  });

  if (isLoading || !site) return <LoadingState />;

  const home = homePage(site);
  const activePage = site.pages.find((p) => p.id === activeId) ?? home;
  const setActivePage = (next: SitePage) =>
    setDraft({ ...site, pages: site.pages.map((p) => (p.id === activePage.id ? next : p)) });

  return (
    <div className="space-y-6">
      {/* Tema */}
      <div className="bg-white border border-cream-300 rounded-2xl shadow-warm p-6">
        <h2 className="font-semibold text-ink-900 mb-1">Tema del sito</h2>
        <p className="text-sm text-ink-500 mb-4">Lo stile generale della tua vetrina.</p>
        <ThemePicker value={site.theme} onChange={(theme) => setDraft({ ...site, theme })} />
      </div>

      {/* Pagine */}
      <div className="bg-white border border-cream-300 rounded-2xl shadow-warm p-6">
        <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
          <div>
            <h2 className="font-semibold text-ink-900">Pagine</h2>
            <p className="text-sm text-ink-500">La home e le pagine extra (es. Chi siamo). Seleziona una pagina per modificarne le sezioni.</p>
          </div>
          {profile?.is_approved && profile?.id && (
            <Link
              href={`/store/${profile.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-white border border-cream-300 hover:border-primary-300 text-ink-800 px-4 py-2 rounded-lg text-sm font-semibold shadow-warm-sm shrink-0"
            >
              <ExternalLink size={16} aria-hidden /> Anteprima
            </Link>
          )}
        </div>
        <PageListEditor site={site} activeId={activePage.id} onSelect={setActiveId} onChange={setDraft} />
      </div>

      {/* Sezioni della pagina attiva */}
      <div className="bg-white border border-cream-300 rounded-2xl shadow-warm p-6">
        <h2 className="font-semibold text-ink-900 mb-1">
          Sezioni · <span className="text-primary-700">{activePage.title}</span>
        </h2>
        <p className="text-sm text-ink-500 mb-4">Aggiungi, riordina, mostra/nascondi e configura i blocchi di questa pagina.</p>
        <PageSectionsEditor page={activePage} onChange={setActivePage} />
      </div>

      {/* Menu */}
      <div className="bg-white border border-cream-300 rounded-2xl shadow-warm p-6">
        <h2 className="font-semibold text-ink-900 mb-1">Menu di navigazione</h2>
        <p className="text-sm text-ink-500 mb-4">Collega le pagine del tuo sito con un menu in cima alla vetrina.</p>
        <MenuEditor site={site} onChange={setDraft} />
      </div>

      {/* Salva */}
      <div className="sticky bottom-4 flex justify-end">
        <button
          type="button"
          onClick={() => save.mutate(site)}
          disabled={save.isPending}
          className="inline-flex items-center gap-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white px-6 py-3 rounded-lg font-semibold shadow-warm-sm"
        >
          <Save size={18} aria-hidden /> {save.isPending ? 'Salvataggio…' : 'Salva sito'}
        </button>
      </div>
    </div>
  );
}
