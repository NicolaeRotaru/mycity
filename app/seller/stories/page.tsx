'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Image from 'next/image';
import { Camera, Eye, Trash2, Upload, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { sizedImage } from '@/lib/image-url';
import { confirmDialog } from '@/components/ConfirmDialog';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { friendlyError } from '@/lib/errors';
import { queryKeys } from '@/lib/queries/keys';

/**
 * Seller: gestione Storie (instagram-like, 24h).
 *
 * Esperti senior consultati:
 * - Senior PM: "Il seller può creare 1 story al giorno, vedere quante view ha
 *   avuto. Time-to-create < 30 sec o nessuno lo userà."
 * - UX Designer: "Solo 2 input: foto + caption. Niente form a 10 campi."
 * - Marketplace PM: "Story analytics (view) = pride driver per il seller →
 *   continua a postare."
 * - Operations Manager: "Bucket 'stories' pubblico. Auto-expire 24h, no
 *   moderazione manuale (Trust & Safety report-based)."
 */

type Story = {
  id: string;
  image_url: string;
  caption: string | null;
  link_url: string | null;
  expires_at: string;
  view_count: number;
  created_at: string;
};

export default function SellerStoriesPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [image, setImage] = useState<File | null>(null);
  const [caption, setCaption] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [uploading, setUploading] = useState(false);

  const { data: stories = [] } = useQuery({
    queryKey: ['my-seller-stories'],
    queryFn: async (): Promise<Story[]> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data } = await supabase
        .from('seller_stories')
        .select('*')
        .eq('seller_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20);
      return (data ?? []) as Story[];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!image) throw new Error('Seleziona un\'immagine');
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');

      setUploading(true);
      // Upload immagine
      const ext = image.name.split('.').pop() ?? 'jpg';
      const path = `${user.id}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('stories').upload(path, image, { upsert: false, contentType: image.type });
      if (upErr) {
        if (upErr.message.includes('not found') || upErr.message.includes('bucket')) {
          throw new Error('Bucket "stories" non configurato. Applica la migration 035.');
        }
        throw upErr;
      }
      const { data: pub } = supabase.storage.from('stories').getPublicUrl(path);

      // Insert record
      const { error } = await supabase.from('seller_stories').insert({
        seller_id: user.id,
        image_url: pub.publicUrl,
        caption: caption.trim() || null,
        link_url: linkUrl.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Storia pubblicata! Sarà visibile 24h.');
      setOpen(false);
      setImage(null);
      setCaption('');
      setLinkUrl('');
      qc.invalidateQueries({ queryKey: ['my-seller-stories'] });
      qc.invalidateQueries({ queryKey: queryKeys.seller.storiesActive });
    },
    onError: (err: any) => toast.error(friendlyError(err)),
    onSettled: () => setUploading(false),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('seller_stories').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Storia rimossa');
      qc.invalidateQueries({ queryKey: ['my-seller-stories'] });
      qc.invalidateQueries({ queryKey: queryKeys.seller.storiesActive });
    },
    onError: (err: any) => toast.error(friendlyError(err)),
  });

  function hoursLeft(expiresAt: string): number {
    const ms = new Date(expiresAt).getTime() - Date.now();
    return Math.max(0, Math.round(ms / 3600_000));
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl space-y-6">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink-900 flex items-center gap-2">
            <Camera size={22} className="text-primary-700" strokeWidth={2.2} />
            Storie del negozio
          </h1>
          <p className="text-sm text-ink-500 mt-1">
            Foto + 1 frase. Scade in 24h. Modo veloce per restare in cima.
          </p>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 bg-primary-700 hover:bg-primary-800 text-white px-4 py-2 rounded-lg font-bold text-sm"
        >
          <Camera size={16} strokeWidth={2.4} /> Nuova storia
        </button>
      </header>

      {stories.length === 0 ? (
        <div className="bg-white border border-cream-300 rounded-xl p-8 text-center">
          <Camera size={48} className="mx-auto text-ink-300 mb-3" strokeWidth={1.5} />
          <p className="text-ink-500">Nessuna storia pubblicata.</p>
          <p className="text-xs text-ink-400 mt-1">Pubblica 1 foto al giorno per restare in evidenza.</p>
        </div>
      ) : (
        <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {stories.map((s) => {
            const hours = hoursLeft(s.expires_at);
            const active = hours > 0;
            return (
              <li key={s.id} className="relative bg-white border border-cream-300 rounded-xl overflow-hidden">
                <div className="relative aspect-[3/4]">
                  <Image
                    src={sizedImage(s.image_url, 'card')}
                    alt={s.caption ?? ''}
                    fill
                    sizes="200px"
                    className={`object-cover ${active ? '' : 'grayscale opacity-60'}`}
                  />
                  <div className="absolute top-2 left-2 inline-flex items-center gap-1 bg-black/60 text-white text-[10px] px-2 py-0.5 rounded-full">
                    <Clock size={10} strokeWidth={2.4} /> {active ? `${hours}h` : 'scaduta'}
                  </div>
                  <div className="absolute top-2 right-2 inline-flex items-center gap-1 bg-black/60 text-white text-[10px] px-2 py-0.5 rounded-full">
                    <Eye size={10} strokeWidth={2.4} /> {s.view_count}
                  </div>
                </div>
                {s.caption && <p className="text-xs p-2 text-ink-700 truncate">{s.caption}</p>}
                <button
                  onClick={async () => {
                    const ok = await confirmDialog({ title: 'Rimuovere storia?', danger: true });
                    if (ok) del.mutate(s.id);
                  }}
                  className="absolute bottom-2 right-2 bg-white/80 hover:bg-white text-rose-600 p-1.5 rounded-full"
                  aria-label="Elimina storia"
                >
                  <Trash2 size={12} strokeWidth={2.4} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Nuova storia"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>Annulla</Button>
            <Button onClick={() => create.mutate()} disabled={uploading || !image} icon={Upload}>
              {uploading ? 'Upload…' : 'Pubblica (24h)'}
            </Button>
          </>
        }
      >
          <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold mb-1">Foto (verticale 3:4 consigliata)</label>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => setImage(e.target.files?.[0] ?? null)}
                  className="w-full text-sm file:mr-3 file:bg-primary-100 file:text-primary-800 file:font-semibold file:rounded-lg file:px-3 file:py-2 file:border-0"
                />
                {image && (
                  <p className="text-xs text-ink-500 mt-1">
                    {image.name} ({(image.size / 1024).toFixed(0)} KB)
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">Caption (1 frase)</label>
                <textarea
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  maxLength={140}
                  rows={2}
                  placeholder="Es: Appena arrivata la prima fragola del Trebbia!"
                  className="w-full bg-cream-50 border border-cream-300 rounded-lg px-3 py-2 text-sm resize-none"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">Link prodotto/categoria (opz.)</label>
                <input
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  placeholder="/category/alimentari"
                  className="w-full bg-cream-50 border border-cream-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
          </div>
      </Modal>
    </div>
  );
}
