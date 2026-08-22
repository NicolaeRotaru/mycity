'use client';

import { useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { friendlyError } from '@/lib/errors';

/**
 * Chiede Termini e Informativa a chi è entrato da una strada che non li
 * chiedeva.
 *
 * Prima l'accesso con Google portava dentro operativi senza nessuna
 * accettazione e senza nessuna riga a verbale. Adesso quel percorso finisce
 * qui, una volta sola: chi accetta prosegue, chi non accetta non entra.
 */
function Contenuto() {
  const router = useRouter();
  const params = useSearchParams();
  const dove = params.get('next') || '/';
  const [accettato, setAccettato] = useState(false);
  const [inCorso, setInCorso] = useState(false);

  const prosegui = async () => {
    setInCorso(true);
    try {
      const res = await fetch('/api/account/accetta-condizioni', { method: 'POST' });
      if (!res.ok) throw new Error('Registrazione non riuscita');
      router.replace(dove);
    } catch (e) {
      toast.error(friendlyError(e));
      setInCorso(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-lg flex-col justify-center px-4 py-10">
      <h1 className="font-serif text-2xl font-extrabold text-ink-900">Ancora una cosa</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-ink-700">
        Per usare MyCity devi accettare i Termini e l&apos;Informativa privacy. Ci vuole un secondo, e
        ci serve per poterti dire con esattezza, un domani, che cosa avevi accettato e quando.
      </p>

      <label className="mt-6 flex items-start gap-2.5 text-[14px] leading-relaxed text-ink-800">
        <input
          type="checkbox"
          checked={accettato}
          onChange={(e) => setAccettato(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-cream-400 text-primary-700"
        />
        <span>
          Ho letto e accetto i{' '}
          <Link href="/terms" className="font-semibold text-primary-700 underline">Termini</Link> e l&apos;
          <Link href="/privacy" className="font-semibold text-primary-700 underline">Informativa privacy</Link>.
        </span>
      </label>

      <Button className="mt-6" fullWidth onClick={prosegui} disabled={!accettato || inCorso}>
        {inCorso ? 'Un attimo…' : 'Continua'}
      </Button>
    </main>
  );
}

export default function AccettaCondizioniPage() {
  return (
    <Suspense fallback={null}>
      <Contenuto />
    </Suspense>
  );
}
