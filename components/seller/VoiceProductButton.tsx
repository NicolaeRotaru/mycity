'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Mic, Loader2, Square, Send } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { apiErrorMessage, friendlyError } from '@/lib/errors';
import type { AttributeField } from '@/lib/category-attributes';
import type { ProductEditPatch } from '@/components/seller/ProductChatAssistant';
import type { EsitoPatchModulo } from '@/lib/products/aiPatch';
import { avvisoDopoLaDettatura, type AvvisoDellaDettatura } from '@/lib/products/avvisoDellaDettatura';

/**
 * Voce → prodotto. Il venditore detta il prodotto a parole; la Web Speech API
 * trascrive (it-IT) e la route /api/ai/voice-product trasforma il testo in una
 * scheda (patch) applicata allo stato del form. Se il browser non supporta il
 * riconoscimento vocale, ripiega su un campo di testo (stessa route).
 */

// Tipi minimi per la Web Speech API (non in lib.dom standard).
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

type Props = {
  attributeSchema: AttributeField[];
  topCategories: { name: string; slug: string }[];
  onApplyPatch: (patch: ProductEditPatch) => EsitoPatchModulo;
  disabled?: boolean;
};

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export default function VoiceProductButton({
  attributeSchema,
  topCategories,
  onApplyPatch,
  disabled = false,
}: Props) {
  const [state, setState] = useState<'idle' | 'listening' | 'processing'>('idle');
  const [manual, setManual] = useState('');
  // 16/10/2026 — Dopo la dettatura il negoziante vede cosa e' successo, quello
  // che ha detto e la risposta dell'assistente, e (se la scheda ha allergeni,
  // ingredienti...) che quelle dichiarazioni le scrive lui. Resta a video
  // finche' non lo chiude o non detta di nuovo: un avviso a tempo spariva
  // prima di essere letto. Cosa dire lo decide `avvisoDopoLaDettatura`.
  const [avviso, setAvviso] = useState<AvvisoDellaDettatura | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const supported = getRecognitionCtor() !== null;

  const process = async (transcript: string) => {
    const text = transcript.trim();
    if (text.length < 3) {
      setState('idle');
      return;
    }
    setState('processing');
    setAvviso(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) { toast.error('Sessione scaduta'); return; }
      const res = await fetch('/api/ai/voice-product', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          transcript: text,
          attributeSchema,
          topCategories: topCategories.map((c) => ({ name: c.name, slug: c.slug })),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(apiErrorMessage(json, 'Errore'));
      // Anche un suggerimento vuoto passa dal modulo: e' il modulo a sapere che
      // categoria ha la scheda, e quindi se ha dichiarazioni da scrivere a mano.
      const patch =
        json.patch && typeof json.patch === 'object' && !Array.isArray(json.patch) ? json.patch : {};
      const esito = onApplyPatch(patch as ProductEditPatch);
      setAvviso(avvisoDopoLaDettatura({ esito, dettato: text, risposta: json.reply }));
      setManual('');
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setState('idle');
    }
  };

  const startListening = () => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    try {
      const rec = new Ctor();
      rec.lang = 'it-IT';
      rec.interimResults = false;
      rec.continuous = false;
      rec.maxAlternatives = 1;
      rec.onresult = (e) => {
        const transcript = e.results?.[0]?.[0]?.transcript ?? '';
        void process(transcript);
      };
      rec.onerror = (e) => {
        setState('idle');
        if (e.error !== 'aborted') {
          toast.error(e.error === 'not-allowed' ? 'Permesso microfono negato.' : 'Non ho sentito bene, riprova.');
        }
      };
      rec.onend = () => setState((s) => (s === 'listening' ? 'idle' : s));
      recRef.current = rec;
      setState('listening');
      rec.start();
    } catch {
      toast.error('Microfono non disponibile.');
      setState('idle');
    }
  };

  const stopListening = () => {
    recRef.current?.stop();
    setState('idle');
  };

  const coloreAvviso =
    avviso?.tono === 'successo'
      ? 'border-emerald-200 bg-emerald-50'
      : avviso?.tono === 'da-controllare'
        ? 'border-accent-200 bg-accent-50'
        : 'border-cream-300 bg-cream-50';
  // La regione resta sempre montata: un lettore di schermo annuncia quello che
  // ci entra dentro, non una regione che nasce insieme al testo.
  const riquadroAvviso = (
    <div role="status" aria-live="polite" data-avviso="dettatura">
      {avviso && (
        <div className={`mt-2 space-y-1 rounded-lg border p-3 text-sm text-ink-800 ${coloreAvviso}`}>
          {/* La frase fissa prima di tutto: viene prima anche delle parole dell'assistente. */}
          {avviso.dichiarazioni && <p className="font-semibold text-accent-800">{avviso.dichiarazioni}</p>}
          <p className="font-semibold">{avviso.esito}</p>
          <p className="break-words text-ink-700">{avviso.dettato}</p>
          {avviso.risposta && <p className="break-words text-ink-700">{avviso.risposta}</p>}
          <button
            type="button"
            onClick={() => setAvviso(null)}
            className="mt-1 rounded-lg border border-cream-300 bg-white px-3 py-1.5 text-xs font-semibold text-ink-700 hover:bg-cream-100"
          >
            Ho letto
          </button>
        </div>
      )}
    </div>
  );

  // Fallback: niente riconoscimento vocale → campo di testo, stessa route.
  if (!supported) {
    return (
      <div className="rounded-lg border border-cream-200 bg-cream-50 p-3">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500">
          <Mic size={13} aria-hidden /> Descrivi il prodotto a parole
        </p>
        <div className="flex items-end gap-2">
          <textarea
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            rows={2}
            disabled={disabled || state === 'processing'}
            placeholder="Es. tre magliette rosse di cotone taglia M a 15 euro l'una"
            className="flex-1 resize-none rounded-lg border border-cream-300 px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-primary-700 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void process(manual)}
            disabled={disabled || state === 'processing' || manual.trim().length < 3}
            aria-label="Crea dalla descrizione"
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-40"
          >
            {state === 'processing' ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
          </button>
        </div>
        {riquadroAvviso}
      </div>
    );
  }

  const listening = state === 'listening';
  const processing = state === 'processing';
  return (
    <div>
      <button
        type="button"
        onClick={listening ? stopListening : startListening}
        disabled={disabled || processing}
        className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${
          listening
            ? 'border-rose-300 bg-rose-50 text-rose-700'
            : 'border-secondary-200 bg-secondary-50 text-secondary-800 hover:bg-secondary-100'
        }`}
      >
        {processing ? (
          <><Loader2 size={16} className="animate-spin" aria-hidden /> Compilo…</>
        ) : listening ? (
          <><Square size={15} strokeWidth={2.4} aria-hidden /> Sto ascoltando… tocca per fermare</>
        ) : (
          <><Mic size={16} strokeWidth={2.2} aria-hidden /> Detta il prodotto a voce</>
        )}
      </button>
      {riquadroAvviso}
    </div>
  );
}
