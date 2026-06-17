'use client';

import { useState } from 'react';
import { Trash2, CheckCircle2 } from 'lucide-react';
import { Input, Textarea, Select, Checkbox } from '@/components/ui/Field';
import { ImageUrlField } from '@/components/ImageUrlField';
import type { HomeSection } from '@/lib/home-site';

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

function VideoField({ section, onChange }: { section: Extract<HomeSection, { type: 'video' }>; onChange: (s: HomeSection) => void }) {
  const c = section.config;
  const initialUrl = c.videoId
    ? c.provider === 'youtube' ? `https://youtu.be/${c.videoId}` : `https://vimeo.com/${c.videoId}`
    : '';
  const [url, setUrl] = useState(initialUrl);
  const [err, setErr] = useState<string | null>(null);
  const set = (patch: Partial<typeof c>) => onChange({ ...section, config: { ...c, ...patch } });

  const onInput = (v: string) => {
    setUrl(v);
    if (!v.trim()) { set({ videoId: '' }); setErr(null); return; }
    const parsed = parseVideo(v);
    if (parsed) { onChange({ ...section, config: { ...c, provider: parsed.provider, videoId: parsed.id } }); setErr(null); }
    else setErr('Link non riconosciuto. Incolla un URL di YouTube o Vimeo.');
  };

  return (
    <div className="space-y-3">
      <Input label="Titolo (opzionale)" value={c.heading ?? ''} maxLength={120} onChange={(e) => set({ heading: e.target.value })} />
      <Input label="Link YouTube o Vimeo" value={url} onChange={(e) => onInput(e.target.value)} error={err ?? undefined} placeholder="https://youtu.be/… oppure https://vimeo.com/…" />
      {c.videoId && <p className="text-xs text-olive-700 inline-flex items-center gap-1"><CheckCircle2 size={14} aria-hidden /> Video {c.provider} riconosciuto.</p>}
    </div>
  );
}

function StructuralNote({ type }: { type: string }) {
  const notes: Record<string, string> = {
    howItWorks: 'Mostra i 3 passi (scegli → ordina → ricevi). Nessuna impostazione.',
    dropOfDay: "Mostra il Drop del giorno (si gestisce dalla sezione 'Drop del giorno' e si auto-nasconde se assente).",
    shopOfMonth: "Mostra il Negozio del mese (si sceglie da 'Negozio mese').",
    stories: 'Mostra il carosello delle storie dei negozi.',
    events: "Mostra gli eventi del marketplace (si gestiscono da 'Eventi').",
    promo: 'Mostra le offerte e promo attive.',
    trending: 'Mostra i prodotti di tendenza ora.',
  };
  return <p className="text-sm text-ink-500">{notes[type] ?? 'Questa sezione non ha impostazioni.'}</p>;
}

/** Form di configurazione di una sezione della home: dispatch sul tipo. */
export default function HomeSectionConfigForm({ section, onChange }: { section: HomeSection; onChange: (s: HomeSection) => void }) {
  switch (section.type) {
    case 'hero': {
      const c = section.config;
      const set = (patch: Partial<typeof c>) => onChange({ ...section, config: { ...c, ...patch } });
      return (
        <div className="space-y-3">
          <p className="text-xs text-ink-500">Lascia i campi vuoti per usare il testo della variante A/B dell&apos;esperimento.</p>
          <Input label="Occhiello" value={c.eyebrow ?? ''} maxLength={160} onChange={(e) => set({ eyebrow: e.target.value })} />
          <Textarea label="Titolo" value={c.headline ?? ''} rows={2} maxLength={200} onChange={(e) => set({ headline: e.target.value })} />
          <Textarea label="Sottotitolo" value={c.subhead ?? ''} rows={3} maxLength={320} onChange={(e) => set({ subhead: e.target.value })} />
          <Input label="Testo pulsante principale" value={c.ctaLabel ?? ''} maxLength={40} onChange={(e) => set({ ctaLabel: e.target.value })} />
          <Checkbox
            checked={c.showChips !== false}
            onChange={(e) => set({ showChips: e.target.checked })}
            label={<>Mostra le scorciatoie alle categorie sotto la hero <span className="text-ink-400">(c&apos;è già la sezione &ldquo;Categorie&rdquo;)</span></>}
          />
        </div>
      );
    }
    case 'categories': {
      const c = section.config;
      const set = (patch: Partial<typeof c>) => onChange({ ...section, config: { ...c, ...patch } });
      return (
        <div className="space-y-3">
          <Input label="Titolo" value={c.heading ?? ''} maxLength={120} onChange={(e) => set({ heading: e.target.value })} placeholder="Cosa cerchi oggi?" />
          <Input label="Sottotitolo" value={c.subheading ?? ''} maxLength={200} onChange={(e) => set({ subheading: e.target.value })} placeholder="Tutte le categorie del mercato locale" />
        </div>
      );
    }
    case 'popularProducts': {
      const c = section.config;
      const set = (patch: Partial<typeof c>) => onChange({ ...section, config: { ...c, ...patch } });
      return (
        <div className="space-y-3">
          <Input label="Occhiello" value={c.eyebrow ?? ''} maxLength={60} onChange={(e) => set({ eyebrow: e.target.value })} placeholder="I più amati" />
          <Input label="Titolo" value={c.heading ?? ''} maxLength={120} onChange={(e) => set({ heading: e.target.value })} placeholder="Prodotti che vanno forte" />
          <Select label="Numero di prodotti" value={String(c.limit ?? 12)} onChange={(e) => set({ limit: Number(e.target.value) })}>
            {[4, 8, 12, 16, 20, 24].map((n) => <option key={n} value={n}>{n}</option>)}
          </Select>
        </div>
      );
    }
    case 'liveActivity': {
      const c = section.config;
      const set = (patch: Partial<typeof c>) => onChange({ ...section, config: { ...c, ...patch } });
      const bullets = c.bullets ?? [];
      const setBullet = (i: number, patch: Partial<(typeof bullets)[number]>) =>
        set({ bullets: bullets.map((b, k) => (k === i ? { ...b, ...patch } : b)) });
      return (
        <div className="space-y-3">
          <Input label="Titolo box vantaggi" value={c.trustTitle ?? ''} maxLength={120} onChange={(e) => set({ trustTitle: e.target.value })} placeholder="Perché scegliere MyCity" />
          <p className="text-xs text-ink-500">Vantaggi: lascia vuoto per usare i 4 di default.</p>
          {bullets.map((b, i) => (
            <div key={i} className="rounded-lg border border-cream-200 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-ink-500">Vantaggio {i + 1}</span>
                <button type="button" onClick={() => set({ bullets: bullets.filter((_, k) => k !== i) })} aria-label="Rimuovi vantaggio" className="text-ink-400 hover:text-red-600">
                  <Trash2 size={14} aria-hidden />
                </button>
              </div>
              <Input value={b.title} maxLength={80} onChange={(e) => setBullet(i, { title: e.target.value })} placeholder="Titolo vantaggio" />
              <Textarea value={b.desc} rows={2} maxLength={200} onChange={(e) => setBullet(i, { desc: e.target.value })} placeholder="Descrizione" />
            </div>
          ))}
          {bullets.length < 6 && (
            <button type="button" onClick={() => set({ bullets: [...bullets, { title: '', desc: '' }] })} className="text-sm font-semibold text-primary-700 hover:underline">
              + Aggiungi vantaggio
            </button>
          )}
        </div>
      );
    }
    case 'nearbyStores': {
      const c = section.config;
      const set = (patch: Partial<typeof c>) => onChange({ ...section, config: { ...c, ...patch } });
      return (
        <div className="space-y-3">
          <Input label="Occhiello" value={c.eyebrow ?? ''} maxLength={60} onChange={(e) => set({ eyebrow: e.target.value })} placeholder="Vicino a te" />
          <Input label="Titolo" value={c.heading ?? ''} maxLength={120} onChange={(e) => set({ heading: e.target.value })} placeholder="Sostieni i negozi di Piacenza" />
          <Input label="Sottotitolo" value={c.subheading ?? ''} maxLength={200} onChange={(e) => set({ subheading: e.target.value })} />
        </div>
      );
    }
    case 'newsletter': {
      const c = section.config;
      const set = (patch: Partial<typeof c>) => onChange({ ...section, config: { ...c, ...patch } });
      return (
        <div className="space-y-3">
          <Input label="Badge" value={c.badge ?? ''} maxLength={40} onChange={(e) => set({ badge: e.target.value })} placeholder="€5 in regalo" />
          <Input label="Titolo" value={c.heading ?? ''} maxLength={160} onChange={(e) => set({ heading: e.target.value })} />
          <Textarea label="Testo" value={c.body ?? ''} rows={3} maxLength={400} onChange={(e) => set({ body: e.target.value })} />
        </div>
      );
    }
    case 'sellerCta': {
      const c = section.config;
      const set = (patch: Partial<typeof c>) => onChange({ ...section, config: { ...c, ...patch } });
      return (
        <div className="space-y-3">
          <Input label="Titolo" value={c.heading ?? ''} maxLength={120} onChange={(e) => set({ heading: e.target.value })} placeholder="Hai un negozio a Piacenza?" />
          <Input label="Sottotesto" value={c.subtext ?? ''} maxLength={200} onChange={(e) => set({ subtext: e.target.value })} placeholder="Vendi online con zero commissioni." />
          <Input label="Testo pulsante" value={c.ctaLabel ?? ''} maxLength={40} onChange={(e) => set({ ctaLabel: e.target.value })} placeholder="Diventa venditore" />
          <Input label="Link pulsante" value={c.href ?? ''} onChange={(e) => set({ href: e.target.value })} placeholder="/sell" />
        </div>
      );
    }
    case 'richText': {
      const c = section.config;
      const set = (patch: Partial<typeof c>) => onChange({ ...section, config: { ...c, ...patch } });
      return (
        <div className="space-y-3">
          <Input label="Titolo (opzionale)" value={c.heading ?? ''} maxLength={120} onChange={(e) => set({ heading: e.target.value })} />
          <Textarea label="Testo" value={c.body ?? ''} rows={5} maxLength={4000} onChange={(e) => set({ body: e.target.value })} hint="Gli a-capo vengono mantenuti. Puoi usare grassetto, corsivo, elenchi e link." />
        </div>
      );
    }
    case 'banner': {
      const c = section.config;
      const set = (patch: Partial<typeof c>) => onChange({ ...section, config: { ...c, ...patch } });
      const cta = c.cta;
      const setCta = (patch: Partial<{ label: string; href: string }>) => {
        const next = { label: cta?.label ?? '', href: cta?.href ?? '', ...patch };
        set({ cta: next.label.trim() ? next : undefined });
      };
      return (
        <div className="space-y-3">
          <ImageUrlField label="Immagine banner" value={c.imageUrl ?? ''} onChange={(url) => set({ imageUrl: url })} pathPrefix="home" hint="Consigliato 16:9. Carica un file o incolla un URL https." />
          <Input label="Titolo" value={c.heading ?? ''} maxLength={120} onChange={(e) => set({ heading: e.target.value })} />
          <Input label="Sottotitolo" value={c.subheading ?? ''} maxLength={200} onChange={(e) => set({ subheading: e.target.value })} />
          <Select label="Sovrapposizione" value={c.overlay ?? 'dark'} onChange={(e) => set({ overlay: e.target.value as 'light' | 'dark' | 'none' })}>
            <option value="dark">Scura</option>
            <option value="light">Chiara</option>
            <option value="none">Nessuna</option>
          </Select>
          <div className="rounded-lg border border-cream-200 p-3 space-y-2">
            <span className="text-xs font-medium text-ink-500">Pulsante (opzionale)</span>
            <Input label="Testo pulsante" value={cta?.label ?? ''} maxLength={40} onChange={(e) => setCta({ label: e.target.value })} />
            <Input label="Link" value={cta?.href ?? ''} onChange={(e) => setCta({ href: e.target.value })} placeholder="/categorie oppure https://…" />
          </div>
        </div>
      );
    }
    case 'gallery': {
      const c = section.config;
      const set = (patch: Partial<typeof c>) => onChange({ ...section, config: { ...c, ...patch } });
      const items = c.items ?? [];
      const setItem = (i: number, patch: Partial<(typeof items)[number]>) =>
        set({ items: items.map((it, k) => (k === i ? { ...it, ...patch } : it)) });
      return (
        <div className="space-y-3">
          <Input label="Titolo (opzionale)" value={c.heading ?? ''} maxLength={120} onChange={(e) => set({ heading: e.target.value })} />
          {items.map((it, i) => (
            <div key={i} className="rounded-lg border border-cream-200 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-ink-500">Immagine {i + 1}</span>
                <button type="button" onClick={() => set({ items: items.filter((_, k) => k !== i) })} aria-label="Rimuovi immagine" className="text-ink-400 hover:text-red-600">
                  <Trash2 size={14} aria-hidden />
                </button>
              </div>
              <ImageUrlField label="" value={it.url} onChange={(url) => setItem(i, { url })} pathPrefix="home" />
              <Input label="Testo alternativo" value={it.alt ?? ''} maxLength={120} onChange={(e) => setItem(i, { alt: e.target.value })} />
            </div>
          ))}
          {items.length < 12 && (
            <button type="button" onClick={() => set({ items: [...items, { url: '', alt: '' }] })} className="text-sm font-semibold text-primary-700 hover:underline">
              + Aggiungi immagine
            </button>
          )}
        </div>
      );
    }
    case 'video':
      return <VideoField section={section} onChange={onChange} />;
    default:
      return <StructuralNote type={section.type} />;
  }
}
