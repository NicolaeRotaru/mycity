'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Save, Store, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { friendlyError } from '@/lib/errors';
import { queryKeys } from '@/lib/queries/keys';
import { LoadingState } from '@/components/ui/LoadingState';
import { normalizeSite, storeSiteSchema, type StoreSite, type SitePage } from '@/lib/store-site';
import ThemePicker from './ThemePicker';
import PageListEditor from './PageListEditor';
import PageEditor from './PageEditor';
import StoreDetailsEditor from './StoreDetailsEditor';
import MenuEditor from './MenuEditor';

/**
 * Editor del sito vetrina a SCHERMATE separate:
 *  - Panoramica: tema, lista pagine (apri/aggiungi/riordina/visibilità/elimina), menu.
 *  - Pagina: si "entra" in una pagina (freccia indietro reale) per modificarne
 *    impostazioni e sezioni.
 *
 * La schermata attiva è guidata dal query param `?page=<id>`: così il tasto
 * indietro del browser/telefono torna naturalmente alla panoramica. Tutte le
 * modifiche restano in un'unica bozza locale (`draft`) e si pubblicano con
 * "Salva sito" (PUT /api/seller/site). Dopo il salvataggio si torna alla
 * panoramica; un guard `beforeunload` avvisa se si lascia l'editor con modifiche
 * non salvate.
 */
export default function SiteEditor() {
  const qc = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const editingId = searchParams.get('page');
  const showDetails = searchParams.get('details') === '1';

  // select('*'): servono store_site + le colonne vetrina (logo, nome, contatti, orari,
  // personalizzazione) per la schermata "Dettagli negozio". Stessa shape e stessa
  // queryKey della pagina /seller/profile, così la cache resta coerente.
  const { data: profile, isLoading } = useQuery({
    queryKey: queryKeys.seller.profile,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();
      if (error) throw error;
      return data;
    },
  });

  const initial = useMemo(() => (profile ? normalizeSite(profile.store_site) : null), [profile]);
  const [draft, setDraft] = useState<StoreSite | null>(null);
  // dirty = bozza modificata ma non ancora salvata (guida l'avviso "uscire senza salvare?").
  const [dirty, setDirty] = useState(false);
  const site = draft ?? initial;

  // Ogni modifica dei sub-editor passa di qui: aggiorna la bozza e segna "non salvato".
  const commit = (next: StoreSite) => {
    setDraft(next);
    setDirty(true);
  };

  // Avviso del browser se si esce (refresh/chiusura/navigazione esterna) con
  // modifiche non salvate, per non perdere la bozza non ancora pubblicata.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

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
      setDirty(false);
      qc.invalidateQueries({ queryKey: queryKeys.seller.profile });
      if (profile?.id) qc.invalidateQueries({ queryKey: queryKeys.stores.detail(profile.id) });
      toast.success('Sito salvato!');
      router.push(pathname); // torna alla panoramica
      if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    onError: (e: unknown) => toast.error(friendlyError(e)),
  });

  if (isLoading || !site) return <LoadingState />;

  const openPage = (id: string) => router.push(`${pathname}?page=${encodeURIComponent(id)}`);
  const openDetails = () => router.push(`${pathname}?details=1`);
  const backToOverview = () => router.push(pathname);
  const editing = editingId ? site.pages.find((p) => p.id === editingId) : undefined;

  const setEditingPage = (next: SitePage) =>
    commit({ ...site, pages: site.pages.map((p) => (p.id === next.id ? next : p)) });

  const saveBar = (
    <div className="sticky z-20 flex items-center justify-end gap-3 bottom-[calc(5rem+env(safe-area-inset-bottom))] md:bottom-4">
      {dirty && (
        <span className="text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-full px-3 py-1.5 shadow-warm-sm">
          Modifiche non salvate
        </span>
      )}
      <button
        type="button"
        onClick={() => save.mutate(site)}
        disabled={save.isPending}
        className="inline-flex items-center gap-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white px-6 py-3 rounded-lg font-semibold shadow-warm-sm"
      >
        <Save size={18} aria-hidden /> {save.isPending ? 'Salvataggio…' : 'Salva sito'}
      </button>
    </div>
  );

  // ---- Schermata: dettagli negozio (logo, nome, contatti, orari, aspetto) ----
  // Ha un proprio salvataggio (VendorForm), quindi niente saveBar del sito.
  if (showDetails && profile) {
    return (
      <div className="space-y-6">
        <StoreDetailsEditor profile={profile} onBack={backToOverview} />
      </div>
    );
  }

  // ---- Schermata: editor di una pagina ----
  if (editing) {
    return (
      <div className="space-y-6">
        <PageEditor site={site} page={editing} onChange={setEditingPage} onBack={backToOverview} />
        {saveBar}
      </div>
    );
  }

  // ---- Schermata: panoramica ----
  return (
    <div className="space-y-6">
      {/* Dettagli negozio: logo, nome, copertina, descrizione, contatti, orari, aspetto */}
      <button
        type="button"
        onClick={openDetails}
        className="w-full text-left bg-white border border-cream-300 rounded-2xl shadow-warm p-6 hover:border-primary-300 transition-colors"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <Store size={20} className="text-primary-600 shrink-0 mt-0.5" aria-hidden />
            <div className="min-w-0">
              <h2 className="font-semibold text-ink-900">Dettagli negozio</h2>
              <p className="text-sm text-ink-500">Logo, nome, copertina, descrizione e aspetto della vetrina.</p>
            </div>
          </div>
          <ChevronRight size={20} className="text-ink-400 shrink-0" aria-hidden />
        </div>
      </button>

      {/* Tema */}
      <div className="bg-white border border-cream-300 rounded-2xl shadow-warm p-6">
        <h2 className="font-semibold text-ink-900 mb-1">Tema del sito</h2>
        <p className="text-sm text-ink-500 mb-4">Lo stile generale della tua vetrina.</p>
        <ThemePicker value={site.theme} onChange={(theme) => commit({ ...site, theme })} />
      </div>

      {/* Pagine */}
      <div className="bg-white border border-cream-300 rounded-2xl shadow-warm p-6">
        <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
          <div>
            <h2 className="font-semibold text-ink-900">Pagine</h2>
            <p className="text-sm text-ink-500">La home e le pagine extra (es. Chi siamo). Tocca una pagina per modificarne impostazioni e sezioni.</p>
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
        <PageListEditor site={site} onChange={commit} onOpen={openPage} />
      </div>

      {/* Menu */}
      <div className="bg-white border border-cream-300 rounded-2xl shadow-warm p-6">
        <h2 className="font-semibold text-ink-900 mb-1">Menu di navigazione</h2>
        <p className="text-sm text-ink-500 mb-4">Collega le pagine del tuo sito con un menu in cima alla vetrina.</p>
        <MenuEditor site={site} onChange={commit} />
      </div>

      {saveBar}
    </div>
  );
}
