'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, Palette, Trash2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { friendlyError } from '@/lib/errors';
import { queryKeys } from '@/lib/queries/keys';
import { LoadingState } from '@/components/ui/LoadingState';
import { LoadError } from '@/components/admin/LoadError';
import { AdminPageTitle } from '@/components/admin/AdminUI';
import { Input, Textarea, Select, Checkbox } from '@/components/ui/Field';
import {
  normalizeBranding, brandingSchema, wedgeIcon, WEDGE_ICON_KEYS, MAX_WEDGE_ITEMS, type Branding,
} from '@/lib/site-branding';

const ICON_LABELS: Record<string, string> = {
  banknote: 'Banconota', zap: 'Fulmine', mappin: 'Pin mappa', truck: 'Camioncino',
  shield: 'Scudo', tag: 'Etichetta', sparkles: 'Brillantini', gift: 'Regalo',
  heart: 'Cuore', check: 'Spunta', store: 'Negozio', clock: 'Orologio',
};

export default function AdminBrandingPage() {
  const qc = useQueryClient();

  const { data: initial, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.admin.branding,
    queryFn: async (): Promise<Branding> => {
      const { data, error } = await supabase.from('site_settings').select('branding').eq('id', 1).maybeSingle();
      if (error) throw error;
      return normalizeBranding((data as { branding?: unknown } | null)?.branding);
    },
  });

  const [draft, setDraft] = useState<Branding | null>(null);
  const [dirty, setDirty] = useState(false);
  const b = draft ?? initial ?? null;
  const commit = (next: Branding) => { setDraft(next); setDirty(true); };

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const save = useMutation({
    mutationFn: async (next: Branding) => {
      const parsed = brandingSchema.safeParse(next);
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Branding non valido');
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/admin/branding', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ branding: parsed.data }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error?.message ?? 'Errore di salvataggio');
      return json.data.branding as Branding;
    },
    onSuccess: (saved) => {
      setDraft(saved);
      setDirty(false);
      qc.invalidateQueries({ queryKey: queryKeys.admin.branding });
      qc.invalidateQueries({ queryKey: queryKeys.branding.public });
      toast.success('Branding salvato! Le modifiche sono pubbliche.');
    },
    onError: (e: unknown) => toast.error(friendlyError(e)),
  });

  if (error && !draft) return <LoadError onRetry={() => refetch()} hint="Verifica che la migrazione del database 075_site_settings sia applicata." />;
  if (isLoading || !b) return <LoadingState />;

  const items = b.announcement.items;
  const setItems = (next: typeof items) => commit({ ...b, announcement: { ...b.announcement, items: next } });

  return (
    <div className="space-y-6">
      <AdminPageTitle
        eyebrow="Contenuti"
        title="Branding"
        sub="Modifica la barra annunci in cima al sito, il nome (wordmark) e il testo del footer. Le modifiche diventano pubbliche al salvataggio."
      />

      {/* Barra annunci */}
      <section className="bg-white border border-cream-300 rounded-2xl shadow-warm p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-ink-900 text-accent-400">
            <Palette size={20} strokeWidth={2.2} aria-hidden />
          </div>
          <div className="min-w-0">
            <h2 className="font-semibold text-ink-900">Barra annunci</h2>
            <p className="text-sm text-ink-500">La striscia scura in cima al sito (max {MAX_WEDGE_ITEMS} elementi).</p>
          </div>
        </div>

        {/* Anteprima */}
        <div className="rounded-lg bg-ink-900 text-ink-100 text-sm px-4 py-2 flex flex-wrap items-center gap-x-5 gap-y-1">
          {items.map((it, i) => {
            const Icon = wedgeIcon(it.icon);
            return (
              <span key={i} className="inline-flex items-center gap-1.5">
                <Icon size={14} strokeWidth={2.2} className="text-accent-400" aria-hidden />
                <span className="font-medium">{it.text || '…'}</span>
              </span>
            );
          })}
        </div>

        {items.map((it, i) => (
          <div key={i} className="flex items-end gap-2">
            <Select
              label={i === 0 ? 'Icona' : undefined}
              containerClassName="w-40 shrink-0"
              value={it.icon}
              onChange={(e) => setItems(items.map((x, k) => (k === i ? { ...x, icon: e.target.value as typeof x.icon } : x)))}
            >
              {WEDGE_ICON_KEYS.map((k) => <option key={k} value={k}>{ICON_LABELS[k] ?? k}</option>)}
            </Select>
            <Input
              label={i === 0 ? 'Testo' : undefined}
              containerClassName="flex-1"
              value={it.text}
              maxLength={60}
              onChange={(e) => setItems(items.map((x, k) => (k === i ? { ...x, text: e.target.value } : x)))}
            />
            <button type="button" onClick={() => setItems(items.filter((_, k) => k !== i))} aria-label="Rimuovi elemento" className="mb-1 p-2 text-ink-400 hover:text-secondary-600">
              <Trash2 size={16} aria-hidden />
            </button>
          </div>
        ))}
        {items.length < MAX_WEDGE_ITEMS && (
          <button type="button" onClick={() => setItems([...items, { icon: 'tag', text: '' }])} className="inline-flex items-center gap-2 text-sm font-semibold text-primary-700 hover:underline">
            <Plus size={15} aria-hidden /> Aggiungi elemento
          </button>
        )}

        <Checkbox
          label="Mostra il link “Promozioni attive” quando ci sono promozioni in corso"
          checked={b.announcement.promoLinkEnabled}
          onChange={(e) => commit({ ...b, announcement: { ...b.announcement, promoLinkEnabled: e.target.checked } })}
        />
      </section>

      {/* Wordmark + footer */}
      <section className="bg-white border border-cream-300 rounded-2xl shadow-warm p-6 space-y-4">
        <h2 className="font-semibold text-ink-900">Nome del marketplace (wordmark)</h2>
        <p className="text-sm text-ink-500 -mt-2">
          Anteprima: <span className="font-serif font-bold text-lg"><span className="text-primary-700">{b.wordmark.accent}</span>{b.wordmark.rest}</span>
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Parte evidenziata" value={b.wordmark.accent} maxLength={20} onChange={(e) => commit({ ...b, wordmark: { ...b.wordmark, accent: e.target.value } })} />
          <Input label="Resto" value={b.wordmark.rest} maxLength={20} onChange={(e) => commit({ ...b, wordmark: { ...b.wordmark, rest: e.target.value } })} />
        </div>
        <Textarea label="Testo del footer" value={b.footerTagline} rows={2} maxLength={220} onChange={(e) => commit({ ...b, footerTagline: e.target.value })} />
      </section>

      <div className="sticky z-30 flex justify-end bottom-[calc(5rem+env(safe-area-inset-bottom))] md:bottom-4">
        <div className="flex flex-col items-end gap-2 mr-16 md:mr-0">
          {dirty && (
            <span className="text-xs font-semibold text-accent-800 bg-accent-50 border border-accent-200 rounded-full px-3 py-1.5 shadow-warm-sm">
              Modifiche non salvate
            </span>
          )}
          <button type="button" onClick={() => save.mutate(b)} disabled={save.isPending} className="inline-flex items-center gap-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white px-6 py-3 rounded-lg font-semibold shadow-warm-sm">
            <Save size={18} aria-hidden /> {save.isPending ? 'Salvataggio…' : 'Salva'}
          </button>
        </div>
      </div>
    </div>
  );
}
