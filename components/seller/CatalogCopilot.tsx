'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Sparkles, Loader2, Send, Check, PackagePlus } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { apiErrorMessage, friendlyError } from '@/lib/errors';

/**
 * Catalog Copilot — chat: il venditore scrive un'istruzione in linguaggio naturale
 * ("abbassa del 10% l'elettronica") e il copilot propone le modifiche per i prodotti
 * coinvolti, mostrate in una card di anteprima dentro la bolla della risposta.
 * Applica via /api/ai/catalog-apply (lo stesso apply validato), una per prodotto,
 * dopo conferma. Human-in-the-loop.
 *
 * Design: design-system/ui_kits/seller/src/80-ai.txt → AiCopilot (avatar gradient,
 * stato "Online", bolle utente/assistente, puntini di digitazione, chip suggeriti,
 * anteprime ricche in-linea). Tutta la logica /api/ai/copilot + catalog-apply resta.
 */

type Change = { product_id: string; name: string; patch: Record<string, unknown> };

type Message =
  | { id: string; role: 'user'; text: string }
  | { id: string; role: 'assistant'; text: string; changes: Change[]; applied?: boolean }
  | { id: string; role: 'typing' };

const SUGGESTIONS = [
  'Abbassa del 10% l\'elettronica',
  'Metti in bozza gli esauriti',
  'Aggiungi il tag saldi all\'abbigliamento',
  'Alza del 5% i salumi',
];

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

let msgSeq = 0;
const nextId = () => `m${++msgSeq}`;

export default function CatalogCopilot() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: nextId(),
      role: 'assistant',
      text: 'Ciao! Sono il tuo copilota catalogo. Dammi un comando sull\'intero catalogo — aggiusto i prezzi, metto in bozza, aggiungo tag e altro. Tu confermi, al resto penso io.',
      changes: [],
    },
  ]);
  const [instruction, setInstruction] = useState('');
  const [loading, setLoading] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const ask = async (q?: string) => {
    const text = (q ?? instruction).trim();
    if (!text || loading) return;
    setLoading(true);
    setInstruction('');
    const typingId = nextId();
    setMessages((m) => [
      ...m,
      { id: nextId(), role: 'user', text },
      { id: typingId, role: 'typing' },
    ]);
    try {
      const json = await authedFetch('/api/ai/copilot', { instruction: text });
      const changes: Change[] = Array.isArray(json.changes) ? json.changes : [];
      setMessages((m) => [
        ...m.filter((x) => x.id !== typingId),
        { id: nextId(), role: 'assistant', text: json.reply ?? '', changes },
      ]);
    } catch (err) {
      setMessages((m) => m.filter((x) => x.id !== typingId));
      toast.error(friendlyError(err));
    } finally {
      setLoading(false);
    }
  };

  const applyChanges = async (msgId: string, changes: Change[]) => {
    if (changes.length === 0) return;
    setApplyingId(msgId);
    let ok = 0;
    try {
      for (const c of changes) {
        try {
          await authedFetch('/api/ai/catalog-apply', { productId: c.product_id, patch: c.patch });
          ok += 1;
        } catch { /* salta il singolo fallito, continua */ }
      }
      toast.success(`Applicato a ${ok} prodotti su ${changes.length}.`);
      setMessages((m) =>
        m.map((x) => (x.id === msgId && x.role === 'assistant' ? { ...x, applied: true } : x)),
      );
    } finally {
      setApplyingId(null);
    }
  };

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-cream-300 bg-white shadow-warm">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-cream-200 px-4 py-3">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-primary-500 to-secondary-600 text-white">
          <Sparkles size={18} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-bold text-ink-900">Catalog Copilot</p>
          <p className="flex items-center gap-1 text-xs text-olive-600">
            <span className="h-1.5 w-1.5 rounded-full bg-olive-500" aria-hidden /> Online · vede il tuo catalogo
          </p>
        </div>
      </div>

      {/* Conversazione */}
      <div ref={scrollRef} className="flex h-[440px] flex-col gap-3 overflow-y-auto bg-cream-50 p-4">
        {messages.map((m) => {
          if (m.role === 'typing') {
            return (
              <div key={m.id} className="self-start rounded-[14px_14px_14px_4px] border border-cream-300 bg-white px-3.5 py-2.5">
                <span className="inline-flex gap-1" aria-label="Sta scrivendo">
                  <Dot delay="0s" /><Dot delay="0.15s" /><Dot delay="0.3s" />
                </span>
              </div>
            );
          }
          const isUser = m.role === 'user';
          return (
            <div
              key={m.id}
              className={`flex max-w-[88%] flex-col gap-2 ${isUser ? 'self-end items-end' : 'self-start items-start'}`}
            >
              {m.text && (
                <div
                  className={`px-3.5 py-2.5 text-sm leading-relaxed ${
                    isUser
                      ? 'rounded-[14px_14px_4px_14px] bg-primary-700 text-white'
                      : 'rounded-[14px_14px_14px_4px] border border-cream-300 bg-white text-ink-800'
                  }`}
                >
                  {m.text}
                </div>
              )}
              {m.role === 'assistant' && m.changes.length > 0 && (
                <ChangesPreview
                  changes={m.changes}
                  applied={!!m.applied}
                  applying={applyingId === m.id}
                  onApply={() => void applyChanges(m.id, m.changes)}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Chip suggeriti */}
      <div className="flex flex-wrap gap-1.5 border-t border-cream-200 px-3.5 py-2.5">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => void ask(s)}
            disabled={loading}
            className="rounded-full border border-cream-300 bg-white px-3 py-1 text-xs font-semibold text-primary-700 transition-colors hover:bg-primary-50 disabled:opacity-40"
          >
            {s}
          </button>
        ))}
      </div>

      {/* Input */}
      <div className="flex items-end gap-2 border-t border-cream-200 px-3.5 py-3">
        <textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask(); } }}
          rows={1}
          placeholder="Chiedi al copilota…"
          className="max-h-28 flex-1 resize-none rounded-full border border-cream-300 px-4 py-2.5 text-sm focus:border-primary-300 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void ask()}
          disabled={loading || !instruction.trim()}
          aria-label="Invia al copilot"
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-600 text-white transition-colors hover:bg-primary-700 disabled:opacity-40"
        >
          {loading ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <Send size={18} aria-hidden />}
        </button>
      </div>
    </div>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-ink-300"
      style={{ animationDelay: delay }}
      aria-hidden
    />
  );
}

/** Anteprima ricca delle modifiche proposte, dentro la bolla dell'assistente. */
function ChangesPreview({
  changes, applied, applying, onApply,
}: {
  changes: Change[];
  applied: boolean;
  applying: boolean;
  onApply: () => void;
}) {
  return (
    <div className="w-full overflow-hidden rounded-xl border border-cream-300 bg-white shadow-warm-sm">
      <div className="flex items-center gap-2 border-b border-cream-200 bg-cream-50 px-3.5 py-2.5">
        <PackagePlus size={16} className="text-primary-700" aria-hidden />
        <span className="flex-1 text-[13px] font-bold text-ink-900">
          {changes.length} {changes.length === 1 ? 'modifica proposta' : 'modifiche proposte'}
        </span>
        <span className="inline-flex items-center rounded-full bg-olive-100 px-2 py-0.5 text-[11px] font-semibold text-olive-800 ring-1 ring-inset ring-olive-200">
          Anteprima
        </span>
      </div>
      <ul className="max-h-56 overflow-y-auto py-1">
        {changes.map((c) => (
          <li key={c.product_id} className="px-3.5 py-2 text-sm">
            <span className="font-medium text-ink-900">{c.name}</span>
            <span className="text-ink-500"> — {patchSummary(c.patch)}</span>
          </li>
        ))}
      </ul>
      <div className="border-t border-cream-200 px-3.5 py-2.5">
        {applied ? (
          <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-olive-600">
            <Check size={16} strokeWidth={2.6} aria-hidden /> Applicato.
          </p>
        ) : (
          <button
            type="button"
            onClick={onApply}
            disabled={applying}
            className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
          >
            {applying ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Check size={16} strokeWidth={2.4} aria-hidden />}
            Applica tutte
          </button>
        )}
      </div>
    </div>
  );
}
