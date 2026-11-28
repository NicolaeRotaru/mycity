'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, BadgeCheck, EyeOff, Globe, Share2, Sparkles, TrendingUp, Video, type LucideIcon } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useProfile } from '@/components/hooks/useProfile';
import { Button } from '@/components/ui/Button';
import { ABBONAMENTI, FASCE, REALIZZATI_DA, canonePrimoMese, type ServizioAgenzia } from '@/lib/agenzia/preventivo';
import { PERCORSO_ABBONAMENTO, hrefFascia } from '@/lib/agenzia/indirizzi-servizi';
import { inCimaAllaPagina, pulsantiServizi, statoRiquadro, TESTI_RIQUADRO, type StatoRiquadro } from '@/lib/agenzia/riquadro-abbonamento';
import { ETICHETTE_SERVIZI } from '@/components/seller/servizi-nel-menu';
import { CHIAVE_PREVENTIVO, leggiPreventivoAgenzia, scriviCanone } from '@/components/seller/preventivo-agenzia';
import { formatPriceFromCents } from '@/lib/format';

/**
 * IL RIQUADRO «ABBONAMENTO» IN DASHBOARD — 24/11/2026 (lib/agenzia/riquadro-abbonamento.ts).
 *
 * La dashboard lo mette in due punti: `posizione="cima"` (primo blocco, quando c'è da scegliere o
 * da sistemare un pagamento) e `posizione="dopo-numeri"` (abbonamento attivo). Ognuno dei due si
 * disegna solo se lo stato è il suo: le letture sono le stesse e React Query le fa una volta.
 */

const ICONE: Record<ServizioAgenzia, LucideIcon> = { foto_video: Video, sito_web: Globe, social: Share2, analisi: TrendingUp };

export default function RiquadroAbbonamento({ posizione }: { posizione: 'cima' | 'dopo-numeri' }) {
  const { profile } = useProfile();
  const id = profile?.id ?? '';
  const approvato = profile?.is_approved === true;
  const { data: p, isLoading } = useQuery({ queryKey: CHIAVE_PREVENTIVO, queryFn: leggiPreventivoAgenzia, retry: false });
  const { data: inVetrina } = useQuery({
    queryKey: ['seller', 'in-vetrina', id],
    enabled: approvato && !!id,
    queryFn: async (): Promise<boolean | null> => {
      const { data, error } = await supabase.rpc('negozio_in_vetrina', { p_id: id });
      if (error) return null;
      return data === true;
    },
  });

  if (isLoading) return null;
  // Senza i dati dei servizi resta almeno l'avviso della demo, se il database dice che lo è: meglio
  // un riquadro corto che nessun modo di sapere perché la vetrina non si vede.
  if (!p) {
    if (posizione !== 'cima' || !approvato || inVetrina !== false) return null;
    return (
      <Cornice tono="giallo">
        <Titolo icona={EyeOff}>{TESTI_RIQUADRO.nascosta}</Titolo>
        <p className="mt-1 text-sm text-ink-700">{TESTI_RIQUADRO.nascostaSotto}</p>
        <div className="mt-4"><Button href={PERCORSO_ABBONAMENTO} iconRight={ArrowRight}>{TESTI_RIQUADRO.pulsante}</Button></div>
      </Cornice>
    );
  }

  const stato = statoRiquadro(p.attivo, approvato ? inVetrina : null);
  if ((posizione === 'cima') !== inCimaAllaPagina(stato)) return null;
  const servizi = <PulsantiServizi righe={p.righe} />;

  if (stato.tipo === 'attivo') {
    return (
      <Cornice tono="verde" compatto>
        <Titolo icona={BadgeCheck}>
          {/* 28/11/2026 — SDG ha il Premium incluso: non lo paga e non lo realizza per sé stesso. */}
          {p.attivo?.incluso
            ? `Il tuo abbonamento ${FASCE[stato.fascia].nome} è attivo ed è incluso: non paghi niente`
            : `Il tuo abbonamento ${FASCE[stato.fascia].nome} è attivo, lo realizza ${REALIZZATI_DA}`}
        </Titolo>
        {servizi}
        <Link href={PERCORSO_ABBONAMENTO} className="mt-3 inline-block text-sm font-semibold text-primary-700 underline underline-offset-2">
          Vedi il tuo abbonamento
        </Link>
      </Cornice>
    );
  }

  if (stato.tipo === 'in_ritardo') {
    return (
      <Cornice tono="giallo">
        <Titolo icona={AlertTriangle}>Il pagamento del tuo abbonamento {FASCE[stato.fascia].nome} non è riuscito</Titolo>
        <p className="mt-1 text-sm text-ink-700">{TESTI_RIQUADRO.inRitardoSotto}</p>
        <div className="mt-4"><Button href="/seller/help" iconRight={ArrowRight}>Scrivici dall’Aiuto</Button></div>
        {servizi}
      </Cornice>
    );
  }

  return <DaScegliere stato={stato} p={p} servizi={servizi} />;
}

function DaScegliere({ stato, p, servizi }: {
  stato: Extract<StatoRiquadro, { tipo: 'scegli' }>;
  p: NonNullable<Awaited<ReturnType<typeof leggiPreventivoAgenzia>>>;
  servizi: React.ReactNode;
}) {
  const nascosta = stato.vetrina === 'nascosta';
  return (
    <Cornice tono={nascosta ? 'giallo' : 'crema'}>
      <Titolo icona={nascosta ? EyeOff : Sparkles}>{nascosta ? TESTI_RIQUADRO.nascosta : TESTI_RIQUADRO.visibile}</Titolo>
      <p className="mt-1 text-sm text-ink-700">{nascosta ? TESTI_RIQUADRO.nascostaSotto : TESTI_RIQUADRO.visibileSotto}</p>
      <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4" aria-label="Le tre fasce dell'abbonamento">
        {ABBONAMENTI.map((f) => {
          const primo = p.primoMeseScontato ? canonePrimoMese(p.prezzi[f]) : null;
          const consigliata = f === p.consigliato;
          return (
            <li key={f}>
              {/* 25/11/2026 — Ogni fascia apre il suo preventivo (Nicola: «in base all'azienda e all'abbonamento»). */}
              <Link
                href={hrefFascia(f)}
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
      <div className="mt-4"><Button href={PERCORSO_ABBONAMENTO} iconRight={ArrowRight}>{TESTI_RIQUADRO.pulsante}</Button></div>
      {servizi}
    </Cornice>
  );
}

function PulsantiServizi({ righe }: { righe: Parameters<typeof pulsantiServizi>[0] }) {
  return (
    <nav aria-label="I servizi" className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {pulsantiServizi(righe).map((s) => {
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
              <span className="flex items-center gap-1 font-semibold text-ink-900">
                {ETICHETTE_SERVIZI[s.id]} <ArrowRight size={14} className="text-primary-700 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </span>
              <span className="mt-0.5 block text-xs text-ink-600">{s.perche}</span>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

function Cornice({ tono, compatto, children }: { tono: 'giallo' | 'verde' | 'crema'; compatto?: boolean; children: React.ReactNode }) {
  const colori = { giallo: 'border-amber-300 bg-amber-50', verde: 'border-olive-300 bg-olive-50', crema: 'border-secondary-200 bg-cream-50' }[tono];
  return (
    <section
      role={tono === 'giallo' ? 'status' : undefined}
      aria-label="Abbonamento"
      data-testid="riquadro-abbonamento"
      className={`rounded-2xl border-2 ${colori} ${compatto ? 'p-4' : 'p-5 sm:p-6'}`}
    >
      {children}
    </section>
  );
}

function Titolo({ icona: Icona, children }: { icona: LucideIcon; children: React.ReactNode }) {
  return (
    <h2 className="flex items-start gap-2 font-serif text-lg sm:text-xl font-bold text-ink-900">
      <Icona size={20} className="mt-1 shrink-0 text-ink-700" aria-hidden /> <span>{children}</span>
    </h2>
  );
}
