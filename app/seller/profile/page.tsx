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
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const update = useMutation({
    mutationFn: async (form: VendorFormData) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const { error } = await supabase
        .from('profiles')
        .update({
          store_name:  form.storeName,
          store_lat:   form.storeLat,
          store_lng:   form.storeLng,
          store_phone: form.storePhone,
          role:        profile?.is_approved ? 'seller' : 'pending_approval',
        })
        .eq('id', user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['seller-profile'] });
      toast.success('Profilo aggiornato!');
    },
    onError: (err: any) => toast.error(err.message),
  });

  if (isLoading) return <div className="text-center py-8">Caricamento...</div>;

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-2xl font-bold">Profilo negozio</h1>

      {profile?.is_approved ? (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-green-800">
          ✅ Il tuo negozio è approvato e attivo
        </div>
      ) : profile?.role === 'pending_approval' ? (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-yellow-800">
          ⏳ In attesa di approvazione dall'admin
        </div>
      ) : (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-blue-800">
          ℹ️ Compila i dati del negozio per richiedere l'approvazione
        </div>
      )}

      <div className="bg-white border rounded-lg p-6">
        <VendorForm
          defaultValues={{
            storeName:  profile?.store_name  ?? '',
            storeLat:   profile?.store_lat   ?? undefined,
            storeLng:   profile?.store_lng   ?? undefined,
            storePhone: profile?.store_phone ?? '',
          }}
          onSubmit={(d) => update.mutate(d)}
          isLoading={update.isPending}
        />
      </div>
    </div>
  );
}
