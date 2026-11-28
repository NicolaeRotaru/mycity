import type { LavoroConsegnato, Sito } from '@/lib/agenzia/lavoro-consegnato/tipi';

/**
 * IL TUO SITO È GIÀ PRONTO — 27/11/2026.
 *
 * Nicola: «mettilo nel momento in cui l'imprenditore ha cliccato sul link che gli ha inviato il venditore di
 * MyCity». Nella pagina del link del preventivo, sopra i tre abbonamenti, il titolare vede il sito che abbiamo
 * già fatto per lui: dal vivo se è online, altrimenti l'immagine della home. Niente stati né effetti: si disegna
 * sul server (MAI 'use client': i dati del sito resterebbero nella pagina pubblica), e riceve solo il sito.
 *
 * Collaudo del 27/11: il riquadro sta sopra tutte e tre le fasce, quindi dice quale versione è il sito e con
 * quale abbonamento va online. Il Base comprende un sito di una pagina: non gli si promette il sito Business.
 */
type Fascia = LavoroConsegnato['fascia'];
const NOME: Record<Fascia, string> = { base: 'Base', business: 'Business', premium: 'Premium' };
const VA_ONLINE: Record<Fascia, string> = {
  base: 'Va online con qualunque abbonamento.',
  business: 'Questa versione va online col Business o col Premium. Col Base diventa un sito di una pagina col tuo nome.',
  premium: 'Questa versione va online col Premium. Col Base e col Business diventa il sito compreso in quell’abbonamento.',
};

export default function SitoPronto({ sito, versione, attivita }: { sito: Sito; versione: Fascia; attivita: string }) {
  const online = sito.stato === 'online' && !!sito.indirizzo;
  const immagine = !online && sito.anteprima ? sito.anteprima : null;
  return (
    <section className="mt-6 rounded-2xl border border-cream-300 bg-white p-5 shadow-warm sm:p-6" aria-labelledby="sito-pronto">
      <p className="text-xs font-bold uppercase tracking-wide text-primary-700">Prima di scegliere · versione {NOME[versione]}</p>
      <h2 id="sito-pronto" className="mt-1 font-serif text-xl font-extrabold text-ink-900 sm:text-2xl">Il sito di {attivita} è già pronto</h2>
      <p className="mt-1 text-sm text-ink-700">
        L’abbiamo fatto con le foto, i testi e gli orari della tua attività.{' '}
        {online ? 'Puoi già navigarlo qui sotto.' : immagine ? 'Ecco la prima pagina.' : 'Te lo mostriamo appena confermi.'}
      </p>
      <p className="mt-1 text-sm font-semibold text-ink-900">{VA_ONLINE[versione]}</p>

      {online && sito.indirizzo ? (
        <div className="mt-4 overflow-hidden rounded-xl border border-cream-300 bg-cream-50">
          <iframe
            src={sito.indirizzo}
            title={`Il sito: ${sito.titolo}`}
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
            sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
            className="block h-[420px] w-full bg-white sm:h-[520px]"
          />
        </div>
      ) : immagine ? (
        <figure className="mt-4 overflow-hidden rounded-xl border border-cream-300 bg-cream-50">
          <div className="flex items-center gap-1.5 border-b border-cream-200 bg-cream-100 px-3 py-1.5" aria-hidden>
            <span className="h-2 w-2 rounded-full bg-cream-300" />
            <span className="h-2 w-2 rounded-full bg-cream-300" />
            <span className="h-2 w-2 rounded-full bg-cream-300" />
          </div>
          <img src={immagine} alt={`La prima pagina del sito: ${sito.titolo}`} width={1280} height={800} className="block h-auto w-full" />
        </figure>
      ) : null}

      {sito.pagine.length > 0 && (
        <p className="mt-3 text-sm text-ink-700">
          <span className="font-semibold text-ink-900">Versione {NOME[versione]}, {sito.pagine.length} pagine:</span> {sito.pagine.map((p) => p.titolo).join(' · ')}.
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
