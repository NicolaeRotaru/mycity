'use client';

import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import VendorForm, { VendorFormData } from '@/components/VendorForm';
import { toast } from 'sonner';
import { LoadingState } from '@/components/ui/LoadingState';
import { friendlyError } from '@/lib/errors';
import { queryKeys } from '@/lib/queries/keys';
import { normalizeCustomization } from '@/lib/store-customization';
import type { StoreHours } from '@/lib/store-hours';

export default function SellerProfilePage() {
  const qc = useQueryClient();

  const { data: profile, isLoading } = useQuery({
    queryKey: queryKeys.seller.profile,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();
      if (error) throw error;
      return data;
    },
  });

  const update = useMutation({
    mutationFn: async (form: VendorFormData) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const { error } = await supabase.from('profiles').update({
        store_name:          form.storeName,
        store_phone:         form.storePhone,
        store_address:       form.storeAddress,
        store_lat:           form.storeLat,
        store_lng:           form.storeLng,
        store_logo:          form.storeLogo,
        store_media:         form.storeMedia,
        store_description:   form.storeDescription || null,
        store_hours:         form.storeHours,
        store_customization: form.storeCustomization,
      }).eq('id', user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.seller.profile });
      qc.invalidateQueries({ queryKey: queryKeys.profile.auth });
      toast.success('Profilo aggiornato!');
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  if (isLoading) return <LoadingState />;

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold font-serif text-ink-900">Profilo negozio</h1>
          <p className="text-sm text-ink-500">Aggiorna i dati e personalizza la vetrina che vedono i clienti</p>
        </div>
        {profile?.is_approved && profile?.id && (
          <Link
            href={`/store/${profile.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-white border border-cream-300 hover:border-primary-300 text-ink-800 px-4 py-2 rounded-lg text-sm font-semibold shadow-warm-sm transition-colors"
          >
            <ExternalLink size={16} aria-hidden />
            Vedi la tua vetrina
          </Link>
        )}
      </div>

      <div className="bg-olive-50 border border-olive-200 rounded-lg p-4 text-olive-800 text-sm">
        ✅ Negozio attivo · I tuoi prodotti sono visibili nel marketplace
      </div>

      <div className="bg-white border border-cream-300 rounded-2xl shadow-warm p-6">
        <VendorForm
          defaultValues={{
            storeName:        profile?.store_name        ?? '',
            storePhone:       profile?.store_phone       ?? '',
            storeAddress:     profile?.store_address     ?? '',
            storeLat:         profile?.store_lat         ?? undefined,
            storeLng:         profile?.store_lng         ?? undefined,
            storeLogo:        profile?.store_logo        ?? null,
            storeMedia:       Array.isArray(profile?.store_media) ? profile.store_media : [],
            storeDescription: profile?.store_description ?? '',
            storeHours:       (profile?.store_hours && typeof profile.store_hours === 'object' && !Array.isArray(profile.store_hours))
                                ? (profile.store_hours as StoreHours)
                                : {},
            storeCustomization: normalizeCustomization(profile?.store_customization),
          }}
          onSubmit={(d) => update.mutate(d)}
          isLoading={update.isPending}
        />
      </div>
    </div>
  );
}
