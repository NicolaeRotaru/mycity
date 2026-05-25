'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowLeft } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';

const REASONS: Array<{ value: string; label: string; hint: string }> = [
  { value: 'not_received',      label: 'Non l\'ho ricevuto',          hint: 'L\'ordine risulta consegnato ma non l\'hai ricevuto.' },
  { value: 'damaged',           label: 'Arrivato danneggiato',         hint: 'Il prodotto è arrivato rotto o non utilizzabile.' },
  { value: 'wrong_item',        label: 'Prodotto sbagliato',           hint: 'Hai ricevuto qualcosa di diverso da quanto ordinato.' },
  { value: 'not_as_described',  label: 'Diverso dalla descrizione',    hint: 'Qualità, colore o caratteristiche differenti.' },
  { value: 'seller_unreachable',label: 'Venditore non risponde',       hint: 'Hai provato a contattarlo ma non risponde.' },
  { value: 'other',             label: 'Altro motivo',                 hint: 'Descrivi nei dettagli qui sotto.' },
];

export default function OpenDisputePage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [order, setOrder] = useState<any>(null);
  const [reason, setReason] = useState<string>('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push(`/sign-in?returnTo=/orders/${params.id}/dispute`);
        return;
      }
      const { data } = await supabase
        .from('orders')
        .select('id, total_cents, delivery_status, seller_id, created_at, profiles!orders_seller_id_fkey ( store_name )')
        .eq('id', params.id)
        .single();
      if (!data) {
        toast.error('Ordine non trovato');
        router.push('/orders');
        return;
      }
      setOrder(data);
    })();
  }, [params.id, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason) { toast.error('Seleziona un motivo'); return; }
    if (description.trim().length < 20) { toast.error('Descrivi meglio (min 20 caratteri)'); return; }

    setSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase.from('disputes').insert({
        order_id: params.id,
        opener_id: user.id,
        against_id: order.seller_id,
        reason,
        description: description.trim(),
      });
      if (error) throw error;
      toast.success('Reclamo aperto. Il nostro team lo prenderà in carico entro 48h.');
      router.push('/orders');
    } catch (err: any) {
      toast.error(err.message ?? 'Errore');
    } finally {
      setSubmitting(false);
    }
  };

  if (!order) return <div className="container mx-auto p-8 text-center text-ink-500">Caricamento…</div>;

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
        Ordine #{params.id.slice(0, 8)} · {order.profiles?.store_name ?? 'Negozio'}
      </p>

      <div className="bg-accent-50 border border-accent-200 rounded-2xl p-4 mt-5 text-sm text-ink-700">
        <p className="font-semibold mb-1">Prima di aprire un reclamo</p>
        <p>Hai già provato a <Link href="/messages" className="text-primary-700 hover:underline font-semibold">scrivere al venditore</Link>? Spesso il problema si risolve in pochi messaggi. Apri un reclamo solo se non hai ricevuto risposta entro 48h o se la situazione è grave.</p>
      </div>

      <form onSubmit={submit} className="bg-white border border-cream-300 rounded-2xl p-6 mt-5 space-y-5 shadow-warm">
        <div>
          <label className="block text-sm font-semibold text-ink-900 mb-2">Motivo del reclamo *</label>
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
        </div>

        <div>
          <label className="block text-sm font-semibold text-ink-900 mb-2">
            Cosa è successo? <span className="text-ink-400 font-normal">(min 20 caratteri)</span>
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            maxLength={2000}
            placeholder={selectedReason?.hint ?? 'Spiega in dettaglio cosa non ha funzionato, quando, e cosa ti aspetteresti per risolvere.'}
            className="w-full bg-cream-50 border border-cream-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 resize-y"
          />
          <p className="text-xs text-ink-400 mt-1 text-right">{description.length}/2000</p>
        </div>

        <div className="bg-cream-100 rounded-lg p-3 text-xs text-ink-600">
          <p>📋 <strong>Cosa succede dopo:</strong></p>
          <ul className="list-disc list-inside mt-1 space-y-0.5">
            <li>Il team riceve il reclamo entro pochi minuti</li>
            <li>Contattiamo il venditore per la sua versione</li>
            <li>Decisione entro 48h lavorative</li>
            <li>Se ti diamo ragione → rimborso completo o parziale</li>
          </ul>
        </div>

        <button
          type="submit"
          disabled={submitting || !reason || description.trim().length < 20}
          className="w-full bg-secondary-600 hover:bg-secondary-700 disabled:opacity-50 text-white px-5 py-3 rounded-lg font-bold transition-colors"
        >
          {submitting ? 'Invio…' : 'Apri reclamo'}
        </button>
      </form>
    </div>
  );
}
