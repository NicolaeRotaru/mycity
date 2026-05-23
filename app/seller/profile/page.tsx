'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import VendorForm, { VendorFormData } from '@/components/VendorForm';
import { toast } from 'sonner';

export default function SellerProfilePage() {
  const qc = useQueryClient();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    await supabase.auth.signOut();
    qc.clear();
    router.push('/sign-in');
    router.refresh();
  };

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
        store_logo:    form.storeLogo,
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
            storeLogo:    profile?.store_logo    ?? null,
          }}
          onSubmit={(d) => update.mutate(d)}
          isLoading={update.isPending}
        />
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSignOut}
          disabled={signingOut}
          className="text-red-600 hover:text-red-700 font-semibold disabled:opacity-50 flex items-center gap-2"
        >
          <span>↪</span>
          <span>{signingOut ? 'Disconnessione...' : 'Esci dal tuo account'}</span>
        </button>
      </div>
    </div>
  );
}
