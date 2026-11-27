'use client';

import { useEffect, useState } from 'react';
import { CalendarCheck } from 'lucide-react';
import { scriviVisita } from '@/lib/agenzia/visita-sdg';

/**
 * «IL TEAM DI SDG PASSA DA TE» — 27/11/2026.
 *
 * Nicola, 27/11 verso le 17:40: dopo la conferma dal link il titolare entra nella sua pagina, e deve capire
 * cosa succede adesso. Se nel link ha scelto il giorno della visita, qui lo rilegge in cima, con cosa si fa
 * quel giorno. La visita la legge il server (app/api/seller/visita-sdg); senza visita non si mostra niente.
 */
export default function VisitaSdg() {
  const [visita, setVisita] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    fetch('/api/seller/visita-sdg', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((c: { ok?: boolean; data?: { visita?: string | null } } | null) => {
        if (vivo && c?.ok && c.data?.visita) setVisita(c.data.visita);
      })
      .catch(() => undefined);
    return () => { vivo = false; };
  }, []);
  if (!visita) return null;
  return (
    <div role="status" data-testid="visita-sdg" className="mb-4 flex gap-3 rounded-2xl border-2 border-olive-300 bg-olive-50 p-4">
      <CalendarCheck size={22} className="mt-0.5 shrink-0 text-olive-800" aria-hidden />
      <div>
        <p className="font-semibold text-ink-900">Il team di SDG passa da te {scriviVisita(visita)}</p>
        <p className="mt-1 text-sm text-ink-700">
          Scriviamo insieme il piano dei contenuti del primo mese, e il fotografo e il videomaker fanno subito le prime
          foto e i primi video. Se quel giorno non ti va più bene, scrivici e lo spostiamo.
        </p>
      </div>
    </div>
  );
}
