import type { Sito } from '@/lib/agenzia/lavoro-consegnato/tipi';

/**
 * IL TUO SITO È GIÀ PRONTO — 27/11/2026.
 *
 * Nicola: «mettilo nel momento in cui l'imprenditore ha cliccato sul link che gli ha inviato il venditore di
 * MyCity». Nella pagina del link del preventivo, sopra i tre abbonamenti, il titolare vede il sito che abbiamo
 * già fatto per lui: dal vivo se è online, altrimenti l'immagine della home. Niente stati né effetti: si disegna
 * sul server, e del lavoro consegnato riceve solo il sito.
 */
export default function SitoPronto({ sito, attivita }: { sito: Sito; attivita: string }) {
  const online = sito.stato === 'online' && !!sito.indirizzo;
  return (
    <section className="mt-6 rounded-2xl border border-cream-300 bg-white p-5 shadow-warm sm:p-6" aria-labelledby="sito-pronto">
      <p className="text-xs font-bold uppercase tracking-wide text-primary-700">Prima di scegliere</p>
      <h2 id="sito-pronto" className="mt-1 font-serif text-xl font-extrabold text-ink-900 sm:text-2xl">Il sito di {attivita} è già pronto</h2>
      <p className="mt-1 text-sm text-ink-700">
        {online
          ? 'L’abbiamo fatto con le foto, il menu e gli orari del tuo locale. Puoi già navigarlo qui sotto.'
          : 'L’abbiamo fatto con le foto, il menu e gli orari del tuo locale. Ecco la prima pagina: lo mettiamo online quando confermi.'}
      </p>

      {online && sito.indirizzo ? (
        <div className="mt-4 overflow-hidden rounded-xl border border-cream-300 bg-cream-50">
          <iframe
            src={sito.indirizzo}
            title={`Il sito: ${sito.titolo}`}
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
            sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
            className="block h-[520px] w-full bg-white"
          />
        </div>
      ) : sito.anteprima ? (
        <figure className="mt-4 overflow-hidden rounded-xl border border-cream-300 bg-cream-50">
          <div className="flex items-center gap-1.5 border-b border-cream-200 bg-cream-100 px-3 py-1.5" aria-hidden>
            <span className="h-2 w-2 rounded-full bg-cream-300" />
            <span className="h-2 w-2 rounded-full bg-cream-300" />
            <span className="h-2 w-2 rounded-full bg-cream-300" />
          </div>
          <img src={sito.anteprima} alt={`La prima pagina del sito: ${sito.titolo}`} width={1280} height={800} loading="lazy" className="block h-auto w-full" />
        </figure>
      ) : null}

      {sito.pagine.length > 0 && (
        <p className="mt-3 text-sm text-ink-700">
          <span className="font-semibold text-ink-900">{sito.pagine.length} pagine:</span> {sito.pagine.map((p) => p.titolo).join(' · ')}.
        </p>
      )}
      {sito.da_confermare.length > 0 && (
        <p className="mt-1 text-sm text-ink-600">
          Da controllare insieme: {sito.da_confermare.map((d) => d.voce.toLowerCase()).join(', ')}. Niente va online senza il tuo sì.
        </p>
      )}
      {online && sito.indirizzo && (
        <p className="mt-3">
          <a href={sito.indirizzo} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-primary-700 underline underline-offset-2">Apri il sito a tutto schermo</a>
        </p>
      )}
    </section>
  );
}
