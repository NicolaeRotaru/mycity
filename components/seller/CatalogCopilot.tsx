'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Bot, Loader2, Send, Check } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { apiErrorMessage, friendlyError } from '@/lib/errors';

/**
 * Copilot del negozio: il venditore scrive un'istruzione di massa in linguaggio
 * naturale ("abbassa del 10% l'elettronica") e il copilot propone le modifiche
 * per i prodotti coinvolti. Applica via /api/ai/catalog-apply (lo stesso apply
 * validato della chat), una per prodotto, dopo conferma. Human-in-the-loop.
 */

type Change = { product_id: string; name: string; patch: Record<string, unknown> };

async function authedFetch(path: string, body: unknown) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Sessione scaduta');
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(apiErrorMessage(json, 'Errore'));
  return json;
}

function patchSummary(patch: Record<string, unknown>): string {
  return Object.entries(patch)
    .map(([k, v]) => `${k} → ${Array.isArray(v) ? v.join(', ') : String(v)}`)
    .join(' · ');
}

export default function CatalogCopilot() {
  const [instruction, setInstruction] = useState('');
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [reply, setReply] = useState('');
  const [changes, setChanges] = useState<Change[]>([]);
  const [applied, setApplied] = useState(false);

  const ask = async () => {
    const text = instruction.trim();
    if (!text || loading) return;
    setLoading(true);
    setChanges([]);
    setReply('');
    setApplied(false);
    try {
      const json = await authedFetch('/api/ai/copilot', { instruction: text });
      setReply(json.reply ?? '');
      setChanges(Array.isArray(json.changes) ? json.changes : []);
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setLoading(false);
    }
  };

  const applyAll = async () => {
    if (changes.length === 0) return;
    setApplying(true);
    let ok = 0;
    try {
      for (const c of changes) {
        try {
          await authedFetch('/api/ai/catalog-apply', { productId: c.product_id, patch: c.patch });
          ok += 1;
        } catch { /* salta il singolo fallito, continua */ }
      }
      toast.success(`Applicato a ${ok} prodotti su ${changes.length}.`);
      setApplied(true);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="rounded-lg border border-cream-200 bg-white p-4 shadow-warm">
      <p className="flex items-center gap-2 font-semibold text-ink-800">
        <Bot size={18} className="text-primary-600" aria-hidden /> Copilot del negozio
      </p>
      <p className="mt-0.5 text-sm text-ink-500">
        Dai un comando sull&apos;intero catalogo. Es. &quot;abbassa del 10% l&apos;elettronica&quot;,
        &quot;metti in bozza gli esauriti&quot;, &quot;aggiungi il tag saldi a tutto l&apos;abbigliamento&quot;.
      </p>

      <div className="mt-3 flex items-end gap-2">
        <textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask(); } }}
          rows={2}
          placeholder="Scrivi un comando…"
          className="flex-1 resize-none rounded-lg border border-cream-300 px-3 py-2 text-sm focus:border-primary-300 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void ask()}
          disabled={loading || !instruction.trim()}
          aria-label="Chiedi al copilot"
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-40"
        >
          {loading ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
        </button>
      </div>

      {reply && <p className="mt-3 rounded-lg bg-cream-50 px-3 py-2 text-sm text-ink-700">{reply}</p>}

      {changes.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-500">
            {changes.length} modifiche proposte
          </p>
          <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
            {changes.map((c) => (
              <li key={c.product_id} className="border-b border-cream-100 py-1 last:border-0">
                <span className="font-medium text-ink-800">{c.name}</span>
                <span className="text-ink-500"> — {patchSummary(c.patch)}</span>
              </li>
            ))}
          </ul>
          {applied ? (
            <p className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-600">
              <Check size={16} strokeWidth={2.6} aria-hidden /> Applicato.
            </p>
          ) : (
            <button
              type="button"
              onClick={() => void applyAll()}
              disabled={applying}
              className="mt-3 inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {applying ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Check size={16} strokeWidth={2.4} aria-hidden />}
              Applica tutte
            </button>
          )}
        </div>
      )}
    </div>
  );
}
