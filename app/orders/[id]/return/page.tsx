'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { LoadingState } from '@/components/ui/LoadingState';
import EmptyState from '@/components/EmptyState';
import { Textarea } from '@/components/ui/Field';
import { apiErrorMessage } from '@/lib/errors';
import { useTranslations } from 'next-intl';
import { Package, RefreshCw, AlertTriangle, MessageSquare, Clock, Pencil, type LucideIcon } from 'lucide-react';

const REASONS: Array<{ value: string; label: string; icon: LucideIcon }> = [
  { value: 'DAMAGED',           label: 'Prodotto danneggiato',          icon: Package },
  { value: 'WRONG_ITEM',        label: 'Prodotto sbagliato',            icon: RefreshCw },
  { value: 'NOT_AS_DESCRIBED',  label: 'Non come descritto',            icon: AlertTriangle },
  { value: 'CHANGED_MIND',      label: 'Ho cambiato idea',              icon: MessageSquare },
  { value: 'LATE',              label: 'Consegna troppo in ritardo',    icon: Clock },
  { value: 'OTHER',             label: 'Altro',                         icon: Pencil },
];

export default function NewReturnPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const tStates = useTranslations('states');
  const [reason, setReason] = useState<string>('DAMAGED');
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [order, setOrder] = useState<any>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('orders')
        .select('id, total_price, delivered_at, delivery_status')
        .eq('id', params.id)
        .single();
      setOrder(data);
      setLoaded(true);
    })();
  }, [params.id]);

  async function uploadPhoto(file: File) {
    setUploading(true);
    try {
      const path = `returns/${params.id}/${Date.now()}-${file.name}`;
      const { error: upErr } = await supabase.storage
        .from('products')
        .upload(path, file, { upsert: false });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('products').getPublicUrl(path);
      setPhotos((p) => [...p, pub.publicUrl]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload fallito');
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    setSubmitting(true);
    try {
      const r = await fetch('/api/returns/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          orderId: params.id,
          reason,
          notes: notes || undefined,
          photoUrls: photos,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(apiErrorMessage(data, 'Errore'));
      toast.success('Richiesta di reso inviata');
      router.push(`/orders/${params.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Errore');
    } finally {
      setSubmitting(false);
    }
  }

  // audit 🟠-20: distinguere "in caricamento" da "non trovato" (prima: spinner
  // infinito su id inesistente o ordine altrui bloccato da RLS).
  if (!loaded) return <LoadingState />;
  if (!order)
    return (
      <div className="container mx-auto max-w-xl px-4 py-12">
        <EmptyState
          icon={Package}
          title="Ordine non trovato"
          description="L'ordine non esiste o non hai i permessi per vederlo."
          ctaLabel="Tutti gli ordini"
          ctaHref="/orders"
        />
      </div>
    );

  return (
    <div className="container mx-auto max-w-xl px-4 py-8">
      <Link href={`/orders/${params.id}`} className="text-sm text-primary-700 hover:underline">
        ← Torna all&apos;ordine
      </Link>
      <h1 className="mt-2 text-2xl font-bold text-ink-900">Richiedi un reso</h1>
      <p className="mt-1 text-sm text-ink-600">
        Hai 14 giorni dalla consegna per richiedere il reso (recesso legale).
      </p>

      <div className="mt-6 rounded-2xl bg-white p-6 shadow ring-1 ring-cream-300">
        <label className="block text-sm font-medium text-ink-700">Motivo del reso</label>
        <div className="mt-2 space-y-2">
          {REASONS.map((r) => (
            <label key={r.value} className="flex cursor-pointer items-center gap-3 rounded-lg border border-cream-300 p-3 hover:bg-cream-50">
              <input
                type="radio"
                name="reason"
                value={r.value}
                checked={reason === r.value}
                onChange={(e) => setReason(e.target.value)}
                className="h-4 w-4 text-primary-700"
              />
              <span className="text-sm inline-flex items-center gap-2"><r.icon size={15} strokeWidth={2.2} className="text-ink-500" aria-hidden /> {r.label}</span>
            </label>
          ))}
        </div>

        <Textarea
          label="Dettagli aggiuntivi (opzionale)"
          containerClassName="mt-6"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          maxLength={2000}
          placeholder="Descrivi il problema in dettaglio…"
        />

        <label className="mt-6 block text-sm font-medium text-ink-700">
          Foto (max 8)
        </label>
        <div className="mt-2 flex flex-wrap gap-2">
          {photos.map((p) => (
            <img key={p} src={p} alt="prova" loading="lazy" className="h-20 w-20 rounded-lg object-cover ring-1 ring-cream-300" />
          ))}
          {photos.length < 8 && (
            <label className="inline-flex h-20 w-20 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-cream-300 text-2xl text-ink-400 hover:bg-cream-50">
              {uploading ? '…' : '+'}
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadPhoto(f);
                }}
              />
            </label>
          )}
        </div>

        <button
          onClick={submit}
          disabled={submitting}
          className="mt-6 w-full rounded-lg bg-primary-700 px-4 py-3 text-sm font-semibold text-white hover:bg-primary-800 disabled:opacity-50"
        >
          {submitting ? tStates('sending') : 'Invia richiesta di reso'}
        </button>
      </div>
    </div>
  );
}
