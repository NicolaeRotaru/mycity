'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';

const REASONS = [
  { value: 'DAMAGED',           label: '📦 Prodotto danneggiato' },
  { value: 'WRONG_ITEM',        label: '🔄 Prodotto sbagliato' },
  { value: 'NOT_AS_DESCRIBED',  label: '⚠️ Non come descritto' },
  { value: 'CHANGED_MIND',      label: '💭 Ho cambiato idea' },
  { value: 'LATE',              label: '⏰ Consegna troppo in ritardo' },
  { value: 'OTHER',             label: '✏️ Altro' },
];

export default function NewReturnPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [reason, setReason] = useState<string>('DAMAGED');
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [order, setOrder] = useState<any>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('orders')
        .select('id, total_price, delivered_at, delivery_status')
        .eq('id', params.id)
        .single();
      setOrder(data);
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
    } catch (e: any) {
      toast.error(e?.message ?? 'Upload fallito');
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
      if (!r.ok) throw new Error(data?.error ?? 'Errore');
      toast.success('Richiesta di reso inviata');
      router.push(`/orders/${params.id}`);
    } catch (e: any) {
      toast.error(e?.message ?? 'Errore');
    } finally {
      setSubmitting(false);
    }
  }

  if (!order) return <div className="container mx-auto p-6">Caricamento…</div>;

  return (
    <div className="container mx-auto max-w-xl px-4 py-8">
      <Link href={`/orders/${params.id}`} className="text-sm text-indigo-600 hover:underline">
        ← Torna all&apos;ordine
      </Link>
      <h1 className="mt-2 text-2xl font-bold text-slate-900">Richiedi un reso</h1>
      <p className="mt-1 text-sm text-slate-600">
        Hai 14 giorni dalla consegna per richiedere il reso (recesso legale).
      </p>

      <div className="mt-6 rounded-2xl bg-white p-6 shadow ring-1 ring-slate-200">
        <label className="block text-sm font-medium text-slate-700">Motivo del reso</label>
        <div className="mt-2 space-y-2">
          {REASONS.map((r) => (
            <label key={r.value} className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50">
              <input
                type="radio"
                name="reason"
                value={r.value}
                checked={reason === r.value}
                onChange={(e) => setReason(e.target.value)}
                className="h-4 w-4 text-indigo-600"
              />
              <span className="text-sm">{r.label}</span>
            </label>
          ))}
        </div>

        <label className="mt-6 block text-sm font-medium text-slate-700">
          Dettagli aggiuntivi (opzionale)
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          maxLength={2000}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="Descrivi il problema in dettaglio…"
        />

        <label className="mt-6 block text-sm font-medium text-slate-700">
          Foto (max 8)
        </label>
        <div className="mt-2 flex flex-wrap gap-2">
          {photos.map((p) => (
            <img key={p} src={p} alt="prova" className="h-20 w-20 rounded-lg object-cover ring-1 ring-slate-200" />
          ))}
          {photos.length < 8 && (
            <label className="inline-flex h-20 w-20 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-slate-300 text-2xl text-slate-400 hover:bg-slate-50">
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
          className="mt-6 w-full rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {submitting ? 'Invio…' : 'Invia richiesta di reso'}
        </button>
      </div>
    </div>
  );
}
