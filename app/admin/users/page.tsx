'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { formatDate } from '@/lib/format';
import { confirmDialog } from '@/components/ConfirmDialog';
import { LoadingState } from '@/components/ui/LoadingState';
import { Button } from '@/components/ui/Button';
import { friendlyError, apiErrorMessage } from '@/lib/errors';
import { queryKeys } from '@/lib/queries/keys';
import { logger } from '@/lib/logger';
import { useTranslations } from 'next-intl';

type Profile = {
  id: string;
  role: string;
  is_approved: boolean;
  approval_status: string | null;
  approval_requested_at: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  store_name: string | null;
  full_name: string | null;
  phone: string | null;
  store_address: string | null;
  legal_first_name: string | null;
  legal_last_name: string | null;
  legal_fiscal_code: string | null;
  business_legal_name: string | null;
  business_vat_number: string | null;
  business_form: string | null;
  business_address: string | null;
  business_city: string | null;
  business_pec: string | null;
  created_at: string;
};

const ROLE_LABELS: Record<string, { label: string; color: string; emoji: string }> = {
  buyer:  { label: 'Acquirente', color: 'bg-primary-100 text-primary-800', emoji: '🛒' },
  seller: { label: 'Venditore',  color: 'bg-secondary-100 text-secondary-700',     emoji: '🏪' },
  rider:  { label: 'Rider',      color: 'bg-accent-100 text-accent-700',   emoji: '🛵' },
  admin:  { label: 'Admin',      color: 'bg-rose-100 text-rose-700',     emoji: '🛡️' },
};

const APPROVAL_LABELS: Record<string, { label: string; color: string }> = {
  pending:   { label: 'In attesa',  color: 'bg-accent-100 text-accent-800' },
  approved:  { label: 'Approvato',  color: 'bg-olive-100 text-olive-800' },
  rejected:  { label: 'Rifiutato',  color: 'bg-rose-100 text-rose-800' },
  suspended: { label: 'Sospeso',    color: 'bg-orange-100 text-orange-800' },
};

function AdminUsersPageInner() {
  const qc = useQueryClient();
  const searchParams = useSearchParams();
  const tActions = useTranslations('actions');
  const tConfirm = useTranslations('confirm');
  const tAdmin = useTranslations('admin');
  const initialFilter = searchParams.get('role') ?? 'all';
  const [filter, setFilter] = useState<string>(initialFilter);
  const [search, setSearch] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);

  const { data: profiles = [], isLoading, error } = useQuery({
    queryKey: queryKeys.admin.users(),
    queryFn: async () => {
      // Prima provo la query completa con i campi della migration 021.
      // Se fallisce (es. migration non ancora applicata) faccio fallback
      // a una select minimale così la pagina resta usabile.
      const fullSelect = `
        id, role, is_approved, approval_status, approval_requested_at, approved_at, rejection_reason,
        store_name, full_name, phone, store_address,
        legal_first_name, legal_last_name, legal_fiscal_code,
        business_legal_name, business_vat_number, business_form,
        business_address, business_city, business_pec, created_at
      `;
      const minimalSelect = `id, role, is_approved, store_name, full_name, phone, store_address, created_at`;

      const tryFull = await supabase
        .from('profiles')
        .select(fullSelect)
        .order('created_at', { ascending: false });
      if (!tryFull.error) return (tryFull.data ?? []) as Profile[];

      logger.warn('admin/users: full select failed, fallback to minimal', { code: tryFull.error.code });
      const min = await supabase
        .from('profiles')
        .select(minimalSelect)
        .order('created_at', { ascending: false });
      if (min.error) throw min.error;
      // Riempi i campi mancanti con null per non rompere la tipizzazione
      return (min.data ?? []).map((p: Record<string, unknown>) => ({
        ...p,
        approval_status: null,
        approval_requested_at: null,
        approved_at: null,
        rejection_reason: null,
        legal_first_name: null, legal_last_name: null, legal_fiscal_code: null,
        business_legal_name: null, business_vat_number: null, business_form: null,
        business_address: null, business_city: null, business_pec: null,
      })) as Profile[];
    },
  });

  const approve = useMutation({
    mutationFn: async (id: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from('profiles').update({
        approval_status: 'approved',
        is_approved: true,
        approved_at: new Date().toISOString(),
        approved_by: user?.id,
        rejection_reason: null,
      }).eq('id', id);
      if (error) throw error;
      await supabase.from('notifications').insert({
        user_id: id,
        type: 'seller_approved',
        title: '✅ Negozio approvato',
        body: 'Il tuo negozio è stato approvato! Ora puoi accedere alla dashboard e pubblicare prodotti.',
        link: '/seller/dashboard',
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.admin.users() });
      qc.invalidateQueries({ queryKey: queryKeys.admin.stats });
      toast.success(tAdmin('sellerApproved'));
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  const reject = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { error } = await supabase.from('profiles').update({
        approval_status: 'rejected',
        is_approved: false,
        rejection_reason: reason,
      }).eq('id', id);
      if (error) throw error;
      await supabase.from('notifications').insert({
        user_id: id,
        type: 'seller_rejected',
        title: '❌ Richiesta non approvata',
        body: `La tua richiesta non è stata approvata. Motivo: ${reason}`,
        link: '/sell',
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.admin.users() });
      toast.success(tAdmin('requestRejected'));
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  const reactivate = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('profiles').update({
        is_approved: true,
        approval_status: 'approved',
        rejection_reason: null,
        approved_at: new Date().toISOString(),
      }).eq('id', id);
      if (error) throw error;
      await supabase.from('notifications').insert({
        user_id: id,
        type: 'seller_reactivated',
        title: '✅ Negozio riattivato',
        body: 'Il tuo negozio è di nuovo operativo. Puoi tornare a vendere su MyCity.',
        link: '/seller/dashboard',
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.admin.users() });
      qc.invalidateQueries({ queryKey: queryKeys.admin.stats });
      toast.success(tAdmin('storeReactivated'));
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  const deleteAccount = useMutation({
    mutationFn: async (id: string) => {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('Sessione scaduta');
      const res = await fetch(`/api/admin/users/${id}/delete`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(apiErrorMessage(body, 'Eliminazione fallita'));
      return body;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.admin.users() });
      qc.invalidateQueries({ queryKey: queryKeys.admin.stats });
      toast.success(tAdmin('accountDeleted'));
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  const suspend = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('profiles').update({
        is_approved: false,
        approval_status: 'suspended',
        rejection_reason: null,
      }).eq('id', id);
      if (error) throw error;
      await supabase.from('notifications').insert({
        user_id: id,
        type: 'seller_suspended',
        title: '⏸️ Negozio sospeso',
        body: 'Il tuo negozio è stato temporaneamente sospeso da un amministratore. Contatta il supporto per chiarimenti.',
        link: '/contact',
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.admin.users() });
      toast.success(tAdmin('storeSuspended'));
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  const pendingCount = profiles.filter((p) => p.approval_status === 'pending' && p.role === 'seller').length;

  const filtered = profiles.filter((p) => {
    if (filter === 'pending') {
      if (!(p.role === 'seller' && p.approval_status === 'pending')) return false;
    } else if (filter !== 'all' && p.role !== filter) {
      return false;
    }
    if (search) {
      const s = search.toLowerCase();
      return (
        p.full_name?.toLowerCase().includes(s) ||
        p.store_name?.toLowerCase().includes(s) ||
        p.business_legal_name?.toLowerCase().includes(s) ||
        p.business_vat_number?.toLowerCase().includes(s) ||
        p.phone?.includes(s)
      );
    }
    return true;
  });

  const detail = detailId ? profiles.find((p) => p.id === detailId) : null;

  if (isLoading) return <LoadingState />;

  if (error) {
    return (
      <div className="bg-rose-50 border border-rose-200 rounded-xl p-6 text-sm text-rose-900">
        <p className="font-bold mb-1">⚠️ Errore nel caricamento utenti</p>
        <p className="mb-2">{error instanceof Error ? error.message : 'Errore sconosciuto'}</p>
        <p className="text-xs">
          Se non l'hai ancora fatto, verifica di avere applicato le migration più recenti su Supabase
          (in particolare <code>021_seller_kyc_and_approval.sql</code>).
        </p>
      </div>
    );
  }

  const exportCSV = () => {
    const headers = ['ID', 'Email', 'Nome', 'Ruolo', 'Approvato', 'Creato il'];
    const rows = filtered.map((u) => [
      u.id,
      (u as Profile & { email?: string }).email ?? '',
      u.full_name ?? u.store_name ?? '',
      u.role ?? '',
      u.is_approved ? 'sì' : 'no',
      u.created_at ?? '',
    ]);
    const csv = [headers, ...rows]
      .map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mycity-utenti-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink-900">Utenti</h1>
          <p className="text-sm text-ink-500">{filtered.length} risultati</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={exportCSV}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-1.5 bg-white border border-cream-300 hover:bg-cream-50 disabled:opacity-50 text-ink-700 px-4 py-2 rounded-lg font-semibold text-sm"
          >
            Esporta CSV
          </button>
        {pendingCount > 0 && filter !== 'pending' && (
          <button
            onClick={() => setFilter('pending')}
            className="bg-accent-100 hover:bg-accent-200 text-accent-900 px-4 py-2 rounded-lg font-semibold text-sm"
          >
            ⏳ {pendingCount} richieste in attesa
          </button>
        )}
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {[
          { key: 'pending', label: `In attesa${pendingCount > 0 ? ` (${pendingCount})` : ''}` },
          { key: 'all',     label: 'Tutti' },
          { key: 'buyer',   label: 'Acquirenti' },
          { key: 'seller',  label: 'Venditori' },
          { key: 'rider',   label: 'Rider' },
          { key: 'admin',   label: 'Admin' },
        ].map((opt) => (
          <button
            key={opt.key}
            onClick={() => setFilter(opt.key)}
            className={`px-3 py-1.5 rounded-full text-sm font-semibold transition-colors ${
              filter === opt.key ? 'bg-rose-600 text-white' : 'bg-cream-100 text-ink-600 hover:bg-cream-200'
            }`}
          >
            {opt.label}
          </button>
        ))}
        <input
          type="search"
          placeholder="Cerca nome, negozio, P.IVA, telefono…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="ml-auto border rounded-lg px-3 py-1.5 text-sm flex-1 sm:flex-none sm:w-64"
        />
      </div>

      <div className="bg-white border rounded-xl overflow-hidden overflow-x-auto">
        <table className="w-full text-sm min-w-[700px]">
          <thead className="bg-cream-50 border-b text-xs uppercase tracking-wide text-ink-500">
            <tr>
              <th className="p-3 text-left">Utente</th>
              <th className="p-3 text-left">Ruolo</th>
              <th className="p-3 text-left">Stato</th>
              <th className="p-3 text-left">Iscritto</th>
              <th className="p-3 text-left">Azioni</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-8 text-center text-ink-400">
                  {profiles.length === 0
                    ? 'Nessun utente registrato sulla piattaforma.'
                    : search
                      ? `Nessun risultato per "${search}"`
                      : filter === 'pending'
                        ? 'Nessuna richiesta in attesa di approvazione 🎉'
                        : `Nessun utente con ruolo "${filter}"`}
                </td>
              </tr>
            ) : filtered.map((p) => {
              const r = ROLE_LABELS[p.role] ?? ROLE_LABELS.buyer;
              const a = p.approval_status ? APPROVAL_LABELS[p.approval_status] : null;
              const isSeller    = p.role === 'seller';
              const isPending   = isSeller && p.approval_status === 'pending';
              const isApproved  = isSeller && p.approval_status === 'approved' && p.is_approved;
              const isSuspended = isSeller && p.approval_status === 'suspended';
              return (
                <tr key={p.id} className="border-t hover:bg-cream-50">
                  <td className="p-3">
                    <p className="font-semibold text-ink-900">
                      {p.store_name ?? p.business_legal_name ?? p.full_name ?? '—'}
                    </p>
                    <p className="text-xs text-ink-400 font-mono">{p.id.slice(0, 8)}…</p>
                  </td>
                  <td className="p-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${r.color}`}>
                      <span>{r.emoji}</span>{r.label}
                    </span>
                  </td>
                  <td className="p-3">
                    {p.role === 'seller' && a && (
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${a.color}`}>
                        {a.label}
                      </span>
                    )}
                  </td>
                  <td className="p-3 text-ink-500 whitespace-nowrap text-xs">{formatDate(p.created_at)}</td>
                  <td className="p-3">
                    <div className="flex gap-1 flex-wrap">
                      {isPending && (
                        <Button onClick={() => setDetailId(p.id)} size="sm">Esamina</Button>
                      )}
                      {isApproved && (
                        <button
                          onClick={async () => {
                            const ok = await confirmDialog({
                              title: 'Sospendere il negozio?',
                              message: `${p.store_name ?? 'Il venditore'} non potrà più operare finché non lo riattiverai. È diverso dal rifiuto: la richiesta resta valida e basta cliccare "Riattiva" per farlo tornare online.`,
                              confirmLabel: tConfirm('yesSuspend'),
                              cancelLabel: tActions('cancel'),
                              danger: true,
                              icon: '⏸️',
                            });
                            if (ok) suspend.mutate(p.id);
                          }}
                          className="text-xs bg-orange-100 hover:bg-orange-200 text-orange-800 px-2 py-1 rounded font-semibold"
                        >
                          Sospendi
                        </button>
                      )}
                      {isSuspended && (
                        <button
                          onClick={async () => {
                            const ok = await confirmDialog({
                              title: 'Riattivare il negozio?',
                              message: `${p.store_name ?? 'Il venditore'} tornerà operativo immediatamente e riceverà una notifica.`,
                              confirmLabel: tConfirm('yesReactivate'),
                              cancelLabel: tActions('cancel'),
                              icon: '▶️',
                            });
                            if (ok) reactivate.mutate(p.id);
                          }}
                          className="text-xs bg-olive-100 hover:bg-olive-200 text-olive-800 px-2 py-1 rounded font-semibold"
                        >
                          Riattiva
                        </button>
                      )}
                      {p.role !== 'admin' && (
                        <button
                          onClick={async () => {
                            const name = p.store_name ?? p.business_legal_name ?? p.full_name ?? `Utente ${p.id.slice(0, 6)}`;
                            const ok = await confirmDialog({
                              title: 'Eliminare definitivamente?',
                              message: `${name} verrà rimosso da auth.users e il profilo anonimizzato. L'utente non potrà più accedere. Gli ordini storici restano per obblighi fiscali. Azione irreversibile.`,
                              confirmLabel: tConfirm('yesDelete'),
                              danger: true,
                              icon: '🗑️',
                            });
                            if (ok) deleteAccount.mutate(p.id);
                          }}
                          className="text-xs bg-rose-100 hover:bg-rose-200 text-rose-700 px-2 py-1 rounded"
                        >
                          Elimina
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

      {/* Pannello dettaglio richiesta */}
      {detail && (
        <DetailPanel
          profile={detail}
          onClose={() => setDetailId(null)}
          onApprove={() => { approve.mutate(detail.id); setDetailId(null); }}
          onReject={async () => {
            const reason = window.prompt('Motivo del rifiuto (visibile al venditore):');
            if (!reason?.trim()) return;
            reject.mutate({ id: detail.id, reason: reason.trim() });
            setDetailId(null);
          }}
        />
      )}
    </div>
  );
}

function DetailPanel({
  profile, onClose, onApprove, onReject,
}: {
  profile: Profile;
  onClose: () => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div
        className="bg-white w-full sm:max-w-2xl sm:rounded-2xl rounded-t-3xl shadow-2xl max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b px-5 py-4 flex items-center justify-between z-10">
          <div>
            <h2 className="font-bold text-lg">Richiesta venditore</h2>
            <p className="text-xs text-ink-500">
              {profile.approval_requested_at && `Inviata il ${formatDate(profile.approval_requested_at)}`}
            </p>
          </div>
          <button onClick={onClose} className="text-2xl text-ink-400 hover:text-ink-700 px-2">×</button>
        </div>

        <div className="p-5 space-y-5 text-sm">
          <DetailGroup title="🏪 Vetrina">
            <DetailRow label="Nome negozio">{profile.store_name ?? '—'}</DetailRow>
            <DetailRow label="Indirizzo negozio">{profile.store_address ?? '—'}</DetailRow>
          </DetailGroup>

          <DetailGroup title="👤 Titolare">
            <DetailRow label="Nome e cognome">
              {profile.legal_first_name} {profile.legal_last_name}
            </DetailRow>
            <DetailRow label="Codice fiscale">
              <code>{profile.legal_fiscal_code ?? '—'}</code>
            </DetailRow>
            <DetailRow label="Telefono">{profile.phone ?? '—'}</DetailRow>
          </DetailGroup>

          <DetailGroup title="🧾 Azienda">
            <DetailRow label="Ragione sociale">{profile.business_legal_name ?? '—'}</DetailRow>
            <DetailRow label="P.IVA"><code>{profile.business_vat_number ?? '—'}</code></DetailRow>
            <DetailRow label="Forma giuridica">{profile.business_form ?? '—'}</DetailRow>
            <DetailRow label="Sede legale">
              {profile.business_address} — {profile.business_city}
            </DetailRow>
            <DetailRow label="PEC">{profile.business_pec ?? '—'}</DetailRow>
          </DetailGroup>
        </div>

        <div className="sticky bottom-0 bg-white border-t px-5 py-4 flex gap-3">
          <button
            onClick={onReject}
            className="flex-1 px-4 py-3 rounded-lg border-2 border-rose-200 text-rose-700 hover:bg-rose-50 font-semibold"
          >
            ❌ Rifiuta
          </button>
          <button
            onClick={onApprove}
            className="flex-1 px-4 py-3 rounded-lg bg-olive-600 hover:bg-olive-700 text-white font-bold shadow-md"
          >
            ✅ Approva
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="font-bold text-ink-900 mb-2">{title}</h3>
      <div className="bg-cream-50 rounded-lg divide-y">{children}</div>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-3 py-2 flex items-baseline gap-3">
      <span className="text-xs text-ink-500 w-32 shrink-0">{label}</span>
      <span className="text-ink-900">{children}</span>
    </div>
  );
}

export default function AdminUsersPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <AdminUsersPageInner />
    </Suspense>
  );
}
