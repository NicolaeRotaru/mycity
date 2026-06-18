'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ShoppingCart, Store, Bike, Shield, AlertTriangle, Clock, Trash2,
  PauseCircle, PlayCircle, User, ReceiptText,
  X, CheckCircle2, type LucideIcon,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { formatDate } from '@/lib/format';
import { confirmDialog } from '@/components/ConfirmDialog';
import { LoadingState } from '@/components/ui/LoadingState';
import { AdminPageTitle } from '@/components/admin/AdminUI';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
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
  // Da auth.users via RPC admin_list_user_emails (solo admin):
  email: string | null;
  auth_phone: string | null;
  last_sign_in_at: string | null;
  email_confirmed_at: string | null;
};

/** Miglior etichetta identificativa per un utente. */
function displayName(p: Profile): string {
  return (
    p.store_name ||
    p.business_legal_name ||
    p.full_name ||
    p.email ||
    `Utente ${p.id.slice(0, 6)}`
  );
}

const ROLE_LABELS: Record<string, { label: string; color: string; icon: LucideIcon }> = {
  buyer:  { label: 'Acquirente', color: 'bg-primary-100 text-primary-800', icon: ShoppingCart },
  seller: { label: 'Venditore',  color: 'bg-secondary-100 text-secondary-700',     icon: Store },
  rider:  { label: 'Rider',      color: 'bg-accent-100 text-accent-700',   icon: Bike },
  admin:  { label: 'Admin',      color: 'bg-rose-100 text-rose-700',     icon: Shield },
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
  const [editUser, setEditUser] = useState<Profile | null>(null);

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

      const emptyAuth = {
        email: null, auth_phone: null, last_sign_in_at: null, email_confirmed_at: null,
      };

      let base: Profile[];
      const tryFull = await supabase
        .from('profiles')
        .select(fullSelect)
        .order('created_at', { ascending: false });
      if (!tryFull.error) {
        base = (tryFull.data ?? []).map((p: Record<string, unknown>) => ({ ...p, ...emptyAuth })) as Profile[];
      } else {
        logger.warn('admin/users: full select failed, fallback to minimal', { code: tryFull.error.code });
        const min = await supabase
          .from('profiles')
          .select(minimalSelect)
          .order('created_at', { ascending: false });
        if (min.error) throw min.error;
        base = (min.data ?? []).map((p: Record<string, unknown>) => ({
          ...p,
          approval_status: null,
          approval_requested_at: null,
          approved_at: null,
          rejection_reason: null,
          legal_first_name: null, legal_last_name: null, legal_fiscal_code: null,
          business_legal_name: null, business_vat_number: null, business_form: null,
          business_address: null, business_city: null, business_pec: null,
          ...emptyAuth,
        })) as Profile[];
      }

      // Email + ultimo accesso vivono in auth.users: li recuperiamo via RPC
      // admin-only (migration 074). Best-effort: se la RPC non c'è, la pagina
      // resta usabile senza email.
      type AuthRow = {
        id: string; email: string | null; phone: string | null;
        last_sign_in_at: string | null; email_confirmed_at: string | null;
      };
      const { data: authRows, error: authErr } = await supabase.rpc('admin_list_user_emails');
      if (!authErr && Array.isArray(authRows)) {
        const byId = new Map<string, AuthRow>((authRows as AuthRow[]).map((a) => [a.id, a]));
        base = base.map((p) => {
          const a = byId.get(p.id);
          return a
            ? { ...p, email: a.email, auth_phone: a.phone, last_sign_in_at: a.last_sign_in_at, email_confirmed_at: a.email_confirmed_at }
            : p;
        });
      }
      return base;
    },
  });

  // Moderazione via route server-side (audit log + niente update client-side
  // diretti su profiles). La notifica all'utente è inviata dal server.
  const moderateUser = async (
    id: string,
    action: 'approve' | 'reject' | 'reactivate' | 'suspend',
    reason?: string,
  ) => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) throw new Error('Sessione scaduta');
    const res = await fetch(`/api/admin/users/${id}/moderate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, reason }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(apiErrorMessage(body, 'Operazione fallita'));
  };

  const approve = useMutation({
    mutationFn: (id: string) => moderateUser(id, 'approve'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.admin.users() });
      qc.invalidateQueries({ queryKey: queryKeys.admin.stats });
      toast.success(tAdmin('sellerApproved'));
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => moderateUser(id, 'reject', reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.admin.users() });
      toast.success(tAdmin('requestRejected'));
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  const reactivate = useMutation({
    mutationFn: (id: string) => moderateUser(id, 'reactivate'),
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
    mutationFn: (id: string) => moderateUser(id, 'suspend'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.admin.users() });
      toast.success(tAdmin('storeSuspended'));
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  const saveUser = useMutation({
    mutationFn: async (vars: { id: string; patch: Partial<Profile> }) => {
      const { error } = await supabase.from('profiles').update(vars.patch).eq('id', vars.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.admin.users() });
      qc.invalidateQueries({ queryKey: queryKeys.admin.stats });
      setEditUser(null);
      toast.success('Utente aggiornato');
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
        p.email?.toLowerCase().includes(s) ||
        p.business_legal_name?.toLowerCase().includes(s) ||
        p.business_vat_number?.toLowerCase().includes(s) ||
        p.phone?.includes(s) ||
        p.auth_phone?.includes(s)
      );
    }
    return true;
  });

  const detail = detailId ? profiles.find((p) => p.id === detailId) : null;

  if (isLoading) return <LoadingState />;

  if (error) {
    return (
      <div className="bg-rose-50 border border-rose-200 rounded-xl p-6 text-sm text-rose-900">
        <p className="font-bold mb-1 flex items-center gap-1.5">
          <AlertTriangle size={16} strokeWidth={2.2} className="text-rose-600 shrink-0" aria-hidden />
          Errore nel caricamento utenti
        </p>
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
      <AdminPageTitle
        eyebrow="Operatività"
        title="Utenti"
        sub={`${filtered.length} risultati`}
        action={
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
                className="inline-flex items-center gap-1.5 bg-accent-100 hover:bg-accent-200 text-accent-900 px-4 py-2 rounded-lg font-semibold text-sm"
              >
                <Clock size={16} strokeWidth={2.2} aria-hidden />
                {pendingCount} richieste in attesa
              </button>
            )}
          </div>
        }
      />

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

      {/* DESKTOP: tabella */}
      <div className="hidden md:block bg-white border rounded-xl overflow-hidden overflow-x-auto">
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
                        ? 'Nessuna richiesta in attesa di approvazione'
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
                    <p className="font-semibold text-ink-900">{displayName(p)}</p>
                    {p.email && <p className="text-xs text-ink-600 break-all">{p.email}</p>}
                    <p className="text-xs text-ink-400">
                      {(p.phone || p.auth_phone) && <span>{p.phone || p.auth_phone} · </span>}
                      {p.last_sign_in_at
                        ? `ultimo accesso ${formatDate(p.last_sign_in_at)}`
                        : 'mai entrato'}
                    </p>
                  </td>
                  <td className="p-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${r.color}`}>
                      <r.icon size={14} strokeWidth={2.2} aria-hidden />{r.label}
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
                      <button
                        onClick={() => setEditUser(p)}
                        className="text-xs bg-primary-100 hover:bg-primary-200 text-primary-800 px-2 py-1 rounded font-semibold"
                      >
                        Modifica
                      </button>
                      {isApproved && (
                        <button
                          onClick={async () => {
                            const ok = await confirmDialog({
                              title: 'Sospendere il negozio?',
                              message: `${p.store_name ?? 'Il venditore'} non potrà più operare finché non lo riattiverai. È diverso dal rifiuto: la richiesta resta valida e basta cliccare "Riattiva" per farlo tornare online.`,
                              confirmLabel: tConfirm('yesSuspend'),
                              cancelLabel: tActions('cancel'),
                              danger: true,
                              icon: PauseCircle,
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
                              icon: PlayCircle,
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
                              icon: Trash2,
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

      {/* MOBILE: card con azioni sempre visibili */}
      <div className="md:hidden space-y-3">
        {filtered.length === 0 ? (
          <div className="bg-white border border-cream-300 rounded-xl p-8 text-center text-ink-400 text-sm">
            Nessun utente da mostrare.
          </div>
        ) : filtered.map((p) => {
          const r = ROLE_LABELS[p.role] ?? ROLE_LABELS.buyer;
          const a = p.approval_status ? APPROVAL_LABELS[p.approval_status] : null;
          const isSeller    = p.role === 'seller';
          const isPending   = isSeller && p.approval_status === 'pending';
          const isApproved  = isSeller && p.approval_status === 'approved' && p.is_approved;
          const isSuspended = isSeller && p.approval_status === 'suspended';
          return (
            <div key={p.id} className="bg-white border border-cream-300 rounded-xl p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-ink-900 truncate">{displayName(p)}</p>
                  {p.email && <p className="text-xs text-ink-600 truncate">{p.email}</p>}
                  {(p.phone || p.auth_phone) && (
                    <p className="text-xs text-ink-400">{p.phone || p.auth_phone}</p>
                  )}
                </div>
                <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${r.color}`}>
                  <r.icon size={14} strokeWidth={2.2} aria-hidden />{r.label}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap text-xs text-ink-500">
                {p.role === 'seller' && a && (
                  <span className={`inline-block px-2 py-0.5 rounded-full font-semibold ${a.color}`}>{a.label}</span>
                )}
                <span>Iscritto il {formatDate(p.created_at)}</span>
                {p.last_sign_in_at && <span>· Ultimo accesso {formatDate(p.last_sign_in_at)}</span>}
              </div>
              <div className="flex items-center gap-2 mt-3 pt-3 border-t border-cream-100 flex-wrap">
                {isPending && (
                  <button onClick={() => setDetailId(p.id)} className="flex-1 min-w-[80px] text-center bg-primary-600 text-white font-semibold py-2 rounded-lg text-sm">
                    Esamina
                  </button>
                )}
                <button onClick={() => setEditUser(p)} className="flex-1 min-w-[80px] text-center bg-primary-50 text-primary-700 font-semibold py-2 rounded-lg text-sm">
                  Modifica
                </button>
                {isApproved && (
                  <button
                    onClick={async () => {
                      const ok = await confirmDialog({
                        title: 'Sospendere il negozio?',
                        message: `${p.store_name ?? 'Il venditore'} non potrà più operare finché non lo riattiverai.`,
                        confirmLabel: tConfirm('yesSuspend'), cancelLabel: tActions('cancel'), danger: true, icon: PauseCircle,
                      });
                      if (ok) suspend.mutate(p.id);
                    }}
                    className="flex-1 min-w-[80px] text-center bg-orange-100 text-orange-800 font-semibold py-2 rounded-lg text-sm"
                  >
                    Sospendi
                  </button>
                )}
                {isSuspended && (
                  <button
                    onClick={async () => {
                      const ok = await confirmDialog({
                        title: 'Riattivare il negozio?',
                        message: `${p.store_name ?? 'Il venditore'} tornerà operativo immediatamente.`,
                        confirmLabel: tConfirm('yesReactivate'), cancelLabel: tActions('cancel'), icon: PlayCircle,
                      });
                      if (ok) reactivate.mutate(p.id);
                    }}
                    className="flex-1 min-w-[80px] text-center bg-olive-100 text-olive-800 font-semibold py-2 rounded-lg text-sm"
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
                        message: `${name} verrà rimosso da auth.users e il profilo anonimizzato. Azione irreversibile.`,
                        confirmLabel: tConfirm('yesDelete'), danger: true, icon: Trash2,
                      });
                      if (ok) deleteAccount.mutate(p.id);
                    }}
                    aria-label="Elimina"
                    className="px-3 py-2 text-rose-700 bg-rose-50 rounded-lg"
                  >
                    <Trash2 size={16} strokeWidth={2.2} aria-hidden />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Modale modifica utente */}
      {editUser && (
        <EditUserModal
          profile={editUser}
          saving={saveUser.isPending}
          onClose={() => setEditUser(null)}
          onSave={async (patch) => {
            // Cambio ruolo: azione delicata → conferma extra.
            if (patch.role && patch.role !== editUser.role) {
              const ok = await confirmDialog({
                title: 'Cambiare il ruolo?',
                message: `Stai cambiando il ruolo di questo utente in "${ROLE_LABELS[patch.role]?.label ?? patch.role}". ${patch.role === 'admin' ? 'Avrà accesso completo al pannello admin.' : ''} Confermi?`,
                confirmLabel: 'Sì, cambia ruolo',
                danger: patch.role === 'admin',
                icon: Shield,
              });
              if (!ok) return;
            }
            saveUser.mutate({ id: editUser.id, patch });
          }}
        />
      )}

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

function EditUserModal({
  profile, saving, onClose, onSave,
}: {
  profile: Profile;
  saving: boolean;
  onClose: () => void;
  onSave: (patch: Partial<Profile>) => void;
}) {
  const [fullName, setFullName] = useState(profile.full_name ?? '');
  const [phone, setPhone] = useState(profile.phone ?? '');
  const [storeAddress, setStoreAddress] = useState(profile.store_address ?? '');
  const [storeName, setStoreName] = useState(profile.store_name ?? '');
  const [role, setRole] = useState(profile.role);

  const inputCls = 'w-full bg-cream-50 border border-cream-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400';

  return (
    <Modal
      open
      onClose={onClose}
      title="Modifica utente"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Annulla</Button>
          <Button type="submit" form="edit-user-form" loading={saving}>Salva</Button>
        </>
      }
    >
      <form
        id="edit-user-form"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({
            full_name: fullName.trim() || null,
            phone: phone.trim() || null,
            store_address: storeAddress.trim() || null,
            store_name: storeName.trim() || null,
            role,
          });
        }}
        className="space-y-4"
      >
        <div className="bg-cream-50 border border-cream-200 rounded-lg p-3 text-xs space-y-1">
          <div className="flex justify-between gap-2">
            <span className="text-ink-500">Email</span>
            <span className="text-ink-900 font-medium break-all text-right">{profile.email ?? '—'}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-ink-500">Email verificata</span>
            <span className="text-ink-900">{profile.email_confirmed_at ? 'Sì' : 'No'}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-ink-500">Ultimo accesso</span>
            <span className="text-ink-900">{profile.last_sign_in_at ? formatDate(profile.last_sign_in_at) : 'Mai'}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-ink-500">ID</span>
            <span className="text-ink-400 font-mono break-all text-right">{profile.id}</span>
          </div>
        </div>

        <div>
          <h3 className="text-xs font-bold uppercase tracking-wide text-ink-500 mb-2">Dati di contatto</h3>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-semibold mb-1">Nome e cognome</label>
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">Telefono</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">Indirizzo</label>
              <input value={storeAddress} onChange={(e) => setStoreAddress(e.target.value)} className={inputCls} />
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-xs font-bold uppercase tracking-wide text-ink-500 mb-2">Dati negozio</h3>
          <div>
            <label className="block text-sm font-semibold mb-1">Nome negozio</label>
            <input value={storeName} onChange={(e) => setStoreName(e.target.value)} className={inputCls} />
          </div>
        </div>

        <div>
          <h3 className="text-xs font-bold uppercase tracking-wide text-ink-500 mb-2">Ruolo account</h3>
          <select value={role} onChange={(e) => setRole(e.target.value)} className={inputCls}>
            <option value="buyer">Acquirente</option>
            <option value="seller">Venditore</option>
            <option value="rider">Rider</option>
            <option value="admin">Admin</option>
          </select>
          {role !== profile.role && (
            <p className="mt-1 text-xs text-accent-700 flex items-center gap-1.5">
              <AlertTriangle size={14} strokeWidth={2.2} className="shrink-0" aria-hidden />
              Stai cambiando il ruolo: ti verrà chiesta conferma al salvataggio.
            </p>
          )}
        </div>
      </form>
    </Modal>
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
          <DetailGroup title="Vetrina" icon={Store}>
            <DetailRow label="Nome negozio">{profile.store_name ?? '—'}</DetailRow>
            <DetailRow label="Indirizzo negozio">{profile.store_address ?? '—'}</DetailRow>
          </DetailGroup>

          <DetailGroup title="Titolare" icon={User}>
            <DetailRow label="Nome e cognome">
              {profile.legal_first_name} {profile.legal_last_name}
            </DetailRow>
            <DetailRow label="Email">{profile.email ?? '—'}</DetailRow>
            <DetailRow label="Codice fiscale">
              <code>{profile.legal_fiscal_code ?? '—'}</code>
            </DetailRow>
            <DetailRow label="Telefono">{profile.phone ?? profile.auth_phone ?? '—'}</DetailRow>
            <DetailRow label="Ultimo accesso">
              {profile.last_sign_in_at ? formatDate(profile.last_sign_in_at) : 'Mai'}
            </DetailRow>
          </DetailGroup>

          <DetailGroup title="Azienda" icon={ReceiptText}>
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
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-3 rounded-lg border-2 border-rose-200 text-rose-700 hover:bg-rose-50 font-semibold"
          >
            <X size={18} strokeWidth={2.2} aria-hidden /> Rifiuta
          </button>
          <button
            onClick={onApprove}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-3 rounded-lg bg-olive-600 hover:bg-olive-700 text-white font-bold shadow-md"
          >
            <CheckCircle2 size={18} strokeWidth={2.2} aria-hidden /> Approva
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailGroup({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="font-bold text-ink-900 mb-2 flex items-center gap-1.5">
        <Icon size={16} strokeWidth={2.2} className="text-primary-700" aria-hidden />
        {title}
      </h3>
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
