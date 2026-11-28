import Link from 'next/link';
import { doveSiAttivaLAbbonamento } from '@/lib/products/sdgSeller';
import { FRASE_CONDIZIONI, FRASE_PARTNER } from '@/lib/agenzia/preventivo';

/**
 * Al posto di «Aggiungi al carrello», nella pagina di un abbonamento di SDG Agenzia.
 *
 * 24/11/2026 — Un abbonamento ai servizi non è un ordine con la consegna: si attiva dal
 * pagina Abbonamento del negozio, che paga con Stripe in abbonamento. Chi ha un negozio va alla sua
 * pagina Abbonamento; chi non lo ha, prima si iscrive (lib/products/sdgSeller.ts).
 */
export function AttivaAbbonamento({ chiGuardaEUnNegozio, giaAbbonato = false }: { chiGuardaEUnNegozio: boolean; giaAbbonato?: boolean | null }) {
  const dove = doveSiAttivaLAbbonamento(chiGuardaEUnNegozio, giaAbbonato);
  return (
    <div className="space-y-3" data-testid="attiva-abbonamento">
      <p className="text-xs text-ink-600">
        Canone al mese, per le attività iscritte a MyCity. {FRASE_CONDIZIONI}
      </p>
      <Link
        href={dove.href}
        className="block w-full text-center py-3 rounded-lg font-bold bg-ink-900 hover:bg-ink-800 text-white"
      >
        {dove.testo}
      </Link>
      <p className="text-xs text-ink-500">{FRASE_PARTNER}</p>
    </div>
  );
}
