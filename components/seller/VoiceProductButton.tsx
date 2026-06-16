'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Mic, Loader2, Square, Send } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { apiErrorMessage, friendlyError } from '@/lib/errors';
import type { AttributeField } from '@/lib/category-attributes';
import type { ProductEditPatch } from '@/components/seller/ProductChatAssistant';

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
  onApplyPatch: (patch: ProductEditPatch) => string[];
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
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const supported = getRecognitionCtor() !== null;

  const process = async (transcript: string) => {
    const text = transcript.trim();
    if (text.length < 3) {
      setState('idle');
      return;
    }
    setState('processing');
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
      const changed = json.patch ? onApplyPatch(json.patch as ProductEditPatch) : [];
      toast.success(changed.length ? 'Compilato dalla tua descrizione — controlla e salva' : 'Non ho ricavato campi: riprova con più dettagli');
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
            className="flex-1 resize-none rounded-lg border border-cream-300 px-3 py-2 text-sm focus:border-primary-300 focus:outline-none"
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
      </div>
    );
  }

  const listening = state === 'listening';
  const processing = state === 'processing';
  return (
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
  );
}
