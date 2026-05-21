'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';

type Profile = {
  id: string;
  role: string;
  store_name: string | null;
  is_approved: boolean;
};

const fetchProfiles = async (): Promise<Profile[]> => {
  const { data, error } = await supabase.from('profiles').select('*');
  if (error) throw error;
  return data ?? [];
};

const Admin = () => {
  const queryClient = useQueryClient();

  const { data: profiles = [], isLoading } = useQuery({
    queryKey: ['profiles'],
    queryFn: fetchProfiles,
  });

  const toggleApproval = useMutation({
    mutationFn: async ({ id, is_approved }: { id: string; is_approved: boolean }) => {
      const { error } = await supabase
        .from('profiles')
        .update({ is_approved, role: is_approved ? 'seller' : 'pending_approval' })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
      toast.success('Stato aggiornato');
    },
    onError: (err: any) => toast.error(err.message),
  });

  if (isLoading) {
    return <div className="container mx-auto p-8 text-center">Caricamento...</div>;
  }

  return (
    <div className="container mx-auto p-8">
      <h2 className="text-2xl font-bold mb-6">Pannello Admin</h2>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse bg-white shadow rounded-lg overflow-hidden">
          <thead className="bg-indigo-600 text-white">
            <tr>
              <th className="p-3 text-left">ID</th>
              <th className="p-3 text-left">Ruolo</th>
              <th className="p-3 text-left">Nome Negozio</th>
              <th className="p-3 text-left">Approvato</th>
              <th className="p-3 text-left">Azioni</th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((profile) => (
              <tr key={profile.id} className="border-t hover:bg-gray-50">
                <td className="p-3 text-xs text-gray-500 font-mono">{profile.id.slice(0, 8)}…</td>
                <td className="p-3">{profile.role}</td>
                <td className="p-3">{profile.store_name ?? '—'}</td>
                <td className="p-3">
                  <span className={`px-2 py-1 rounded-full text-xs font-semibold ${profile.is_approved ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                    {profile.is_approved ? 'Sì' : 'No'}
                  </span>
                </td>
                <td className="p-3">
                  <button
                    onClick={() => toggleApproval.mutate({ id: profile.id, is_approved: !profile.is_approved })}
                    className={`text-sm px-3 py-1 rounded transition-colors ${profile.is_approved ? 'bg-red-100 hover:bg-red-200 text-red-700' : 'bg-green-100 hover:bg-green-200 text-green-700'}`}
                  >
                    {profile.is_approved ? 'Revoca' : 'Approva'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default Admin;
