'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Search, Languages, Stethoscope, Loader2, Check, X, AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { apiErrorMessage, friendlyError } from '@/lib/errors';
import type { AttributeField } from '@/lib/category-attributes';
import type {
  ProductChatSnapshot,
  ProductEditPatch,
} from '@/components/seller/ProductChatAssistant';

/**
 * Strumenti AI rapidi per la scheda prodotto: SEO (titolo+tag), traduzione
 * annuncio e diagnosi "perché non vende". Ognuno chiama la sua route, mostra il
 * risultato e — dove c'è — applica un patch allo stato del form via onApplyPatch
 * (human-in-the-loop). Stessa logica di applicazione dell'assistente in chat.
 */

type DiagnoseIssue = { area: string; severity: string; fix: string };
type DiagnoseResult = {
  summary: string;
  score: number | null;
  issues: DiagnoseIssue[];
  patch: ProductEditPatch;
};

type Props = {
  product: ProductChatSnapshot;
  attributeSchema: AttributeField[];
  topCategories: { name: string; slug: string }[];
  imageUrls: string[];
  onApplyPatch: (patch: ProductEditPatch) => string[];
  disabled?: boolean;
};

const LANGS: { code: string; label: string }[] = [
  { code: 'en', label: 'Inglese' },
  { code: 'fr', label: 'Francese' },
  { code: 'de', label: 'Tedesco' },
  { code: 'es', label: 'Spagnolo' },
  { code: 'ro', label: 'Rumeno' },
  { code: 'ar', label: 'Arabo' },
  { code: 'zh', label: 'Cinese' },
];

const SEV_COLOR: Record<string, string> = {
  alta: 'bg-rose-100 text-rose-700',
  media: 'bg-amber-100 text-amber-700',
  bassa: 'bg-cream-200 text-ink-600',
};

export default function QuickAiTools({
  product,
  attributeSchema,
  topCategories,
  imageUrls,
  onApplyPatch,
  disabled = false,
}: Props) {
  const [busy, setBusy] = useState<null | 'seo' | 'translate' | 'diagnose'>(null);
  const [lang, setLang] = useState('en');
  const [diag, setDiag] = useState<DiagnoseResult | null>(null);

  const callAi = async (path: string, extra: Record<string, unknown> = {}) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      toast.error('Sessione scaduta');
      return null;
    }
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ product, attributeSchema, topCategories, imageUrls, ...extra }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(apiErrorMessage(json, 'Errore'));
    return json;
  };

  const runSeo = async () => {
    setBusy('seo');
    try {
      const json = await callAi('/api/ai/seo');
      if (!json) return;
      const changed = json.patch ? onApplyPatch(json.patch) : [];
      toast.success(changed.length ? 'Titolo e tag ottimizzati nel form' : 'Già ottimizzato');
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setBusy(null);
    }
  };

  const runTranslate = async () => {
    setBusy('translate');
    try {
      const json = await callAi('/api/ai/translate', { targetLang: lang });
      if (!json) return;
      const changed = json.patch ? onApplyPatch(json.patch) : [];
      toast.success(changed.length ? 'Annuncio tradotto nel form — controlla e salva' : 'Niente da tradurre');
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setBusy(null);
    }
  };

  const runDiagnose = async () => {
    setBusy('diagnose');
    setDiag(null);
    try {
      const json = await callAi('/api/ai/diagnose');
      if (!json) return;
      setDiag(json as DiagnoseResult);
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setBusy(null);
    }
  };

  const applyDiagnosePatch = () => {
    if (!diag) return;
    const changed = onApplyPatch(diag.patch);
    toast.success(changed.length ? 'Correzioni applicate al form — controlla e salva' : 'Niente da applicare');
    setDiag((d) => (d ? { ...d, patch: {} } : d));
  };

  const hasDiagPatch = !!diag && Object.keys(diag.patch ?? {}).length > 0;

  return (
    <div className="rounded-lg border border-cream-200 bg-cream-50 p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">Strumenti AI</p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void runSeo()}
          disabled={disabled || busy !== null}
          className="inline-flex items-center gap-1.5 rounded-lg border border-cream-300 bg-white px-3 py-2 text-sm font-medium text-ink-700 transition-colors hover:bg-cream-100 disabled:opacity-50"
        >
          {busy === 'seo' ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Search size={15} aria-hidden />}
          Ottimizza per la ricerca
        </button>

        <button
          type="button"
          onClick={() => void runDiagnose()}
          disabled={disabled || busy !== null}
          className="inline-flex items-center gap-1.5 rounded-lg border border-cream-300 bg-white px-3 py-2 text-sm font-medium text-ink-700 transition-colors hover:bg-cream-100 disabled:opacity-50"
        >
          {busy === 'diagnose' ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Stethoscope size={15} aria-hidden />}
          Perché non vende?
        </button>

        <span className="inline-flex items-center gap-1 rounded-lg border border-cream-300 bg-white pl-2">
          <Languages size={15} className="text-ink-400" aria-hidden />
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value)}
            disabled={disabled || busy !== null}
            aria-label="Lingua di traduzione"
            className="bg-transparent py-2 pr-1 text-sm text-ink-700 focus:outline-none"
          >
            {LANGS.map((l) => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void runTranslate()}
            disabled={disabled || busy !== null}
            className="rounded-r-lg px-2.5 py-2 text-sm font-medium text-primary-700 hover:bg-cream-100 disabled:opacity-50"
          >
            {busy === 'translate' ? <Loader2 size={15} className="animate-spin" aria-hidden /> : 'Traduci'}
          </button>
        </span>
      </div>

      {diag && (
        <div className="mt-3 rounded-lg border border-cream-200 bg-white p-3">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm font-semibold text-ink-800">Diagnosi</span>
            <div className="flex items-center gap-2">
              {typeof diag.score === 'number' && (
                <span className="rounded-full bg-cream-100 px-2 py-0.5 text-xs font-semibold text-ink-600">
                  Vendibilità {diag.score}/100
                </span>
              )}
              <button type="button" onClick={() => setDiag(null)} aria-label="Chiudi" className="text-ink-400 hover:text-ink-700">
                <X size={16} aria-hidden />
              </button>
            </div>
          </div>
          {diag.summary && <p className="text-sm text-ink-700">{diag.summary}</p>}
          {diag.issues.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {diag.issues.map((it, i) => (
                <li key={i} className="flex gap-2 text-sm text-ink-700">
                  <span className={`mt-0.5 inline-flex h-fit shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold capitalize ${SEV_COLOR[it.severity] ?? SEV_COLOR.bassa}`}>
                    {it.severity === 'alta' && <AlertTriangle size={11} aria-hidden />}
                    {it.area}
                  </span>
                  <span>{it.fix}</span>
                </li>
              ))}
            </ul>
          )}
          {hasDiagPatch && (
            <button
              type="button"
              onClick={applyDiagnosePatch}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-700"
            >
              <Check size={15} strokeWidth={2.4} aria-hidden /> Applica le correzioni
            </button>
          )}
        </div>
      )}
    </div>
  );
}
