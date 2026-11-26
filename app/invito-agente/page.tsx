import type { Metadata } from 'next';
import { getCurrentUser } from '@/lib/supabase/server';
import { agenteDi } from '@/lib/agenti/inviti';
import InvitoAgente from './InvitoAgente';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Invito per gli agenti · MyCity', robots: { index: false, follow: false }, referrer: 'no-referrer' };

/**
 * LA PORTA DEGLI AGENTI — 26/11/2026 (migrazione 865). Si arriva solo dal link che Nicola crea in Admin → Agenti:
 * /invito-agente#<codice>. Il server non vede il codice (sta dopo il «#»): sa solo chi è collegato. Il codice lo
 * legge la pagina nel browser e lo manda nel corpo delle richieste (lib/agenti/codice.ts).
 * Chi non ha un account lo crea qui (email e password); chi ce l'ha già entra e preme «Attiva».
 */
export default async function Pagina() {
  let email: string | null = null;
  let giaAgente = false;
  try {
    const utente = await getCurrentUser().catch(() => null);
    email = utente?.email ?? null;
    if (utente) giaAgente = !!(await agenteDi(utente.id))?.attivo;
  } catch {
    // Se non riesco a leggere l'agente, la pagina lo chiede comunque al momento di attivare.
  }
  return <InvitoAgente emailCollegata={email} giaAgente={giaAgente} />;
}
