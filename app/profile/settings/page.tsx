'use client';

import { titolare } from '@/lib/legal/titolare';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import PushNotificationOptIn from '@/components/PushNotificationOptIn';
import PublicProfileToggle from '@/components/PublicProfileToggle';
import {
  User, Lock, Bell, Shield, AlertTriangle, Smartphone,
  Download, FileText, Mail, Hourglass, Undo2, Trash2, Settings,
  type LucideIcon,
} from 'lucide-react';
// 22/8/2026 — `apiErrorMessage` c'era una copia locale, riga per riga
// identica a questa. Una copia non resta uguale: quella è sparita.
import { friendlyError, apiErrorMessage } from '@/lib/errors';
import { perchePasswordNonCambiabile, puoiProvareACambiare } from '@/lib/account/cambio-password';
import { LoadingState } from '@/components/ui/LoadingState';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Field';
// 30/8/2026 (R105) — l'interruttore stava qui dentro, senza nome accessibile:
// cinque comandi che si annunciavano tutti come «interruttore». Adesso ha una
// casa sua, e il nome ce l'ha (components/ui/Toggle.tsx).
import { Toggle } from '@/components/ui/Toggle';

type Tab = 'account' | 'password' | 'notifications' | 'privacy' | 'danger';

const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: 'account',       label: 'Account',          icon: User },
  { id: 'password',      label: 'Password',         icon: Lock },
  { id: 'notifications', label: 'Notifiche',        icon: Bell },
  { id: 'privacy',       label: 'Privacy e dati',   icon: Shield },
  { id: 'danger',        label: 'Zona pericolosa',  icon: AlertTriangle },
];

type Prefs = {
  notif_order_updates: boolean;
  notif_promos: boolean;
  notif_groups: boolean;
  notif_newsletter: boolean;
  email_marketing: boolean;
  push_enabled: boolean;
  language: 'it' | 'en';
};

const DEFAULT_PREFS: Prefs = {
  notif_order_updates: true,
  notif_promos: true,
  notif_groups: true,
  notif_newsletter: false,
  email_marketing: false,
  push_enabled: false,
  language: 'it',
};

export default function SettingsPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('account');
  const [email, setEmail] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Password change
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPwd, setChangingPwd] = useState(false);

  // New email
  const [newEmail, setNewEmail] = useState('');
  const [changingEmail, setChangingEmail] = useState(false);

  // Prefs — le 5 notifiche sono persistite su profiles (load nel useEffect, save
  // in updatePref). push_enabled/language restano locali (non funzionali sul DB).
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);

  // Delete account (cooldown 7gg)
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [pendingDeletion, setPendingDeletion] = useState<{ effectiveAt: string; daysRemaining: number } | null>(null);
  const [cancelingDeletion, setCancelingDeletion] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) {
        router.push('/sign-in?returnTo=/profile/settings');
        return;
      }
      setEmail(data.user.email ?? '');
      setUserId(data.user.id);
      // Carica le preferenze notifiche persistite sul profilo.
      const { data: prof } = await supabase
        .from('profiles')
        .select('notif_order_updates, notif_promos, notif_groups, notif_newsletter, email_marketing')
        .eq('id', data.user.id)
        .single();
      if (prof) {
        setPrefs((prev) => ({
          ...prev,
          notif_order_updates: !!prof.notif_order_updates,
          notif_promos: !!prof.notif_promos,
          notif_groups: !!prof.notif_groups,
          notif_newsletter: !!prof.notif_newsletter,
          email_marketing: !!prof.email_marketing,
        }));
      }
      // Verifica se c'è una richiesta di eliminazione pendente (cooldown 7gg)
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (token) {
          const res = await fetch('/api/account/delete', { headers: { Authorization: `Bearer ${token}` } });
          if (res.ok) {
            const body = await res.json();
            if (body?.pending) {
              setPendingDeletion({ effectiveAt: body.effectiveAt, daysRemaining: body.daysRemaining });
            }
          }
        }
      } catch { /* stato non bloccante */ }
      setLoading(false);
    });
  }, [router]);

  const updatePref = <K extends keyof Prefs>(key: K, value: Prefs[K]) => {
    setPrefs((prev) => ({ ...prev, [key]: value }));
    const dbCols = ['notif_order_updates', 'notif_promos', 'notif_groups', 'notif_newsletter', 'email_marketing'];
    if (userId && dbCols.includes(key as string)) {
      void (async () => {
        const { error } = await supabase.from('profiles').update({ [key]: value }).eq('id', userId);
        if (error) toast.error('Errore nel salvataggio');
        else toast.success('Preferenza salvata');
      })();
    } else {
      toast.success('Preferenza salvata');
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const motivo = perchePasswordNonCambiabile({ currentPassword, newPassword, confirmPassword });
    if (motivo) {
      toast.error(motivo);
      return;
    }
    setChangingPwd(true);
    /**
     * LA PASSWORD ATTUALE SI CONTROLLA SUL SERVER.
     *
     * 27/8/2026 (R019) — Qui c'erano due chiamate indipendenti fatte dal
     * browser: prima la verifica della password attuale con un accesso finto,
     * poi la scrittura della nuova sull'account. Chi controlla questa
     * pagina — la console degli strumenti per sviluppatori, un'estensione
     * ostile, uno script iniettato — chiamava direttamente la SECONDA e
     * saltava la prima. Il controllo c'era e non difendeva da niente: una
     * sessione rubata diventava un account perso per sempre, perche' con la
     * password cambiata il proprietario vero non rientra piu'.
     *
     * Adesso verifica e cambio sono una cosa sola, e stanno dietro
     * /api/account/cambia-password, dove il browser non arriva.
     */
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/account/cambia-password', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(session?.access_token ? { authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ passwordAttuale: currentPassword, nuovaPassword: newPassword }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(apiErrorMessage(j, 'Password attuale non corretta'));
        return;
      }
    } catch (err) {
      toast.error(friendlyError(err));
      return;
    } finally {
      setChangingPwd(false);
    }
    toast.success('Password aggiornata con successo');
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
  };

  const handleChangeEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail.trim()) return;
    setChangingEmail(true);
    const { error } = await supabase.auth.updateUser({ email: newEmail.trim() });
    setChangingEmail(false);
    if (error) {
      toast.error(friendlyError(error));
      return;
    }
    toast.success('Ti abbiamo inviato un\'email per confermare il nuovo indirizzo');
    setNewEmail('');
  };

  /**
   * 22/8/2026 — IL PULSANTE SCARICAVA UN FILE SENZA GLI ORDINI, E DICEVA CHE
   * ERA ANDATO TUTTO BENE.
   *
   * Qui si leggeva `orders` filtrando su `buyer_id`, una colonna che sulla
   * tabella degli ordini NON ESISTE (si chiama `user_id`; `buyer_id` sta su
   * altre tabelle, ed e' da li' che era stata copiata). PostgREST rifiuta
   * l'intera lettura, il codice scartava l'errore, `orders` restava vuoto e
   * partiva comunque il messaggio «Esportazione dati scaricata».
   *
   * Chi esercita il diritto di portabilita' scaricava un file in cui la
   * cronologia degli acquisti — il dato che conta di piu' — non c'era, e il
   * sito gli confermava che era tutto a posto.
   *
   * L'esportazione giusta esiste gia' ed e' completa: `/api/account/export`
   * porta ordini come cliente, come negozio e come fattorino, con un freno a
   * tre richieste al giorno. Non la chiamava nessuno. Adesso il pulsante passa
   * di li': una strada sola, quella gia' scritta e gia' coperta dalle prove.
   */
  const handleDownloadData = async () => {
    if (!userId) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        toast.error('Sessione scaduta: rientra e riprova.');
        return;
      }
      const res = await fetch('/api/account/export', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const corpo = await res.json().catch(() => null);
        toast.error(apiErrorMessage(corpo, 'Esportazione non riuscita. Riprova piu tardi.'));
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mycity-export-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Esportazione dati scaricata');
    } catch {
      toast.error('Esportazione non riuscita. Riprova piu tardi.');
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirm !== 'ELIMINA') {
      toast.error('Scrivi ELIMINA per confermare');
      return;
    }
    setDeleting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('Sessione scaduta, esegui di nuovo il login.');

      const res = await fetch('/api/account/delete', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(apiErrorMessage(body, 'Richiesta non riuscita'));

      // L'account NON viene eliminato subito: c'è un cooldown di 7 giorni
      // durante il quale l'utente può annullare. NON facciamo signOut così
      // l'utente può vedere lo stato e cambiare idea.
      const days = body?.effectiveAt
        ? Math.max(0, Math.ceil((new Date(body.effectiveAt).getTime() - Date.now()) / 86_400_000))
        : 7;
      setPendingDeletion({ effectiveAt: body?.effectiveAt ?? '', daysRemaining: days });
      setDeleteConfirm('');
      toast.success(`Richiesta registrata. L'account sarà eliminato tra ${days} giorni. Puoi annullare quando vuoi.`);
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setDeleting(false);
    }
  };

  const handleCancelDeletion = async () => {
    setCancelingDeletion(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('Sessione scaduta, esegui di nuovo il login.');
      const res = await fetch('/api/account/delete', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(apiErrorMessage(body, 'Annullamento non riuscito'));
      setPendingDeletion(null);
      toast.success('Eliminazione annullata. Il tuo account resta attivo.');
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setCancelingDeletion(false);
    }
  };

  if (loading) {
    return <LoadingState />;
  }

  return (
    <div className="container mx-auto px-6 py-8 max-w-5xl">
      <div className="mb-6">
        <Link href="/profile" className="text-sm text-primary-700 hover:underline">← Il tuo account</Link>
        <h1 className="text-2xl md:text-3xl font-extrabold text-ink-900 mt-2 flex items-center gap-2">
          <Settings size={28} className="text-ink-500" aria-hidden />
          Impostazioni
        </h1>
        <p className="text-sm text-ink-600">Gestisci account, sicurezza, notifiche e privacy.</p>
      </div>

      <div className="grid md:grid-cols-[220px_1fr] gap-6">
        {/* Sidebar tabs */}
        <aside>
          <nav className="bg-white border rounded-xl overflow-hidden md:sticky md:top-[var(--header-height)]">
            {TABS.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left text-sm border-l-4 transition-colors ${
                    tab === t.id
                      ? 'bg-primary-50 border-primary-600 text-primary-800 font-bold'
                      : 'border-transparent text-ink-700 hover:bg-cream-50'
                  }`}
                >
                  <Icon size={20} className="text-ink-500" aria-hidden />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Content */}
        <div className="space-y-6">
          {tab === 'account' && (
            <section className="bg-white border rounded-xl p-6 space-y-6">
              <div>
                <h2 className="text-lg font-bold mb-1">Email di accesso</h2>
                <p className="text-sm text-ink-500 mb-4">
                  Email attuale: <span className="font-mono text-ink-900">{email}</span>
                </p>
                <form onSubmit={handleChangeEmail} className="flex flex-col sm:flex-row gap-2">
                  <Input
                    type="email"
                    placeholder="nuova-email@example.com"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    inputMode="email"
                    containerClassName="flex-1"
                  />
                  <Button
                    type="submit"
                    loading={changingEmail}
                    disabled={!newEmail.trim()}
                  >Cambia email</Button>
                </form>
                <p className="text-xs text-ink-500 mt-2">
                  Ti invieremo un'email di conferma al nuovo indirizzo.
                </p>
              </div>

              <hr />

              <div>
                <h2 className="text-lg font-bold mb-1">Lingua</h2>
                <p className="text-sm text-ink-500 mb-3">Lingua dell'interfaccia.</p>
                <Select
                  value={prefs.language}
                  onChange={(e) => updatePref('language', e.target.value as 'it' | 'en')}
                >
                  <option value="it">🇮🇹 Italiano</option>
                  <option value="en">🇬🇧 English (presto)</option>
                </Select>
              </div>

              <hr />

              <div>
                <h2 className="text-lg font-bold mb-1">Dati personali</h2>
                <p className="text-sm text-ink-500 mb-3">Per modificare nome, telefono, indirizzo principale:</p>
                <Link href="/profile" className="inline-flex items-center gap-2 bg-cream-100 hover:bg-cream-200 px-4 py-2 rounded-lg font-semibold text-sm text-ink-900 transition-colors">
                  Modifica profilo →
                </Link>
              </div>
            </section>
          )}

          {tab === 'password' && (
            <section className="bg-white border rounded-xl p-6">
              <h2 className="text-lg font-bold mb-1 flex items-center gap-2">
                <Lock size={20} className="text-ink-500" aria-hidden />
                Cambia password
              </h2>
              <p className="text-sm text-ink-500 mb-5">Usa una password di almeno 8 caratteri, diversa dalle altre.</p>
              <form onSubmit={handleChangePassword} className="space-y-4 max-w-md">
                <Input
                  label="Password attuale"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                />
                <Input
                  label="Nuova password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                />
                <Input
                  label="Conferma nuova password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                />
                <Button
                  type="submit"
                  loading={changingPwd}
                  disabled={!puoiProvareACambiare({ currentPassword, newPassword, confirmPassword })}
                >Aggiorna password</Button>
              </form>
            </section>
          )}

          {tab === 'notifications' && (
            <section className="bg-white border rounded-xl p-6 space-y-5">
              <div>
                <h2 className="text-lg font-bold mb-1 flex items-center gap-2">
                  <Bell size={20} className="text-ink-500" aria-hidden />
                  Preferenze notifiche
                </h2>
                <p className="text-sm text-ink-500">Scegli cosa vuoi ricevere e come.</p>
              </div>

              <div className="space-y-3">
                <Toggle
                  label="Aggiornamenti ordini"
                  desc="Avvisi per nuovi ordini, cambio stato, consegna."
                  value={prefs.notif_order_updates}
                  onChange={(v) => updatePref('notif_order_updates', v)}
                />
                <Toggle
                  label="Promozioni e sconti"
                  desc="Offerte dai tuoi negozi preferiti e coupon."
                  value={prefs.notif_promos}
                  onChange={(v) => updatePref('notif_promos', v)}
                />
                <Toggle
                  label="Gruppi d'acquisto"
                  desc="Avvisi quando un gruppo sta per chiudere."
                  value={prefs.notif_groups}
                  onChange={(v) => updatePref('notif_groups', v)}
                />
                <Toggle
                  label="Newsletter mensile"
                  desc="Novità, nuovi negozi, articoli del blog."
                  value={prefs.notif_newsletter}
                  onChange={(v) => updatePref('notif_newsletter', v)}
                />
              </div>

              <hr />

              <div>
                <h3 className="font-bold mb-2">Canali</h3>
                <Toggle
                  label="Email marketing"
                  desc="Ricevi anche le promozioni via email."
                  value={prefs.email_marketing}
                  onChange={(v) => updatePref('email_marketing', v)}
                />
                <div className="mt-3 flex items-start justify-between gap-4 p-3 border rounded-lg">
                  <div>
                    <div className="font-semibold flex items-center gap-2">
                      <Smartphone size={18} className="text-ink-500" aria-hidden />
                      Notifiche push del browser
                    </div>
                    <div className="text-xs text-ink-500">
                      Avvisi immediati anche a schermo bloccato (richiede permesso).
                    </div>
                  </div>
                  <PushNotificationOptIn />
                </div>
              </div>
            </section>
          )}

          {tab === 'privacy' && (
            <section className="bg-white border rounded-xl p-6 space-y-5">
              <div>
                <h2 className="text-lg font-bold mb-1 flex items-center gap-2">
                  <Shield size={20} className="text-ink-500" aria-hidden />
                  Privacy e dati
                </h2>
                <p className="text-sm text-ink-500">Hai pieno controllo sui tuoi dati.</p>
              </div>

              <div className="border rounded-lg p-4">
                <h3 className="font-bold mb-1 flex items-center gap-2">
                  <Download size={18} className="text-ink-500" aria-hidden />
                  Scarica i tuoi dati
                </h3>
                <p className="text-sm text-ink-600 mb-3">
                  Esporta in JSON tutto quello che abbiamo su di te: profilo, ordini, indirizzi, preferenze.
                </p>
                <button
                  type="button"
                  onClick={handleDownloadData}
                  className="bg-cream-100 hover:bg-cream-200 px-4 py-2 rounded-lg text-sm font-semibold text-ink-900"
                >
                  Esporta dati (JSON)
                </button>
              </div>

              {/* Profilo pubblico — Community Manager: opt-in stretto, default OFF */}
              <PublicProfileToggle />

              <div className="border rounded-lg p-4">
                <h3 className="font-bold mb-1 flex items-center gap-2">
                  <FileText size={18} className="text-ink-500" aria-hidden />
                  Documenti
                </h3>
                <ul className="text-sm space-y-1">
                  <li><Link href="/terms" className="text-primary-700 hover:underline">Termini di servizio</Link></li>
                  <li><Link href="/privacy" className="text-primary-700 hover:underline">Privacy policy</Link></li>
                  <li><Link href="/cookies" className="text-primary-700 hover:underline">Cookie policy</Link></li>
                </ul>
              </div>

              <div className="border rounded-lg p-4">
                <h3 className="font-bold mb-1 flex items-center gap-2">
                  <Mail size={18} className="text-ink-500" aria-hidden />
                  Contatta il responsabile privacy
                </h3>
                <p className="text-sm text-ink-600">
                  Per esercitare i tuoi diritti GDPR (accesso, rettifica, opposizione, cancellazione):
                </p>
                {/* 22/8/2026 — L'indirizzo era scritto a mano, su un dominio
                    che non e' quello di produzione: chi esercitava i suoi
                    diritti scriveva a una casella che non riceve. Adesso viene
                    dalla configurazione, come gli altri dati del titolare. */}
                <a
                  href={`mailto:${titolare().emailPrivacy}`}
                  className="text-primary-700 hover:underline text-sm"
                >
                  {titolare().emailPrivacy}
                </a>
              </div>
            </section>
          )}

          {tab === 'danger' && (
            <section className="bg-white border-2 border-red-200 rounded-xl p-6">
              <h2 className="text-lg font-bold text-red-700 mb-1 flex items-center gap-2">
                <AlertTriangle size={20} className="text-red-700" aria-hidden />
                Zona pericolosa
              </h2>
              <p className="text-sm text-ink-600 mb-5">Azioni irreversibili. Procedi con cautela.</p>

              {pendingDeletion ? (
                /* Stato: eliminazione già richiesta — mostra countdown + annulla */
                <div className="bg-accent-50 border border-accent-300 rounded-lg p-5">
                  <h3 className="font-bold text-accent-900 mb-2 flex items-center gap-2">
                    <Hourglass size={18} className="text-accent-900" aria-hidden />
                    Eliminazione programmata
                  </h3>
                  <p className="text-sm text-accent-800 mb-1 leading-relaxed">
                    Il tuo account sarà eliminato definitivamente tra{' '}
                    <strong>{pendingDeletion.daysRemaining} {pendingDeletion.daysRemaining === 1 ? 'giorno' : 'giorni'}</strong>
                    {pendingDeletion.effectiveAt && (
                      <> (il {new Date(pendingDeletion.effectiveAt).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })})</>
                    )}.
                  </p>
                  <p className="text-sm text-accent-700 mb-4">
                    Puoi annullare in qualsiasi momento entro questa data. Dopo, i dati saranno rimossi in modo irreversibile.
                  </p>
                  <button
                    type="button"
                    onClick={handleCancelDeletion}
                    disabled={cancelingDeletion}
                    className="inline-flex items-center gap-2 bg-olive-600 hover:bg-olive-700 disabled:opacity-40 text-white px-5 py-2.5 rounded-lg font-bold transition-colors"
                  >
                    {cancelingDeletion ? (
                      'Annullamento...'
                    ) : (
                      <>
                        <Undo2 size={18} className="text-white" aria-hidden />
                        Annulla eliminazione
                      </>
                    )}
                  </button>
                </div>
              ) : (
                <div className="bg-red-50 border border-red-200 rounded-lg p-5">
                  <h3 className="font-bold text-red-900 mb-2">Elimina il tuo account</h3>
                  <p className="text-sm text-red-800 mb-3 leading-relaxed">
                    Verranno rimossi profilo, indirizzi e preferenze. Gli ordini già evasi resteranno anonimizzati
                    per obblighi fiscali. C'è un periodo di ripensamento di <strong>7 giorni</strong> durante il
                    quale puoi annullare; dopo, <strong>l'azione è permanente.</strong>
                  </p>
                  <label className="block text-sm font-medium text-red-900 mb-1">
                    Scrivi <span className="font-mono bg-white px-1.5 py-0.5 rounded">ELIMINA</span> per confermare:
                  </label>
                  <input
                    type="text"
                    value={deleteConfirm}
                    onChange={(e) => setDeleteConfirm(e.target.value)}
                    className="w-full border border-red-300 rounded-lg p-2.5 mb-3 focus:outline-none focus:ring-2 focus:ring-red-400 bg-white"
                  />
                  <button
                    type="button"
                    onClick={handleDeleteAccount}
                    disabled={deleting || deleteConfirm !== 'ELIMINA'}
                    className="inline-flex items-center gap-2 bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-lg font-bold transition-colors"
                  >
                    {deleting ? (
                      'Invio richiesta...'
                    ) : (
                      <>
                        <Trash2 size={18} className="text-white" aria-hidden />
                        Richiedi eliminazione
                      </>
                    )}
                  </button>
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

