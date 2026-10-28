import { Truck } from 'lucide-react';
import { cn } from '@/lib/cn';
import { promessaSpedizione } from '@/lib/promesse-pubbliche';

/**
 * La riga della consegna, sotto il prezzo.
 *
 * 27/10/2026 — FINO A OGGI ERA LA BARRA «TI MANCANO X € ALLA SPEDIZIONE GRATIS». La soglia dei
 * 30 euro non esiste più: scelta 8 della carta #209, il cliente paga solo la consegna, per
 * negozio, sempre. La barra spingeva verso un traguardo che la cassa non dà, cioè una promessa
 * falsa proprio sull'ultimo schermo prima di «Aggiungi». Resta una riga sola, con la cifra che
 * la cassa addebita: le parole le decide `promessaSpedizione()`, non questo file.
 *
 * 27/10/2026 (terzo giro) — La scheda prodotto non la monta più: sotto il riquadro che dice già
 * «Consegna MyCity 3,00 € per negozio» ripeteva la stessa cifra con un altro nome, e due nomi si
 * leggono come due costi. Il componente resta, con la frase di `promessaSpedizione()`; la prop
 * `subtotal` non cambia più niente.
 */
export function FreeShippingProgress({ className }: { subtotal?: number; className?: string }) {
  const promessa = promessaSpedizione();
  return (
    <p
      className={cn(
        'rounded-xl border border-cream-300 bg-cream-50 p-3 text-sm text-ink-700 flex items-center gap-2',
        className,
      )}
    >
      <Truck size={16} strokeWidth={2.4} className="shrink-0" aria-hidden />
      <span>{promessa.titolo}</span>
    </p>
  );
}
