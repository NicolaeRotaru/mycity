import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUserWithProfile } from '@/lib/supabase/server';
import { puoUsareLaScheda } from '@/lib/agenti/inviti';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Scheda del cliente · Agenti MyCity', robots: { index: false, follow: false } };

/**
 * LA PAGINA DEGLI AGENTI — 26/11/2026 (migrazione 865). Si apre solo a un agente attivo (entrato dal link
 * d'invito di Admin → Agenti) o all'admin. Il controllo lo rifanno anche le rotte /api/agente/*.
 */
export default async function LayoutAgente({ children }: { children: React.ReactNode }) {
  const chi = await getCurrentUserWithProfile().catch(() => null);
  if (!chi?.user) redirect(`/sign-in?returnTo=${encodeURIComponent('/agente')}`);
  let puo = false;
  let guasto = false;
  try {
    puo = await puoUsareLaScheda(chi.user.id, chi.profile?.role);
  } catch {
    guasto = true;
  }
  if (!puo) {
    return (
      <main className="mx-auto max-w-md px-4 py-12 text-center">
        <h1 className="font-serif text-2xl font-extrabold text-ink-900">Pagina per gli agenti</h1>
        <p className="mt-2 text-sm text-ink-600">
          {guasto ? 'Non riesco a controllare il tuo accesso in questo momento. Riprova fra poco.' : 'Questa pagina è per gli agenti di MyCity. Si entra solo col link d’invito che dà Nicola.'}
        </p>
        <Link href="/" className="mt-4 inline-block text-sm font-semibold text-primary-700 underline">Torna a MyCity</Link>
      </main>
    );
  }
  return <>{children}</>;
}
