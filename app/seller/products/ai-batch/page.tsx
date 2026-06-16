'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Sparkles, Loader2, Wand2, FileText, ShieldCheck, Languages, ArrowLeft, Check } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { apiErrorMessage, friendlyError } from '@/lib/errors';
import CatalogCopilot from '@/components/seller/CatalogCopilot';

/**
 * Operazioni AI su TUTTO il catalogo (Batch API, asincrona, -50%). Il venditore
 * sceglie l'operazione, avvia il job, il polling segue lo stato e — a risultati
 * pronti — può applicare in blocco. Human-in-the-loop: si applica solo dopo aver
 * visto quanti prodotti verrebbero toccati.
 */

type Operation = 'improve' | 'redescribe' | 'moderate' | 'translate';

type JobResult = {
  product_id: string;
  patch?: Record<string, unknown>;
  summary?: string;
  flagged?: boolean;
  reason?: string;
};
type Job = {
  id: string;
  operation: Operation;
  status: 'processing' | 'ready' | 'applied' | 'error' | 'canceled';
  total: number;
  targetLang: string | null;
  results: JobResult[];
  counts: { total: number; withChanges: number };
};

const OPS: { key: Operation; label: string; desc: string; icon: typeof Wand2 }[] = [
  { key: 'improve', label: 'Migliora tutto', desc: 'Ottimizza nome, descrizione, tag e attributi di ogni prodotto.', icon: Wand2 },
  { key: 'redescribe', label: 'Ri-descrivi', desc: 'Riscrive tutte le descrizioni con un tono coerente.', icon: FileText },
  { key: 'moderate', label: 'Modera', desc: 'Controlla la conformità di tutto il catalogo e segnala i prodotti a rischio.', icon: ShieldCheck },
  { key: 'translate', label: 'Traduci', desc: 'Traduce nome, descrizione e tag in un\'altra lingua.', icon: Languages },
];
const LANGS = [
  { code: 'en', label: 'Inglese' }, { code: 'fr', label: 'Francese' }, { code: 'de', label: 'Tedesco' },
  { code: 'es', label: 'Spagnolo' }, { code: 'ro', label: 'Rumeno' }, { code: 'ar', label: 'Arabo' }, { code: 'zh', label: 'Cinese' },
];

async function authedFetch(path: string, init?: RequestInit) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Sessione scaduta');
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${session.access_token}`, ...(init?.headers ?? {}) },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(apiErrorMessage(json, 'Errore'));
  return json;
}

export default function CatalogAiBatchPage() {
  const [operation, setOperation] = useState<Operation>('improve');
  const [lang, setLang] = useState('en');
  const [job, setJob] = useState<Job | null>(null);
  const [starting, setStarting] = useState(false);
  const [applying, setApplying] = useState(false);

  const poll = useCallback(async (jobId: string) => {
    try {
      const data = (await authedFetch(`/api/ai/catalog-batch/status?jobId=${encodeURIComponent(jobId)}`)) as Job;
      setJob(data);
    } catch { /* riprova al prossimo tick */ }
  }, []);

  // Polling mentre il job è in lavorazione.
  useEffect(() => {
    if (!job || job.status !== 'processing') return;
    const id = setInterval(() => void poll(job.id), 5000);
    return () => clearInterval(id);
  }, [job, poll]);

  const start = async () => {
    setStarting(true);
    setJob(null);
    try {
      const data = await authedFetch('/api/ai/catalog-batch/start', {
        method: 'POST',
        body: JSON.stringify({ operation, ...(operation === 'translate' ? { targetLang: lang } : {}) }),
      });
      toast.success(`Job avviato su ${data.total} prodotti. Può volerci qualche minuto.`);
      setJob({ id: data.jobId, operation, status: 'processing', total: data.total, targetLang: operation === 'translate' ? lang : null, results: [], counts: { total: 0, withChanges: 0 } });
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setStarting(false);
    }
  };

  const apply = async () => {
    if (!job) return;
    setApplying(true);
    try {
      const data = await authedFetch('/api/ai/catalog-batch/apply', { method: 'POST', body: JSON.stringify({ jobId: job.id }) });
      toast.success(`Applicato a ${data.applied} prodotti.`);
      setJob({ ...job, status: 'applied' });
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setApplying(false);
    }
  };

  const isModerate = job?.operation === 'moderate';
  const actionLabel = isModerate ? 'Metti in bozza i segnalati' : 'Applica a tutti';

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Link href="/seller/products" className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-700">
          <ArrowLeft size={15} aria-hidden /> Torna ai prodotti
        </Link>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold">
          <Sparkles size={22} className="text-primary-600" aria-hidden /> AI su tutto il catalogo
        </h1>
        <p className="text-sm text-ink-500">
          Lavora su tutti i tuoi prodotti in un colpo solo. Il job gira in background (anche qualche minuto):
          quando è pronto rivedi e applichi.
        </p>
      </div>

      {/* Scelta operazione */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {OPS.map((o) => {
          const Icon = o.icon;
          const active = operation === o.key;
          return (
            <button
              key={o.key}
              type="button"
              onClick={() => setOperation(o.key)}
              disabled={job?.status === 'processing'}
              className={`rounded-lg border p-3 text-left transition-colors disabled:opacity-50 ${
                active ? 'border-primary-400 bg-primary-50' : 'border-cream-200 bg-white hover:bg-cream-50'
              }`}
            >
              <span className="flex items-center gap-2 font-semibold text-ink-800">
                <Icon size={16} className="text-primary-600" aria-hidden /> {o.label}
              </span>
              <span className="mt-0.5 block text-xs text-ink-500">{o.desc}</span>
            </button>
          );
        })}
      </div>

      {operation === 'translate' && (
        <label className="flex items-center gap-2 text-sm text-ink-700">
          Lingua di destinazione:
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value)}
            disabled={job?.status === 'processing'}
            className="rounded-lg border border-cream-300 px-2 py-1.5 text-sm focus:outline-none"
          >
            {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </label>
      )}

      {(!job || job.status === 'applied') && (
        <button
          type="button"
          onClick={() => void start()}
          disabled={starting}
          className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 font-semibold text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
        >
          {starting ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <Sparkles size={18} aria-hidden />}
          Avvia sul catalogo
        </button>
      )}

      {/* Stato job */}
      {job && job.status === 'processing' && (
        <div className="flex items-center gap-3 rounded-lg border border-cream-200 bg-cream-50 p-4 text-sm text-ink-600">
          <Loader2 size={18} className="animate-spin" aria-hidden />
          <span>Sto elaborando {job.total} prodotti… puoi lasciare aperta questa pagina o tornare più tardi.</span>
        </div>
      )}

      {job && (job.status === 'ready' || job.status === 'applied') && (
        <div className="rounded-lg border border-cream-200 bg-white p-4 shadow-warm">
          <p className="text-sm font-semibold text-ink-800">
            {isModerate
              ? `${job.results.filter((r) => r.flagged).length} prodotti segnalati su ${job.counts.total}`
              : `${job.counts.withChanges} prodotti con modifiche su ${job.counts.total}`}
          </p>
          <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto text-sm text-ink-600">
            {job.results.slice(0, 50).map((r) => (
              <li key={r.product_id} className="flex gap-2 border-b border-cream-100 py-1 last:border-0">
                {isModerate ? (
                  r.flagged
                    ? <span className="text-rose-600">⚠︎ {r.reason ?? 'Da rivedere'}</span>
                    : <span className="text-emerald-600">✓ ok</span>
                ) : (
                  <span>{r.summary ?? (r.patch && Object.keys(r.patch).length ? 'Modifiche proposte' : 'Nessuna modifica')}</span>
                )}
              </li>
            ))}
          </ul>

          {job.status === 'ready' && (
            <button
              type="button"
              onClick={() => void apply()}
              disabled={applying}
              className="mt-3 inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-semibold text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
            >
              {applying ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Check size={16} strokeWidth={2.4} aria-hidden />}
              {actionLabel}
            </button>
          )}
          {job.status === 'applied' && (
            <p className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-600">
              <Check size={16} strokeWidth={2.6} aria-hidden /> Applicato.
            </p>
          )}
        </div>
      )}

      <div className="border-t border-cream-200 pt-6">
        <CatalogCopilot />
      </div>
    </div>
  );
}
