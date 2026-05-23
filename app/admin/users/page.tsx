'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { formatDate } from '@/lib/format';

type Profile = {
  id: string;
  role: string;
  is_approved: boolean;
  store_name: string | null;
  full_name: string | null;
  phone: string | null;
  store_address: string | null;
  created_at: string;
};

const ROLE_LABELS: Record<string, { label: string; color: string; emoji: string }> = {
  buyer:             { label: 'Acquirente',      color: 'bg-indigo-100 text-indigo-700', emoji: '🛒' },
  seller:            { label: 'Venditore',       color: 'bg-pink-100 text-pink-700',     emoji: '🏪' },
  rider:             { label: 'Rider',           color: 'bg-amber-100 text-amber-700',   emoji: '🛵' },
  admin:             { label: 'Admin',           color: 'bg-rose-100 text-rose-700',     emoji: '🛡️' },
  pending_approval:  { label: 'In attesa',       color: 'bg-yellow-100 text-yellow-700', emoji: '⏳' },
};

function AdminUsersPageInner() {
  const qc = useQueryClient();
  const searchParams = useSearchParams();
  const initialFilter = searchParams.get('role') ?? 'all';
  const [filter, setFilter] = useState<string>(initialFilter);
  const [search, setSearch] = useState('');

  const { data: profiles = [], isLoading } = useQuery({
    queryKey: ['admin-users'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, role, is_approved, store_name, full_name, phone, store_address, created_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as Profile[];
    },
  });

  const updateRole = useMutation({
    mutationFn: async ({ id, role, is_approved }: { id: string; role: string; is_approved: boolean }) => {
      const { error } = await supabase.from('profiles').update({ role, is_approved }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      qc.invalidateQueries({ queryKey: ['admin-stats'] });
      toast.success('Utente aggiornato');
    },
    onError: (err: any) => toast.error(err.message),
  });

  const filtered = profiles.filter((p) => {
    if (filter !== 'all' && p.role !== filter) return false;
    if (search) {
      const s = search.toLowerCase();
      return (
        p.full_name?.toLowerCase().includes(s) ||
        p.store_name?.toLowerCase().includes(s) ||
        p.phone?.includes(s)
      );
    }
    return true;
  });

  if (isLoading) return <div className="text-center py-8 text-gray-500">Caricamento...</div>;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Utenti</h1>
        <p className="text-sm text-gray-500">{filtered.length} risultati</p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {['all', 'buyer', 'seller', 'rider', 'admin', 'pending_approval'].map((r) => (
          <button
            key={r}
            onClick={() => setFilter(r)}
            className={`px-3 py-1.5 rounded-full text-sm font-semibold transition-colors ${
              filter === r ? 'bg-rose-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {r === 'all' ? 'Tutti' : ROLE_LABELS[r]?.label ?? r}
          </button>
        ))}
        <input
          type="search"
          placeholder="Cerca nome, negozio, telefono…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="ml-auto border rounded-lg px-3 py-1.5 text-sm flex-1 sm:flex-none sm:w-64"
        />
      </div>

      <div className="bg-white border rounded-xl overflow-hidden overflow-x-auto">
        <table className="w-full text-sm min-w-[700px]">
          <thead className="bg-gray-50 border-b text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="p-3 text-left">Utente</th>
              <th className="p-3 text-left">Ruolo</th>
              <th className="p-3 text-left">Contatto</th>
              <th className="p-3 text-left">Iscritto</th>
              <th className="p-3 text-left">Azioni</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => {
              const r = ROLE_LABELS[p.role] ?? ROLE_LABELS.buyer;
              return (
                <tr key={p.id} className="border-t hover:bg-gray-50">
                  <td className="p-3">
                    <div>
                      <p className="font-semibold text-gray-900">
                        {p.store_name ?? p.full_name ?? '—'}
                      </p>
                      <p className="text-xs text-gray-400 font-mono">{p.id.slice(0, 8)}…</p>
                    </div>
                  </td>
                  <td className="p-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${r.color}`}>
                      <span>{r.emoji}</span>
                      {r.label}
                    </span>
                  </td>
                  <td className="p-3 text-gray-700">
                    {p.phone && <p>📞 {p.phone}</p>}
                    {p.store_address && <p className="text-xs text-gray-500">📍 {p.store_address}</p>}
                  </td>
                  <td className="p-3 text-gray-500 whitespace-nowrap">{formatDate(p.created_at)}</td>
                  <td className="p-3">
                    <div className="flex gap-2">
                      {!p.is_approved && (
                        <button
                          onClick={() => updateRole.mutate({ id: p.id, role: p.role === 'pending_approval' ? 'seller' : p.role, is_approved: true })}
                          className="text-xs bg-emerald-100 hover:bg-emerald-200 text-emerald-700 px-2 py-1 rounded"
                        >
                          Approva
                        </button>
                      )}
                      {p.is_approved && p.role !== 'admin' && (
                        <button
                          onClick={() => updateRole.mutate({ id: p.id, role: p.role, is_approved: false })}
                          className="text-xs bg-orange-100 hover:bg-orange-200 text-orange-700 px-2 py-1 rounded"
                        >
                          Sospendi
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function AdminUsersPage() {
  return (
    <Suspense fallback={<div className="text-center py-8 text-gray-500">Caricamento...</div>}>
      <AdminUsersPageInner />
    </Suspense>
  );
}
