'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Save, ExternalLink, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { friendlyError } from '@/lib/errors';
import { LoadingState } from '@/components/ui/LoadingState';
import { LoadError } from '@/components/admin/LoadError';
import { Input, Select } from '@/components/ui/Field';
import HomeSectionsEditor from '@/components/admin/home/HomeSectionsEditor';
import { cmsPageSchema, cmsPageLabel, CMS_PAGES, type CmsPage } from '@/lib/cms-page';
import type { HomeSection } from '@/lib/home-site';

/** Editor di una pagina statica (CMS) a blocchi di contenuto. */
export default function AdminCmsPageEditor() {
  const slug = String(useParams().slug ?? '');
  const known = CMS_PAGES.find((p) => p.slug === slug);
  const qc = useQueryClient();

  const { data: initial, isLoading, error, refetch } = useQuery({
    queryKey: ['admin', 'cms', slug],
    enabled: !!slug,
    queryFn: async (): Promise<CmsPage> => {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/admin/cms/${slug}`, {
        headers: { ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error?.message ?? 'Errore di caricamento');
      return json.data.page as CmsPage;
    },
  });

  const [draft, setDraft] = useState<CmsPage | null>(null);
  const [dirty, setDirty] = useState(false);
  const page = draft ?? initial ?? null;
  const commit = (next: CmsPage) => { setDraft(next); setDirty(true); };

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const save = useMutation({
    mutationFn: async (next: CmsPage) => {
      const parsed = cmsPageSchema.safeParse(next);
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Pagina non valida');
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/admin/cms/${slug}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ page: parsed.data }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error?.message ?? 'Errore di salvataggio');
      return json.data.page as CmsPage;
    },
    onSuccess: (saved) => {
      setDraft(saved);
      setDirty(false);
      qc.invalidateQueries({ queryKey: ['admin', 'cms', slug] });
      toast.success(saved.status === 'published' ? 'Pagina pubblicata!' : 'Bozza salvata.');
    },
    onError: (e: unknown) => toast.error(friendlyError(e)),
  });

  if (!known) {
    return <p className="text-sm text-ink-500">Pagina non gestita.</p>;
  }
  if (error && !draft) return <LoadError onRetry={() => refetch()} hint="Verifica che la migrazione del database 077_cms_pages sia applicata." />;
  if (isLoading || !page) return <LoadingState />;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/admin/pages" className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-primary-700 transition-colors">
            <ArrowLeft size={15} aria-hidden /> Pagine
          </Link>
          <h1 className="font-serif text-2xl sm:text-3xl font-bold text-ink-900 mt-1 flex items-center gap-2">
            <FileText size={22} className="text-primary-700" strokeWidth={2.2} /> {cmsPageLabel(slug)}
          </h1>
          <p className="text-sm text-ink-500 mt-1">
            Componi la pagina a blocchi. Pubblica per sostituire il contenuto predefinito; salva come bozza per non pubblicarla ancora.
          </p>
        </div>
        <Link href={known.route} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 bg-white border border-cream-300 hover:border-primary-300 text-ink-800 px-4 py-2.5 rounded-xl text-sm font-semibold shadow-warm-sm shrink-0 transition-colors">
          <ExternalLink size={16} aria-hidden /> Vedi pagina
        </Link>
      </header>

      <section className="bg-white border border-cream-300 rounded-2xl shadow-warm p-6 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_200px] gap-3">
          <Input label="Titolo della pagina" value={page.title} maxLength={80} onChange={(e) => commit({ ...page, title: e.target.value })} />
          <Select label="Stato" value={page.status} onChange={(e) => commit({ ...page, status: e.target.value as 'draft' | 'published' })}>
            <option value="draft">Bozza (non pubblicata)</option>
            <option value="published">Pubblicata</option>
          </Select>
        </div>
        <HomeSectionsEditor
          sections={page.sections as HomeSection[]}
          groups={['contenuto']}
          onChange={(next) => commit({ ...page, sections: next })}
        />
      </section>

      <div className="sticky z-30 flex justify-end bottom-[calc(5rem+env(safe-area-inset-bottom))] md:bottom-4">
        <div className="flex flex-col items-end gap-2 mr-16 md:mr-0">
          {dirty && (
            <span className="text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-full px-3 py-1.5 shadow-warm-sm">
              Modifiche non salvate
            </span>
          )}
          <button type="button" onClick={() => save.mutate(page)} disabled={save.isPending} className="inline-flex items-center gap-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white px-6 py-3 rounded-lg font-semibold shadow-warm-sm">
            <Save size={18} aria-hidden /> {save.isPending ? 'Salvataggio…' : 'Salva'}
          </button>
        </div>
      </div>
    </div>
  );
}
