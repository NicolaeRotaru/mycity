'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Headset, X, Send, Sparkles, ChevronLeft } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { useCloseOnBack } from './hooks/useCloseOnBack';
import SupportProductAssistant from './SupportProductAssistant';

type SupportRole = 'buyer' | 'seller' | 'rider' | 'default';

const PRESETS: Record<SupportRole, string[]> = {
  buyer: ['Dov\'è il mio ordine?', 'Come richiedo un reso?', 'Ho un problema con un pagamento'],
  seller: ['Non ricevo i pagamenti', 'Come funzionano le promozioni?', 'Ho un problema con un ordine'],
  rider: ['Ho un problema con una consegna', 'Non vedo ordini disponibili', 'Come funzionano i compensi?'],
  default: ['Ho bisogno di aiuto', 'Vorrei segnalare un problema'],
};

type Props = {
  open: boolean;
  onClose: () => void;
  role?: SupportRole;
};

/**
 * Modale "Assistenza MyCity": preset in base al ruolo + campo libero. All'invio
 * apre una vera conversazione con l'account Assistenza e naviga al thread.
 * Estratto da SupportChatButton così da poter essere aperto anche da altri
 * punti (es. la tab "Assistenza" della MobileTabBar per il buyer).
 */
export default function SupportChatModal({ open, onClose, role = 'default' }: Props) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  // 'menu' = scelta argomento; 'ai' = assistente prodotti AI (solo seller).
  const [view, setView] = useState<'menu' | 'ai'>('menu');

  useCloseOnBack(open, onClose);

  // Riparti sempre dal menu quando il modale si riapre.
  useEffect(() => {
    if (open) setView('menu');
  }, [open]);

  const presets = PRESETS[role] ?? PRESETS.default;
  const canUseAi = role === 'seller';

  const start = async (message: string) => {
    const body = message.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/support/conversation', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(session?.access_token ? { authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ firstMessage: body }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? j.message ?? 'Impossibile aprire la chat');
      }
      const { conversationId } = await res.json();
      onClose();
      setText('');
      router.push(`/messages/${conversationId}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Errore');
    } finally {
      setSending(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Assistenza MyCity"
    >
      <div
        className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-warm-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-primary-600 text-white px-5 py-4 flex items-center justify-between">
          <h2 className="font-bold flex items-center gap-2">
            {view === 'ai' ? (
              <>
                <button onClick={() => setView('menu')} aria-label="Indietro" className="-ml-1">
                  <ChevronLeft size={20} strokeWidth={2.4} />
                </button>
                <Sparkles size={18} strokeWidth={2.2} /> Assistente prodotti
              </>
            ) : (
              <>
                <Headset size={20} strokeWidth={2.2} /> Assistenza MyCity
              </>
            )}
          </h2>
          <button onClick={onClose} aria-label="Chiudi"><X size={20} /></button>
        </div>

        {view === 'ai' ? (
          <SupportProductAssistant />
        ) : (
          <div className="p-5 space-y-4">
            <p className="text-sm text-ink-600">Come possiamo aiutarti? Scegli un argomento o scrivici.</p>

            {canUseAi && (
              <button
                onClick={() => setView('ai')}
                className="w-full text-left rounded-xl border border-secondary-200 bg-secondary-50 px-4 py-3 transition-colors hover:bg-secondary-100"
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-secondary-800">
                  <Sparkles size={16} strokeWidth={2.4} /> Modifica un prodotto con l&apos;AI
                </span>
                <span className="mt-0.5 block text-xs text-ink-500">
                  Scrivi o manda una foto: trovo il prodotto e lo aggiorno per te.
                </span>
              </button>
            )}

            <div className="flex flex-col gap-2">
              {presets.map((p) => (
                <button
                  key={p}
                  onClick={() => start(p)}
                  disabled={sending}
                  className="text-left text-sm font-medium bg-cream-50 hover:bg-cream-100 border border-cream-200 rounded-xl px-4 py-3 disabled:opacity-50 transition-colors"
                >
                  {p}
                </button>
              ))}
            </div>

            <form
              onSubmit={(e) => { e.preventDefault(); start(text); }}
              className="flex items-end gap-2 pt-2 border-t border-cream-200"
            >
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={2}
                maxLength={4000}
                placeholder="Scrivi qui la tua richiesta…"
                className="flex-1 border border-cream-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 resize-none"
              />
              <button
                type="submit"
                disabled={sending || !text.trim()}
                aria-label="Invia"
                className="bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white rounded-lg p-2.5 shrink-0"
              >
                <Send size={18} strokeWidth={2.2} />
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
