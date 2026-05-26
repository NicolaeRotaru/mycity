'use client';

import { useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import type { StoreMediaItem } from './StoreMediaCarousel';

interface Props {
  value: StoreMediaItem[];
  onChange: (next: StoreMediaItem[]) => void;
}

const MAX_IMAGES = 3;
const MAX_VIDEOS = 1;

const StoreMediaManager = ({ value, onChange }: Props) => {
  const [uploading, setUploading] = useState(false);

  const imageCount = value.filter((m) => m.type === 'image').length;
  const videoCount = value.filter((m) => m.type === 'video').length;

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 'image/*': [], 'video/*': [] },
    multiple: true,
    onDrop: async (files) => {
      setUploading(true);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Non autenticato');

        const next = [...value];
        for (const file of files) {
          const isVideo = file.type.startsWith('video/');
          const isImage = file.type.startsWith('image/');
          if (!isVideo && !isImage) continue;

          const currentImages = next.filter((m) => m.type === 'image').length;
          const currentVideos = next.filter((m) => m.type === 'video').length;
          if (isVideo && currentVideos >= MAX_VIDEOS) {
            toast.error('Max 1 video per negozio');
            continue;
          }
          if (isImage && currentImages >= MAX_IMAGES) {
            toast.error('Max 3 immagini per negozio');
            continue;
          }

          const ext = file.name.split('.').pop() ?? 'bin';
          const path = `store-media/${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
          const { error } = await supabase.storage.from('products').upload(path, file, {
            upsert: false,
            contentType: file.type,
          });
          if (error) {
            toast.error(error.message);
            continue;
          }
          const { data } = supabase.storage.from('products').getPublicUrl(path);
          next.push({ type: isVideo ? 'video' : 'image', url: data.publicUrl });
        }
        onChange(next);
        toast.success('Media caricato');
      } catch (err: any) {
        toast.error(err.message || 'Errore upload');
      } finally {
        setUploading(false);
      }
    },
  });

  const move = (i: number, dir: -1 | 1) => {
    const next = [...value];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  const remove = (i: number) => {
    onChange(value.filter((_, idx) => idx !== i));
  };

  const canAddMore = imageCount < MAX_IMAGES || videoCount < MAX_VIDEOS;

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-ink-700 mb-1">Copertina negozio</label>
        <p className="text-xs text-ink-500">
          Aggiungi fino a {MAX_IMAGES} immagini e 1 video. Trascina per riordinare.
          Attualmente: {imageCount}/{MAX_IMAGES} foto · {videoCount}/{MAX_VIDEOS} video.
        </p>
      </div>

      {value.length > 0 && (
        <ul className="space-y-2">
          {value.map((m, i) => (
            <li key={i} className="flex items-center gap-3 border rounded-lg p-2 bg-cream-50">
              <div className="w-20 h-16 rounded overflow-hidden bg-black shrink-0">
                {m.type === 'image' ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.url} alt="" loading="lazy" className="w-full h-full object-cover" />
                ) : (
                  <video src={m.url} muted playsInline className="w-full h-full object-cover" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-ink-700">
                  {m.type === 'image' ? '🖼️ Immagine' : '🎬 Video'} · posizione {i + 1}
                </p>
                <p className="text-xs text-ink-400 truncate">{m.url.split('/').pop()}</p>
              </div>
              <div className="flex flex-col gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  className="text-xs bg-white border px-2 py-1 rounded disabled:opacity-30"
                  aria-label="Sposta su"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === value.length - 1}
                  className="text-xs bg-white border px-2 py-1 rounded disabled:opacity-30"
                  aria-label="Sposta giù"
                >
                  ↓
                </button>
              </div>
              <button
                type="button"
                onClick={() => remove(i)}
                className="text-xs text-rose-600 hover:bg-rose-50 px-2 py-1 rounded shrink-0"
              >
                ✕ Rimuovi
              </button>
            </li>
          ))}
        </ul>
      )}

      {canAddMore && (
        <div
          {...getRootProps()}
          className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
            isDragActive ? 'border-primary-400 bg-primary-50' : 'border-cream-300 hover:border-cream-400'
          } ${uploading ? 'opacity-50 pointer-events-none' : ''}`}
        >
          <input {...getInputProps()} />
          <p className="text-sm text-ink-600">
            {uploading
              ? 'Caricamento…'
              : 'Trascina foto o video qui, oppure clicca per scegliere'}
          </p>
        </div>
      )}
    </div>
  );
};

export default StoreMediaManager;
