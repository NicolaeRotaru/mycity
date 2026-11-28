import Link from 'next/link';

/**
 * 28/11/2026 (R04-007) — LA CONFERMA DELLA NEWSLETTER HA UNA PAGINA SUA.
 *
 * Il link dell'email di conferma (/api/newsletter/confirm) rimandava alla home con
 * `?newsletter=confermata` o `?newsletter=link-non-valido`, un parametro che nessuna pagina
 * leggeva: chi confermava non vedeva nessun esito, e chi aveva un link scaduto nemmeno. Come per
 * la disiscrizione (app/disiscrizione/page.tsx), adesso la rotta porta qui e la pagina lo dice.
 */
export const metadata = {
  title: 'Newsletter · MyCity',
  robots: { index: false, follow: false },
};

const ESITI_NEWSLETTER: Record<string, { titolo: string; testo: string }> = {
  confermata: {
    titolo: 'Fatto: l’iscrizione è confermata',
    testo: 'Da adesso ricevi le novità dei negozi di Piacenza. Puoi smettere quando vuoi dal link in fondo a ogni email.',
  },
  'link-non-valido': {
    titolo: 'Questo link non è valido',
    testo: 'Il link è scaduto, è già stato usato o è incompleto. Se non ricevi le nostre email, iscriviti di nuovo e conferma dal link più recente, oppure scrivici dalla pagina Contatti.',
  },
};

export default async function NewsletterPage({
  searchParams,
}: {
  searchParams: Promise<{ esito?: string }>;
}) {
  const { esito } = await searchParams;
  const quale = esito && ESITI_NEWSLETTER[esito] ? esito : 'link-non-valido';
  const testi = ESITI_NEWSLETTER[quale];

  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <h1 className="font-serif text-2xl font-bold text-ink-900">{testi.titolo}</h1>
      <p className="mt-3 text-ink-700">{testi.testo}</p>
      <p className="mt-6 text-sm">
        <Link href="/" className="text-primary-700 underline">Torna a MyCity</Link>
        {quale === 'link-non-valido' ? (
          <>
            {' · '}
            <Link href="/contact" className="text-primary-700 underline">Contatti</Link>
          </>
        ) : null}
      </p>
    </div>
  );
}
