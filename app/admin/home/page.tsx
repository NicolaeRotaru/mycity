'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Save, ArrowLeft, LayoutTemplate, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { friendlyError } from '@/lib/errors';
import { queryKeys } from '@/lib/queries/keys';
import { LoadingState } from '@/components/ui/LoadingState';
import { LoadError } from '@/components/admin/LoadError';
import { normalizeHomeSite, homeSiteSchema, type HomeSite } from '@/lib/home-site';
import HomeSectionsEditor from '@/components/admin/home/HomeSectionsEditor';

/**
 * Home builder admin — compone la home pubblica del marketplace come lista ordinata
 * di sezioni (logica "Shopify", sul modello dell'editor vetrina dei negozi). Carica
 * la home EFFETTIVA (vuota => default = layout attuale), tiene le modifiche in una
 * bozza locale e le pubblica con "Salva" (PUT /api/admin/home). Un guard
 * `beforeunload` avvisa se si esce con modifiche non salvate.
 */

/** Rimuove elementi incompleti che la validazione rifiuterebbe (es. immagini galleria vuote). */
function prepareForSave(site: HomeSite): HomeSite {
  return {
    ...site,
    sections: site.sections.map((s) =>
      s.type === 'gallery'
        ? { ...s, config: { ...s.config, items: (s.config.items ?? []).filter((it) => it.url.trim()) } }
        : s,
    ),
  };
}

export default function AdminHomePage() {
  const qc = useQueryClient();

  const { data: initial, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.admin.home,
    queryFn: async () => {
      const { data, error } = await supabase.from('site_settings').select('home_site').eq('id', 1).maybeSingle();
      if (error) throw error;
      return normalizeHomeSite((data as { home_site?: unknown } | null)?.home_site);
    },
  });

  const [draft, setDraft] = useState<HomeSite | null>(null);
  const [dirty, setDirty] = useState(false);
  // Ultima versione persistita (caricata o salvata): base per "Annulla modifiche".
  const [baseline, setBaseline] = useState<HomeSite | null>(null);
  const site = draft ?? initial ?? null;

  const commit = (next: HomeSite) => { setDraft(next); setDirty(true); };
  const revert = () => { setDraft(baseline); setDirty(false); };

  // Inizializza la baseline al primo caricamento della home.
  useEffect(() => { if (initial && !baseline) setBaseline(initial); }, [initial, baseline]);

  // Avviso del browser se si esce con modifiche non salvate.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const save = useMutation({
    mutationFn: async (next: HomeSite) => {
      const cleaned = prepareForSave(next);
      const parsed = homeSiteSchema.safeParse(cleaned);
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Home non valida');
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/admin/home', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ site: parsed.data }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error?.message ?? 'Errore di salvataggio');
      return json.data.site as HomeSite;
    },
    onSuccess: (saved) => {
      setDraft(saved);
      setBaseline(saved);
      setDirty(false);
      qc.invalidateQueries({ queryKey: queryKeys.admin.home });
      toast.success('Home salvata! Le modifiche sono pubbliche.');
      if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    onError: (e: unknown) => toast.error(friendlyError(e)),
  });

  if (error && !draft) return <LoadError onRetry={() => refetch()} hint="Verifica che la migrazione del database 075_site_settings sia applicata." />;
  if (isLoading || !site) return <LoadingState />;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/admin" className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-primary-700 transition-colors">
            <ArrowLeft size={15} aria-hidden /> Dashboard admin
          </Link>
          <h1 className="font-serif text-2xl sm:text-3xl font-bold text-ink-900 mt-1">Home builder</h1>
          <p className="text-sm text-ink-500 mt-1 max-w-xl">
            Componi la home pubblica del marketplace: riordina le sezioni, mostrale o nascondile,
            modifica i testi e aggiungi blocchi. Le modifiche diventano pubbliche quando premi{' '}
            <span className="font-semibold text-ink-700">Salva</span>.
          </p>
        </div>
        <Link
          href="/"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 bg-white border border-cream-300 hover:border-primary-300 text-ink-800 px-4 py-2.5 rounded-xl text-sm font-semibold shadow-warm-sm shrink-0 transition-colors"
        >
          <ExternalLink size={16} aria-hidden /> Vedi home
        </Link>
      </header>

      <section className="bg-white border border-cream-300 rounded-2xl shadow-warm p-6">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-primary-100 text-primary-700">
            <LayoutTemplate size={20} strokeWidth={2.2} aria-hidden />
          </div>
          <div className="min-w-0">
            <h2 className="font-semibold text-ink-900">Sezioni della home</h2>
            <p className="text-sm text-ink-500">Usa le frecce per riordinare. Tocca una sezione per modificarne i contenuti.</p>
          </div>
        </div>
        <HomeSectionsEditor sections={site.sections} onChange={(next) => commit({ ...site, sections: next })} />
      </section>

      {/* Barra di salvataggio sticky (stesso pattern dell'editor vetrina). */}
      <div className="sticky z-30 flex justify-end bottom-[calc(5rem+env(safe-area-inset-bottom))] md:bottom-4">
        <div className="flex flex-col items-end gap-2 mr-16 md:mr-0">
          {dirty && (
            <span className="text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-full px-3 py-1.5 shadow-warm-sm">
              Modifiche non salvate
            </span>
          )}
          <div className="flex items-center gap-2">
            {dirty && (
              <button
                type="button"
                onClick={revert}
                disabled={save.isPending}
                className="inline-flex items-center gap-2 bg-white border border-cream-300 hover:border-ink-300 disabled:opacity-50 text-ink-700 px-4 py-3 rounded-lg font-semibold shadow-warm-sm"
              >
                <Undo2 size={18} aria-hidden /> Annulla modifiche
              </button>
            )}
            <button
              type="button"
              onClick={() => save.mutate(site)}
              disabled={save.isPending}
              className="inline-flex items-center gap-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white px-6 py-3 rounded-lg font-semibold shadow-warm-sm"
            >
              <Save size={18} aria-hidden /> {save.isPending ? 'Salvataggio…' : 'Salva'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
