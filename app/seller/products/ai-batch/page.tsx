'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  Sparkles, Loader2, Wand2, FileText, ShieldCheck, Languages, Check, AlertTriangle,
  Mic, Camera, ScanBarcode, Link2, type LucideIcon,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { apiErrorMessage, friendlyError } from '@/lib/errors';
import CatalogCopilot from '@/components/seller/CatalogCopilot';
import SellerPageTitle from '@/components/seller/SellerPageTitle';
import { Card } from '@/components/ui/Card';
import { Select } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';

/**
 * AI Studio — tre modi per lavorare col catalogo con l'intelligenza artificiale:
 *  - "Crea con AI": entrate verso il flusso reale di creazione (voce/foto/barcode/link)
 *    che vive in /seller/products/new (gli strumenti AI sono lì, sul form prodotto).
 *  - "Catalogo AI": operazioni in blocco su TUTTO il catalogo via Batch API
 *    (improve/redescribe/moderate/translate). Human-in-the-loop: si applica solo
 *    dopo l'anteprima.
 *  - "Copilot": comando in linguaggio naturale sull'intero catalogo.
 *
 * Tutte le chiamate AI esistenti (/api/ai/catalog-batch/*, /api/ai/copilot,
 * /api/ai/catalog-apply via CatalogCopilot) restano invariate.
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

const OPS: { key: Operation; label: string; desc: string; icon: LucideIcon }[] = [
  { key: 'improve', label: 'Migliora tutto', desc: 'Ottimizza nome, descrizione, tag e attributi di ogni prodotto.', icon: Wand2 },
  { key: 'redescribe', label: 'Ri-descrivi', desc: 'Riscrive tutte le descrizioni con un tono coerente.', icon: FileText },
  { key: 'moderate', label: 'Modera', desc: 'Controlla la conformità di tutto il catalogo e segnala i prodotti a rischio.', icon: ShieldCheck },
  { key: 'translate', label: 'Traduci', desc: 'Traduce nome, descrizione e tag in un\'altra lingua.', icon: Languages },
];
const LANGS = [
  { code: 'en', label: 'Inglese' }, { code: 'fr', label: 'Francese' }, { code: 'de', label: 'Tedesco' },
  { code: 'es', label: 'Spagnolo' }, { code: 'ro', label: 'Rumeno' }, { code: 'ar', label: 'Arabo' }, { code: 'zh', label: 'Cinese' },
];

type Tab = 'crea' | 'catalogo' | 'copilot';
const TABS: { key: Tab; label: string }[] = [
  { key: 'crea', label: 'Crea con AI' },
  { key: 'catalogo', label: 'Catalogo AI' },
  { key: 'copilot', label: 'Copilot' },
];

// Le 4 modalità di creazione: l'AI compila la scheda, tu confermi. Tutte aprono
// il flusso reale di creazione prodotto, dove vivono gli strumenti AI sul form.
type CreateTone = 'primary' | 'accent' | 'olive' | 'secondary';
const CREATE_METHODS: { id: string; icon: LucideIcon; title: string; desc: string; tone: CreateTone; href: string }[] = [
  { id: 'voice', icon: Mic, title: 'Da voce', desc: 'Detta il prodotto a voce: l\'AI compila nome, prezzo e descrizione.', tone: 'primary', href: '/seller/products/new' },
  { id: 'photo', icon: Camera, title: 'Da foto', desc: 'Carica una foto: riconosce il prodotto e crea la scheda.', tone: 'accent', href: '/seller/products/new' },
  { id: 'barcode', icon: ScanBarcode, title: 'Da barcode', desc: 'Inquadra il codice a barre e recupera i dati del prodotto.', tone: 'olive', href: '/seller/products/new' },
  { id: 'url', icon: Link2, title: 'Da link', desc: 'Incolla un URL e importa nome, foto e attributi.', tone: 'secondary', href: '/seller/products/new' },
];
const TONE: Record<CreateTone, string> = {
  primary:   'bg-primary-100 text-primary-700',
  accent:    'bg-accent-100 text-accent-700',
  olive:     'bg-olive-100 text-olive-700',
  secondary: 'bg-secondary-100 text-secondary-600',
};

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
  const [tab, setTab] = useState<Tab>('crea');

  return (
    <div>
      <SellerPageTitle
        eyebrow="Intelligenza artificiale"
        title="AI Studio"
        sub="Crea schede prodotto e lavora su tutto il catalogo con l'intelligenza artificiale"
        action={
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-50 px-3 py-1.5 text-xs font-bold text-primary-700 ring-1 ring-inset ring-primary-200">
            <Sparkles size={14} aria-hidden /> Powered by AI
          </span>
        }
      />

      {/* Tab */}
      <div className="mb-6 flex gap-1 border-b border-cream-300">
        {TABS.map((t) => {
          const on = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              aria-current={on ? 'true' : undefined}
              className={`-mb-px border-b-2 px-4 py-2.5 text-sm transition-colors ${
                on
                  ? 'border-primary-600 font-bold text-primary-700'
                  : 'border-transparent font-medium text-ink-500 hover:text-ink-700'
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'crea' && <CreateTab />}
      {tab === 'catalogo' && <CatalogTab />}
      {tab === 'copilot' && (
        <div className="max-w-2xl">
          <CatalogCopilot />
        </div>
      )}
    </div>
  );
}

/* ---------------- Tab 1: crea con AI (entrate verso il form reale) ---------------- */
function CreateTab() {
  return (
    <div className="max-w-3xl space-y-4">
      <p className="text-sm text-ink-600">
        Scegli da dove partire: l&apos;AI compila la scheda, tu controlli e pubblichi.
      </p>
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        {CREATE_METHODS.map((m) => {
          const Icon = m.icon;
          return (
            <Link
              key={m.id}
              href={m.href}
              className="flex gap-3.5 rounded-xl border border-cream-300 bg-white p-[18px] transition-all hover:border-primary-300 hover:shadow-warm"
            >
              <span className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-md ${TONE[m.tone]}`}>
                <Icon size={22} strokeWidth={2.2} aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="font-bold text-ink-900">{m.title}</p>
                <p className="mt-0.5 text-[13px] leading-snug text-ink-500">{m.desc}</p>
              </div>
            </Link>
          );
        })}
      </div>
      <p className="text-xs text-ink-400">
        Gli strumenti AI per la singola scheda (voce, foto, import da link, ottimizza per la ricerca,
        traduci, &laquo;perché non vende?&raquo;) sono disponibili nel form prodotto.
      </p>
    </div>
  );
}

/* ---------------- Tab 2: operazioni AI su tutto il catalogo (batch) ---------------- */
function CatalogTab() {
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
      <p className="text-sm leading-relaxed text-ink-600">
        Lavora su <strong>tutti</strong> i tuoi prodotti in un colpo solo. Il job gira in background
        (anche qualche minuto): quando è pronto rivedi e applichi.{' '}
        <span className="text-ink-400">(Human-in-the-loop: applichi solo dopo l&apos;anteprima.)</span>
      </p>

      {/* Scelta operazione */}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {OPS.map((o) => {
          const Icon = o.icon;
          const active = operation === o.key;
          return (
            <button
              key={o.key}
              type="button"
              onClick={() => { setOperation(o.key); setJob(null); }}
              disabled={job?.status === 'processing'}
              className={`rounded-xl border p-3.5 text-left transition-colors disabled:opacity-50 ${
                active ? 'border-primary-400 bg-primary-50' : 'border-cream-300 bg-white hover:bg-cream-50'
              }`}
            >
              <span className="flex items-center gap-2 font-bold text-ink-800">
                <Icon size={16} className="text-primary-600" aria-hidden /> {o.label}
              </span>
              <span className="mt-1 block text-xs leading-snug text-ink-500">{o.desc}</span>
            </button>
          );
        })}
      </div>

      {operation === 'translate' && (
        <div className="max-w-[280px]">
          <Select
            label="Lingua di destinazione"
            value={lang}
            onChange={(e) => setLang(e.target.value)}
            disabled={job?.status === 'processing'}
          >
            {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </Select>
        </div>
      )}

      {(!job || job.status === 'applied') && (
        <Button size="lg" icon={Sparkles} loading={starting} onClick={() => void start()}>
          Avvia sul catalogo
        </Button>
      )}

      {/* Stato job */}
      {job && job.status === 'processing' && (
        <div className="flex items-center gap-3 rounded-xl border border-cream-200 bg-cream-50 p-4 text-sm text-ink-600">
          <Loader2 size={18} className="animate-spin" aria-hidden />
          <span>Sto elaborando {job.total} prodotti… puoi lasciare aperta questa pagina o tornare più tardi.</span>
        </div>
      )}

      {job && (job.status === 'ready' || job.status === 'applied') && (
        <Card variant="elevated" padding="lg">
          <p className="text-sm font-bold text-ink-800">
            {isModerate
              ? `${job.results.filter((r) => r.flagged).length} prodotti segnalati su ${job.counts.total}`
              : `${job.counts.withChanges} prodotti con modifiche su ${job.counts.total}`}
          </p>
          <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto text-sm text-ink-600">
            {job.results.slice(0, 50).map((r) => (
              <li key={r.product_id} className="flex gap-2 border-b border-cream-100 py-1 last:border-0">
                {isModerate ? (
                  r.flagged
                    ? <span className="inline-flex items-center gap-1.5 text-secondary-600"><AlertTriangle size={14} aria-hidden /> {r.reason ?? 'Da rivedere'}</span>
                    : <span className="inline-flex items-center gap-1.5 text-olive-600"><Check size={14} strokeWidth={2.4} aria-hidden /> ok</span>
                ) : (
                  <span>{r.summary ?? (r.patch && Object.keys(r.patch).length ? 'Modifiche proposte' : 'Nessuna modifica')}</span>
                )}
              </li>
            ))}
          </ul>

          {job.status === 'ready' && (
            <Button className="mt-3" icon={Check} loading={applying} onClick={() => void apply()}>
              {actionLabel}
            </Button>
          )}
          {job.status === 'applied' && (
            <p className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-olive-600">
              <Check size={16} strokeWidth={2.6} aria-hidden /> Applicato.
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
