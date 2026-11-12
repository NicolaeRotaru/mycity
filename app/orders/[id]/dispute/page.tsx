'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowLeft, ClipboardList } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { apiErrorMessage, friendlyError } from '@/lib/errors';
import { LoadingState } from '@/components/ui/LoadingState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Textarea } from '@/components/ui/Field';
import { useTranslations } from 'next-intl';
import { conNegozioDellOrdine } from '@/lib/queries/negozio-dell-ordine';

const REASONS: Array<{ value: string; label: string; hint: string }> = [
  { value: 'not_received',      label: 'Non l\'ho ricevuto',          hint: 'L\'ordine risulta consegnato ma non l\'hai ricevuto.' },
  { value: 'damaged',           label: 'Arrivato danneggiato',         hint: 'Il prodotto è arrivato rotto o non utilizzabile.' },
  { value: 'wrong_item',        label: 'Prodotto sbagliato',           hint: 'Hai ricevuto qualcosa di diverso da quanto ordinato.' },
  { value: 'not_as_described',  label: 'Diverso dalla descrizione',    hint: 'Qualità, colore o caratteristiche differenti.' },
  { value: 'seller_unreachable',label: 'Venditore non risponde',       hint: 'Hai provato a contattarlo ma non risponde.' },
  { value: 'other',             label: 'Altro motivo',                 hint: 'Descrivi nei dettagli qui sotto.' },
];

export default function OpenDisputePage(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  const router = useRouter();
  const tStates = useTranslations('states');
  const tForms = useTranslations('forms');
  const [order, setOrder] = useState<{ id: string; total_price: number; delivery_status: string; seller_id: string; created_at: string; seller?: { store_name?: string | null } | null } | null>(null);
  const [reason, setReason] = useState<string>('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // 5/11/2026 — Una lettura caduta non è «ordine non trovato»: si resta qui con «Riprova».
  const [letturaFallita, setLetturaFallita] = useState(false);
  const [tentativo, setTentativo] = useState(0);
  // 5/11/2026 — Il database tiene un solo reclamo aperto per ordine: se c'è già, lo si dice.
  const [reclamoAperto, setReclamoAperto] = useState<{ created_at: string; status: string } | null>(null);

  useEffect(() => {
    (async () => {
      setLetturaFallita(false);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push(`/sign-in?returnTo=/orders/${params.id}/dispute`);
        return;
      }
      const { data, error } = await supabase
        .from('orders')
        .select('id, total_price, delivery_status, seller_id, created_at')
        .eq('id', params.id)
        .maybeSingle();
      if (error) {
        setLetturaFallita(true);
        return;
      }
      if (!data) {
        toast.error('Ordine non trovato');
        router.push('/orders');
        return;
      }
      // 18/10/2026 — Il nome del negozio contro cui si reclama viene dalla vetrina
      // pubblica, non da `profiles` (lib/queries/negozio-dell-ordine.ts). Qui e'
      // solo un'etichetta: se quella lettura cade resta «Negozio», e il reclamo si
      // apre lo stesso.
      const riga = data as { seller_id: string };
      const [conNegozio] = await conNegozioDellOrdine(supabase, [riga], 'id, store_name')
        .catch(() => [{ ...riga, seller: null }]);
      // Se questa lettura cade si mostra il modulo: il database rifiuta comunque il doppione,
      // e il messaggio qui sotto (submit) lo dice con parole vere.
      const { data: aperti } = await supabase
        .from('disputes')
        .select('created_at, status')
        .eq('order_id', params.id)
        .in('status', ['open', 'under_review'])
        .limit(1);
      setReclamoAperto(((aperti as Array<{ created_at: string; status: string }> | null) ?? [])[0] ?? null);
      setOrder(conNegozio as unknown as typeof order);
    })();
  }, [params.id, router, tentativo]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason) { toast.error('Seleziona un motivo'); return; }
    if (description.trim().length < 20) { toast.error('Descrivi meglio (min 20 caratteri)'); return; }

    setSubmitting(true);
    try {
      // 12/11/2026 (R03-013) — Il reclamo lo apre il server (/api/disputes): controlla che
      // l'ordine sia tuo, avvisa gli amministratori e il negozio, e ti manda la ricevuta. Prima la
      // riga si scriveva da qui e nessuno ne sapeva niente, mentre il bonifico del negozio si fermava.
      const res = await fetch('/api/disputes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orderId: params.id, reason, description: description.trim() }),
      });
      if (!res.ok) {
        const corpo = await res.json().catch(() => ({}));
        toast.error(apiErrorMessage(corpo, 'Non sono riuscito ad aprire il reclamo: riprova fra poco.'));
        return;
      }
      toast.success('Reclamo aperto: ti abbiamo mandato una ricevuta per email e ti scriviamo noi con la decisione.');
      router.push('/orders');
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (letturaFallita) {
    return (
      <div className="container mx-auto px-4 sm:px-6 py-12 max-w-2xl">
        <ErrorState
          title="Non riesco a caricare l'ordine"
          description="Sembra un problema di collegamento. L'ordine c'è: riprova."
          retry={() => setTentativo((t) => t + 1)}
        />
      </div>
    );
  }
  if (!order) return <LoadingState />;
  if (reclamoAperto) {
    return (
      <div className="container mx-auto px-4 sm:px-6 py-8 max-w-2xl">
        <Link href={`/orders/${params.id}`} className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-800 mb-2">
          <ArrowLeft size={14} /> Torna all'ordine
        </Link>
        <div className="bg-accent-50 border border-accent-200 rounded-2xl p-5 mt-5 text-sm text-ink-700">
          <p className="font-semibold mb-1">Hai già un reclamo aperto su questo ordine</p>
          <p>
            L&apos;hai aperto il {new Date(reclamoAperto.created_at).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' })} ·
            stato: {reclamoAperto.status === 'under_review' ? 'in esame' : 'aperto'}. Ti scriviamo noi appena c&apos;è una decisione.
          </p>
        </div>
      </div>
    );
  }

  const selectedReason = REASONS.find((r) => r.value === reason);

  return (
    <div className="container mx-auto px-4 sm:px-6 py-8 max-w-2xl">
      <Link href={`/orders/${params.id}`} className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-800 mb-2">
        <ArrowLeft size={14} /> Torna all'ordine
      </Link>

      <h1 className="text-3xl font-serif font-bold text-ink-900 flex items-center gap-2 mt-3">
        <AlertCircle size={26} className="text-secondary-600" />
        Apri un reclamo
      </h1>
      <p className="text-sm text-ink-500 mt-1">
        Ordine #{params.id.slice(0, 8)} · {order.seller?.store_name ?? 'Negozio'}
      </p>

      <div className="bg-accent-50 border border-accent-200 rounded-2xl p-4 mt-5 text-sm text-ink-700">
        <p className="font-semibold mb-1">Prima di aprire un reclamo</p>
        <p>Hai già provato a <Link href="/messages" className="text-primary-700 hover:underline font-semibold">scrivere al venditore</Link>? Spesso il problema si risolve in pochi messaggi. Apri un reclamo solo se non hai ricevuto risposta entro 48h o se la situazione è grave.</p>
      </div>

      <form onSubmit={submit} className="bg-white border border-cream-300 rounded-2xl p-6 mt-5 space-y-5 shadow-warm">
        <fieldset>
          <legend className="block text-sm font-semibold text-ink-900 mb-2">Motivo del reclamo *</legend>
          <div className="space-y-2">
            {REASONS.map((r) => (
              <label key={r.value} className={`flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-colors ${
                reason === r.value ? 'border-primary-400 bg-primary-50' : 'border-cream-200 hover:border-cream-300'
              }`}>
                <input
                  type="radio"
                  name="reason"
                  value={r.value}
                  checked={reason === r.value}
                  onChange={(e) => setReason(e.target.value)}
                  className="mt-0.5"
                />
                <div>
                  <p className="font-semibold text-ink-900">{r.label}</p>
                  <p className="text-xs text-ink-500">{r.hint}</p>
                </div>
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <Textarea
            label="Cosa è successo?"
            hint="(min 20 caratteri)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            maxLength={2000}
            placeholder={selectedReason?.hint ?? 'Spiega in dettaglio cosa non ha funzionato, quando, e cosa ti aspetteresti per risolvere.'}
            className="bg-cream-50 resize-y"
          />
          <p className="text-xs text-ink-400 mt-1 text-right">{description.length}/2000</p>
        </div>

        <div className="bg-cream-100 rounded-lg p-3 text-xs text-ink-600">
          <p className="flex items-center gap-1.5"><ClipboardList size={14} strokeWidth={2.2} aria-hidden /> <strong>Cosa succede dopo:</strong></p>
          <ul className="list-disc list-inside mt-1 space-y-0.5">
            <li>Il team riceve subito un avviso col tuo reclamo, e tu una ricevuta per email</li>
            <li>Contattiamo il venditore per la sua versione</li>
            <li>Ti scriviamo con la decisione</li>
            <li>Se ti diamo ragione → rimborso completo o parziale</li>
          </ul>
        </div>

        <button
          type="submit"
          disabled={submitting || !reason || description.trim().length < 20}
          className="w-full bg-secondary-600 hover:bg-secondary-700 disabled:opacity-50 text-white px-5 py-3 rounded-lg font-bold transition-colors"
        >
          {submitting ? tStates('sending') : tForms('openDispute')}
        </button>
      </form>
    </div>
  );
}
