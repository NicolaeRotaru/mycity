'use client';

import { type StoreCustomization, MAX_ANNOUNCEMENT } from '@/lib/store-customization';

type Announcement = NonNullable<StoreCustomization['announcement']>;

interface Props {
  value?: Announcement;
  onChange: (next: Announcement) => void;
}

/** Banner annuncio (es. ferie / novità) con scadenza opzionale. */
export default function AnnouncementEditor({ value, onChange }: Props) {
  const enabled = value?.enabled ?? false;
  const text = value?.text ?? '';
  const until = value?.until ?? '';
  const patch = (p: Partial<Announcement>) => onChange({ enabled, text, until, ...p });

  return (
    <div className="space-y-2.5">
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => patch({ enabled: e.target.checked })}
          className="rounded border-cream-300 text-primary-600 focus:ring-primary-400"
        />
        <span className="text-sm font-medium text-ink-700">Mostra un banner annuncio in vetrina</span>
      </label>

      {enabled && (
        <>
          <textarea
            value={text}
            maxLength={MAX_ANNOUNCEMENT}
            onChange={(e) => patch({ text: e.target.value })}
            rows={2}
            placeholder="Es. Chiusi per ferie dal 10 al 20 agosto · Nuovi arrivi in negozio!"
            className="w-full border p-2 rounded focus:outline-none focus:ring-2 focus:ring-primary-400 resize-none text-sm"
          />
          <div className="flex items-center gap-2 text-sm flex-wrap">
            <label className="text-ink-600" htmlFor="announcement-until">Fino al</label>
            <input
              id="announcement-until"
              type="date"
              value={until}
              onChange={(e) => patch({ until: e.target.value })}
              className="border p-1.5 rounded focus:outline-none focus:ring-2 focus:ring-primary-400"
            />
            <span className="text-xs text-ink-400">(opzionale — dopo questa data sparisce)</span>
          </div>
        </>
      )}
    </div>
  );
}
