'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useDropzone } from 'react-dropzone';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/Field';
import { sizedImage } from '@/lib/image-url';
import { friendlyError } from '@/lib/errors';
import { MAX_GALLERY_ITEMS, type SiteSection } from '@/lib/store-site';
import { uploadSiteImage } from './ImageUpload';

type GallerySec = Extract<SiteSection, { type: 'gallery' }>;
type Cfg = GallerySec['config'];
type Item = Cfg['items'][number];

/** Config del blocco "galleria": upload multiplo di immagini con testo alternativo. */
export default function GalleryFields({ section, onChange }: { section: GallerySec; onChange: (s: SiteSection) => void }) {
  const c = section.config;
  const items = c.items ?? [];
  const set = (patch: Partial<Cfg>) => onChange({ ...section, config: { ...c, ...patch } });
  const [busy, setBusy] = useState(false);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 'image/*': [] },
    disabled: busy || items.length >= MAX_GALLERY_ITEMS,
    onDrop: async (files) => {
      const toUpload = files.slice(0, MAX_GALLERY_ITEMS - items.length);
      if (toUpload.length === 0) return;
      setBusy(true);
      try {
        const urls = await Promise.all(toUpload.map(uploadSiteImage));
        set({ items: [...items, ...urls.map((url) => ({ url, alt: '' }) as Item)] });
      } catch (e) {
        toast.error(friendlyError(e));
      } finally {
        setBusy(false);
      }
    },
  });

  const setItem = (i: number, patch: Partial<Item>) =>
    set({ items: items.map((it, k) => (k === i ? { ...it, ...patch } : it)) });
  const remove = (i: number) => set({ items: items.filter((_, k) => k !== i) });

  return (
    <div className="space-y-3">
      <Input
        label="Titolo (opzionale)"
        value={c.heading ?? ''}
        maxLength={120}
        onChange={(e) => set({ heading: e.target.value })}
      />
      {items.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {items.map((it, i) => (
            <div key={i} className="space-y-1">
              <div className="relative aspect-square rounded-lg overflow-hidden border border-cream-200">
                <Image src={sizedImage(it.url, 'thumb')} alt="" fill sizes="160px" className="object-cover" />
                <button
                  type="button"
                  onClick={() => remove(i)}
                  aria-label="Rimuovi immagine"
                  className="absolute top-1 right-1 bg-white/90 text-ink-600 hover:text-red-600 rounded p-1 shadow"
                >
                  <Trash2 size={14} aria-hidden />
                </button>
              </div>
              <input
                value={it.alt ?? ''}
                maxLength={120}
                onChange={(e) => setItem(i, { alt: e.target.value })}
                placeholder="Descrizione"
                className="w-full border border-cream-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-primary-400"
              />
            </div>
          ))}
        </div>
      )}
      {items.length < MAX_GALLERY_ITEMS && (
        <div
          {...getRootProps()}
          className={`border-2 border-dashed rounded-lg p-4 cursor-pointer text-sm text-center transition-colors ${
            isDragActive ? 'border-primary-400 bg-primary-50' : 'border-cream-300 hover:border-cream-400'
          } ${busy ? 'opacity-50 pointer-events-none' : ''}`}
        >
          <input {...getInputProps()} />
          {busy ? 'Caricamento…' : `Aggiungi immagini (max ${MAX_GALLERY_ITEMS})`}
        </div>
      )}
    </div>
  );
}
