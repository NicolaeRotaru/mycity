'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Sparkles, Loader2, Wand2, FileText, ShieldCheck, Languages, Check, AlertTriangle,
  Mic, Camera, ScanBarcode, Link2, ArrowRight, type LucideIcon,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { apiErrorMessage, friendlyError } from '@/lib/errors';
import CatalogCopilot from '@/components/seller/CatalogCopilot';
import SellerPageTitle from '@/components/seller/SellerPageTitle';
import ImportFromUrlBox, { type ImportResult } from '@/components/products/ImportFromUrlBox';
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

// Le 4 modalità di creazione: l'AI compila la scheda, tu confermi.
//  - "url" è davvero in-linea: usa il box reale di import (/api/marketplace/import-fetch),
//    mostra l'anteprima e passa i dati al form prodotto via autosave.
//  - voce/foto/barcode vivono sul form prodotto (lì stanno i loro strumenti AI):
//    la tile espande un pannello in stile mockup con azione primaria verso /seller/products/new.
type CreateMethodId = 'voice' | 'photo' | 'barcode' | 'url';
type CreateTone = 'primary' | 'accent' | 'olive' | 'secondary';
const CREATE_METHODS: { id: CreateMethodId; icon: LucideIcon; title: string; desc: string; tone: CreateTone }[] = [
  { id: 'voice', icon: Mic, title: 'Da voce', desc: 'Detta il prodotto a voce: l\'AI compila nome, prezzo e descrizione.', tone: 'primary' },
  { id: 'photo', icon: Camera, title: 'Da foto', desc: 'Carica una foto: riconosce il prodotto e crea la scheda.', tone: 'accent' },
  { id: 'barcode', icon: ScanBarcode, title: 'Da barcode', desc: 'Inquadra il codice a barre e recupera i dati del prodotto.', tone: 'olive' },
  { id: 'url', icon: Link2, title: 'Da link', desc: 'Incolla un URL e importa nome, foto e attributi.', tone: 'secondary' },
];
const TONE: Record<CreateTone, string> = {
  primary:   'bg-primary-100 text-primary-700',
  accent:    'bg-accent-100 text-accent-700',
  olive:     'bg-olive-100 text-olive-700',
  secondary: 'bg-secondary-100 text-secondary-600',
};

// Chiave dell'autosave del form "Nuovo prodotto": scrivendo qui prima di navigare,
// il form reale ripristina la scheda importata (nessun endpoint finto, nessun handoff fragile).
const NEW_PRODUCT_AUTOSAVE_KEY = 'mc_new_product_draft';

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

/* ---------------- Tab 1: crea con AI (tile metodo + pannelli in-linea) ---------------- */
function CreateTab() {
  const [active, setActive] = useState<CreateMethodId | null>(null);

  return (
    <div className="max-w-3xl space-y-4">
      <p className="text-sm text-ink-600">
        Scegli da dove partire: l&apos;AI compila la scheda, tu controlli e pubblichi.
      </p>
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        {CREATE_METHODS.map((m) => {
          const Icon = m.icon;
          const on = active === m.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => setActive((cur) => (cur === m.id ? null : m.id))}
              aria-pressed={on}
              className={`flex gap-3.5 rounded-xl border bg-white p-[18px] text-left transition-all hover:shadow-warm ${
                on ? 'border-primary-400 ring-2 ring-primary-100' : 'border-cream-300 hover:border-primary-300'
              }`}
            >
              <span className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-md ${TONE[m.tone]}`}>
                <Icon size={22} strokeWidth={2.2} aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="font-bold text-ink-900">{m.title}</p>
                <p className="mt-0.5 text-[13px] leading-snug text-ink-500">{m.desc}</p>
              </div>
            </button>
          );
        })}
      </div>

      {active === 'url' && <UrlImportPanel />}
      {active === 'voice' && (
        <CaptureEntryPanel
          icon={Mic}
          title="Crea da voce"
          hint="Detta nome, prezzo e descrizione: la registrazione e la trascrizione AI avvengono direttamente sul form prodotto."
          cta="Apri il form e detta"
        />
      )}
      {active === 'photo' && (
        <CaptureEntryPanel
          icon={Camera}
          title="Crea da foto"
          hint="Carica o scatta una foto: il riconoscimento prodotto e la compilazione AI della scheda avvengono sul form prodotto."
          cta="Apri il form e carica una foto"
        />
      )}
      {active === 'barcode' && (
        <CaptureEntryPanel
          icon={ScanBarcode}
          title="Crea da barcode"
          hint="Inquadra il codice a barre: il recupero dei dati prodotto avviene sul form prodotto."
          cta="Apri il form e scansiona"
        />
      )}

      <p className="text-xs text-ink-400">
        Gli strumenti AI per la singola scheda (voce, foto, import da link, ottimizza per la ricerca,
        traduci, &laquo;perché non vende?&raquo;) sono disponibili nel form prodotto.
      </p>
    </div>
  );
}

/**
 * Pannello "entrata" per voce/foto/barcode: in stile mockup (icona + hint + CTA),
 * ma con azione reale verso /seller/products/new dove vivono gli strumenti di cattura.
 */
function CaptureEntryPanel({ icon: Icon, title, hint, cta }: { icon: LucideIcon; title: string; hint: string; cta: string }) {
  return (
    <Card variant="bordered" padding="lg">
      <div className="flex flex-col items-center gap-3 py-3 text-center">
        <span className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-olive-50 text-olive-700">
          <Icon size={30} strokeWidth={2} aria-hidden />
        </span>
        <p className="text-base font-semibold text-ink-900">{title}</p>
        <p className="max-w-md text-sm leading-relaxed text-ink-500">{hint}</p>
        <Button href="/seller/products/new" iconRight={ArrowRight} size="lg" className="mt-1">
          {cta}
        </Button>
      </div>
    </Card>
  );
}

/**
 * Pannello "Da link" davvero in-linea: usa il box di import reale (stesso endpoint
 * del form prodotto), mostra un'anteprima stile AiResultCard e, su conferma, passa
 * la scheda importata al form reale tramite l'autosave (nessun endpoint finto).
 */
function UrlImportPanel() {
  const router = useRouter();
  const [imported, setImported] = useState<ImportResult | null>(null);

  const continueToForm = () => {
    if (!imported) return;
    try {
      // Stesso shape del Snapshot letto da /seller/products/new (loadAutosave).
      localStorage.setItem(
        NEW_PRODUCT_AUTOSAVE_KEY,
        JSON.stringify({
          name: imported.name,
          description: imported.description,
          price: imported.suggested_price ?? '',
          category_id: imported.subcategory_id ?? imported.category_id ?? '',
          imageUrls: imported.image_urls,
          attributes: imported.attributes,
          tags: imported.tags,
          unit: 'pezzo',
        }),
      );
    } catch { /* quota/Safari privata: il form parte vuoto */ }
    router.push('/seller/products/new');
  };

  return (
    <div className="space-y-4">
      <ImportFromUrlBox onImported={setImported} />

      {imported && (
        <Card variant="elevated" padding="lg" className="border-olive-300">
          <div className="mb-3 flex items-center gap-2">
            <Sparkles size={16} className="text-olive-700" aria-hidden />
            <span className="text-[13px] font-bold text-olive-800">Scheda importata dall&apos;AI</span>
            <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-200">
              Bozza
            </span>
          </div>
          <div className="flex gap-4">
            {imported.image_urls[0] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imported.image_urls[0]} alt="" className="h-20 w-20 shrink-0 rounded-lg object-cover" />
            ) : null}
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-ink-900">{imported.name || 'Prodotto importato'}</p>
              {imported.suggested_price != null && (
                <p className="mt-0.5 font-serif text-lg font-bold text-ink-900">€{imported.suggested_price}</p>
              )}
              {imported.description && (
                <p className="mt-1 line-clamp-3 text-sm leading-snug text-ink-500">{imported.description}</p>
              )}
              {imported.tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {imported.tags.slice(0, 6).map((t) => (
                    <span key={t} className="inline-flex items-center rounded-full bg-cream-100 px-2 py-0.5 text-[11px] font-medium text-ink-600">
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button icon={Check} iconRight={ArrowRight} onClick={continueToForm}>
              Continua nel form prodotto
            </Button>
            <Button variant="secondary" onClick={() => setImported(null)}>Scarta</Button>
          </div>
        </Card>
      )}
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
