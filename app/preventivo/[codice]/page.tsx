import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, Eye, Globe, Share2, Sparkles, Store, TrendingUp, Video, type LucideIcon } from 'lucide-react';
import { ABBONAMENTI, FASCE, FRASE_PARTNER, SLUG_SERVIZIO, canonePrimoMese, scriviCanone, type ServizioAgenzia } from '@/lib/agenzia/preventivo';
import { CODICE_VALIDO } from '@/lib/agenzia/preventivo-col-codice';
import { leggiDemoDalLink } from '@/lib/agenzia/demo-dal-link';
import { indirizziDemo } from '@/lib/agenzia/indirizzi-demo';
import { hrefFascia } from '@/lib/agenzia/indirizzi-servizi';
import { pulsantiServizi, TESTI_RIQUADRO } from '@/lib/agenzia/riquadro-abbonamento';
import { descriviAttivita } from '@/lib/agenzia/tipi-attivita';
import { ETICHETTE_SERVIZI } from '@/components/seller/servizi-nel-menu';
import { formatPriceFromCents } from '@/lib/format';

/**
 * LA DASHBOARD DEL PANNELLO DEMO — 25/11/2026.
 *
 * Nicola: «che il link del preventivo ti porti ad una demo come quella di pane quotidiano». Il link
 * col codice ora apre questa pagina: la dashboard del negozio come la vede Pane Quotidiano, col nome
 * dell'attività, il riquadro dell'abbonamento con le tre fasce (ognuna apre il suo preventivo) e i
 * quattro servizi, ognuno col primo «perché» vero letto dai dati. Il preventivo completo, con
 * l'accettazione, sta nella voce «Abbonamento».
 *
 * Il ritorno dal pagamento Stripe arriva ancora qui (?pagato=1 o 0, lib/agenzia/cassa-dal-link.ts) e
 * un preventivo già accettato non ha più una demo da mostrare: in tutti e due i casi si va alla
 * pagina dell'abbonamento, che sa cosa dire.
 */

export const dynamic = 'force-dynamic';

const ICONE: Record<ServizioAgenzia, LucideIcon> = { foto_video: Video, sito_web: Globe, social: Share2, analisi: TrendingUp };

export default async function DashboardDemo({
  params,
  searchParams,
}: {
  params: Promise<{ codice: string }>;
  searchParams: Promise<{ pagato?: string }>;
}) {
  const { codice } = await params;
  const { pagato } = await searchParams;
  if (!CODICE_VALIDO.test(codice)) notFound();
  const ind = indirizziDemo(codice);
  if (pagato === '0' || pagato === '1') redirect(`${ind.abbonamento}?pagato=${pagato}`);

  const demo = await leggiDemoDalLink(codice);
  if (demo.tipo === 'non-trovato') notFound();
  if (demo.tipo === 'accettato') redirect(ind.abbonamento);
  if (demo.tipo === 'guasto') return <p className="text-ink-700">{demo.messaggio}</p>;

  const p = demo.preventivo;
  const servizi = pulsantiServizi(p.righe, (id) => ind.servizio(SLUG_SERVIZIO[id]));

  return (
    <div className="space-y-6">
      {/* Il riquadro dell'abbonamento, come in cima alla dashboard di Pane Quotidiano. */}
      <section aria-labelledby="scegli-abbonamento" className="rounded-2xl border-2 border-primary-200 bg-surface-0 p-5 sm:p-6">
        <h2 id="scegli-abbonamento" className="inline-flex items-center gap-2 font-serif text-xl font-bold text-ink-900">
          <Sparkles size={20} className="text-primary-700" aria-hidden /> {TESTI_RIQUADRO.visibile}
        </h2>
        <p className="mt-1 text-sm text-ink-700">{TESTI_RIQUADRO.visibileSotto}</p>
        <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3" aria-label="Le tre fasce dell'abbonamento">
          {ABBONAMENTI.map((f) => {
            const primo = p.primoMeseScontato ? canonePrimoMese(p.prezzi[f]) : null;
            const consigliata = f === p.consigliato;
            return (
              <li key={f}>
                <Link
                  href={hrefFascia(f, ind.abbonamento)}
                  aria-label={`Il preventivo col ${FASCE[f].nome}: ${scriviCanone(p.prezzi[f])}${consigliata ? ', consigliato' : ''}`}
                  className={`block h-full rounded-xl border-2 bg-white p-3 transition-colors hover:border-primary-300 hover:bg-cream-50 ${consigliata ? 'border-primary-700' : 'border-cream-200'}`}
                >
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-serif text-lg font-bold text-ink-900">{FASCE[f].nome}</span>
                    {consigliata && <span className="rounded-full bg-olive-700 px-2 py-0.5 text-[11px] font-bold text-white">Consigliato</span>}
                  </p>
                  <p className="text-sm font-semibold text-ink-900">{scriviCanone(p.prezzi[f])}</p>
                  {primo !== null && <p className="text-xs font-semibold text-olive-800">Il primo mese {formatPriceFromCents(primo)}</p>}
                  <p className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-primary-700">
                    Vedi il preventivo <ArrowRight size={12} aria-hidden />
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
        <Link
          href={hrefFascia(p.consigliato, ind.abbonamento)}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-primary-800"
        >
          {TESTI_RIQUADRO.pulsante} <ArrowRight size={16} aria-hidden />
        </Link>
        <nav aria-label="I servizi" className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {servizi.map((s) => {
            const Icona = ICONE[s.id];
            return (
              <Link
                key={s.id}
                href={s.href}
                className="group flex items-start gap-3 rounded-xl border border-cream-300 bg-white p-3 transition-colors hover:border-primary-300 hover:bg-cream-50"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-700">
                  <Icona size={18} aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="inline-flex items-center gap-1 font-semibold text-ink-900">
                    {ETICHETTE_SERVIZI[s.id]} <ArrowRight size={14} className="text-primary-700" aria-hidden />
                  </span>
                  <span className="mt-0.5 block text-sm text-ink-600">{s.perche}</span>
                </span>
              </Link>
            );
          })}
        </nav>
      </section>

      {/* L'intestazione del negozio, come «Bentornato, Pane Quotidiano». */}
      <section className="rounded-2xl bg-gradient-to-br from-primary-700 to-secondary-600 p-5 text-white shadow-warm sm:p-7">
        <div className="flex flex-wrap items-center gap-4">
          <span className="inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-white/90 text-primary-700" aria-hidden>
            <Store size={28} />
          </span>
          <div className="min-w-0">
            <p className="text-sm text-white/85">Benvenuto nel tuo pannello</p>
            <h1 className="font-serif text-3xl font-extrabold leading-tight sm:text-4xl">{p.attivita}</h1>
            <p className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">
              <Eye size={13} aria-hidden /> In demo · {descriviAttivita(p.tipoAttivita)}
            </p>
          </div>
        </div>
        <p className="mt-4 text-sm text-white/90">
          Qui, quando attivi l’abbonamento, trovi gli ordini, i prodotti e i clienti del tuo negozio. Intanto guarda cosa
          faremmo per te: ogni servizio qui sopra ha la sua pagina, e ogni fascia il suo preventivo.
        </p>
        <p className="mt-2 text-xs text-white/75">{FRASE_PARTNER}</p>
      </section>
    </div>
  );
}
