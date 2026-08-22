'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';

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
  const { data } = useQuery({
    queryKey: ['venduto-da', sellerId],
    queryFn: async () => {
      const { data: riga } = await supabase
        .from('seller_public_profiles')
        .select('store_name, business_legal_name, business_form, business_vat_number, business_address, business_city, business_zip, store_address, store_phone')
        .eq('id', sellerId)
        .maybeSingle();
      return riga as {
        store_name: string | null;
        business_legal_name: string | null;
        business_form: string | null;
        business_vat_number: string | null;
        business_address: string | null;
        business_city: string | null;
        business_zip: string | null;
        store_address: string | null;
        store_phone: string | null;
      } | null;
    },
    staleTime: 10 * 60_000,
  });

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
