'use client';

import type { ReactNode } from 'react';
import { Instagram, Facebook, Globe, MessageCircle, Music2 } from 'lucide-react';
import type { StoreCustomization } from '@/lib/store-customization';

type Socials = NonNullable<StoreCustomization['socials']>;

interface Props {
  value?: Socials;
  onChange: (next: Socials) => void;
  /** R21-004 — Cosa non va in ogni campo, detto sotto il campo giusto. */
  errori?: Partial<Record<keyof Socials, string>>;
}

const FIELDS: { key: keyof Socials; label: string; placeholder: string; icon: ReactNode }[] = [
  { key: 'instagram', label: 'Instagram', placeholder: 'nomenegozio', icon: <Instagram size={16} /> },
  { key: 'facebook', label: 'Facebook', placeholder: 'nomepagina', icon: <Facebook size={16} /> },
  { key: 'tiktok', label: 'TikTok', placeholder: 'nomenegozio', icon: <Music2 size={16} /> },
  { key: 'whatsapp', label: 'WhatsApp', placeholder: '+39 333 1234567', icon: <MessageCircle size={16} /> },
  { key: 'website', label: 'Sito web', placeholder: 'https://...', icon: <Globe size={16} /> },
];

/** Input dei link social — si salva solo handle/numero/URL, gli href li costruisce il sito. */
export default function SocialLinksFields({ value, onChange, errori }: Props) {
  const set = (key: keyof Socials, v: string) => onChange({ ...value, [key]: v });
  return (
    <div className="space-y-2.5">
      {FIELDS.map((f) => {
        const errore = errori?.[f.key];
        return (
          <div key={f.key}>
            <div className="flex items-center gap-2">
              <span className="w-9 h-9 rounded-lg bg-cream-100 text-ink-500 flex items-center justify-center shrink-0" aria-hidden>
                {f.icon}
              </span>
              <label className="sr-only" htmlFor={`social-${f.key}`}>{f.label}</label>
              <input
                id={`social-${f.key}`}
                type="text"
                value={value?.[f.key] ?? ''}
                onChange={(e) => set(f.key, e.target.value)}
                placeholder={`${f.label} · ${f.placeholder}`}
                aria-invalid={errore ? true : undefined}
                aria-describedby={errore ? `social-${f.key}-errore` : undefined}
                className={`flex-1 border p-2 rounded focus:outline-none focus:ring-2 focus:ring-primary-700 text-sm ${errore ? 'border-secondary-600' : ''}`}
              />
            </div>
            {errore && (
              <p id={`social-${f.key}-errore`} role="alert" className="mt-1 pl-11 text-xs font-medium text-secondary-600">
                {errore}
              </p>
            )}
          </div>
        );
      })}
      <p className="text-xs text-ink-500">Scrivi il nome del profilo, senza @: se incolli il link lo correggiamo noi. Il sito va bene anche senza https.</p>
    </div>
  );
}
