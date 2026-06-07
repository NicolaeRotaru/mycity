'use client';

import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Camera, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { friendlyError } from '@/lib/errors';
import { LoadingState } from '@/components/ui/LoadingState';
import CameraCapture from '@/components/seller/CameraCapture';
import BackgroundRemovalPreview from '@/components/seller/BackgroundRemovalPreview';

/**
 * Campo foto prodotto condiviso (nuovo + modifica annuncio).
 *
 * Incapsula il blocco immagini prima duplicato nelle due pagine e aggiunge:
 *  - "Scatta foto": fotocamera in-app live (CameraCapture).
 *  - "Sfondo bianco": rimozione sfondo per singola foto (BackgroundRemovalPreview).
 *
 * Controllato (value/onChange = array di URL pubblici). Lo stato `imageUrls`,
 * la validazione ">=1 foto" e il disable del submit restano nelle pagine: il
 * componente espone `onUploadingChange` e `onUploadSuccess` per mantenere quel
 * comportamento invariato.
 */

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
  error?: string | null;
  onUploadingChange?: (uploading: boolean) => void;
  onUploadSuccess?: () => void;
  label?: React.ReactNode;
  dropzoneHint?: string;
  hint?: string;
  showCoverBadge?: boolean;
  maxFiles?: number;
}

export default function ProductImagesField({
  value,
  onChange,
  error,
  onUploadingChange,
  onUploadSuccess,
  label = 'Foto del prodotto',
  dropzoneHint = 'Trascina qui le foto o clicca per selezionarle',
  hint,
  showCoverBadge = false,
  maxFiles = 8,
}: Props) {
  const [uploading, setUploadingState] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [bgIndex, setBgIndex] = useState<number | null>(null);

  const setUploading = useCallback(
    (b: boolean) => {
      setUploadingState(b);
      onUploadingChange?.(b);
    },
    [onUploadingChange],
  );

  // Loop di upload condiviso (camera + galleria), identico al precedente onDrop.
  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setUploading(true);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Non autenticato');

        const uploaded: string[] = [];
        for (const file of files) {
          if (file.size > 5 * 1024 * 1024) throw new Error(`File "${file.name}" troppo grande (max 5 MB)`);
          if (!ALLOWED.includes(file.type)) throw new Error(`Formato non valido per "${file.name}"`);
          const safeName = file.name.toLowerCase().replace(/[^a-z0-9.\-_]/g, '_').slice(-80);
          const ext = file.type.split('/')[1];
          const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName || `img.${ext}`}`;
          const { error: upErr } = await supabase.storage.from('products').upload(path, file, {
            cacheControl: '3600',
            upsert: false,
            contentType: file.type,
          });
          if (upErr) throw upErr;
          const { data } = supabase.storage.from('products').getPublicUrl(path);
          uploaded.push(data.publicUrl);
        }
        onChange([...value, ...uploaded]);
        onUploadSuccess?.();
        toast.success('Immagini caricate');
      } catch (err) {
        toast.error(friendlyError(err));
      } finally {
        setUploading(false);
      }
    },
    [value, onChange, onUploadSuccess, setUploading],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: {
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
      'image/webp': ['.webp'],
    },
    maxSize: 5 * 1024 * 1024,
    maxFiles,
    onDropRejected: (rejections) => {
      const reason = rejections[0]?.errors[0]?.code;
      if (reason === 'file-too-large') toast.error('File troppo grande (max 5 MB)');
      else if (reason === 'file-invalid-type') toast.error('Formato non supportato (solo JPG, PNG, WEBP)');
      else if (reason === 'too-many-files') toast.error(`Massimo ${maxFiles} foto per upload`);
      else toast.error('File non valido');
    },
    onDrop: (files) => { void uploadFiles(files); },
  });

  return (
    <div id="image-dropzone">
      <label className="block text-sm font-medium mb-1">{label}</label>

      {/* Scatta foto: fotocamera in-app */}
      <div className="mb-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setCameraOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg border border-cream-300 bg-white px-3 py-2 text-sm font-semibold text-ink-700 hover:border-primary-300 hover:bg-primary-50"
        >
          <Camera size={16} strokeWidth={2.2} aria-hidden /> Scatta foto
        </button>
        <span className="text-xs text-ink-400">oppure carica dalla galleria</span>
      </div>

      {/* Dropzone galleria/file */}
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
          error
            ? 'border-rose-300 bg-rose-50'
            : isDragActive
              ? 'border-primary-400 bg-primary-50'
              : 'border-cream-300 hover:border-primary-400'
        }`}
      >
        <input {...getInputProps()} />
        {uploading ? <LoadingState variant="inline" /> : <p className="text-ink-500">{dropzoneHint}</p>}
      </div>

      {hint && <p className="text-xs text-ink-400 mt-1">{hint}</p>}
      {error && <p className="text-sm text-rose-600 mt-1">{error}</p>}

      {value.length > 0 && (
        <div className="grid grid-cols-4 gap-2 mt-3">
          {value.map((url, i) => (
            <div key={url} className="relative aspect-square">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" loading="lazy" className="w-full h-full object-cover rounded" />
              <button
                type="button"
                onClick={() => onChange(value.filter((_, j) => j !== i))}
                aria-label="Rimuovi immagine"
                className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-6 h-6 text-xs"
              >
                ×
              </button>
              <button
                type="button"
                onClick={() => setBgIndex(i)}
                className="absolute bottom-1 left-1 right-1 inline-flex items-center justify-center gap-1 rounded bg-black/70 px-1.5 py-1 text-[10px] font-semibold text-white hover:bg-black/85"
              >
                <Sparkles size={11} strokeWidth={2.4} aria-hidden /> Sfondo bianco
              </button>
              {showCoverBadge && i === 0 && (
                <span className="absolute top-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">
                  Copertina
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <CameraCapture
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={(file) => { void uploadFiles([file]); }}
      />

      <BackgroundRemovalPreview
        open={bgIndex !== null}
        url={bgIndex !== null ? (value[bgIndex] ?? null) : null}
        onClose={() => setBgIndex(null)}
        onReplaced={(newUrl) => {
          if (bgIndex === null) return;
          onChange(value.map((u, j) => (j === bgIndex ? newUrl : u)));
        }}
      />
    </div>
  );
}
