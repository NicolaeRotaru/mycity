import type { Metadata } from 'next';
import { getCurrentUserWithProfile } from '@/lib/supabase/server';
import { agenteDi } from '@/lib/agenti/inviti';
import InvitoAgente from './InvitoAgente';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Invito per gli agenti · MyCity', robots: { index: false, follow: false }, referrer: 'no-referrer' };

/**
 * LA PORTA DEGLI AGENTI — 26/11/2026 (migrazione 865). Si arriva solo dal link che Nicola crea in Admin → Agenti:
 * /invito-agente#<codice>. Il server non vede il codice (sta dopo il «#»): sa solo chi è collegato. Il codice lo
 * legge la pagina nel browser e lo manda nel corpo delle richieste (lib/agenti/codice.ts).
 *
 * Questa pagina NON crea account (terzo collaudo del 26/11): l'account si crea con la registrazione normale di
 * MyCity, che conferma l'email, ha il controllo anti-bot e mette a verbale le condizioni. Creandolo qui con l'email
 * «già confermata», chi aveva un link poteva registrare l'email di un altro. Poi la persona torna qui e preme
 * «Attiva»: è quello, e solo quello, che la fa diventare agente.
 */
export default async function Pagina() {
  let email: string | null = null;
  let giaDentro: 'agente' | 'admin' | null = null;
  try {
    const chi = await getCurrentUserWithProfile().catch(() => null);
    email = chi?.user?.email ?? null;
    if (chi?.profile?.role === 'admin') giaDentro = 'admin';
    else if (chi?.user && (await agenteDi(chi.user.id))?.attivo) giaDentro = 'agente';
  } catch {
    // Se non riesco a leggere l'agente, la rotta di attivazione lo ricontrolla comunque.
  }
  return <InvitoAgente emailCollegata={email} giaDentro={giaDentro} />;
}
