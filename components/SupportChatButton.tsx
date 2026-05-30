'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Headset, X, Send } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { useProfile } from './hooks/useProfile';

/**
 * Pulsante "Assistenza" flottante (sostituisce il vecchio SOS). Disponibile a
 * tutti gli utenti loggati. Mostra 2-3 domande preset in base al ruolo + campo
 * libero; all'invio apre una vera conversazione con l'account Assistenza e
 * naviga al thread /messages/[id].
 */
const PRESETS: Record<string, string[]> = {
  buyer: ['Dov\'è il mio ordine?', 'Come richiedo un reso?', 'Ho un problema con un pagamento'],
  seller: ['Non ricevo i pagamenti', 'Come funzionano le promozioni?', 'Ho un problema con un ordine'],
  rider: ['Ho un problema con una consegna', 'Non vedo ordini disponibili', 'Come funzionano i compensi?'],
  default: ['Ho bisogno di aiuto', 'Vorrei segnalare un problema'],
};

export default function SupportChatButton() {
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const { isAuthenticated, isSeller, isRider, isAdmin } = useProfile();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  // Niente pulsante in auth flow, dentro un thread chat, o per l'admin stesso.
  const hidden =
    !isAuthenticated ||
    isAdmin ||
    pathname.startsWith('/sign-in') ||
    pathname.startsWith('/sign-up') ||
    pathname.startsWith('/reset-password') ||
    pathname.startsWith('/auth/') ||
    /^\/messages\/[^/]+/.test(pathname);
  if (hidden) return null;

  const role = isSeller ? 'seller' : isRider ? 'rider' : 'buyer';
  const presets = PRESETS[role] ?? PRESETS.default;

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
      setOpen(false);
      setText('');
      router.push(`/messages/${conversationId}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Errore');
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Assistenza"
        className="fixed bottom-24 md:bottom-6 right-4 z-40 bg-primary-600 hover:bg-primary-700 text-white rounded-full w-14 h-14 shadow-warm-lg flex items-center justify-center ring-4 ring-primary-200/60 transition-colors"
      >
        <Headset size={22} strokeWidth={2.2} />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setOpen(false)}>
          <div
            className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-warm-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-primary-600 text-white px-5 py-4 rounded-t-2xl flex items-center justify-between">
              <h2 className="font-bold flex items-center gap-2">
                <Headset size={20} strokeWidth={2.2} /> Assistenza MyCity
              </h2>
              <button onClick={() => setOpen(false)} aria-label="Chiudi"><X size={20} /></button>
            </div>

            <div className="p-5 space-y-4">
              <p className="text-sm text-ink-600">Come possiamo aiutarti? Scegli un argomento o scrivici.</p>
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
          </div>
        </div>
      )}
    </>
  );
}
