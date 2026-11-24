'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ClipboardList } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { CHIAVE_PREVENTIVO, leggiPreventivoAgenzia } from '@/components/seller/preventivo-agenzia';

/**
 * «COSA TI MANCA» IN DASHBOARD — 22/11/2026.
 *
 * Il riquadro dice in tre righe cosa manca alla vetrina e porta al preventivo
 * già pronto (/seller/preventivo). Se la lettura non riesce non dice niente:
 * è un'offerta, non un avviso, e un riquadro rotto in cima alla dashboard
 * farebbe più danno di un riquadro assente.
 */
export default function PreventivoAgenziaCard() {
  const { data: p } = useQuery({ queryKey: CHIAVE_PREVENTIVO, queryFn: leggiPreventivoAgenzia, retry: false });
  if (!p || p.righe.length === 0) return null;

  const prime = p.righe.slice(0, 3);
  const altre = p.righe.length - prime.length;

  return (
    <section className="rounded-2xl border-2 border-secondary-200 bg-gradient-to-br from-cream-50 to-white p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-secondary-600 text-white flex items-center justify-center shrink-0">
          <ClipboardList size={22} aria-hidden />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold uppercase tracking-wider text-secondary-700">{p.agenzia}</p>
          <h2 className="font-serif text-xl font-bold text-ink-900">Il tuo preventivo è pronto</h2>
          <p className="text-sm text-ink-600">
            Abbiamo guardato la tua vetrina: ecco cosa manca. Possiamo farlo noi.
          </p>
          <ul className="mt-3 space-y-1.5 text-sm">
            {prime.map((r) => (
              <li key={r.id}>
                <span className="font-semibold text-ink-900">{r.titolo}</span>
                <span className="text-ink-600"> — {r.perche[0]}{r.perche.length > 1 ? ` (e ${r.perche.length - 1} ${r.perche.length === 2 ? 'altra cosa' : 'altre cose'})` : ''}</span>
              </li>
            ))}
            {altre > 0 && <li className="text-ink-500">e {altre} {altre === 1 ? 'altra voce' : 'altre voci'}.</li>}
          </ul>
          <div className="mt-4">
            <Button href="/seller/preventivo" size="sm" shape="pill" iconRight={ArrowRight}>
              Vedi il preventivo
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
