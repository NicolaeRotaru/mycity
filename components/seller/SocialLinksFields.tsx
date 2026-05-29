'use client';

import type { ReactNode } from 'react';
import { Instagram, Facebook, Globe, MessageCircle, Music2 } from 'lucide-react';
import type { StoreCustomization } from '@/lib/store-customization';

type Socials = NonNullable<StoreCustomization['socials']>;

interface Props {
  value?: Socials;
  onChange: (next: Socials) => void;
  /** Errori per campo (key social → messaggio). Mostrati sotto l'input. */
  errors?: Partial<Record<keyof Socials, string | undefined>>;
}

const FIELDS: { key: keyof Socials; label: string; placeholder: string; icon: ReactNode }[] = [
  { key: 'instagram', label: 'Instagram', placeholder: 'nomenegozio', icon: <Instagram size={16} /> },
  { key: 'facebook', label: 'Facebook', placeholder: 'nomepagina', icon: <Facebook size={16} /> },
  { key: 'tiktok', label: 'TikTok', placeholder: 'nomenegozio', icon: <Music2 size={16} /> },
  { key: 'whatsapp', label: 'WhatsApp', placeholder: '+39 333 1234567', icon: <MessageCircle size={16} /> },
  { key: 'website', label: 'Sito web', placeholder: 'https://...', icon: <Globe size={16} /> },
];

/** Input dei link social — si salva solo handle/numero/URL, gli href li costruisce il sito. */
export default function SocialLinksFields({ value, onChange, errors }: Props) {
  const set = (key: keyof Socials, v: string) => onChange({ ...value, [key]: v });
  return (
    <div className="space-y-2.5">
      {FIELDS.map((f) => {
        const err = errors?.[f.key];
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
                aria-invalid={err ? true : undefined}
                aria-describedby={err ? `social-${f.key}-err` : undefined}
                className={`flex-1 border p-2 rounded focus:outline-none focus:ring-2 text-sm ${
                  err ? 'border-red-400 focus:ring-red-300' : 'focus:ring-primary-400'
                }`}
              />
            </div>
            {err && (
              <p id={`social-${f.key}-err`} className="text-red-500 text-xs mt-1 ml-11">
                {f.label}: {err}
              </p>
            )}
          </div>
        );
      })}
      <p className="text-xs text-ink-500">Inserisci solo il nome utente (senza @) o l&apos;URL del sito.</p>
    </div>
  );
}
