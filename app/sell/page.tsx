'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import VendorForm, { VendorFormData } from '@/components/VendorForm';
import { toast } from 'sonner';

const fetchProfile = async () => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Non autenticato');
  const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();
  if (error) throw error;
  return data;
};

const Sell = () => {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: profile, isLoading } = useQuery({ queryKey: ['profile'], queryFn: fetchProfile });

  const updateProfile = useMutation({
    mutationFn: async (formData: VendorFormData) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const { error } = await supabase.from('profiles').update({
        store_name:    formData.storeName,
        store_phone:   formData.storePhone,
        store_address: formData.storeAddress,
        store_lat:     formData.storeLat,
        store_lng:     formData.storeLng,
        store_logo:    formData.storeLogo,
        role:          'seller',
        is_approved:   true,
      }).eq('id', user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profile'] });
      qc.invalidateQueries({ queryKey: ['auth-profile'] });
      toast.success('Negozio attivato! Ora puoi pubblicare prodotti.');
      router.push('/seller/dashboard');
    },
    onError: (err: any) => toast.error(err.message || 'Errore nel salvataggio'),
  });

  if (isLoading) return <div className="container mx-auto p-8 text-center">Caricamento...</div>;

  return (
    <div className="container mx-auto p-6 max-w-2xl">
      <div className="bg-gradient-to-r from-pink-500 to-rose-500 text-white rounded-xl p-6 mb-6">
        <h2 className="text-2xl font-bold mb-1">🚀 Diventa venditore</h2>
        <p className="text-pink-100 text-sm">
          Compila i dati del tuo negozio. Una volta salvato sei subito online — niente attese.
        </p>
      </div>

      {profile?.is_approved && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 text-emerald-800 mb-6">
          ✅ Il tuo negozio è già attivo. Puoi modificare i dati qui sotto.
        </div>
      )}

      <div className="bg-white border rounded-xl p-6">
        <VendorForm
          defaultValues={{
            storeName:    profile?.store_name    ?? '',
            storePhone:   profile?.store_phone   ?? '',
            storeAddress: profile?.store_address ?? '',
            storeLat:     profile?.store_lat     ?? undefined,
            storeLng:     profile?.store_lng     ?? undefined,
            storeLogo:    profile?.store_logo    ?? null,
          }}
          onSubmit={(data) => updateProfile.mutate(data)}
          isLoading={updateProfile.isPending}
        />
      </div>
    </div>
  );
};

export default Sell;
