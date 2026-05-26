'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';

type Props = {
  orderId: string;
  expectedCents: number;
  onConfirmed?: () => void;
};

/**
 * Dialog conferma cash on delivery:
 *  - Importo incassato (pre-popolato col totale)
 *  - Foto contanti/scontrino (obbligatoria)
 *  - Foto consegna pacco (raccomandata)
 *
 * Alla conferma chiama /api/rider/cash-confirm che valida lato server
 * (rider proprietario, stato ordine, payment_method=cod, non duplicato).
 */
export default function CashConfirmDialog({ orderId, expectedCents, onConfirmed }: Props) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState((expectedCents / 100).toFixed(2));
  const [cashPhoto, setCashPhoto] = useState<string | null>(null);
  const [deliveryPhoto, setDeliveryPhoto] = useState<string | null>(null);
  const [uploading, setUploading] = useState<'cash' | 'delivery' | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function upload(file: File, kind: 'cash' | 'delivery'): Promise<string | null> {
    setUploading(kind);
    try {
      const path = `cod-proof/${orderId}/${kind}-${Date.now()}.jpg`;
      const { error } = await supabase.storage.from('products').upload(path, file, { upsert: false });
      if (error) throw error;
      const { data } = supabase.storage.from('products').getPublicUrl(path);
      return data.publicUrl;
    } catch (e: any) {
      toast.error(e?.message ?? 'Upload fallito');
      return null;
    } finally {
      setUploading(null);
    }
  }

  async function submit() {
    if (!cashPhoto) {
      toast.error('Carica la foto dei contanti / scontrino');
      return;
    }
    const cents = Math.round(parseFloat(amount) * 100);
    if (Number.isNaN(cents) || cents < 0) {
      toast.error('Importo non valido');
      return;
    }
    setSubmitting(true);
    try {
      const r = await fetch('/api/rider/cash-confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          orderId,
          cashCollectedCents: cents,
          photoUrl: cashPhoto,
          deliveryPhotoUrl: deliveryPhoto ?? undefined,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? 'Errore');
      toast.success('Incasso confermato');
      setOpen(false);
      onConfirmed?.();
    } catch (e: any) {
      toast.error(e?.message ?? 'Errore');
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-lg bg-accent-500 px-4 py-3 text-sm font-semibold text-white hover:bg-accent-600"
      >
        💶 Conferma incasso contanti
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-3">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <h2 className="text-lg font-semibold text-ink-900">Conferma incasso contanti</h2>
        <p className="mt-1 text-xs text-ink-500">
          Inserisci l&apos;importo ricevuto, una foto dei contanti o dello scontrino, e una foto
          della consegna.
        </p>

        <label className="mt-4 block text-sm font-medium text-ink-700">Importo incassato (€)</label>
        <input
          type="number"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="mt-1 w-full rounded-lg border border-cream-300 px-3 py-2 text-lg font-mono"
        />
        <p className="mt-1 text-xs text-ink-500">Importo previsto: €{(expectedCents / 100).toFixed(2)}</p>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <PhotoSlot
            label="Foto contanti / scontrino"
            required
            url={cashPhoto}
            uploading={uploading === 'cash'}
            onChange={async (f) => setCashPhoto(await upload(f, 'cash'))}
          />
          <PhotoSlot
            label="Foto consegna pacco"
            required={false}
            url={deliveryPhoto}
            uploading={uploading === 'delivery'}
            onChange={async (f) => setDeliveryPhoto(await upload(f, 'delivery'))}
          />
        </div>

        <div className="mt-6 flex gap-2">
          <button
            onClick={() => setOpen(false)}
            disabled={submitting}
            className="flex-1 rounded-lg px-4 py-2 text-sm font-medium text-ink-700 ring-1 ring-cream-300 hover:bg-cream-50"
          >
            Annulla
          </button>
          <button
            onClick={submit}
            disabled={submitting || !cashPhoto}
            className="flex-1 rounded-lg bg-accent-500 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-600 disabled:opacity-50"
          >
            {submitting ? 'Invio…' : 'Conferma'}
          </button>
        </div>
      </div>
    </div>
  );
}

function PhotoSlot({
  label, required, url, uploading, onChange,
}: {
  label: string;
  required: boolean;
  url: string | null;
  uploading: boolean;
  onChange: (f: File) => void;
}) {
  return (
    <label className="cursor-pointer">
      <div className="text-xs font-medium text-ink-700">
        {label} {required && <span className="text-rose-600">*</span>}
      </div>
      <div className="mt-1 flex h-24 items-center justify-center rounded-lg border-2 border-dashed border-cream-300 bg-cream-50">
        {url ? (
          <img src={url} alt="" className="h-full w-full rounded-lg object-cover" />
        ) : (
          <span className="text-xl text-ink-400">{uploading ? '…' : '📷'}</span>
        )}
      </div>
      <input
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onChange(f);
        }}
      />
    </label>
  );
}
