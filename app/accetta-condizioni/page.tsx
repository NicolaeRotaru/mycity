'use client';

import { useRef, useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { apiErrorMessage, friendlyError } from '@/lib/errors';
import { safeInternalPath } from '@/lib/safe-redirect';
import { COSA_CAMBIA_NEI_TERMINI, TERMINI_IN_VIGORE_DAL, VERSIONE_TESTI_LEGALI } from '@/lib/legal/versione';

const VERSIONE_TERMINI = /terms-([\d.]+)/.exec(VERSIONE_TESTI_LEGALI)?.[1] ?? VERSIONE_TESTI_LEGALI;

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
  // Il ritorno arriva dall'indirizzo: si torna solo a una pagina del sito.
  const dove = safeInternalPath(params.get('next'), '/');
  const [accettato, setAccettato] = useState(false);
  const [inCorso, setInCorso] = useState(false);
  // 12/11/2026 (R12-002) — «Continua» era spento (`disabled`) senza una parola:
  // chi non notava la casella da 16 px non capiva, da tastiera non lo si
  // raggiungeva nemmeno. Ora resta premibile e, senza spunta, dice cosa manca e
  // porta il fuoco sulla casella (lo stesso schema di /sign-up).
  const [manca, setManca] = useState(false);
  const casella = useRef<HTMLInputElement>(null);

  const prosegui = async () => {
    if (inCorso) return;
    if (!accettato) {
      setManca(true);
      casella.current?.focus();
      return;
    }
    setInCorso(true);
    try {
      const res = await fetch('/api/account/accetta-condizioni', { method: 'POST' });
      // 12/11/2026 (R12-016) — Ogni risposta non buona diventava «Registrazione
      // non riuscita»: chi aveva perso la sessione leggeva di una registrazione
      // che non stava facendo, e restava davanti al muro senza la strada per
      // rientrare. Si legge lo stato.
      if (res.status === 401) {
        toast.error('La sessione è scaduta: accedi di nuovo per continuare.');
        const quiDopo = `/accetta-condizioni?next=${encodeURIComponent(dove)}`;
        router.replace(`/sign-in?returnTo=${encodeURIComponent(quiDopo)}`);
        setInCorso(false);
        return;
      }
      if (res.status === 429) throw new Error('Troppi tentativi in poco tempo: riprova fra un minuto.');
      if (!res.ok) {
        const corpo = await res.json().catch(() => ({}));
        throw new Error(apiErrorMessage(corpo, 'Non siamo riusciti a salvare la tua accettazione. Riprova.'));
      }
      router.replace(dove);
    } catch (e) {
      toast.error(friendlyError(e));
      setInCorso(false);
    }
  };

  return (
    // 27/8/2026 (R107) — era un `<main>` dentro il `<main>` del guscio del
    // sito: HTML non valido, e due «contenuto principale» per chi salta fra i
    // punti di riferimento della pagina.
    <div className="mx-auto flex min-h-[70vh] max-w-lg flex-col justify-center px-4 py-10">
      <h1 className="font-serif text-2xl font-extrabold text-ink-900">Ancora una cosa</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-ink-700">
        Per usare MyCity devi accettare i Termini e l&apos;Informativa privacy. Ci vuole un secondo, e
        ci serve per poterti dire con esattezza, un domani, che cosa avevi accettato e quando.
      </p>
      {/* 5/11/2026 — Chi li aveva già accettati riaccettava senza sapere che erano cambiati, né cosa. */}
      <div className="mt-4 rounded-xl border border-cream-300 bg-cream-50 p-4 text-[14px] leading-relaxed text-ink-700">
        <p>
          I Termini sono cambiati: versione {VERSIONE_TERMINI}, in vigore dal {TERMINI_IN_VIGORE_DAL}. Se li
          avevi già accettati, ecco cosa cambia:
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {COSA_CAMBIA_NEI_TERMINI.map((voce) => (
            <li key={voce}>{voce}</li>
          ))}
        </ul>
      </div>

      <label className="mt-6 flex items-start gap-2.5 text-[14px] leading-relaxed text-ink-800">
        <input
          ref={casella}
          type="checkbox"
          checked={accettato}
          onChange={(e) => {
            setAccettato(e.target.checked);
            if (e.target.checked) setManca(false);
          }}
          aria-describedby={manca ? 'termini-manca-la-spunta' : undefined}
          aria-invalid={manca || undefined}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-cream-400 text-primary-700"
        />
        <span>
          Ho letto e accetto i{' '}
          {/* Si aprono in una nuova scheda: tornando indietro la spunta non si perde. */}
          <Link href="/terms" target="_blank" rel="noopener noreferrer" className="font-semibold text-primary-700 underline">
            Termini<span className="sr-only"> (si apre in una nuova scheda)</span>
          </Link>{' '}e l&apos;
          <Link href="/privacy" target="_blank" rel="noopener noreferrer" className="font-semibold text-primary-700 underline">
            Informativa privacy<span className="sr-only"> (si apre in una nuova scheda)</span>
          </Link>.
        </span>
      </label>
      {manca && (
        <p id="termini-manca-la-spunta" role="alert" className="mt-2 text-[13px] font-semibold text-secondary-600">
          Spunta la casella per continuare.
        </p>
      )}

      <Button
        className="mt-6"
        fullWidth
        onClick={prosegui}
        disabled={inCorso}
        aria-disabled={!accettato || undefined}
        aria-describedby={manca ? 'termini-manca-la-spunta' : undefined}
      >
        {inCorso ? 'Un attimo…' : 'Continua'}
      </Button>
    </div>
  );
}

export default function AccettaCondizioniPage() {
  return (
    <Suspense fallback={null}>
      <Contenuto />
    </Suspense>
  );
}
