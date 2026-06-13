'use client';

import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Camera, Sparkles, Star, ChevronLeft, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/errors';
import { uploadProductImages } from '@/lib/products/uploadImages';
import { LoadingState } from '@/components/ui/LoadingState';
import CameraCapture from '@/components/seller/CameraCapture';
import BackgroundRemovalPreview from '@/components/seller/BackgroundRemovalPreview';

/**
 * Campo foto prodotto condiviso (nuovo + modifica annuncio).
 *
 * Incapsula il blocco immagini e offre:
 *  - "Scatta foto": fotocamera in-app live (CameraCapture);
 *  - "Sfondo bianco": rimozione sfondo per singola foto;
 *  - riordino + scelta copertina (la prima foto è la copertina).
 *
 * Controllato (value/onChange = array di URL pubblici). La validazione ">=1
 * foto" e il disable del submit restano nelle pagine via `onUploadingChange` /
 * `onUploadSuccess`.
 */

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
  showCoverBadge = true,
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

  // Loop di upload condiviso (camera + galleria) — vedi lib/products/uploadImages.
  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setUploading(true);
      try {
        const uploaded = await uploadProductImages(files);
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

  // Riordino: la prima posizione è la copertina mostrata nelle liste.
  const move = (from: number, to: number) => {
    if (to < 0 || to >= value.length || from === to) return;
    const next = value.slice();
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: {
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
      'image/webp': ['.webp'],
    },
    // Limite generoso: le foto oltre i 5 MB vengono ricompresse lato client in
    // fase di upload (vedi uploadProductImages), non rifiutate. Qui blocchiamo
    // solo i file abnormi che non avrebbe senso provare a comprimere.
    maxSize: 30 * 1024 * 1024,
    maxFiles,
    onDropRejected: (rejections) => {
      const reason = rejections[0]?.errors[0]?.code;
      if (reason === 'file-too-large') toast.error('File troppo grande (max 30 MB)');
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
        <>
          {value.length > 1 && (
            <p className="text-xs text-ink-400 mt-3">
              Trascina o usa le frecce per riordinare. La <strong>prima foto è la copertina</strong>.
            </p>
          )}
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mt-2">
            {value.map((url, i) => (
              <div
                key={url}
                draggable
                onDragStart={(e) => e.dataTransfer.setData('text/plain', String(i))}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const from = Number(e.dataTransfer.getData('text/plain'));
                  if (!Number.isNaN(from)) move(from, i);
                }}
                className="group"
              >
                <div className="relative aspect-square">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" loading="lazy" className="w-full h-full object-cover rounded" />
                  <button
                    type="button"
                    onClick={() => onChange(value.filter((_, j) => j !== i))}
                    aria-label="Rimuovi immagine"
                    className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-6 h-6 text-xs leading-none"
                  >
                    ×
                  </button>
                  {showCoverBadge && i === 0 && (
                    <span className="absolute top-1 left-1 inline-flex items-center gap-0.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                      <Star size={9} strokeWidth={2.6} className="fill-white" aria-hidden /> Copertina
                    </span>
                  )}
                </div>

                {/* Controlli: riordina + copertina + sfondo bianco */}
                <div className="mt-1 flex items-center justify-between gap-1">
                  <button
                    type="button"
                    onClick={() => move(i, i - 1)}
                    disabled={i === 0}
                    aria-label="Sposta a sinistra"
                    className="rounded p-1 text-ink-500 hover:bg-cream-100 disabled:opacity-30"
                  >
                    <ChevronLeft size={14} strokeWidth={2.4} aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(i, 0)}
                    disabled={i === 0}
                    aria-label="Imposta come copertina"
                    title="Imposta come copertina"
                    className="rounded p-1 text-ink-500 hover:bg-cream-100 disabled:opacity-30"
                  >
                    <Star size={14} strokeWidth={2.4} className={i === 0 ? 'fill-amber-400 text-amber-500' : ''} aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(i, i + 1)}
                    disabled={i === value.length - 1}
                    aria-label="Sposta a destra"
                    className="rounded p-1 text-ink-500 hover:bg-cream-100 disabled:opacity-30"
                  >
                    <ChevronRight size={14} strokeWidth={2.4} aria-hidden />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setBgIndex(i)}
                  className="mt-1 w-full inline-flex items-center justify-center gap-1 rounded bg-black/70 px-1.5 py-1 text-[10px] font-semibold text-white hover:bg-black/85"
                >
                  <Sparkles size={11} strokeWidth={2.4} aria-hidden /> Sfondo bianco
                </button>
              </div>
            ))}
          </div>
        </>
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
