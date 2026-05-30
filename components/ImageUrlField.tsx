'use client';

import { useState } from 'react';
import { useDropzone } from 'react-dropzone';
import Image from 'next/image';
import { Upload, X, Link as LinkIcon } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { friendlyError } from '@/lib/errors';

/**
 * Campo immagine riutilizzabile: accetta SIA un URL incollato a mano SIA il
 * caricamento di un file dal dispositivo (dropzone → Supabase Storage).
 * In entrambi i casi scrive la URL pubblica risultante in `value`.
 *
 * Riusa lo stesso pattern di upload di components/VendorForm.tsx
 * (supabase.storage.from(bucket).upload + getPublicUrl).
 */
type Props = {
  value: string;
  onChange: (url: string) => void;
  /** Bucket Storage pubblico in cui caricare i file. Default: 'products'. */
  bucket?: string;
  /** Prefisso del path nel bucket (es. 'events', 'shop'). */
  pathPrefix: string;
  label: string;
  hint?: string;
};

export function ImageUrlField({ value, onChange, bucket = 'products', pathPrefix, label, hint }: Props) {
  const [uploading, setUploading] = useState(false);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 'image/*': [] },
    maxFiles: 1,
    multiple: false,
    disabled: uploading,
    onDrop: async (files) => {
      const file = files[0];
      if (!file) return;
      setUploading(true);
      try {
        const ext = file.name.split('.').pop()?.toLowerCase() ?? 'png';
        const path = `${pathPrefix}/${Date.now()}.${ext}`;
        const { error } = await supabase.storage.from(bucket).upload(path, file, {
          upsert: true,
          contentType: file.type,
        });
        if (error) throw error;
        const { data } = supabase.storage.from(bucket).getPublicUrl(path);
        onChange(data.publicUrl);
        toast.success('Immagine caricata');
      } catch (err) {
        toast.error(friendlyError(err));
      } finally {
        setUploading(false);
      }
    },
  });

  return (
    <div>
      <label className="block text-sm font-semibold text-ink-700 mb-1">{label}</label>

      {/* Anteprima + rimozione */}
      {value ? (
        <div className="mb-2 flex items-center gap-3">
          <div className="relative w-20 h-20 rounded-lg overflow-hidden bg-cream-100 border border-cream-300 shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <Image src={value} alt="Anteprima" fill sizes="80px" unoptimized className="object-cover" />
          </div>
          <button
            type="button"
            onClick={() => onChange('')}
            className="inline-flex items-center gap-1 text-xs font-semibold text-rose-700 hover:text-rose-800"
          >
            <X size={14} strokeWidth={2.4} /> Rimuovi
          </button>
        </div>
      ) : null}

      {/* Dropzone "carica da dispositivo" */}
      <div
        {...getRootProps()}
        className={`flex items-center justify-center gap-2 border-2 border-dashed rounded-lg px-3 py-3 text-sm cursor-pointer transition-colors mb-2 ${
          isDragActive ? 'border-primary-400 bg-primary-50' : 'border-cream-300 bg-cream-50 hover:border-primary-300'
        } ${uploading ? 'opacity-60 cursor-wait' : ''}`}
      >
        <input {...getInputProps()} />
        <Upload size={16} strokeWidth={2.2} className="text-ink-500" aria-hidden />
        <span className="text-ink-600">
          {uploading ? 'Caricamento…' : isDragActive ? 'Rilascia qui…' : 'Carica da dispositivo'}
        </span>
      </div>

      {/* Oppure incolla un URL */}
      <div className="relative">
        <LinkIcon size={14} strokeWidth={2.2} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400" aria-hidden />
        <input
          type="url"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="oppure incolla un URL https://…"
          className="w-full bg-cream-50 border border-cream-300 rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
        />
      </div>

      {hint ? <p className="mt-1 text-xs text-ink-400">{hint}</p> : null}
    </div>
  );
}
