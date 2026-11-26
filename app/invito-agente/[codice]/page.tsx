import type { Metadata } from 'next';
import { getCurrentUser } from '@/lib/supabase/server';
import { CODICE_INVITO, agenteDi, leggiInvito, statoInvito } from '@/lib/agenti/inviti';
import InvitoAgente from './InvitoAgente';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Invito per gli agenti · MyCity', robots: { index: false, follow: false } };

/**
 * LA PORTA DEGLI AGENTI — 26/11/2026 (migrazione 865). Si arriva solo dal link che Nicola crea in Admin → Agenti.
 * Chi non ha un account lo crea qui (email e password); chi ce l'ha già entra e preme «Attiva».
 */
export default async function Pagina({ params }: { params: Promise<{ codice: string }> }) {
  const { codice } = await params;
  let stato: ReturnType<typeof statoInvito> = 'inesistente';
  let email: string | null = null;
  let giaAgente = false;
  let guasto = false;
  try {
    stato = CODICE_INVITO.test(codice) ? statoInvito(await leggiInvito(codice)) : 'inesistente';
    const utente = await getCurrentUser().catch(() => null);
    email = utente?.email ?? null;
    if (utente) giaAgente = !!(await agenteDi(utente.id))?.attivo;
  } catch {
    guasto = true;
  }
  return <InvitoAgente codice={codice} stato={guasto ? 'guasto' : stato} emailCollegata={email} giaAgente={giaAgente} />;
}
