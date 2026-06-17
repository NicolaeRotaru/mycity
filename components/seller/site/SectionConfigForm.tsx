'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Trash2, CheckCircle2 } from 'lucide-react';
import { Input, Textarea, Checkbox } from '@/components/ui/Field';
import type { SiteSection } from '@/lib/store-site';
import BannerFields from './BannerFields';
import CollectionFields from './CollectionFields';
import GalleryFields from './GalleryFields';

type VideoSec = Extract<SiteSection, { type: 'video' }>;

/** Estrae provider + id da un URL YouTube/Vimeo (o da un id grezzo). */
function parseVideo(input: string): { provider: 'youtube' | 'vimeo'; id: string } | null {
  const s = input.trim();
  const yt = s.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (yt) return { provider: 'youtube', id: yt[1] };
  const vm = s.match(/vimeo\.com\/(?:video\/)?(\d{6,12})/);
  if (vm) return { provider: 'vimeo', id: vm[1] };
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return { provider: 'youtube', id: s };
  if (/^\d{6,12}$/.test(s)) return { provider: 'vimeo', id: s };
  return null;
}

function VideoField({ section, onChange }: { section: VideoSec; onChange: (s: SiteSection) => void }) {
  const c = section.config;
  const initialUrl = c.videoId
    ? c.provider === 'youtube' ? `https://youtu.be/${c.videoId}` : `https://vimeo.com/${c.videoId}`
    : '';
  const [url, setUrl] = useState(initialUrl);
  const [err, setErr] = useState<string | null>(null);
  const set = (patch: Partial<VideoSec['config']>) => onChange({ ...section, config: { ...c, ...patch } });

  const onInput = (v: string) => {
    setUrl(v);
    if (!v.trim()) {
      set({ videoId: '' });
      setErr(null);
      return;
    }
    const parsed = parseVideo(v);
    if (parsed) {
      onChange({ ...section, config: { ...c, provider: parsed.provider, videoId: parsed.id } });
      setErr(null);
    } else {
      setErr('Link non riconosciuto. Incolla un URL di YouTube o Vimeo.');
    }
  };

  return (
    <div className="space-y-3">
      <Input label="Titolo (opzionale)" value={c.heading ?? ''} maxLength={120} onChange={(e) => set({ heading: e.target.value })} />
      <Input
        label="Link YouTube o Vimeo"
        value={url}
        onChange={(e) => onInput(e.target.value)}
        error={err ?? undefined}
        placeholder="https://youtu.be/… oppure https://vimeo.com/…"
      />
      {c.videoId && <p className="text-xs text-olive-700 inline-flex items-center gap-1"><CheckCircle2 size={14} aria-hidden /> Video {c.provider} riconosciuto.</p>}
    </div>
  );
}

function StructuralNote({ type }: { type: string }) {
  const notes: Record<string, string> = {
    contact: 'Mostra telefono e indirizzo del tuo negozio.',
    hours: 'Mostra gli orari di apertura (si modificano da Profilo negozio).',
    reviews: 'Mostra le recensioni dei clienti.',
    featured: 'Mostra i prodotti in evidenza (si scelgono da Profilo negozio).',
    promotions: 'Mostra le promozioni attive (si creano nella sezione Promozioni).',
    productGrid: 'Mostra tutti i tuoi prodotti con ricerca e filtri.',
  };
  return <p className="text-sm text-ink-500">{notes[type] ?? 'Questa sezione non ha impostazioni.'}</p>;
}

/** Form di configurazione di una sezione: dispatch sul tipo (unione discriminata). */
export default function SectionConfigForm({ section, onChange }: { section: SiteSection; onChange: (s: SiteSection) => void }) {
  switch (section.type) {
    case 'hero': {
      const c = section.config;
      const set = (patch: Partial<typeof c>) => onChange({ ...section, config: { ...c, ...patch } });
      return (
        <div className="space-y-2">
          <Checkbox label="Mostra descrizione" checked={c.showDescription !== false} onChange={(e) => set({ showDescription: e.target.checked })} />
          <Checkbox label="Mostra badge (punti di forza)" checked={c.showBadges !== false} onChange={(e) => set({ showBadges: e.target.checked })} />
          <Checkbox label="Mostra link social" checked={c.showSocials !== false} onChange={(e) => set({ showSocials: e.target.checked })} />
          <p className="text-xs text-ink-500 pt-1">
            Logo, copertina, nome e slogan si modificano da{' '}
            <Link href="/seller/profile" className="text-primary-700 underline">Profilo negozio</Link>.
          </p>
        </div>
      );
    }
    case 'richText': {
      const c = section.config;
      const set = (patch: Partial<typeof c>) => onChange({ ...section, config: { ...c, ...patch } });
      return (
        <div className="space-y-3">
          <Input label="Titolo (opzionale)" value={c.heading ?? ''} maxLength={120} onChange={(e) => set({ heading: e.target.value })} />
          <Textarea
            label="Testo"
            value={c.body ?? ''}
            rows={5}
            maxLength={4000}
            onChange={(e) => set({ body: e.target.value })}
            hint="Gli a-capo vengono mantenuti. Puoi usare grassetto, corsivo, elenchi e link."
          />
        </div>
      );
    }
    case 'video':
      return <VideoField section={section} onChange={onChange} />;
    case 'faq': {
      const c = section.config;
      const items = c.items ?? [];
      const set = (patch: Partial<typeof c>) => onChange({ ...section, config: { ...c, ...patch } });
      const setItem = (i: number, patch: Partial<(typeof items)[number]>) =>
        set({ items: items.map((it, k) => (k === i ? { ...it, ...patch } : it)) });
      return (
        <div className="space-y-3">
          <Input label="Titolo (opzionale)" value={c.heading ?? ''} maxLength={120} onChange={(e) => set({ heading: e.target.value })} />
          {items.map((it, i) => (
            <div key={i} className="rounded-lg border border-cream-200 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-ink-500">Domanda {i + 1}</span>
                <button type="button" onClick={() => set({ items: items.filter((_, k) => k !== i) })} aria-label="Rimuovi domanda" className="text-ink-400 hover:text-red-600">
                  <Trash2 size={14} aria-hidden />
                </button>
              </div>
              <Input value={it.q} maxLength={200} onChange={(e) => setItem(i, { q: e.target.value })} placeholder="Domanda" />
              <Textarea value={it.a} rows={2} maxLength={1000} onChange={(e) => setItem(i, { a: e.target.value })} placeholder="Risposta" />
            </div>
          ))}
          <button type="button" onClick={() => set({ items: [...items, { q: '', a: '' }] })} className="text-sm font-semibold text-primary-700 hover:underline">
            + Aggiungi domanda
          </button>
        </div>
      );
    }
    case 'banner':
      return <BannerFields section={section} onChange={onChange} />;
    case 'collection':
      return <CollectionFields section={section} onChange={onChange} />;
    case 'gallery':
      return <GalleryFields section={section} onChange={onChange} />;
    default:
      return <StructuralNote type={section.type} />;
  }
}
