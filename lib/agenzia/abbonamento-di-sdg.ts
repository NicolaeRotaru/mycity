import { eDiSdg } from '@/lib/products/sdgSeller';
import type { AbbonamentoAttivo } from './preventivo';

/**
 * SDG HA IL PREMIUM, INCLUSO — 28/11/2026.
 *
 * Nicola, dal telefono: «metti già di standard SDG è un abbonamento premium ed è l'unico che non paga,
 * quindi togli la funzione dentro SDG di scegliere l'abbonamento». SDG Agenzia è il partner che realizza
 * i servizi (`REALIZZATI_DA`): nel pannello del negozio risultava «Nessun abbonamento» e la dashboard gli
 * chiedeva di sceglierne uno, come a un cliente.
 *
 * La regola sta qui, in un posto solo, e la legge il calcolo del server (`leggiPreventivo`): menu in basso,
 * riquadro della dashboard, pagina Abbonamento e Profilo dicono tutti «Premium, incluso» senza toccare il
 * database. La scelta e il pagamento li rifiutano anche le rotte (`/api/seller/preventivo` e la cassa dei
 * servizi), non solo lo schermo.
 */
export const PREMIUM_INCLUSO: Readonly<AbbonamentoAttivo> = Object.freeze({
  fascia: 'premium',
  stato: 'active',
  rinnovoIl: null,
  incluso: true,
});

/** L'abbonamento che il negozio ha per regola, senza averlo pagato: oggi solo SDG. `null` per tutti gli altri. */
export function abbonamentoIncluso(idAttivita: string | null | undefined): AbbonamentoAttivo | null {
  return eDiSdg(idAttivita) ? { ...PREMIUM_INCLUSO } : null;
}

export const MESSAGGIO_ABBONAMENTO_INCLUSO =
  'SDG Agenzia ha già il Premium, incluso: non c’è un abbonamento da scegliere né da pagare.';
