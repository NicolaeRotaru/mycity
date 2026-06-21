'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { friendlyError } from '@/lib/errors';
import { queryKeys } from '@/lib/queries/keys';
import { THEME_PRESETS, type ThemeKey } from '@/lib/store-site';
import {
  ACCENT_PRESETS,
  DEFAULT_ACCENT,
  normalizeCustomization,
} from '@/lib/store-customization';

/**
 * Scelta del tema/look del sito (catalogo chiuso, sul modello di CoverPicker)
 * + swatch dell'accent (colore del negozio).
 *
 * SPLIT DI SALVATAGGIO (importante, non spostarlo):
 *  - Il TEMA vive in store_site → persiste con il salvataggio del sito (onChange → commit).
 *  - L'ACCENT vive in store_customization → ha il suo salvataggio dedicato. Qui lo
 *    scriviamo SOLO sulla colonna store_customization (non sul site save) e notifichiamo
 *    il consumer via onAccentChange così l'anteprima dal vivo si ricolora subito (la
 *    SitePreview legge già l'accent). Design: 85-extra.txt → Vetrina (swatch tema).
 *
 * Le prop dell'accent sono OPZIONALI: senza di esse il componente resta retro-compatibile
 * (solo griglia tema, come prima).
 */
export default function ThemePicker({
  value,
  onChange,
  accent,
  onAccentChange,
}: {
  value: ThemeKey;
  onChange: (t: ThemeKey) => void;
  /** Hex dell'accent corrente (da store_customization). Se assente, niente swatch. */
  accent?: string;
  /** Notifica il cambio accent per ricolorare l'anteprima dal vivo (preview reads accent already). */
  onAccentChange?: (hex: string) => void;
}) {
  const qc = useQueryClient();
  // Selezione ottimistica locale: ricolora subito mentre il salvataggio gira.
  const [pendingAccent, setPendingAccent] = useState<string | null>(null);
  const currentAccent = pendingAccent ?? accent ?? DEFAULT_ACCENT;

  // Salvataggio DEDICATO dell'accent su store_customization (non tocca il site save).
  const saveAccent = useMutation({
    mutationFn: async (hex: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const { data: profile } = await supabase
        .from('profiles')
        .select('store_customization')
        .eq('id', user.id)
        .single();
      const current = normalizeCustomization(profile?.store_customization);
      const next = { ...current, theme: { ...current.theme, accent: hex } };
      const { error } = await supabase
        .from('profiles')
        .update({ store_customization: next })
        .eq('id', user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.seller.profile });
      toast.success('Colore del negozio aggiornato');
    },
    onError: (e: unknown) => {
      setPendingAccent(null);
      toast.error(friendlyError(e));
    },
  });

  const pickAccent = (hex: string) => {
    if (hex === currentAccent) return;
    setPendingAccent(hex);     // ricolora subito (ottimistico)
    onAccentChange?.(hex);     // l'anteprima dal vivo legge il nuovo accent
    saveAccent.mutate(hex);    // persiste su store_customization (save dedicato)
  };

  const showAccents = accent !== undefined || onAccentChange !== undefined;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {THEME_PRESETS.map((t) => {
          const active = t.key === value;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => onChange(t.key)}
              aria-pressed={active}
              className={`rounded-xl border p-3 text-left transition-all ${
                active
                  ? 'border-primary-500 bg-primary-50/40 ring-2 ring-primary-200'
                  : 'border-cream-300 bg-white hover:border-cream-400'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-ink-900">{t.label}</span>
                {active && <Check size={16} className="shrink-0 text-primary-600" aria-hidden />}
              </div>
              <p className="mt-0.5 text-xs text-ink-500">{t.description}</p>
            </button>
          );
        })}
      </div>

      {showAccents && (
        <div>
          <p className="mb-2 text-sm font-semibold text-ink-900">Colore del negozio</p>
          <p className="mb-3 text-xs text-ink-500">
            Tinge copertina, badge e pulsanti della vetrina. L&apos;anteprima si aggiorna dal vivo.
          </p>
          <div className="flex flex-wrap gap-2.5">
            {ACCENT_PRESETS.map((a) => {
              const active = a.hex === currentAccent;
              return (
                <button
                  key={a.key}
                  type="button"
                  onClick={() => pickAccent(a.hex)}
                  disabled={saveAccent.isPending}
                  title={a.label}
                  aria-label={`Accent ${a.label}`}
                  aria-pressed={active}
                  className={`inline-flex h-9 w-9 items-center justify-center rounded-full ring-2 ring-offset-2 transition-all disabled:opacity-60 ${
                    active ? 'ring-ink-900' : 'ring-transparent hover:ring-cream-400'
                  }`}
                  style={{ backgroundColor: a.hex }}
                >
                  {active && <Check size={15} className="text-white" strokeWidth={3} aria-hidden />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
