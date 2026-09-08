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
import { useDebounce } from '@/lib/hooks';
import { leggiInBlocchi } from '@/lib/supabase/blocchi';
import {
  TETTO_UTENTI, TETTO_RISULTATI_RICERCA,
  etichetteElenco, filtroRicercaProfili, idsDaContattiAuth, unisciPerId,
  risultatiRicerca, ambitoDellaRicerca,
} from '@/lib/admin/elenco-utenti';
import {
  raccogliUtentiDaEsportare, raccoltaDallaRicerca, contenutoCsvUtenti, nomeFileUtenti,
  type UtenteDaEsportare,
} from '@/lib/admin/esporta-utenti';

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
  admin:  { label: 'Admin',      color: 'bg-secondary-100 text-secondary-700',     icon: Shield },
};

const APPROVAL_LABELS: Record<string, { label: string; color: string }> = {
  pending:   { label: 'In attesa',  color: 'bg-accent-100 text-accent-800' },
  approved:  { label: 'Approvato',  color: 'bg-olive-100 text-olive-800' },
  rejected:  { label: 'Rifiutato',  color: 'bg-rose-100 text-rose-800' },
  suspended: { label: 'Sospeso',    color: 'bg-secondary-50 text-secondary-600' },
};

/** Le colonne dei profili con i campi della migrazione 021. */
const COLONNE_COMPLETE = `
  id, role, is_approved, approval_status, approval_requested_at, approved_at, rejection_reason,
  store_name, full_name, phone, store_address,
  legal_first_name, legal_last_name,
  business_legal_name, business_form,
  business_address, business_city, business_pec, created_at
`;

/** Il ripiego se quella migrazione non c'e' ancora: la pagina resta usabile. */
const COLONNE_MINIME = 'id, role, is_approved, store_name, full_name, phone, store_address, created_at';

/** I campi che arrivano da auth.users, finche' non sono arrivati. */
const AUTH_VUOTO = {
  email: null, auth_phone: null, last_sign_in_at: null, email_confirmed_at: null,
};

type RispostaProfili = {
  data: Record<string, unknown>[] | null;
  error: { code?: string; message?: string } | null;
};

/** Una riga di auth.users come la restituisce la RPC admin (migrazione 074). */
type RigaAuth = {
  id: string; email: string | null; phone: string | null;
  last_sign_in_at: string | null; email_confirmed_at: string | null;
};

const conAuthVuoto = (p: Record<string, unknown>): Profile => ({ ...p, ...AUTH_VUOTO } as unknown as Profile);

/** Il profilo letto col ripiego: i campi che mancano restano vuoti, non assenti. */
const daColonneMinime = (p: Record<string, unknown>): Profile => ({
  ...p,
  approval_status: null,
  approval_requested_at: null,
  approved_at: null,
  rejection_reason: null,
  legal_first_name: null, legal_last_name: null, legal_fiscal_code: null,
  business_legal_name: null, business_vat_number: null, business_form: null,
  business_address: null, business_city: null, business_pec: null,
  ...AUTH_VUOTO,
} as unknown as Profile);

/**
 * Legge i profili con le colonne complete e, se la migrazione 021 non c'e',
 * ripiega su quelle minime.
 *
 * Sta qui fuori — e prende la lettura come funzione — perche' adesso lo fanno
 * in due: l'elenco all'apertura e la ricerca sul database. Due copie della
 * stessa scala di ripiego si sarebbero scollate al primo cambio di colonne.
 */
async function leggiProfili(chiedi: (colonne: string) => PromiseLike<RispostaProfili>): Promise<Profile[]> {
  const completa = await chiedi(COLONNE_COMPLETE);
  if (!completa.error) return (completa.data ?? []).map(conAuthVuoto);
  logger.warn('admin/users: full select failed, fallback to minimal', { code: completa.error.code });
  const minima = await chiedi(COLONNE_MINIME);
  if (minima.error) throw minima.error;
  return (minima.data ?? []).map(daColonneMinime);
}

/**
 * Email e ultimo accesso vivono in auth.users: arrivano dalla RPC admin-only
 * (migrazione 074). Se la RPC non c'e', la pagina resta usabile senza email.
 */
async function leggiContattiAuth(): Promise<RigaAuth[]> {
  const { data, error } = await supabase.rpc('admin_list_user_emails');
  if (error || !Array.isArray(data)) return [];
  return data as RigaAuth[];
}

/** Attacca a ogni profilo i contatti letti da auth.users. */
function conContattiAuth(base: Profile[], righeAuth: readonly RigaAuth[]): Profile[] {
  if (righeAuth.length === 0) return base;
  const perId = new Map<string, RigaAuth>(righeAuth.map((a) => [a.id, a]));
  return base.map((p) => {
    const a = perId.get(p.id);
    return a
      ? { ...p, email: a.email, auth_phone: a.phone, last_sign_in_at: a.last_sign_in_at, email_confirmed_at: a.email_confirmed_at }
      : p;
  });
}

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
  const [esportando, setEsportando] = useState(false);

  const { data: profiles = [], isLoading, error } = useQuery({
    queryKey: queryKeys.admin.users(),
    queryFn: async () => {
      // #90 — Un tetto esplicito: il pannello leggeva TUTTI i profili a ogni
      // apertura. Cinquecento e' molto piu' di quanti utenti ci siano oggi, e
      // molto meno del punto in cui la pagina smette di aprirsi.
      const base = await leggiProfili((colonne) =>
        supabase
          .from('profiles')
          .select(colonne)
          .order('created_at', { ascending: false })
          .limit(TETTO_UTENTI) as unknown as PromiseLike<RispostaProfili>,
      );
      return conContattiAuth(base, await leggiContattiAuth());
    },
  });

  /**
   * QUANTI UTENTI CI SONO DAVVERO.
   *
   * Non `profiles.length`: quello e' quanti ne ho in mano, e sopra c'e' un
   * tetto. Il numero vero lo conta il database. Se non riesce a contarlo resta
   * `null`, che a schermo diventa «non ho potuto contare» — non zero.
   */
  const { data: totaleLetto } = useQuery({
    queryKey: queryKeys.admin.users({ conteggio: 'totale' }),
    queryFn: async (): Promise<number | null> => {
      const { count, error: erroreConteggio } = await supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true });
      if (erroreConteggio) {
        logger.warn('admin/users: conteggio totale fallito', { code: erroreConteggio.code });
        return null;
      }
      return typeof count === 'number' ? count : null;
    },
  });
  const totaleUtenti = typeof totaleLetto === 'number' ? totaleLetto : null;

  /**
   * LA RICERCA ESCE DAL TETTO.
   *
   * Filtrare in memoria vuol dire cercare dentro i cinquecento piu' recenti: un
   * cliente iscritto sei mesi fa non usciva, e non usciva in silenzio. Qui la
   * domanda va al database, su tutti i profili, e l'email — che sta in
   * auth.users, non in profiles — si cerca dalle righe della RPC admin.
   */
  const termineScritto = search.trim();
  const termine = useDebounce(termineScritto, 300);
  const filtro = filtroRicercaProfili(termine);
  const {
    data: rispostaRicerca,
    isError: ricercaCaduta,
  } = useQuery({
    queryKey: queryKeys.admin.users({ cerca: termine }),
    enabled: filtro !== null,
    queryFn: async (): Promise<{ righe: Profile[]; troncato: boolean }> => {
      if (!filtro) return { righe: [], troncato: false };

      const contatti = await leggiContattiAuth();
      const idsPerContatto = idsDaContattiAuth(contatti, termine);

      const perTesto = await leggiProfili((colonne) =>
        supabase
          .from('profiles')
          .select(colonne)
          .or(filtro)
          .order('created_at', { ascending: false })
          .limit(TETTO_RISULTATI_RICERCA) as unknown as PromiseLike<RispostaProfili>,
      );

      // Chi combacia solo per email o telefono: si prende per identificativo, a
      // blocchi, perche' un elenco lungo di id non ci sta in un indirizzo (#93).
      // Se questa lettura non riesce l'errore risale, e la pagina lo dice: e'
      // meglio di un elenco che ha guardato meno di quanto dichiara.
      const mancanti = idsPerContatto
        .filter((id) => !perTesto.some((p) => p.id === id))
        .slice(0, TETTO_RISULTATI_RICERCA);
      const perContatto = mancanti.length === 0 ? [] : await leggiProfili((colonne) =>
        leggiInBlocchi<Record<string, unknown>>(
          mancanti,
          (blocco) =>
            supabase
              .from('profiles')
              .select(colonne)
              .in('id', blocco) as unknown as PromiseLike<{ data: Record<string, unknown>[] | null; error: { message?: string } | null }>,
        ),
      );

      const righe = conContattiAuth(unisciPerId(perTesto, perContatto), contatti);
      return { righe, troncato: righe.length >= TETTO_RISULTATI_RICERCA };
    },
  });

  /**
   * Una lettura senza la forma attesa non e' un risultato: se qui passasse
   * l'elenco nudo dei profili, la pagina direbbe «cercato su tutti gli utenti»
   * senza averlo fatto.
   */
  const risultato = filtro !== null ? risultatiRicerca<Profile>(rispostaRicerca) : null;
  const { ambito: ambitoRicerca, mostrato: termineMostrato } = ambitoDellaRicerca({
    termineScritto,
    termineCercato: termine,
    haRisposta: risultato !== null,
    caduta: ricercaCaduta,
  });
  /** Le righe del database valgono solo quando la ricerca e' davvero arrivata. */
  const ricerca = ambitoRicerca === 'server' ? risultato : null;

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

  /**
   * Chi si puo' approvare da questo pannello: negozi E fattorini.
   *
   * Prima erano solo i negozi. Un fattorino iscritto restava «in attesa» per
   * sempre, perche' i pulsanti non gli comparivano mai accanto: su questo
   * database ce n'era uno fermo dal 25 maggio. Ed e' il motivo per cui la
   * bacheca delle consegne era vuota — senza un fattorino approvato non c'e'
   * nessuno che possa prendere un ordine.
   */
  const siPuoModerare = (ruolo: string) => ruolo === 'seller' || ruolo === 'rider';

  /** Come si chiama, nei messaggi di conferma: un fattorino non e' un negozio. */
  const comeSiChiama = (p: { role: string; store_name?: string | null; full_name?: string | null }) =>
    p.role === 'rider'
      ? { cosa: 'il fattorino', chi: p.full_name ?? 'Il fattorino' }
      : { cosa: 'il negozio',   chi: p.store_name ?? 'Il venditore' };

  const pendingCount = profiles.filter((p) => p.approval_status === 'pending' && siPuoModerare(p.role)).length;

  /**
   * Le righe da cui si parte: quelle trovate dal database quando si sta
   * cercando, altrimenti i piu' recenti che la pagina ha in casa.
   */
  const inMano = ricerca ? ricerca.righe : profiles;

  const filtered = inMano.filter((p) => {
    if (filter === 'pending') {
      if (!(siPuoModerare(p.role) && p.approval_status === 'pending')) return false;
    } else if (filter !== 'all' && p.role !== filter) {
      return false;
    }
    // Col risultato del database il testo l'ha gia' confrontato lui, su tutti
    // gli utenti: rifarlo qui butterebbe via proprio le righe che il tetto
    // nascondeva. Il filtro in memoria resta per il ripiego.
    if (search && !ricerca) {
      const s = search.toLowerCase();
      return (
        p.full_name?.toLowerCase().includes(s) ||
        p.store_name?.toLowerCase().includes(s) ||
        p.email?.toLowerCase().includes(s) ||
        p.business_legal_name?.toLowerCase().includes(s) ||
        p.phone?.includes(s) ||
        p.auth_phone?.includes(s)
      );
    }
    return true;
  });

  /**
   * Le tre scritte che devono restare d'accordo — sottotitolo, avviso e elenco
   * vuoto — escono tutte da qui: e' la funzione che sa dove si e' guardato
   * davvero (`lib/admin/elenco-utenti.ts`).
   */
  const etichette = etichetteElenco({
    mostrati: filtered.length,
    caricati: profiles.length,
    totale: totaleUtenti,
    tetto: TETTO_UTENTI,
    ricerca: termineMostrato,
    ambito: ambitoRicerca,
    ricercaTroncata: ricerca?.troncato ?? false,
    filtro: filter,
  });

  const detail = detailId ? inMano.find((p) => p.id === detailId) : null;

  /**
   * #81 — Codice fiscale e partita IVA si chiedono per UN utente, quando si apre
   * la sua scheda, e la lettura finisce nel registro (chi, quando, di chi).
   * Prima arrivavano in blocco per tutti a ogni apertura del pannello, e nessuna
   * lettura lasciava traccia.
   */
  const { data: datiIdentita } = useQuery({
    queryKey: [...queryKeys.admin.users(), 'kyc', detailId],
    enabled: !!detailId,
    staleTime: 0,
    gcTime: 0,
    queryFn: async (): Promise<{ legal_fiscal_code: string | null; business_vat_number: string | null }> => {
      const res = await fetch(`/api/admin/users/${detailId}/kyc`);
      if (!res.ok) return { legal_fiscal_code: null, business_vat_number: null };
      return res.json();
    },
  });

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

  /**
   * IL FILE NON E' PIU' «QUELLO CHE STA A SCHERMO».
   *
   * Prima scriveva `filtered`, cioe' al massimo i cinquecento profili che la
   * pagina si porta in casa: un elenco degli iscritti monco, senza una riga che
   * lo dicesse. Ora l'esportazione fa la sua lettura, a finestre, finche' il
   * database non dice che sono finiti; se non ci arriva, l'avviso e' in prima
   * riga e nel nome del file. Quando invece si sta guardando il risultato di
   * una ricerca, il file e' quel risultato — ed e' completo solo se la ricerca
   * non ha toccato il suo tetto. Come si compone sta in
   * `lib/admin/esporta-utenti.ts`, dove le prove lo possono eseguire.
   */
  const exportCSV = async () => {
    if (esportando) return; // due clic non fanno due file
    setEsportando(true);
    try {
      const contatti = await leggiContattiAuth();
      const perId = new Map(contatti.map((c) => [c.id, c]));
      const raccolta = ricerca
        ? raccoltaDallaRicerca(filtered, ricerca.troncato)
        : await raccogliUtentiDaEsportare(async (da, a) => {
          let q = supabase
            .from('profiles')
            // Solo colonne che esistono anche senza la migrazione 021.
            .select('id, role, is_approved, full_name, store_name, created_at')
            .order('created_at', { ascending: false })
            // Secondo criterio d'ordine: senza, fra una finestra e l'altra una
            // riga puo' saltare o ripetersi mentre entrano iscritti nuovi.
            .order('id', { ascending: false });
          if (filter === 'pending') q = q.eq('approval_status', 'pending');
          else if (filter !== 'all') q = q.eq('role', filter);
          const { data, error: erroreLettura } = await q.range(da, a);
          if (erroreLettura) throw erroreLettura;
          return ((data ?? []) as unknown as UtenteDaEsportare[]).map((u) => ({
            ...u,
            email: perId.get(u.id)?.email ?? null,
          }));
        });

      if (raccolta.righe.length === 0) {
        toast.error('Nessun utente da esportare');
        return;
      }

      const blob = new Blob([contenutoCsvUtenti(raccolta)], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = nomeFileUtenti({
        oggi: new Date().toISOString().slice(0, 10),
        completo: raccolta.completo,
        filtro: filter,
        ricerca: ricerca ? termineMostrato : '',
      });
      a.click();
      URL.revokeObjectURL(url);

      if (raccolta.completo) {
        toast.success(`Esportati ${raccolta.righe.length} utenti`);
      } else {
        toast.warning(`Il file è PARZIALE: ${raccolta.righe.length} utenti, ce ne sono altri. Non usarlo come elenco degli iscritti.`);
      }
    } catch (e: unknown) {
      toast.error(friendlyError(e));
    } finally {
      setEsportando(false);
    }
  };

  return (
    <div className="space-y-5">
      <AdminPageTitle
        eyebrow="Operatività"
        title="Utenti"
        sub={etichette.sottotitolo}
        action={
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={exportCSV}
              disabled={esportando}
              aria-busy={esportando}
              className="inline-flex items-center gap-1.5 bg-white border border-cream-300 hover:bg-cream-50 disabled:opacity-50 text-ink-700 px-4 py-2 rounded-lg font-semibold text-sm"
            >
              {esportando ? 'Esporto…' : 'Esporta CSV'}
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
              filter === opt.key ? 'bg-secondary-600 text-white' : 'bg-cream-100 text-ink-600 hover:bg-cream-200'
            }`}
          >
            {opt.label}
          </button>
        ))}
        <input
          type="search"
          placeholder="Cerca nome, negozio, email, telefono…"
          aria-label="Cerca fra tutti gli utenti per nome, negozio, email o telefono"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="ml-auto border rounded-lg px-3 py-1.5 text-sm flex-1 sm:flex-none sm:w-64"
        />
      </div>

      {/*
        La striscia c'è SOLO quando c'è qualcosa da confessare: l'elenco si
        ferma ai più recenti, oppure la ricerca sul database non ha risposto.
        Il testo lo decide `etichetteElenco`, insieme al sottotitolo.
      */}
      {etichette.avviso && (
        <p
          role="status"
          className="flex items-start gap-2 bg-accent-50 border border-accent-200 text-accent-900 rounded-xl px-4 py-3 text-sm"
        >
          <AlertTriangle size={16} strokeWidth={2.2} className="text-accent-600 shrink-0 mt-0.5" aria-hidden />
          <span>{etichette.avviso}</span>
        </p>
      )}

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
                  {etichette.vuoto}
                </td>
              </tr>
            ) : filtered.map((p) => {
              const r = ROLE_LABELS[p.role] ?? ROLE_LABELS.buyer;
              const a = p.approval_status ? APPROVAL_LABELS[p.approval_status] : null;
              const moderabile  = siPuoModerare(p.role);
              const isPending   = moderabile && p.approval_status === 'pending';
              const isApproved  = moderabile && p.approval_status === 'approved' && p.is_approved;
              const isSuspended = moderabile && p.approval_status === 'suspended';
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
                    {moderabile && a && (
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
                              title: `Sospendere ${comeSiChiama(p).cosa}?`,
                              message: `${comeSiChiama(p).chi} non potrà più operare finché non lo riattiverai. È diverso dal rifiuto: la richiesta resta valida e basta cliccare "Riattiva" per farlo tornare online.`,
                              confirmLabel: tConfirm('yesSuspend'),
                              cancelLabel: tActions('cancel'),
                              danger: true,
                              icon: PauseCircle,
                            });
                            if (ok) suspend.mutate(p.id);
                          }}
                          className="text-xs bg-accent-100 hover:bg-accent-200 text-accent-800 px-2 py-1 rounded font-semibold"
                        >
                          Sospendi
                        </button>
                      )}
                      {isSuspended && (
                        <button
                          onClick={async () => {
                            const ok = await confirmDialog({
                              title: `Riattivare ${comeSiChiama(p).cosa}?`,
                              message: `${comeSiChiama(p).chi} tornerà operativo immediatamente e riceverà una notifica.`,
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
                              message: `L'account di ${name} verrà cancellato e i dati personali anonimizzati. Non potrà più accedere. Gli ordini storici restano per obblighi fiscali. Azione irreversibile.`,
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
            {etichette.vuoto}
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
                        title: `Sospendere ${comeSiChiama(p).cosa}?`,
                        message: `${comeSiChiama(p).chi} non potrà più operare finché non lo riattiverai.`,
                        confirmLabel: tConfirm('yesSuspend'), cancelLabel: tActions('cancel'), danger: true, icon: PauseCircle,
                      });
                      if (ok) suspend.mutate(p.id);
                    }}
                    className="flex-1 min-w-[80px] text-center bg-accent-100 text-accent-800 font-semibold py-2 rounded-lg text-sm"
                  >
                    Sospendi
                  </button>
                )}
                {isSuspended && (
                  <button
                    onClick={async () => {
                      const ok = await confirmDialog({
                        title: `Riattivare ${comeSiChiama(p).cosa}?`,
                        message: `${comeSiChiama(p).chi} tornerà operativo immediatamente.`,
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
                        message: `L'account di ${name} verrà cancellato e i dati personali anonimizzati. Azione irreversibile.`,
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
          datiIdentita={datiIdentita ?? null}
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

  const inputCls = 'w-full bg-cream-50 border border-cream-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-700';

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
  profile, datiIdentita, onClose, onApprove, onReject,
}: {
  profile: Profile;
  // #81 — Codice fiscale e partita IVA arrivano solo qui, per questo utente,
  // e la lettura e' registrata: non viaggiano piu' con l'elenco di tutti.
  datiIdentita: { legal_fiscal_code: string | null; business_vat_number: string | null } | null;
  onClose: () => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  /**
   * 27/8/2026 (R100) — QUESTO PANNELLO ERA UN VELO SCRITTO A MANO.
   *
   * `<div className="fixed inset-0 …" onClick={onClose}>` e basta: niente
   * `role="dialog"`, niente `aria-modal`, niente Esc, niente trappola del
   * fuoco, niente blocco dello scorrimento dietro, niente ritorno del fuoco al
   * pulsante «Esamina». Da tastiera si usciva dal pannello con un Tab e si
   * finiva a navigare la tabella dietro il velo, senza vederla e senza poter
   * tornare indietro: l'unica uscita era ricaricare la pagina. Con un lettore
   * di schermo non era nemmeno un dialogo, quindi tutto il sito sotto restava
   * leggibile come se il pannello non ci fosse.
   *
   * Ed e' il pannello con cui si approva o si rifiuta un negozio di Piacenza.
   *
   * La correzione stava a diciassette righe di distanza: `components/ui/Modal`
   * era gia' importato in questo file — e gia' usato per «Modifica utente» —
   * con dentro tutte e cinque le cose che qui mancavano. La regola di casa e'
   * scritta in `components/hooks/useBottomSheetA11y.ts`: nessun overlay del
   * marketplace scritto a mano, o passa da `Modal`, o passa da quell'aggancio.
   */
  return (
    <Modal
      open
      onClose={onClose}
      title="Richiesta venditore"
      description={profile.approval_requested_at ? `Inviata il ${formatDate(profile.approval_requested_at)}` : undefined}
      size="xl"
      footer={
        <div className="flex w-full gap-3">
          <button
            type="button"
            onClick={onReject}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-3 rounded-lg border-2 border-rose-200 text-rose-700 hover:bg-rose-50 font-semibold"
          >
            <X size={18} strokeWidth={2.2} aria-hidden /> Rifiuta
          </button>
          <button
            type="button"
            onClick={onApprove}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-3 rounded-lg bg-olive-600 hover:bg-olive-700 text-white font-bold shadow-md"
          >
            <CheckCircle2 size={18} strokeWidth={2.2} aria-hidden /> Approva
          </button>
        </div>
      }
    >
      <div className="space-y-5 text-sm">
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
            <code>{datiIdentita?.legal_fiscal_code ?? '—'}</code>
          </DetailRow>
          <DetailRow label="Telefono">{profile.phone ?? profile.auth_phone ?? '—'}</DetailRow>
          <DetailRow label="Ultimo accesso">
            {profile.last_sign_in_at ? formatDate(profile.last_sign_in_at) : 'Mai'}
          </DetailRow>
        </DetailGroup>

        <DetailGroup title="Azienda" icon={ReceiptText}>
          <DetailRow label="Ragione sociale">{profile.business_legal_name ?? '—'}</DetailRow>
          <DetailRow label="P.IVA"><code>{datiIdentita?.business_vat_number ?? '—'}</code></DetailRow>
          <DetailRow label="Forma giuridica">{profile.business_form ?? '—'}</DetailRow>
          <DetailRow label="Sede legale">
            {profile.business_address} — {profile.business_city}
          </DetailRow>
          <DetailRow label="PEC">{profile.business_pec ?? '—'}</DetailRow>
        </DetailGroup>
      </div>
    </Modal>
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
