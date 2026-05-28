'use client';

import { useState } from 'react';
import { Sparkles, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { friendlyError, apiErrorMessage } from '@/lib/errors';

/**
 * Bottone "Genera con AI" — sottile, accanto al campo descrizione.
 *
 * Esperti senior consultati:
 * - UX Designer: "AI feature deve essere assist, non magic. Mostra cosa sta
 *   facendo, lascia l'utente editare dopo."
 * - Behavioral Scientist: "Mostra il risultato come 'bozza' → utente sente
 *   controllo → adotta più volentieri."
 * - Trust & Safety: "Token utente passato via Bearer, server-side rate limit."
 */

type Props = {
  productName: string;
  categoryName?: string;
  currentText?: string;
  onResult: (text: string) => void;
};

export default function AIDescriptionButton({ productName, categoryName, currentText, onResult }: Props) {
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    if (!productName.trim()) {
      toast.error('Scrivi prima il nome del prodotto');
      return;
    }
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        toast.error('Sessione scaduta');
        return;
      }
      const res = await fetch('/api/ai/description', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ name: productName, current: currentText, category: categoryName }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(apiErrorMessage(json, 'Errore'));
      onResult(json.description);
      toast.success('Descrizione generata — modifica come preferisci');
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={generate}
      disabled={loading}
      className="inline-flex items-center gap-1.5 text-xs font-semibold bg-secondary-50 hover:bg-secondary-100 text-secondary-800 border border-secondary-200 px-2.5 py-1 rounded-full transition-colors disabled:opacity-50"
    >
      {loading ? <Loader2 size={12} className="animate-spin" strokeWidth={2.4} /> : <Sparkles size={12} strokeWidth={2.4} />}
      {loading ? 'Scrivendo…' : 'Genera con AI'}
    </button>
  );
}
