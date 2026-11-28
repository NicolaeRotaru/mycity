'use client';

import { Suspense, useEffect, useState } from 'react';
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
import { esameRider, type DatiEsameRider, type StatoDocumento } from '@/lib/kyc/esame-rider';
import { giornoPiacenza } from '@/lib/tempo-piacenza';

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
  /** R08-006 — la RPC delle email non ha risposto: l'email vuota di questa riga non vuol dire «senza email». */
  email_non_letta?: boolean;
};

/** Miglior etichetta identificativa per un utente. */
/** 28/11/2026 (R04-016) — Nella scheda il trattino vuol dire «nessuna email»: se non è arrivata, si dice. */
function emailDaMostrare(p: Profile): string {
  if (p.email) return p.email;
  return p.email_non_letta ? 'non arrivata: ricarica la pagina' : '—';
}

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
 * `null` = la lettura non è riuscita (R08-006: l'elenco lo deve dire).
 */
/**
 * 26/11/2026 — OLTRE MILLE ISCRITTI LE EMAIL SI LEGGONO A PAGINE.
 *
 * PostgREST restituisce al massimo `max_rows` righe per richiesta (1000, supabase/config.toml), anche
 * da una RPC: la lettura in un colpo solo si fermava alle prime mille righe di auth.users, e agli
 * altri utenti mancavano email e ultimo accesso senza nessun avviso. Si legge a pagine di mille,
 * in ordine di iscrizione (chi si iscrive mentre si legge finisce in fondo, non sposta le pagine),
 * finché una pagina non torna più corta. Una pagina che cade vale come lettura non riuscita: meglio
 * l'avviso «email non arrivate» che un elenco con le email a metà.
 */
const PAGINA_CONTATTI = 1000;
/** Freno: centomila iscritti. Oltre, la lettura non si dichiara completa. */
const PAGINE_CONTATTI_MASSIME = 100;

async function leggiContattiAuthOppureNull(): Promise<RigaAuth[] | null> {
  const tutte: RigaAuth[] = [];
  for (let pagina = 0; pagina < PAGINE_CONTATTI_MASSIME; pagina++) {
    const da = pagina * PAGINA_CONTATTI;
    const { data, error } = await supabase
      .rpc('admin_list_user_emails')
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(da, da + PAGINA_CONTATTI - 1);
    if (error || !Array.isArray(data)) {
      logger.warn('admin/users: email degli utenti non lette', { code: (error as { code?: string } | null)?.code, pagina });
      return null;
    }
    tutte.push(...(data as RigaAuth[]));
    if (data.length < PAGINA_CONTATTI) return tutte;
  }
  logger.warn('admin/users: email degli utenti oltre il freno delle pagine', { righe: tutte.length });
  return null;
}

/**
 * 26/11/2026 (R08-003) — LA RICERCA NON SI PORTA PIÙ A CASA TUTTE LE EMAIL.
 *
 * Per trovare una persona per email la ricerca leggeva tutto auth.users (la lettura qui sopra) e
 * filtrava qui: a ogni ricerca le email di tutti gli iscritti arrivavano nel browser. Adesso il
 * testo lo cerca il database (migrazione 940, la stessa RPC con due argomenti, solo admin): tornano
 * i contatti che corrispondono, più quelli dei profili già trovati per nome, perché anche quelle
 * righe mostrino l'email. Finché la 940 non è applicata la funzione con questi argomenti non c'è
 * (PGRST202) e si torna alla lettura di prima.
 *
 * 28/11/2026 (R04-016) — `null` = le email non sono arrivate. Prima tornava un elenco vuoto: i
 * risultati della ricerca uscivano senza email e senza la riga che lo dice, che c'era solo
 * nell'elenco dei più recenti.
 */
async function cercaContattiAuth(termine: string, idsGiaTrovati: readonly string[]): Promise<RigaAuth[] | null> {
  const { data, error } = await supabase.rpc('admin_list_user_emails', { p_termine: termine, p_ids: [...idsGiaTrovati] });
  if (!error && Array.isArray(data)) return data as RigaAuth[];
  if ((error as { code?: string } | null)?.code === 'PGRST202') return leggiContattiAuthOppureNull();
  logger.warn('admin/users: email della ricerca non lette', { code: (error as { code?: string } | null)?.code });
  return null;
}

/** Le righe senza email perché la lettura delle email non è riuscita, non perché non ce l'hanno. */
const senzaEmailLette = (righe: Profile[]): Profile[] => righe.map((p) => ({ ...p, email_non_letta: true }));

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
      // 26/11/2026 (R08-006) — Se le email non arrivano le righe restano senza email, come prima,
      // ma ognuna lo sa: sotto i filtri compare una riga che lo dice (`emailNonLette`).
      const contatti = await leggiContattiAuthOppureNull();
      return contatti === null ? senzaEmailLette(base) : conContattiAuth(base, contatti);
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
   * auth.users, non in profiles — la cerca la RPC admin (`cercaContattiAuth`).
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

      const perTesto = await leggiProfili((colonne) =>
        supabase
          .from('profiles')
          .select(colonne)
          .or(filtro)
          .order('created_at', { ascending: false })
          .limit(TETTO_RISULTATI_RICERCA) as unknown as PromiseLike<RispostaProfili>,
      );

      const contatti = await cercaContattiAuth(termine, perTesto.map((p) => p.id));
      const idsPerContatto = idsDaContattiAuth(contatti ?? [], termine);

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

      const unite = unisciPerId(perTesto, perContatto);
      const righe = contatti === null ? senzaEmailLette(unite) : conContattiAuth(unite, contatti);
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
    // 5/11/2026 (S05) — Notifica o email non partite, consegne ancora in mano al
    // fattorino sospeso: la rotta lo dice, la pagina lo deve mostrare.
    const avviso = (body as { avviso?: string })?.avviso;
    if (avviso) toast.warning(avviso, { duration: 10_000 });
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
    // 5/11/2026 (S05) — Il motivo si chiede anche per la sospensione: arriva al
    // negozio o al fattorino, che altrimenti spariva dal sito senza sapere perché.
    mutationFn: async (id: string) => {
      const motivo = window.prompt('Motivo della sospensione (lo riceve l’utente):');
      if (!motivo?.trim()) throw new Error('Specifica un motivo per la sospensione.');
      return moderateUser(id, 'suspend', motivo.trim());
    },
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
  // R30-024 — Un cliente non si approva: si sospende e si riattiva (app/api/admin/users/[id]/moderate).
  // Nasce «pending», ma per lui vuol dire «attivo»: niente «Esamina» e niente «In attesa».
  const clienteSospendibile = (p: { role: string; approval_status: string | null }) =>
    p.role === 'buyer' && p.approval_status !== 'suspended';

  /** Come si chiama, nei messaggi di conferma: un fattorino non e' un negozio. */
  const comeSiChiama = (p: { role: string; store_name?: string | null; full_name?: string | null }) =>
    p.role === 'rider'
      ? { cosa: 'il fattorino', chi: p.full_name ?? 'Il fattorino' }
      : p.role === 'buyer'
        ? { cosa: 'il cliente', chi: p.full_name ?? 'Il cliente' }
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
  /** R08-006 — le righe a schermo sono senza email perché la RPC non ha risposto, non perché non ce l'hanno. */
  const emailNonLette = inMano.some((p) => p.email_non_letta === true);

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
    // 20/11/2026 (R04-002) — Una lettura che non riesce non è «nessun dato»: la scheda scrive «non
    // disponibile» invece del trattino, che sembrava un codice fiscale o una partita IVA mai dati.
    queryFn: async (): Promise<DatiIdentita> => {
      try {
        const res = await fetch(`/api/admin/users/${detailId}/kyc`);
        if (!res.ok) return { legal_fiscal_code: null, business_vat_number: null, nonLetti: true };
        return await res.json();
      } catch {
        return { legal_fiscal_code: null, business_vat_number: null, nonLetti: true };
      }
    },
  });

  /**
   * I documenti del fattorino (patente, polizza, documento, selfie) e la sua
   * data di nascita: solo quando si apre la scheda di un fattorino, con link
   * firmati brevi, e la lettura resta a verbale.
   */
  const { data: documentiRider, isLoading: documentiRiderInArrivo, refetch: rileggiDocumentiRider } = useQuery({
    queryKey: [...queryKeys.admin.users(), 'documenti-rider', detailId],
    enabled: !!detailId && detail?.role === 'rider',
    gcTime: 0,
    // 5/11/2026 (S05) — I link firmati valgono 120 secondi: quando si torna sulla
    // scheda dopo più di 100 secondi si rileggono. Niente rilettura a orologio: ogni
    // lettura lascia una riga nel registro degli accessi ai documenti.
    staleTime: 100_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<DatiEsameRider | null> => {
      const res = await fetch(`/api/kyc/documenti-rider/${detailId}`);
      if (!res.ok) return null;
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
      /**
       * 28/11/2026 (R04-016) — UN FILE SENZA EMAIL NON ESCE COME SE FOSSE GIUSTO.
       * Se le email non arrivavano il file usciva lo stesso, con la colonna «Email» vuota per tutti
       * e «Esportati N utenti»: chi lo usa per scrivere agli iscritti crede che non ne abbiano una.
       * Ora si ferma e lo dice. Per il risultato di una ricerca le email sono già nelle righe.
       */
      const contatti = ricerca ? [] : await leggiContattiAuthOppureNull();
      if (contatti === null || (ricerca && filtered.some((p) => p.email_non_letta === true))) {
        toast.error('Le email degli utenti non sono arrivate: il file uscirebbe senza email. Riprova fra poco.');
        return;
      }
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
      {emailNonLette && (
        <p
          role="status"
          className="flex items-start gap-2 bg-accent-50 border border-accent-200 text-accent-900 rounded-xl px-4 py-3 text-sm"
        >
          <AlertTriangle size={16} strokeWidth={2.2} className="text-accent-600 shrink-0 mt-0.5" aria-hidden />
          <span>
            Le email degli utenti non sono arrivate: in questo elenco mancano anche a chi ce l&apos;ha, quindi una
            riga senza email non vuol dire che quell&apos;utente non ne abbia una.
            {ricerca ? ' E la ricerca non ha potuto guardare fra le email e i telefoni degli iscritti.' : ''} Ricarica la pagina fra poco.
          </span>
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
              const isApproved  = (moderabile && p.approval_status === 'approved' && p.is_approved) || clienteSospendibile(p);
              const isSuspended = (moderabile || p.role === 'buyer') && p.approval_status === 'suspended';
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
                    {(moderabile || isSuspended) && a && (
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
          // 5/11/2026 (S05) — Stessa regola della tabella: anche i fattorini si moderano.
          // Prima dal telefono un fattorino in attesa non aveva «Esamina».
          const moderabile  = siPuoModerare(p.role);
          const isPending   = moderabile && p.approval_status === 'pending';
          const isApproved  = (moderabile && p.approval_status === 'approved' && p.is_approved) || clienteSospendibile(p);
          const isSuspended = (moderabile || p.role === 'buyer') && p.approval_status === 'suspended';
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
                {(moderabile || isSuspended) && a && (
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
          documentiRider={documentiRiderInArrivo ? undefined : (documentiRider ?? null)}
          rinnovaLinkDocumenti={() => { void rileggiDocumentiRider(); }}
          onClose={() => setDetailId(null)}
          onApprove={() => { approve.mutate(detail.id); setDetailId(null); }}
          onReject={async () => {
            const reason = window.prompt(`Motivo del rifiuto (visibile ${detail.role === 'rider' ? 'al fattorino' : 'al negozio'}):`);
            if (!reason?.trim()) return;
            reject.mutate({ id: detail.id, reason: reason.trim() });
            setDetailId(null);
          }}
        />
      )}
    </div>
  );
}

/** Il tetto del nome del negozio: lo stesso del database (migrazione 830) e dell'iscrizione. */
const NOME_NEGOZIO_MAX = 80;

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
  /**
   * 28/11/2026 (R04-014) — IL NOME DEL NEGOZIO HA IL SUO TETTO ANCHE QUI.
   * Il database rifiuta un nome che nasce o cambia oltre 80 caratteri (migrazione 830): da questo
   * modulo si scopriva solo dopo «Salva». Ora il modulo conta (in caratteri, come il database) e
   * non salva. Un nome vecchio già oltre il tetto, non toccato, si può lasciare com'è: il database
   * guarda il nome solo quando cambia.
   */
  const nomeNegozio = storeName.trim();
  const caratteriNomeNegozio = Array.from(nomeNegozio).length;
  const nomeNegozioTroppoLungo =
    nomeNegozio !== (profile.store_name ?? '').trim() && caratteriNomeNegozio > NOME_NEGOZIO_MAX;

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
          if (nomeNegozioTroppoLungo) {
            document.getElementById('admin-nome-negozio')?.focus();
            return;
          }
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
            <span className="text-ink-900 font-medium break-all text-right">{emailDaMostrare(profile)}</span>
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
            <label htmlFor="admin-nome-negozio" className="block text-sm font-semibold mb-1">Nome negozio</label>
            <input
              id="admin-nome-negozio"
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
              aria-invalid={nomeNegozioTroppoLungo || undefined}
              aria-describedby="admin-nome-negozio-tetto"
              className={inputCls}
            />
            <p
              id="admin-nome-negozio-tetto"
              className={`mt-1 text-xs ${nomeNegozioTroppoLungo ? 'text-rose-700 font-semibold' : 'text-ink-500'}`}
            >
              {nomeNegozioTroppoLungo
                ? `Il nome del negozio può avere al massimo ${NOME_NEGOZIO_MAX} caratteri: accorcialo (ora sono ${caratteriNomeNegozio}).`
                : `${caratteriNomeNegozio}/${NOME_NEGOZIO_MAX} caratteri`}
            </p>
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

/** Codice fiscale e partita IVA di UN utente (/api/admin/users/[id]/kyc). `nonLetti` = la lettura non è riuscita. */
type DatiIdentita = { legal_fiscal_code: string | null; business_vat_number: string | null; nonLetti?: boolean };

/** R04-002 — Il trattino vuol dire «non c'è»; una lettura caduta si dice per quello che è. */
function datoIdentita(d: DatiIdentita | null, campo: 'legal_fiscal_code' | 'business_vat_number'): string {
  // R03-001 — Senza risposta la lettura è ancora in corso: il trattino direbbe «non c'è».
  if (!d) return 'Caricamento…';
  if (d.nonLetti) return 'non disponibile: riprova';
  return d[campo] ?? '—';
}

function DetailPanel({
  profile, datiIdentita, documentiRider, rinnovaLinkDocumenti, onClose, onApprove, onReject,
}: {
  profile: Profile;
  // #81 — Codice fiscale e partita IVA arrivano solo qui, per questo utente,
  // e la lettura e' registrata: non viaggiano piu' con l'elenco di tutti.
  datiIdentita: DatiIdentita | null;
  /** Solo per i fattorini: undefined = in arrivo, null = lettura non riuscita. */
  documentiRider?: DatiEsameRider | null;
  /** Solo per i fattorini: chiede link nuovi ai documenti (una lettura in più nel registro). */
  rinnovaLinkDocumenti?: () => void;
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
  if (profile.role === 'rider') {
    return (
      <PannelloFattorino
        profile={profile}
        datiIdentita={datiIdentita}
        documentiRider={documentiRider}
        rinnovaLink={rinnovaLinkDocumenti}
        onClose={onClose}
        onApprove={onApprove}
        onReject={onReject}
      />
    );
  }
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
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-3 rounded-lg bg-olive-600 hover:bg-olive-700 text-white font-bold shadow-warm"
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
          {/* 25/11/2026 — Col modulo corto i dati del titolare arrivano dopo l'invio: vuoti si dice. */}
          <DetailRow label="Nome e cognome">
            {[profile.legal_first_name, profile.legal_last_name].filter(Boolean).join(' ') || 'non ancora inseriti'}
          </DetailRow>
          <DetailRow label="Email">{emailDaMostrare(profile)}</DetailRow>
          <DetailRow label="Codice fiscale">
            <code>{datoIdentita(datiIdentita, 'legal_fiscal_code')}</code>
          </DetailRow>
          <DetailRow label="Telefono">{profile.phone ?? profile.auth_phone ?? '—'}</DetailRow>
          <DetailRow label="Ultimo accesso">
            {profile.last_sign_in_at ? formatDate(profile.last_sign_in_at) : 'Mai'}
          </DetailRow>
        </DetailGroup>

        <DetailGroup title="Azienda" icon={ReceiptText}>
          <DetailRow label="Ragione sociale">{profile.business_legal_name ?? '—'}</DetailRow>
          <DetailRow label="P.IVA"><code>{datoIdentita(datiIdentita, 'business_vat_number')}</code></DetailRow>
          <DetailRow label="Forma giuridica">{profile.business_form ?? '—'}</DetailRow>
          <DetailRow label="Sede legale">
            {[profile.business_address, profile.business_city].filter(Boolean).join(' — ') || 'non ancora inserita'}
          </DetailRow>
          <DetailRow label="PEC">{profile.business_pec ?? '—'}</DetailRow>
        </DetailGroup>
      </div>
    </Modal>
  );
}

const STATO_DOCUMENTO: Record<StatoDocumento, { testo: string; colore: string }> = {
  ok:             { testo: 'Valido',                   colore: 'bg-olive-100 text-olive-800' },
  in_scadenza:    { testo: 'In scadenza',              colore: 'bg-accent-100 text-accent-800' },
  scaduto:        { testo: 'Scaduto',                  colore: 'bg-rose-100 text-rose-800' },
  mancante:       { testo: 'Manca',                    colore: 'bg-rose-100 text-rose-800' },
  senza_scadenza: { testo: 'Scadenza non indicata',    colore: 'bg-accent-100 text-accent-800' },
};

/**
 * Il pannello d'esame di un fattorino.
 *
 * In produzione la verifica e' solo manuale (`ManualReviewKycProvider` lascia
 * tutto «PENDING»): questo pannello e' l'unico controllo vero. Mostra eta',
 * documento, selfie, patente e polizza con le scadenze, e tiene «Approva»
 * spento finche' manca qualcosa o un documento e' scaduto.
 */
const VEICOLI: Record<string, string> = { BIKE: 'Bicicletta', EBIKE: 'Bici elettrica', SCOOTER: 'Scooter', CAR: 'Auto' };
function etichettaVeicolo(tipo: string | null | undefined): string {
  if (!tipo) return '—';
  return VEICOLI[tipo] ?? tipo;
}

/**
 * 28/11/2026 (R04-005) — I LINK AI DOCUMENTI SCADONO ANCHE A PANNELLO APERTO.
 * La rotta firma i link per 120 secondi (app/api/kyc/documenti-rider/[id]/route.ts). Il pannello
 * li rileggeva solo tornando sulla scheda: chi restava a guardare la patente, poi apriva la
 * polizza, trovava la pagina d'errore del deposito. Poco prima della scadenza i link lasciano il
 * posto a «Rinnova il link»: una lettura nuova (e una riga nel registro) solo quando la si chiede,
 * niente rilettura a orologio.
 */
const LINK_DOCUMENTI_VALIDI_MS = 110_000;

function PannelloFattorino({
  profile, datiIdentita, documentiRider, rinnovaLink, onClose, onApprove, onReject,
}: {
  profile: Profile;
  datiIdentita: DatiIdentita | null;
  documentiRider?: DatiEsameRider | null;
  rinnovaLink?: () => void;
  onClose: () => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  const [linkScaduti, setLinkScaduti] = useState(false);
  useEffect(() => {
    // Documenti nuovi (prima lettura o rinnovo): link freschi, e l'orologio riparte da qui.
    setLinkScaduti(false);
    if (!documentiRider?.documenti?.some((d) => d.url)) return;
    const t = setTimeout(() => setLinkScaduti(true), LINK_DOCUMENTI_VALIDI_MS);
    return () => clearTimeout(t);
  }, [documentiRider]);
  const inArrivo = documentiRider === undefined;
  const esito = esameRider(documentiRider ?? null, giornoPiacenza());
  const motivi = inArrivo
    ? ['Sto caricando i documenti…']
    : documentiRider === null
      ? ['Non riesco a leggere i documenti: riprova tra poco.']
      : esito.motivi;
  const puoApprovare = !inArrivo && documentiRider !== null && esito.puoApprovare;

  return (
    <Modal
      open
      onClose={onClose}
      title="Richiesta fattorino"
      description={profile.approval_requested_at ? `Inviata il ${formatDate(profile.approval_requested_at)}` : undefined}
      size="xl"
      footer={
        <div className="flex w-full flex-col gap-2">
          {!puoApprovare && (
            <ul className="text-xs text-rose-700" aria-live="polite">
              {motivi.map((m) => <li key={m}>{m}</li>)}
            </ul>
          )}
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
              disabled={!puoApprovare}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-3 rounded-lg bg-olive-600 hover:bg-olive-700 text-white font-bold shadow-warm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <CheckCircle2 size={18} strokeWidth={2.2} aria-hidden /> Approva
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-5 text-sm">
        <DetailGroup title="Fattorino" icon={User}>
          <DetailRow label="Nome e cognome">
            {[profile.legal_first_name, profile.legal_last_name].filter(Boolean).join(' ') || profile.full_name || '—'}
          </DetailRow>
          <DetailRow label="Età">
            {inArrivo ? '…' : esito.eta === null ? 'Data di nascita mancante' : (
              <span className={esito.maggiorenne ? '' : 'font-bold text-rose-700'}>
                {esito.eta} anni{esito.maggiorenne ? '' : ' — minorenne'}
              </span>
            )}
          </DetailRow>
          <DetailRow label="Codice fiscale">
            <code>{datoIdentita(datiIdentita, 'legal_fiscal_code')}</code>
          </DetailRow>
          <DetailRow label="Email">{emailDaMostrare(profile)}</DetailRow>
          <DetailRow label="Telefono">{profile.phone ?? profile.auth_phone ?? '—'}</DetailRow>
          <DetailRow label="Veicolo">
            {inArrivo ? '…' : etichettaVeicolo(documentiRider?.veicolo?.tipo)}
          </DetailRow>
          <DetailRow label="Targa">
            {inArrivo ? '…' : (documentiRider?.veicolo?.targa?.trim() || '—')}
          </DetailRow>
        </DetailGroup>

        <DetailGroup title="Documenti" icon={ReceiptText}>
          {esito.documenti.map((d) => (
            <DetailRow key={d.chiave} label={d.etichetta}>
              <span className="inline-flex flex-wrap items-center gap-2">
                {d.url && linkScaduti ? (
                  <button type="button" onClick={rinnovaLink} className="text-primary-700 underline">
                    Link scaduto: rinnova il link
                  </button>
                ) : d.url ? (
                  <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-primary-700 underline">
                    Apri {d.etichetta.toLowerCase()}
                  </a>
                ) : null}
                {!inArrivo && (d.url || d.obbligatorio) && (
                  <span className={`px-2 py-0.5 rounded text-xs font-semibold ${STATO_DOCUMENTO[d.stato].colore}`}>
                    {STATO_DOCUMENTO[d.stato].testo}
                  </span>
                )}
                {d.scade_il && <span className="text-xs text-ink-500">scade il {formatDate(d.scade_il)}</span>}
              </span>
            </DetailRow>
          ))}
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
