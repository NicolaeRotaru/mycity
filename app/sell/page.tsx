'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import VendorForm, { VendorFormData } from '@/components/VendorForm';
import { toast } from 'sonner';

const fetchProfile = async () => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Non autenticato');
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();
  if (error) throw error;
  return data;
};

const Sell = () => {
  const { data: profile, isLoading } = useQuery({
    queryKey: ['profile'],
    queryFn: fetchProfile,
  });

  const updateProfile = useMutation({
    mutationFn: async (formData: VendorFormData) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const { error } = await supabase
        .from('profiles')
        .update({
          store_name: formData.storeName,
          store_lat: formData.storeLat,
          store_lng: formData.storeLng,
          store_phone: formData.storePhone,
          role: 'pending_approval',
        })
        .eq('id', user.id);
      if (error) throw error;
    },
    onSuccess: () => toast.success('Profilo negozio salvato!'),
    onError: (err: any) => toast.error(err.message || 'Errore nel salvataggio'),
  });

  if (isLoading) {
    return <div className="container mx-auto p-8 text-center">Caricamento...</div>;
  }

  return (
    <div className="container mx-auto p-8 max-w-lg">
      <h2 className="text-2xl font-bold mb-6">Vendi su Piacenza Market</h2>
      {profile?.is_approved ? (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-green-800">
          ✅ Il tuo negozio è approvato e attivo.
        </div>
      ) : profile?.role === 'pending_approval' ? (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-yellow-800 mb-6">
          ⏳ La tua richiesta è in attesa di approvazione.
        </div>
      ) : null}
      <VendorForm
        onSubmit={(data) => updateProfile.mutate(data)}
        isLoading={updateProfile.isPending}
      />
    </div>
  );
};

export default Sell;
