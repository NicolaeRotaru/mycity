'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { PasswordInput } from '@/components/ui/Field';
import { LoadingState } from '@/components/ui/LoadingState';
import { logger } from '@/lib/logger';

/**
 * Pagina di reset password.
 *
 * Flusso Supabase:
 *  1) /sign-in → user clicca "Password dimenticata?" → resetPasswordForEmail()
 *     con redirectTo = `${origin}/reset-password`
 *  2) Supabase invia email con magic link verso /reset-password con un token
 *     nel fragment dell'URL (#access_token=...&type=recovery&...)
 *  3) Al mount, il client Supabase intercetta l'hash e fa setSession.
 *     L'evento onAuthStateChange emette 'PASSWORD_RECOVERY'.
 *  4) Mostriamo il form di nuova password.
 *  5) updateUser({ password }) → success → redirect al sign-in.
 *
 * Se l'utente arriva qui senza token, mostriamo un avviso.
 */

function translateError(msg: string): string {
  const m = (msg || '').toLowerCase();
  if (m.includes('same as') || m.includes('should be different'))
    return 'La nuova password deve essere diversa da quella precedente';
  if (m.includes('weak') || m.includes('at least'))
    return 'Password troppo debole. Usane una più lunga, con maiuscole/numeri/simboli.';
  if (m.includes('expired') || m.includes('jwt'))
    return 'Sessione scaduta. Richiedi un nuovo link di reset dalla pagina di accesso.';
  if (m.includes('invalid') && m.includes('token'))
    return 'Link di reset non valido. Richiedine uno nuovo dalla pagina di accesso.';
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
        toast.error('Sessione di reset persa. Richiedi un nuovo link dalla pagina di accesso.');
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

  // STATO: caricamento iniziale (attendiamo l'evento di Supabase)
  if (checkingSession) {
    return (
      <Card>
        <div className="text-center py-6">
          <div className="w-12 h-12 mx-auto rounded-full border-4 border-primary-200 border-t-indigo-600 animate-spin mb-3" />
          <p className="text-sm text-ink-500">Verifica del link di reset…</p>
        </div>
      </Card>
    );
  }

  // STATO: nessuna sessione di recovery valida → link rotto o scaduto
  if (!recoveryReady) {
    return (
      <Card>
        <div className="text-center">
          <div className="text-5xl mb-3">⏰</div>
          <h1 className="text-xl font-bold text-ink-900 mb-2">Link non valido o scaduto</h1>
          <p className="text-sm text-ink-600 mb-5">
            Il link di reset password potrebbe essere stato usato o essere scaduto.
            Richiedine uno nuovo dalla pagina di accesso.
          </p>
          <Button href="/sign-in">Vai al login</Button>
        </div>
      </Card>
    );
  }

  // STATO: successo (prima del redirect)
  if (done) {
    return (
      <Card>
        <div className="text-center py-6">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-olive-100 text-olive-600 flex items-center justify-center text-3xl mb-3">
            ✓
          </div>
          <h1 className="text-xl font-bold text-ink-900 mb-1">Password aggiornata!</h1>
          <p className="text-sm text-ink-600">Tra un istante ti porto al login con la nuova password.</p>
        </div>
      </Card>
    );
  }

  // STATO: form
  return (
    <Card>
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-ink-900">Nuova password</h1>
        <p className="text-sm text-ink-500 mt-1">Scegli una password sicura, di almeno 8 caratteri.</p>
      </div>
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

        <button
          type="submit"
          disabled={submitting || password.length < 8 || password !== confirm}
          className="w-full bg-gradient-to-r from-primary-600 to-purple-600 hover:from-primary-700 hover:to-purple-700 disabled:opacity-40 text-white px-4 py-3 rounded-lg font-bold transition-colors shadow"
        >
          {submitting ? 'Aggiornamento…' : 'Imposta nuova password'}
        </button>
      </form>
    </Card>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-cream-50 p-4">
      <div className="bg-white p-8 rounded-xl shadow-md w-full max-w-md">
        {children}
      </div>
    </div>
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
  const colors = ['bg-cream-200', 'bg-rose-400', 'bg-orange-400', 'bg-accent-400', 'bg-olive-500'];
  const labels = ['', 'Debole', 'Sufficiente', 'Buona', 'Forte'];

  if (!value) return null;

  return (
    <div>
      <div className="flex gap-1 mb-2">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded ${i < ok ? colors[ok] : 'bg-cream-200'}`}
          />
        ))}
      </div>
      <p className="text-xs text-ink-500 mb-2">{labels[ok]}</p>
      <ul className="text-xs space-y-0.5">
        {checks.map((c) => (
          <li key={c.label} className={c.ok ? 'text-olive-600' : 'text-ink-400'}>
            {c.ok ? '✓' : '○'} {c.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<Card><LoadingState variant="inline" /></Card>}>
      <ResetPasswordInner />
    </Suspense>
  );
}
