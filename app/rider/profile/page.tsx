'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { LoadingState } from '@/components/ui/LoadingState';
import { friendlyError } from '@/lib/errors';
import { queryKeys } from '@/lib/queries/keys';
import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/Field';
import { Bike } from 'lucide-react';

export default function RiderProfilePage() {
  const qc = useQueryClient();
  const tStates = useTranslations('states');
  const tActions = useTranslations('actions');

  const { data: profile, isLoading } = useQuery({
    queryKey: queryKeys.rider.profile,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, phone')
        .eq('id', user.id)
        .single();
      if (error) throw error;
      return { ...data, email: user.email ?? '' };
    },
  });

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');

  const update = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const { error } = await supabase
        .from('profiles')
        .update({ full_name: fullName, phone })
        .eq('id', user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.rider.profile });
      qc.invalidateQueries({ queryKey: queryKeys.profile.auth });
      toast.success('Profilo aggiornato');
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  if (isLoading) return <LoadingState />;

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink-900">Profilo rider</h1>
        <p className="text-sm text-ink-500">I tuoi dati di contatto, visibili al cliente.</p>
      </div>

      <div className="bg-accent-50 border border-accent-200 rounded-lg p-4 text-accent-800 text-sm flex items-center gap-1.5">
        <Bike size={16} strokeWidth={2.2} aria-hidden /> Account rider attivo · {profile?.email}
      </div>

      <div className="bg-white border rounded-lg p-6 space-y-4">
        <Input
          label="Nome e cognome"
          type="text"
          defaultValue={profile?.full_name ?? ''}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Mario Rossi"
        />
        <Input
          label="Telefono"
          type="tel"
          defaultValue={profile?.phone ?? ''}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="3331234567"
          inputMode="tel"
        />
        <button
          onClick={() => update.mutate()}
          disabled={update.isPending}
          className="bg-accent-500 hover:bg-accent-600 disabled:opacity-50 text-white px-6 py-2.5 rounded font-semibold"
        >
          {update.isPending ? tStates('saving') : tActions('save')}
        </button>
      </div>
    </div>
  );
}
