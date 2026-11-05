'use client';

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { domandaVendutoDa } from '@/lib/queries/venduto-da';

/**
 * «Venduto da»: chi sta vendendo davvero, con nome, sede e partita IVA.
 *
 * 22/8/2026 — SUL SITO NON C'ERA. Sulle pagine prodotto e negozio si leggeva
 * solo l'insegna. Il cliente non sapeva con chi stava stipulando il contratto:
 * non la ragione sociale, non la sede, non la partita IVA. Per un marketplace
 * non e' una gentilezza — e' l'informazione precontrattuale che il Codice del
 * Consumo (art. 49) e il d.lgs. 70/2003 pretendono prima dell'acquisto.
 *
 * Il blocco NON si inventa niente: se un campo manca non lo stampa. E' la
 * stessa regola gia' usata per l'indirizzo e la partita IVA del titolare nelle
 * pagine legali — meglio una riga in meno che una riga finta.
 */
export function VendutoDa({ sellerId, storeName }: { sellerId: string; storeName?: string | null }) {
  // 15/10/2026 (R55) — La lettura vive in lib/queries/venduto-da.ts. Qui l'errore
  // spariva: in produzione la vista non ha ancora le colonne d'impresa (migrazione
  // 126), la domanda falliva e il riquadro non si disegnava senza una riga nei log.
  // La domanda e' la stessa che il server fa nel guscio della pagina: il browser
  // trova gia' la risposta, e l'avviso resta nei registri del server.
  const { data, error } = useQuery(domandaVendutoDa(supabase, sellerId));

  // 1/11/2026 (ondata 5) — NEL BROWSER IN PRODUZIONE IL NO SPARIVA ANCORA. Se il
  // precarico del server non riesce, la lettura la rifa' il telefono del cliente;
  // li' `logger.error` non scrive in console in produzione e manda a Sentry, che
  // in produzione non e' acceso. Il riquadro tornava `null` senza una riga da
  // nessuna parte. Adesso il no lascia una traccia con il negozio e il motivo.
  useEffect(() => {
    if (!error) return;
    console.error('[venduto-da] il riquadro «Venduto da» non si disegna: la vista pubblica dei negozi ha detto no', {
      sellerId,
      storeName: storeName ?? null,
      codice: (error as { code?: string } | null)?.code ?? null,
      // 5/11/2026 — L'errore di PostgREST è un oggetto semplice, non un Error: con String() nel
      // registro usciva «[object Object]». Si prende il suo `message` quando c'è.
      motivo: motivoDellErrore(error),
    });
  }, [error, sellerId, storeName]);

  if (!data) return null;

  const ragioneSociale = [data.business_legal_name, data.business_form].filter(Boolean).join(' ');
  const sede = [data.business_address, [data.business_zip, data.business_city].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ');
  const nome = ragioneSociale || data.store_name || storeName;

  // Niente da dire con onestà: meglio non dire niente.
  if (!nome && !data.business_vat_number && !sede) return null;

  return (
    <section className="mt-6 rounded-xl border border-cream-300 bg-cream-50 p-4 text-[13px] leading-relaxed text-ink-700">
      <h2 className="mb-1.5 text-[13px] font-bold uppercase tracking-[0.03em] text-ink-700">Venduto da</h2>
      {nome && <p className="font-semibold text-ink-900">{nome}</p>}
      {sede && <p>{sede}</p>}
      {!sede && data.store_address && <p>{data.store_address}</p>}
      {data.business_vat_number && <p>P.IVA {data.business_vat_number}</p>}
      {data.store_phone && <p>Tel. {data.store_phone}</p>}
      <p className="mt-2 text-ink-500">
        Il contratto di vendita è tra te e questo negozio. MyCity gestisce la vetrina, il pagamento e la
        consegna.
      </p>
    </section>
  );
}

/** Il testo dell'errore, che arrivi come Error o come oggetto di PostgREST ({ message, code }). */
export function motivoDellErrore(error: unknown): string {
  if (error instanceof Error) return error.message;
  const messaggio = (error as { message?: unknown } | null)?.message;
  if (typeof messaggio === 'string' && messaggio) return messaggio;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
