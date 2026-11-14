'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Circle, Mail, MailCheck, ArrowRight } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input, PasswordInput } from '@/components/ui/Field';
import { LoadingState } from '@/components/ui/LoadingState';
import { AuthShell } from '@/components/ui/AuthShell';
import { logger } from '@/lib/logger';
import { traduciErroreNuovaPassword, type ErroreDiSupabase } from '@/lib/auth/errori-nuova-password';
import {
  motivoLinkPasswordSenzaSessione,
  SPIEGAZIONE_RESET,
  type MotivoResetSenzaSessione,
} from '@/lib/auth/link-email';

/**
 * Pagina di reset password.
 *
 * Flusso Supabase:
 *  1) /sign-in → user clicca "Password dimenticata?" → resetPasswordForEmail()
 *     con redirectTo = `${origin}/reset-password` — OPPURE l'utente arriva qui
 *     senza token e usa la vista "richiedi link" sotto.
 *  2) Supabase invia email con magic link verso /reset-password con un token
 *     nel fragment dell'URL (#access_token=...&type=recovery&...)
 *  3) Al mount, il client Supabase intercetta l'hash e fa setSession.
 *     L'evento onAuthStateChange emette 'PASSWORD_RECOVERY'.
 *  4) Mostriamo il form di nuova password.
 *  5) updateUser({ password }) → success → redirect al sign-in.
 *
 * Se l'utente arriva qui senza token, mostriamo la vista "richiedi link".
 *
 * 15/10/2026 (R13) — CHI APRIVA IL LINK SUL TELEFONO TORNAVA AL PUNTO DI PARTENZA.
 *
 * Il client del browser usa il flusso PKCE: il link porta un `?code=` che si
 * scambia solo nel browser che ha chiesto il cambio password. Aperto altrove
 * (il telefono, l'app della posta) la libreria non tentava nemmeno, e dopo 800
 * millisecondi questa pagina mostrava di nuovo «Inserisci la tua email», senza
 * una parola. Due cambi:
 *  - la strada che funziona ovunque e' /auth/confirm con il `token_hash`: il
 *    server verifica il link e arriva qui con la sessione gia' nei cookie;
 *  - quando invece si arriva con un link che qui non puo' funzionare, la
 *    pagina dice perche' e cosa fare (`lib/auth/link-email.ts`).
 */

// 12/11/2026 (R10-016) — La traduzione degli errori sta in lib/auth/errori-nuova-password.ts
// e legge il MOTIVO del rifiuto (una password rubata non e' una password corta).
const translateError = (err: unknown): string =>
  traduciErroreNuovaPassword(err && typeof err === 'object' ? (err as ErroreDiSupabase) : { message: String(err ?? '') });

/**
 * 1/11/2026 — LA PASSWORD SI CAMBIA SOLO COL LINK DI RECUPERO.
 *
 * Questa pagina scrive una password nuova senza chiedere quella vecchia: la
 * puo' fare solo chi e' arrivato dal link dell'email. Il segno lo mette
 * Supabase, non noi: il gettone di una sessione nata da un link di recupero
 * (frammento, `?code=` o `verifyOtp` su /auth/confirm) porta nel campo `amr`
 * il metodo `recovery`, firmato dal server. Un parametro nell'indirizzo si
 * potrebbe scrivere a mano; il gettone no. Per questo /auth/confirm non deve
 * aggiungere niente: la sessione che apre porta gia' il segno.
 *
 * Il segno vale per `FINESTRA_RECUPERO_MS` dal momento in cui il link e' stato
 * aperto, la stessa durata del link: dopo, si chiede un link nuovo.
 */
const FINESTRA_RECUPERO_MS = 60 * 60 * 1000;

function nataDalLinkDiRecupero(sessione: { access_token?: string | null } | null | undefined): boolean {
  const gettone = sessione?.access_token;
  if (typeof gettone !== 'string') return false;
  const parti = gettone.split('.');
  if (parti.length !== 3) return false;
  try {
    const b64 = parti[1].replace(/-/g, '+').replace(/_/g, '/');
    const dati = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))) as {
      amr?: Array<{ method?: unknown; timestamp?: unknown }>;
    };
    if (!Array.isArray(dati.amr)) return false;
    return dati.amr.some(
      (voce) =>
        voce?.method === 'recovery' &&
        typeof voce.timestamp === 'number' &&
        Date.now() - voce.timestamp * 1000 <= FINESTRA_RECUPERO_MS,
    );
  } catch {
    return false;
  }
}

/**
 * 1/11/2026 — Il link passato da /auth/confirm apre una sessione che Supabase
 * marca «otp» (non «recovery»), e nel browser non arriva nessun evento. Per
 * quelle sessioni, e solo per quelle, si chiede al server se ha messo il segno
 * del recupero dopo un `verifyOtp` riuscito (lib/auth/segno-recupero.ts).
 * Chi è entrato con la password non arriva mai fin qui.
 */
function nataDaUnLinkOtp(sessione: { access_token?: string | null } | null | undefined): boolean {
  const gettone = sessione?.access_token;
  if (typeof gettone !== 'string') return false;
  const parti = gettone.split('.');
  if (parti.length !== 3) return false;
  try {
    const b64 = parti[1].replace(/-/g, '+').replace(/_/g, '/');
    const dati = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))) as {
      amr?: Array<{ method?: unknown }>;
    };
    return Array.isArray(dati.amr) && dati.amr.some((voce) => voce?.method === 'otp');
  } catch {
    return false;
  }
}

async function ilServerHaSegnatoIlRecupero(sessione: { access_token?: string | null } | null | undefined): Promise<boolean> {
  if (!nataDaUnLinkOtp(sessione)) return false;
  try {
    const risposta = await fetch('/auth/recupero', { method: 'GET', credentials: 'same-origin', cache: 'no-store' });
    if (!risposta.ok) return false;
    const corpo = (await risposta.json()) as { recupero?: unknown };
    return corpo.recupero === true;
  } catch {
    return false;
  }
}

/** Il link di recupero, in una delle sue tre strade, è passato da qui. */
async function sessioneDiRecupero(
  annunciato: boolean,
  sessione: { access_token?: string | null } | null | undefined,
): Promise<boolean> {
  return annunciato || nataDalLinkDiRecupero(sessione) || (await ilServerHaSegnatoIlRecupero(sessione));
}

function ResetPasswordInner() {
  const router = useRouter();
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  // R10-016 — Il motivo per cui la nuova password e' stata rifiutata, sotto il campo.
  const [erroreDellaPassword, setErroreDellaPassword] = useState<string | undefined>(undefined);
  // Supabase ha annunciato PASSWORD_RECOVERY: il link dell'email e' stato aperto qui.
  const recuperoAnnunciato = useRef(false);

  // Vista "richiedi link" (quando l'utente arriva senza token di recovery).
  const [requestEmail, setRequestEmail] = useState('');
  const [sendingLink, setSendingLink] = useState(false);
  const [linkSent, setLinkSent] = useState(false);
  // Perche' il link aperto non ha dato una sessione: si dice, non si tace.
  const [motivo, setMotivo] = useState<MotivoResetSenzaSessione | null>(null);
  // S10 (5/11/2026) — Di chi e' la password che si sta cambiando: sul telefono
  // puo' essere aperto un altro account, e va detto prima di scrivere.
  const [emailDellaSessione, setEmailDellaSessione] = useState<string | null>(null);

  // Ascolta gli eventi di Supabase: PASSWORD_RECOVERY ci dice che il magic
  // link è stato consumato e la sessione di recovery è attiva.
  useEffect(() => {
    // Un SIGNED_IN qualunque (un account gia' aperto su questo dispositivo)
    // non basta: serve che la sessione sia nata dal link di recupero.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') recuperoAnnunciato.current = true;
      if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && nataDalLinkDiRecupero(session))) {
        setRecoveryReady(true);
        setEmailDellaSessione(session?.user?.email ?? null);
        setCheckingSession(false);
      }
    });

    // Se l'utente arriva qui senza hash (es. ha aperto il link su un altro
    // dispositivo e poi è venuto qui a mano), comunque controlliamo dopo
    // un breve delay se c'è una sessione di recovery.
    const t = setTimeout(async () => {
      // L'esito dello scambio del `code` dice se il link e' scaduto qui o e'
      // stato aperto altrove (lib/auth/link-email.ts).
      const { error: erroreDelloScambio } = await supabase.auth.initialize();
      const { data } = await supabase.auth.getSession();
      if (await sessioneDiRecupero(recuperoAnnunciato.current, data.session)) {
        setRecoveryReady(true);
        setEmailDellaSessione(data.session?.user?.email ?? null);
      } else {
        setMotivo(
          motivoLinkPasswordSenzaSessione(
            new URLSearchParams(window.location.search),
            window.location.hash,
            erroreDelloScambio as { name?: unknown; code?: unknown } | null,
          ),
        );
      }
      setCheckingSession(false);
    }, 800);

    return () => {
      sub.subscription.unsubscribe();
      clearTimeout(t);
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast.error('La password deve avere almeno 8 caratteri');
      return;
    }
    if (password !== confirm) {
      toast.error('Le due password non coincidono');
      return;
    }
    setSubmitting(true);
    try {
      // Diagnostica: verifica che ci sia ancora una sessione attiva
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        toast.error('Sessione di reset persa. Richiedi un nuovo link qui sotto.');
        setSubmitting(false);
        return;
      }
      if (!(await sessioneDiRecupero(recuperoAnnunciato.current, sess.session))) {
        toast.error('Per cambiare la password apri il link che ti abbiamo mandato via email. Richiedilo qui sotto.');
        setRecoveryReady(false);
        setSubmitting(false);
        return;
      }
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        // Log completo in console per debug
        const errObj = error as { status?: number; message: string; name?: string };
        logger.error(error, { status: errObj.status, message: errObj.message, name: errObj.name });
        throw error;
      }
      setDone(true);
      toast.success('Password aggiornata con successo');
      await supabase.auth.signOut();
      setTimeout(() => router.push('/sign-in'), 1200);
    } catch (err) {
      // R10-016 — L'errore resta sotto il campo, non solo in un avviso che sparisce.
      const testo = translateError(err);
      // Sotto il campo solo cio' che riguarda la password; «sessione scaduta» resta nell'avviso.
      if (/^(Questa password|La password|La nuova password)/.test(testo)) setErroreDellaPassword(testo);
      toast.error(testo);
    } finally {
      setSubmitting(false);
    }
  };

  // Richiesta di un nuovo link di reset (vista senza token).
  const requestLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requestEmail.trim()) {
      toast.error('Inserisci la tua email per ricevere il link di reset');
      return;
    }
    setSendingLink(true);
    try {
      const redirectTo = typeof window !== 'undefined'
        ? `${window.location.origin}/reset-password`
        : undefined;
      const { error } = await supabase.auth.resetPasswordForEmail(requestEmail.trim(), { redirectTo });
      if (error) throw error;
      setLinkSent(true);
    } catch (err) {
      toast.error(translateError(err));
    } finally {
      setSendingLink(false);
    }
  };

  // STATO: caricamento iniziale (attendiamo l'evento di Supabase)
  if (checkingSession) {
    return (
      <AuthShell>
        <div className="py-6 text-center">
          <div className="mx-auto mb-3 h-12 w-12 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
          <p className="text-sm text-ink-500">Verifica del link di reset…</p>
        </div>
      </AuthShell>
    );
  }

  // STATO: nessuna sessione di recovery valida → vista "richiedi link".
  if (!recoveryReady) {
    if (linkSent) {
      return (
        <AuthShell back={{ href: '/sign-in', label: 'Torna al login' }}>
          <h1 className="font-serif text-4xl font-extrabold leading-tight text-ink-900">
            Controlla l&apos;email
          </h1>
          <p className="mt-1.5 mb-7 text-base leading-relaxed text-ink-600">
            Ti abbiamo inviato un link per reimpostare la password. Controlla la posta (anche lo spam).
          </p>
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-xl border border-olive-200 bg-olive-50 p-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-olive-100">
                <MailCheck size={20} className="text-olive-700" aria-hidden />
              </span>
              <span className="text-sm text-olive-900">
                Link inviato a <strong>{requestEmail.trim()}</strong>
              </span>
            </div>
            <Button href="/sign-in" size="lg" fullWidth>Torna al login</Button>
          </div>
        </AuthShell>
      );
    }
    return (
      <AuthShell back={{ href: '/sign-in', label: 'Torna al login' }}>
        <h1 className="font-serif text-4xl font-extrabold leading-tight text-ink-900">
          Reimposta la password
        </h1>
        {motivo && (
          <div role="alert" className="mt-4 rounded-xl border border-secondary-200 bg-secondary-50 p-4 text-sm text-ink-800">
            <p className="font-bold text-ink-900">{SPIEGAZIONE_RESET[motivo].titolo}</p>
            <p className="mt-1 leading-relaxed">{SPIEGAZIONE_RESET[motivo].testo}</p>
          </div>
        )}
        <p className="mt-1.5 mb-7 text-base leading-relaxed text-ink-600">
          Inserisci la tua email: ti mandiamo un link per scegliere una nuova password.
        </p>
        <form onSubmit={requestLink} className="space-y-4">
          <Input
            id="reset-request-email"
            label="Email"
            type="email"
            value={requestEmail}
            onChange={(e) => setRequestEmail(e.target.value)}
            placeholder="la-tua@email.it"
            autoComplete="email"
            inputMode="email"
            leading={<Mail size={18} aria-hidden />}
            required
          />
          <Button type="submit" size="lg" loading={sendingLink} iconRight={ArrowRight} fullWidth>
            {sendingLink ? 'Invio…' : 'Invia il link'}
          </Button>
        </form>
      </AuthShell>
    );
  }

  // STATO: successo (prima del redirect)
  if (done) {
    return (
      <AuthShell>
        <div className="py-6 text-center">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-olive-100 text-olive-600">
            <Check size={28} strokeWidth={2.4} aria-hidden />
          </div>
          <h1 className="font-serif text-2xl font-extrabold text-ink-900">Password aggiornata!</h1>
          <p className="mt-1 text-sm text-ink-600">Tra un istante ti porto al login con la nuova password.</p>
        </div>
      </AuthShell>
    );
  }

  // STATO: form nuova password (sessione di recovery attiva)
  return (
    <AuthShell back={{ href: '/sign-in', label: 'Torna al login' }}>
      <h1 className="font-serif text-4xl font-extrabold leading-tight text-ink-900">
        Nuova password
      </h1>
      <p className="mt-1.5 mb-7 text-base leading-relaxed text-ink-600">
        Scegli una password sicura, di almeno 8 caratteri, che non usi già altrove.
      </p>
      {emailDellaSessione && (
        <p className="-mt-4 mb-6 rounded-lg border border-cream-300 bg-cream-50 p-3 text-sm text-ink-700">
          Stai cambiando la password di <strong>{emailDellaSessione}</strong>. Se non è il tuo account, non continuare.
        </p>
      )}
      <form onSubmit={submit} className="space-y-4">
        <PasswordInput
          label="Nuova password"
          value={password}
          onChange={(e) => { setPassword(e.target.value); setErroreDellaPassword(undefined); }}
          error={erroreDellaPassword}
          minLength={8}
          maxLength={200}
          autoComplete="new-password"
          required
          placeholder="••••••••"
        />
        <PasswordInput
          label="Conferma nuova password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          minLength={8}
          maxLength={200}
          autoComplete="new-password"
          required
          placeholder="••••••••"
          error={confirm && password !== confirm ? 'Le due password non coincidono' : undefined}
        />

        {/* Strength hint */}
        <PasswordStrength value={password} />

        <Button
          type="submit"
          size="lg"
          loading={submitting}
          disabled={password.length < 8 || password !== confirm}
          iconRight={ArrowRight}
          fullWidth
        >
          {submitting ? 'Aggiornamento…' : 'Imposta nuova password'}
        </Button>
      </form>
    </AuthShell>
  );
}

function PasswordStrength({ value }: { value: string }) {
  const checks = [
    { ok: value.length >= 8,            label: 'Almeno 8 caratteri' },
    { ok: /[A-Z]/.test(value),          label: 'Una lettera maiuscola' },
    { ok: /[0-9]/.test(value),          label: 'Un numero' },
    { ok: /[^A-Za-z0-9]/.test(value),   label: 'Un simbolo (consigliato)' },
  ];
  const ok = checks.filter((c) => c.ok).length;
  const colors = ['bg-cream-200', 'bg-secondary-400', 'bg-accent-400', 'bg-accent-500', 'bg-olive-500'];
  const labels = ['', 'Debole', 'Sufficiente', 'Buona', 'Forte'];

  if (!value) return null;

  return (
    <div>
      <div className="mb-2 flex gap-1">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded ${i < ok ? colors[ok] : 'bg-cream-200'}`}
          />
        ))}
      </div>
      <p className="mb-2 text-xs text-ink-500">{labels[ok]}</p>
      <ul className="space-y-0.5 text-xs">
        {checks.map((c) => (
          <li key={c.label} className={`flex items-center gap-1.5 ${c.ok ? 'text-olive-600' : 'text-ink-400'}`}>
            {c.ok ? <Check size={14} strokeWidth={2.4} aria-hidden /> : <Circle size={14} strokeWidth={2.2} aria-hidden />}
            {c.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<AuthShell><LoadingState variant="inline" /></AuthShell>}>
      <ResetPasswordInner />
    </Suspense>
  );
}
