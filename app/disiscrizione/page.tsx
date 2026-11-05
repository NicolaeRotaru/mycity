import Link from 'next/link';

/**
 * 5/11/2026 — LA DISISCRIZIONE HA UNA PAGINA SUA.
 *
 * Prima il link «Annulla l'iscrizione» disiscriveva appena qualcuno lo apriva (anche gli antivirus
 * che aprono i link delle email per controllarli) e poi rimandava alla home con
 * `?disiscrizione=…`, un parametro che nessuna pagina leggeva: chi cliccava non sapeva se era
 * andata. Adesso il link porta qui: con il gettone si chiede la conferma (un pulsante che fa la
 * POST), e dopo si legge l'esito.
 */
export const metadata = {
  title: 'Disiscrizione · MyCity',
  robots: { index: false, follow: false },
};

const ESITI: Record<string, { titolo: string; testo: string }> = {
  fatta: {
    titolo: 'Fatto: non riceverai più queste email',
    testo: 'La disiscrizione è registrata. Le email che riguardano i tuoi ordini continuano ad arrivare.',
  },
  'non-trovato': {
    titolo: 'Non c’era niente da spegnere',
    testo: 'Questo indirizzo non risulta iscritto: non riceverai queste email.',
  },
  'non-riuscita': {
    titolo: 'La disiscrizione non è riuscita',
    testo: 'Qualcosa non ha funzionato dalla nostra parte. Riapri il link dall’email fra qualche minuto, oppure scrivici dalla pagina Contatti: ti togliamo noi dalla lista.',
  },
  'link-non-valido': {
    titolo: 'Questo link non è valido',
    testo: 'Il link è incompleto o è stato modificato. Usa il link in fondo all’email più recente, oppure scrivici dalla pagina Contatti.',
  },
};

export default async function DisiscrizionePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; disiscrizione?: string }>;
}) {
  const { token, disiscrizione } = await searchParams;
  const esito = disiscrizione ? ESITI[disiscrizione] : undefined;

  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      {esito ? (
        <>
          <h1 className="font-serif text-2xl font-bold text-ink-900">{esito.titolo}</h1>
          <p className="mt-3 text-ink-700">{esito.testo}</p>
          <p className="mt-6 text-sm">
            <Link href="/" className="text-primary-700 underline">Torna a MyCity</Link>
            {disiscrizione === 'non-riuscita' || disiscrizione === 'link-non-valido' ? (
              <>
                {' · '}
                <Link href="/contact" className="text-primary-700 underline">Contatti</Link>
              </>
            ) : null}
          </p>
        </>
      ) : token ? (
        <>
          <h1 className="font-serif text-2xl font-bold text-ink-900">Vuoi smettere di ricevere queste email?</h1>
          <p className="mt-3 text-ink-700">Conferma e non te le mandiamo più. Le email sui tuoi ordini continuano ad arrivare.</p>
          <form method="post" action={`/api/unsubscribe?token=${encodeURIComponent(token)}`} className="mt-6">
            <button
              type="submit"
              className="inline-flex min-h-[44px] items-center rounded-lg bg-primary-700 px-5 py-2.5 font-semibold text-white hover:bg-primary-800"
            >
              Conferma la disiscrizione
            </button>
          </form>
        </>
      ) : (
        <>
          <h1 className="font-serif text-2xl font-bold text-ink-900">{ESITI['link-non-valido'].titolo}</h1>
          <p className="mt-3 text-ink-700">{ESITI['link-non-valido'].testo}</p>
        </>
      )}
    </div>
  );
}
