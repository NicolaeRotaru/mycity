'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import VendorForm, { VendorFormData } from '@/components/VendorForm';
import { toast } from 'sonner';

export default function SellerProfilePage() {
  const qc = useQueryClient();

  const { data: profile, isLoading } = useQuery({
    queryKey: ['seller-profile'],
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
        store_name:    form.storeName,
        store_phone:   form.storePhone,
        store_address: form.storeAddress,
        store_lat:     form.storeLat,
        store_lng:     form.storeLng,
      }).eq('id', user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['seller-profile'] });
      qc.invalidateQueries({ queryKey: ['auth-profile'] });
      toast.success('Profilo aggiornato!');
    },
    onError: (err: any) => toast.error(err.message),
  });

  if (isLoading) return <div className="text-center py-8 text-gray-400">Caricamento...</div>;

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Profilo negozio</h1>
        <p className="text-sm text-gray-500">Aggiorna i dati visibili ai clienti</p>
      </div>

      <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 text-emerald-800 text-sm">
        ✅ Negozio attivo · I tuoi prodotti sono visibili nel marketplace
      </div>

      <div className="bg-white border rounded-lg p-6">
        <VendorForm
          defaultValues={{
            storeName:    profile?.store_name    ?? '',
            storePhone:   profile?.store_phone   ?? '',
            storeAddress: profile?.store_address ?? '',
            storeLat:     profile?.store_lat     ?? undefined,
            storeLng:     profile?.store_lng     ?? undefined,
          }}
          onSubmit={(d) => update.mutate(d)}
          isLoading={update.isPending}
        />
      </div>
    </div>
  );
}
