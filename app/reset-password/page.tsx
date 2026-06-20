'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Circle, Mail, MailCheck, ArrowRight } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input, PasswordInput } from '@/components/ui/Field';
import { LoadingState } from '@/components/ui/LoadingState';
import { AuthShell } from '@/components/ui/AuthShell';
import { logger } from '@/lib/logger';

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
 */

function translateError(msg: string): string {
  const m = (msg || '').toLowerCase();
  if (m.includes('same as') || m.includes('should be different'))
    return 'La nuova password deve essere diversa da quella precedente';
  if (m.includes('weak') || m.includes('at least'))
    return 'Password troppo debole. Usane una più lunga, con maiuscole/numeri/simboli.';
  if (m.includes('expired') || m.includes('jwt'))
    return 'Sessione scaduta. Richiedi un nuovo link di reset qui sotto.';
  if (m.includes('invalid') && m.includes('token'))
    return 'Link di reset non valido. Richiedine uno nuovo qui sotto.';
  if (m.includes('rate') || m.includes('too many'))
    return 'Troppi tentativi. Riprova fra qualche minuto.';
  if (m.includes('not authenticated') || m.includes('no session'))
    return 'Sessione persa. Apri di nuovo il link dall\'email.';
  // Niente match: mostra il messaggio originale per debug
  return msg ? `Errore: ${msg}` : 'Errore durante l\'aggiornamento della password';
}

function ResetPasswordInner() {
  const router = useRouter();
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  // Vista "richiedi link" (quando l'utente arriva senza token di recovery).
  const [requestEmail, setRequestEmail] = useState('');
  const [sendingLink, setSendingLink] = useState(false);
  const [linkSent, setLinkSent] = useState(false);

  // Ascolta gli eventi di Supabase: PASSWORD_RECOVERY ci dice che il magic
  // link è stato consumato e la sessione di recovery è attiva.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
        setRecoveryReady(true);
        setCheckingSession(false);
      }
    });

    // Se l'utente arriva qui senza hash (es. ha aperto il link su un altro
    // dispositivo e poi è venuto qui a mano), comunque controlliamo dopo
    // un breve delay se c'è una sessione di recovery.
    const t = setTimeout(async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) setRecoveryReady(true);
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
      toast.error(translateError(err instanceof Error ? err.message : ''));
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
      toast.error(translateError(err instanceof Error ? err.message : ''));
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
          <h1 className="font-serif text-[34px] font-extrabold leading-tight text-ink-900">
            Controlla l&apos;email
          </h1>
          <p className="mt-1.5 mb-7 text-[15px] leading-relaxed text-ink-600">
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
        <h1 className="font-serif text-[34px] font-extrabold leading-tight text-ink-900">
          Reimposta la password
        </h1>
        <p className="mt-1.5 mb-7 text-[15px] leading-relaxed text-ink-600">
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
      <h1 className="font-serif text-[34px] font-extrabold leading-tight text-ink-900">
        Nuova password
      </h1>
      <p className="mt-1.5 mb-7 text-[15px] leading-relaxed text-ink-600">
        Scegli una password sicura, di almeno 8 caratteri.
      </p>
      <form onSubmit={submit} className="space-y-4">
        <PasswordInput
          label="Nuova password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
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
