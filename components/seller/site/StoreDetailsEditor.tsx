'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { friendlyError } from '@/lib/errors';
import { queryKeys, invalidaProfiloDiChiEntrato } from '@/lib/queries/keys';
import { personalizzazioneDaModificare } from '@/lib/store-customization';
import type { StoreHours } from '@/lib/store-hours';
import type { StoreMediaItem } from '@/components/StoreMediaCarousel';
import VendorForm, { type VendorFormData } from '@/components/VendorForm';

/**
 * Schermata "Dettagli negozio" del site builder: logo, nome, copertina, descrizione,
 * contatti, mappa, orari e personalizzazione della vetrina. Incapsula VendorForm con
 * il proprio salvataggio (colonne profilo), distinto da "Salva sito" (store_site JSONB).
 * Spostata qui dal vecchio /seller/profile: tutto ciò che si vede in vetrina si
 * gestisce dentro "Costruisci il sito".
 */
type ProfileRow = {
  store_name: string | null;
  store_phone: string | null;
  store_address: string | null;
  store_lat: number | null;
  store_lng: number | null;
  store_logo: string | null;
  store_media: unknown;
  store_description: string | null;
  store_hours: unknown;
  store_customization: unknown;
};

export default function StoreDetailsEditor({ profile, onBack }: { profile: ProfileRow; onBack: () => void }) {
  const qc = useQueryClient();
  // Il modulo dice se ci sono modifiche non salvate: «Tutte le impostazioni» lo smonta e le perderebbe.
  const [dirty, setDirty] = useState(false);

  // Salva SOLO le colonne "branding" (vetrina). Telefono/indirizzo/orari stanno nel
  // Profilo (StoreContactForm), quindi qui non si toccano.
  const update = useMutation({
    mutationFn: async (form: VendorFormData) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      // Il modulo conta gli 80 caratteri sul nome senza spazi in testa e in coda, e il database
      // (migrazione 830) li conta su quello che si salva: si salva quello che il modulo ha contato.
      const { error } = await supabase.from('profiles').update({
        store_name:          form.storeName.trim(),
        store_logo:          form.storeLogo,
        store_media:         form.storeMedia,
        store_description:   form.storeDescription || null,
        store_customization: form.storeCustomization,
      }).eq('id', user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.seller.profile });
      invalidaProfiloDiChiEntrato(qc);
      toast.success('Dettagli negozio aggiornati!');
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => {
          if (dirty && !window.confirm('Hai modifiche ai dettagli del negozio non salvate: se esci le perdi. Uscire lo stesso?')) return;
          onBack();
        }}
        className="inline-flex items-center gap-1.5 -ml-1 text-sm font-semibold text-ink-600 hover:text-ink-900"
      >
        <ArrowLeft size={16} aria-hidden /> Tutte le impostazioni
      </button>

      <div>
        <h2 className="text-xl font-bold font-serif text-ink-900">Dettagli negozio</h2>
        <p className="text-sm text-ink-500">Logo, nome, copertina, descrizione e aspetto della vetrina. (Telefono, indirizzo e orari sono nel Profilo.)</p>
      </div>

      <div className="bg-white border border-cream-300 rounded-2xl shadow-warm p-6">
        <VendorForm
          mode="branding"
          defaultValues={{
            storeName:        profile.store_name        ?? '',
            storePhone:       profile.store_phone       ?? '',
            storeAddress:     profile.store_address     ?? '',
            storeLat:         profile.store_lat         ?? undefined,
            storeLng:         profile.store_lng         ?? undefined,
            storeLogo:        profile.store_logo        ?? null,
            storeMedia:       Array.isArray(profile.store_media) ? (profile.store_media as StoreMediaItem[]) : [],
            storeDescription: profile.store_description ?? '',
            storeHours:       (profile.store_hours && typeof profile.store_hours === 'object' && !Array.isArray(profile.store_hours))
                                ? (profile.store_hours as StoreHours)
                                : {},
            // R04-010 — I social già salvati arrivano al modulo come sono, anche quelli che le regole di oggi
            // rifiutano: con la lettura della vetrina il campo si apriva vuoto e il «Salva» li cancellava.
            storeCustomization: personalizzazioneDaModificare(profile.store_customization),
          }}
          onSubmit={(d) => update.mutate(d)}
          isLoading={update.isPending}
          salvataggioRiuscito={update.isSuccess ? update.submittedAt : 0}
          onDirtyChange={setDirty}
        />
      </div>
    </div>
  );
}
