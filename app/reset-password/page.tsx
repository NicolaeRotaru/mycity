'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';
import { toast } from 'sonner';

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
  const m = msg.toLowerCase();
  if (m.includes('same as the old')) return 'La nuova password deve essere diversa da quella precedente';
  if (m.includes('weak'))            return 'Password troppo debole. Usane una più lunga.';
  if (m.includes('token') || m.includes('expired'))
                                     return 'Link di reset scaduto o non valido. Richiedi un nuovo link dalla pagina di accesso.';
  return 'Errore durante l\'aggiornamento della password';
}

function ResetPasswordInner() {
  const router = useRouter();
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPwd, setShowPwd] = useState(false);
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
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setDone(true);
      toast.success('Password aggiornata con successo');
      await supabase.auth.signOut();
      // Aspetta un secondo così l'utente legge il messaggio di successo
      setTimeout(() => router.push('/sign-in'), 1200);
    } catch (err: any) {
      toast.error(translateError(err?.message ?? ''));
    } finally {
      setSubmitting(false);
    }
  };

  // STATO: caricamento iniziale (attendiamo l'evento di Supabase)
  if (checkingSession) {
    return (
      <Card>
        <div className="text-center py-6">
          <div className="w-12 h-12 mx-auto rounded-full border-4 border-indigo-200 border-t-indigo-600 animate-spin mb-3" />
          <p className="text-sm text-gray-500">Verifica del link di reset…</p>
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
          <h1 className="text-xl font-bold text-gray-900 mb-2">Link non valido o scaduto</h1>
          <p className="text-sm text-gray-600 mb-5">
            Il link di reset password potrebbe essere stato usato o essere scaduto.
            Richiedine uno nuovo dalla pagina di accesso.
          </p>
          <Link
            href="/sign-in"
            className="inline-block bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg font-semibold"
          >
            Vai al login
          </Link>
        </div>
      </Card>
    );
  }

  // STATO: successo (prima del redirect)
  if (done) {
    return (
      <Card>
        <div className="text-center py-6">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center text-3xl mb-3">
            ✓
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-1">Password aggiornata!</h1>
          <p className="text-sm text-gray-600">Tra un istante ti porto al login con la nuova password.</p>
        </div>
      </Card>
    );
  }

  // STATO: form
  return (
    <Card>
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">Nuova password</h1>
        <p className="text-sm text-gray-500 mt-1">Scegli una password sicura, di almeno 8 caratteri.</p>
      </div>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Nuova password</label>
          <div className="relative">
            <input
              type={showPwd ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              maxLength={200}
              autoComplete="new-password"
              required
              placeholder="••••••••"
              className="w-full border p-2 pr-12 rounded focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
            <button
              type="button"
              onClick={() => setShowPwd((v) => !v)}
              aria-label={showPwd ? 'Nascondi password' : 'Mostra password'}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-500 hover:text-gray-700 px-2 py-1"
            >
              {showPwd ? '🙈' : '👁'}
            </button>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Conferma nuova password</label>
          <input
            type={showPwd ? 'text' : 'password'}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            minLength={8}
            maxLength={200}
            autoComplete="new-password"
            required
            placeholder="••••••••"
            className={`w-full border p-2 rounded focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
              confirm && password !== confirm ? 'border-rose-300' : ''
            }`}
          />
          {confirm && password !== confirm && (
            <p className="text-xs text-rose-600 mt-1">Le due password non coincidono</p>
          )}
        </div>

        {/* Strength hint */}
        <PasswordStrength value={password} />

        <button
          type="submit"
          disabled={submitting || password.length < 8 || password !== confirm}
          className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 disabled:opacity-40 text-white px-4 py-3 rounded-lg font-bold transition-colors shadow"
        >
          {submitting ? 'Aggiornamento…' : 'Imposta nuova password'}
        </button>
      </form>
    </Card>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
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
  const colors = ['bg-gray-200', 'bg-rose-400', 'bg-orange-400', 'bg-amber-400', 'bg-emerald-500'];
  const labels = ['', 'Debole', 'Sufficiente', 'Buona', 'Forte'];

  if (!value) return null;

  return (
    <div>
      <div className="flex gap-1 mb-2">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded ${i < ok ? colors[ok] : 'bg-gray-200'}`}
          />
        ))}
      </div>
      <p className="text-xs text-gray-500 mb-2">{labels[ok]}</p>
      <ul className="text-xs space-y-0.5">
        {checks.map((c) => (
          <li key={c.label} className={c.ok ? 'text-emerald-600' : 'text-gray-400'}>
            {c.ok ? '✓' : '○'} {c.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<Card><p className="text-center text-gray-500">Caricamento…</p></Card>}>
      <ResetPasswordInner />
    </Suspense>
  );
}
