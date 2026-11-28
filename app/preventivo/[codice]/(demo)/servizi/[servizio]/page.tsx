import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, Check } from 'lucide-react';
import { ABBONAMENTI, FASCE, FRASE_PARTNER, LISTINO, scriviCanone, servizioDaSlug } from '@/lib/agenzia/preventivo';
import { CODICE_VALIDO } from '@/lib/agenzia/preventivo-col-codice';
import { leggiDemoDalLink } from '@/lib/agenzia/demo-dal-link';
import { indirizziDemo } from '@/lib/agenzia/indirizzi-demo';
import { hrefFascia } from '@/lib/agenzia/indirizzi-servizi';
import AnalisiAziendale from '@/components/seller/AnalisiAziendale';
import CanaliAnalizzati from '@/components/seller/CanaliAnalizzati';
import AnteprimaServizio from '@/components/seller/AnteprimaServizio';
import OffertaSuMisura from '@/components/seller/OffertaSuMisura';

/**
 * UN SERVIZIO NEL PANNELLO DEMO — 25/11/2026.
 *
 * La stessa pagina che Pane Quotidiano vede in /seller/servizi/<slug>, disegnata sul server coi dati
 * del link col codice: perché te lo proponiamo (dai dati veri), cosa facciamo per te con la fascia
 * consigliata, cosa ricevi già pronto (la bozza del sito, il piano dei post, i formati) e come è
 * compreso nelle tre fasce. Ogni fascia apre il suo preventivo nella voce «Abbonamento».
 * L'analisi del business qui mostra l'analisi aziendale intera, solo da fonti pubbliche
 * (mycity#330, components/seller/AnalisiAziendale.tsx). Mai la pagella del marketplace: arriva solo
 * dopo l'abbonamento (Nicola, 25/11).
 */

export const dynamic = 'force-dynamic';

export default async function ServizioDemo({ params }: { params: Promise<{ codice: string; servizio: string }> }) {
  const { codice, servizio } = await params;
  if (!CODICE_VALIDO.test(codice)) notFound();
  const id = servizioDaSlug(servizio);
  if (!id) notFound();
  const ind = indirizziDemo(codice);

  const demo = await leggiDemoDalLink(codice);
  if (demo.tipo === 'non-trovato') notFound();
  if (demo.tipo === 'accettato') redirect(ind.abbonamento);
  if (demo.tipo === 'guasto') return <p className="text-ink-700">{demo.messaggio}</p>;

  const p = demo.preventivo;
  const voce = LISTINO[id];
  const riga = p.righe.find((r) => r.id === id) ?? null;
  const giaAPosto = !riga && p.giaAPosto.includes(id);

  return (
    <div className="max-w-2xl">
      <p className="text-xs font-bold uppercase tracking-label text-primary-700">Servizi</p>
      <h1 className="mt-0.5 font-serif text-3xl font-extrabold leading-tight text-ink-900">{voce.titolo}</h1>
      <p className="mt-1 text-sm text-ink-600">{voce.descrizione}</p>
      <p className="mb-4 mt-2 text-sm font-semibold text-primary-700">{FRASE_PARTNER}</p>

      {riga && (
        <section className="mb-4 rounded-2xl border border-cream-300 bg-white p-5 shadow-warm sm:p-6">
          <h2 className="font-serif text-xl font-bold text-ink-900">Perché te lo proponiamo</h2>
          <ul className="mt-1 list-disc pl-5 text-sm text-ink-700">
            {riga.perche.map((frase) => <li key={frase}>{frase}</li>)}
          </ul>
        </section>
      )}

      <div className="mb-4">
        <OffertaSuMisura offerta={p.offerta} fascia={p.consigliato} servizi={[id]} titolo={`Cosa facciamo per te, col ${FASCE[p.consigliato].nome}`} completa={false} />
      </div>

      {giaAPosto && (
        <section className="mb-4 rounded-2xl border border-cream-300 bg-cream-50 p-5">
          <p className="inline-flex items-center gap-2 font-semibold text-ink-900">
            <Check size={18} className="text-olive-700" aria-hidden /> Questo ce l&apos;hai già
          </p>
          <p className="mt-1 text-sm text-ink-700">Dai tuoi dati risulta a posto. Se vuoi rifarlo o migliorarlo, lo diciamo nel preventivo.</p>
        </section>
      )}

      {id === 'analisi' && (
        <AnalisiAziendale analisi={p.analisiAziendale} stato={p.analisiAziendaleStato} fascia={p.consigliato} nome={p.attivita} />
      )}

      {/* 25/11/2026 sera — I social e la scheda Google anche nella demo del link (Nicola, `agenzia.social-come-il-sito`). */}
      {id === 'analisi' && p.canali && (
        <section className="mt-6 rounded-2xl border border-cream-300 bg-white p-5 shadow-warm sm:p-6" aria-labelledby="social-analizzati">
          <h2 id="social-analizzati" className="text-lg font-bold text-ink-900">I tuoi social e la scheda Google</h2>
          <div className="mt-2"><CanaliAnalizzati canali={p.canali} /></div>
        </section>
      )}
      {id === 'social' && p.canali && (
        <section className="mb-4 rounded-2xl border border-cream-300 bg-white p-5 shadow-warm sm:p-6" aria-labelledby="social-oggi">
          <h2 id="social-oggi" className="font-serif text-xl font-bold text-ink-900">I tuoi social, oggi</h2>
          <div className="mt-2"><CanaliAnalizzati canali={p.canali} /></div>
        </section>
      )}

      {!giaAPosto && id !== 'analisi' && (
        <AnteprimaServizio id={id} nome={p.attivita} tipo={p.tipoAttivita} giorno={p.data} nascita={p.nascitaAttivita} scheda={demo.scheda} />
      )}

      <section className="mt-4 rounded-2xl border border-cream-300 bg-white p-5 shadow-warm sm:p-6" aria-labelledby="compreso-nei-piani">
        <h2 id="compreso-nei-piani" className="font-serif text-xl font-bold text-ink-900">È compreso in tutti e tre gli abbonamenti</h2>
        <ul className="mt-3 space-y-3">
          {ABBONAMENTI.map((f) => (
            <li key={f}>
              <Link
                href={hrefFascia(f, ind.abbonamento)}
                className={`block rounded-xl border p-3 transition-colors hover:border-primary-300 ${f === p.consigliato ? 'border-primary-700 bg-cream-50' : 'border-cream-200'}`}
              >
                <p className="text-sm font-semibold text-ink-900">
                  {FASCE[f].nome} · {scriviCanone(p.prezzi[f])}
                  {f === p.consigliato && <span className="ml-2 rounded-full bg-olive-700 px-2 py-0.5 text-[11px] font-bold text-white">Consigliato</span>}
                </p>
                <p className="mt-0.5 text-sm text-ink-700">{FASCE[f].servizi[id]}</p>
              </Link>
            </li>
          ))}
        </ul>
        <Link
          href={hrefFascia(p.consigliato, ind.abbonamento)}
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-primary-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-primary-800"
        >
          Scegli l&apos;abbonamento <ArrowRight size={16} aria-hidden />
        </Link>
      </section>
    </div>
  );
}
