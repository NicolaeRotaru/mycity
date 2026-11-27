'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ABBONAMENTI, FASCE, scriviCanone, type Abbonamento } from '@/lib/agenzia/preventivo';
import { FRASE_CONTANTI, PAGAMENTO_ONLINE_SERVIZI } from '@/lib/agenzia/pagamento-servizi';

/**
 * LA SCELTA DELLA FASCIA NELLA VECCHIA PAGINA DELL'ABBONAMENTO DELLA DEMO.
 *
 * 24/11/2026 — Qui il titolare sceglieva, lasciava l'email e accettava. 27/11/2026 — Si accetta solo dalla
 * pagina della conferma (app/preventivo/[codice]/page.tsx), col codice dell'email (Nicola: «codice
 * dall'email»; i collaudi della sicurezza hanno bocciato ogni porta che accettava senza provare l'email).
 * Qui resta la scelta della fascia, che segue l'indirizzo (?fascia=), e un pulsante che porta alla conferma
 * con quella fascia già scelta.
 */
export default function AccettaDalLink({
  codice,
  consigliato,
  prezzi,
}: {
  codice: string;
  consigliato: Abbonamento;
  prezzi: Record<Abbonamento, number | null>;
  primoMeseScontato?: boolean;
}) {
  const [fascia, setFascia] = useState<Abbonamento>(consigliato);
  const router = useRouter();
  // 25/11/2026 (collaudo) — La scelta segue la fascia dell'indirizzo (?fascia=), senza ricreare il riquadro.
  useEffect(() => { setFascia(consigliato); }, [consigliato]);
  // E il contrario: scegliendo qui un'altra fascia, il preventivo sopra (titolo, offerta) diventa il suo.
  const scegli = (f: Abbonamento) => {
    setFascia(f);
    router.replace(`?fascia=${f}`, { scroll: false });
  };

  return (
    <section className="mt-6 rounded-2xl border-2 border-cream-300 bg-surface-0 p-5" aria-labelledby="accetta-titolo">
      <h2 id="accetta-titolo" className="text-lg font-bold text-ink-900">Conferma l’abbonamento</h2>
      <fieldset className="mt-3">
        <legend className="text-sm font-medium text-ink-800">Quale abbonamento?</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {ABBONAMENTI.map((f) => (
            <label key={f} className={`cursor-pointer rounded-lg border-2 px-3 py-2 text-sm ${fascia === f ? 'border-primary-600 bg-primary-50' : 'border-cream-200'}`}>
              <input type="radio" name="fascia" value={f} checked={fascia === f} onChange={() => scegli(f)} className="sr-only" />
              {FASCE[f].nome} · {scriviCanone(prezzi[f])}
            </label>
          ))}
        </div>
      </fieldset>
      <Link
        href={`/preventivo/${codice}?fascia=${fascia}`}
        className="mt-4 block w-full rounded-lg bg-ink-900 py-3 text-center font-bold text-white hover:bg-ink-800"
      >
        Conferma il {FASCE[fascia].nome}
      </Link>
      {!PAGAMENTO_ONLINE_SERVIZI && <p className="mt-2 text-xs text-ink-600">{FRASE_CONTANTI}</p>}
    </section>
  );
}
