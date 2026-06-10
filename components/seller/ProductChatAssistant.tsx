'use client';

import { useEffect, useRef, useState } from 'react';
import { Sparkles, Loader2, Send, X, Check } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { friendlyError, apiErrorMessage } from '@/lib/errors';
import type { AttributeField } from '@/lib/category-attributes';

/**
 * Assistente AI in chat per modificare la scheda prodotto.
 *
 * Il venditore chatta in italiano e l'AI restituisce un PATCH dei campi da
 * cambiare + una risposta. Il patch viene applicato allo stato del form via
 * `onApplyPatch`: l'utente rivede e salva (human-in-the-loop).
 *
 * Esperti senior consultati:
 * - UX Designer: "AI = assist, non magic. Mostra cosa cambia, l'utente conferma
 *   col Salva. Niente scrittura silenziosa sul DB."
 * - Trust & Safety: "Token via Bearer, rate limit server-side."
 */

/** Snapshot dei campi prodotto inviato al modello (DATO, non istruzioni). */
export type ProductChatSnapshot = {
  name: string;
  description: string;
  price: number | null;
  compareAtPrice: number | null;
  unit: string;
  condition: string;
  stock: number | null;
  unlimitedStock: boolean;
  categorySlug: string | null;
  subcategoryName: string | null;
  tags: string[];
  attributes: Record<string, unknown>;
  status: string;
};

/** Patch restituito dall'AI: solo i campi da cambiare. */
export type ProductEditPatch = {
  name?: string;
  description?: string;
  price?: number;
  compare_at_price?: number | null;
  unit?: string;
  condition?: string | null;
  stock?: number;
  unlimited_stock?: boolean;
  category_slug?: string;
  subcategory_name?: string;
  tags?: string[];
  attributes?: Record<string, string>;
  attributes_remove?: string[];
  status?: string;
};

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  /** true quando il turno assistant ha applicato modifiche al form. */
  applied?: boolean;
};

type Props = {
  product: ProductChatSnapshot;
  attributeSchema: AttributeField[];
  topCategories: { name: string; slug: string }[];
  onApplyPatch: (patch: ProductEditPatch) => string[];
  disabled?: boolean;
};

const WELCOME =
  "Ciao! Dimmi come sistemare la scheda: prezzo, descrizione, categoria, marca, tag… Scrivi pure in modo naturale.";

export default function ProductChatAssistant({
  product,
  attributeSchema,
  topCategories,
  onApplyPatch,
  disabled = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, open]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(nextMessages);
    setInput('');
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        toast.error('Sessione scaduta');
        return;
      }
      // Solo i turni di conversazione (role/content) vanno nella history.
      const history = nextMessages.map((m) => ({ role: m.role, content: m.content }));
      const res = await fetch('/api/ai/product-chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ history, product, attributeSchema, topCategories }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(apiErrorMessage(json, 'Errore'));

      const patch: ProductEditPatch = json.patch ?? {};
      const changed = Object.keys(patch).length > 0 ? onApplyPatch(patch) : [];
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: json.reply ?? 'Fatto.', applied: changed.length > 0 },
      ]);
      if (changed.length > 0) toast.success('Campi aggiornati nel form');
    } catch (err) {
      toast.error(friendlyError(err));
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Ops, qualcosa è andato storto. Riprova.' },
      ]);
    } finally {
      setLoading(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="inline-flex items-center gap-2 rounded-lg border border-secondary-200 bg-secondary-50 px-3 py-2 text-sm font-semibold text-secondary-800 transition-colors hover:bg-secondary-100 disabled:opacity-50"
      >
        <Sparkles size={16} strokeWidth={2.2} aria-hidden /> Modifica con l&apos;AI
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-secondary-200 bg-white shadow-warm">
      <div className="flex items-center justify-between border-b border-cream-200 px-3 py-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-secondary-800">
          <Sparkles size={15} strokeWidth={2.4} aria-hidden /> Assistente prodotto
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Chiudi assistente"
          className="text-ink-400 hover:text-ink-700"
        >
          <X size={18} aria-hidden />
        </button>
      </div>

      <div ref={scrollRef} className="max-h-72 space-y-2 overflow-y-auto p-3">
        {messages.length === 0 && (
          <p className="rounded-lg bg-cream-50 px-3 py-2 text-sm text-ink-500">{WELCOME}</p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
          >
            <div
              className={
                m.role === 'user'
                  ? 'max-w-[85%] rounded-2xl rounded-br-sm bg-primary-600 px-3 py-2 text-sm text-white'
                  : 'max-w-[85%] rounded-2xl rounded-bl-sm bg-cream-100 px-3 py-2 text-sm text-ink-800'
              }
            >
              {m.content}
              {m.applied && (
                <span className="mt-1 flex items-center gap-1 text-xs font-semibold text-emerald-600">
                  <Check size={12} strokeWidth={2.6} aria-hidden /> Campi aggiornati nel form
                </span>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-sm bg-cream-100 px-3 py-2 text-sm text-ink-500">
              <Loader2 size={14} className="animate-spin" strokeWidth={2.4} aria-hidden />
            </div>
          </div>
        )}
      </div>

      <div className="flex items-end gap-2 border-t border-cream-200 p-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={1}
          placeholder="Es. metti il prezzo a 4,90 e aggiungi il tag spezie"
          className="flex-1 resize-none rounded-lg border border-cream-300 px-3 py-2 text-sm focus:border-primary-300 focus:outline-none focus:ring-1 focus:ring-primary-200"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={loading || !input.trim()}
          aria-label="Invia"
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary-600 text-white transition-colors hover:bg-primary-700 disabled:opacity-40"
        >
          {loading ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
        </button>
      </div>
    </div>
  );
}
