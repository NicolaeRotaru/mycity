'use client';

import { useEffect, useState } from 'react';

import {
  FASCE_DI_DOMANI,
  SOTTOTITOLO_ADESSO,
  expressSiPuo,
  fasciaDiPartenzaOggi,
  giornoDiPartenza,
  fasceAncoraPossibili,
  fasceDiDomaniPossibili,
  type Giorno,
} from '@/lib/quando-arriva';
import { romeNow } from '@/lib/store-hours';

/**
 * Selettore della fascia di consegna ("Quando vuoi riceverlo", step 2).
 *
 * UI (vedi mockup docs/mockup/ui_kits/buyer/src/35-checkout.txt):
 *  - 3 day-tile: Adesso (express) / Oggi (scegli l'ora) / Domani.
 *  - sotto, la lista delle fasce orarie selezionabili.
 *
 * IMPORTANTE — non mostriamo badge di "capacità" (Disponibile/Quasi pieno/Al
 * completo) né disabilitiamo slot in modo statico: erano scarsità FINTA, non
 * dati reali di prenotazione. Mostriamo solo le fasce realmente proponibili,
 * filtrando per "Oggi" quelle già trascorse rispetto all'ora corrente.
 *
 * ⚠️ QUI NON SI DECIDE PIÙ NIENTE. Quali fasce esistono, quali sono ancora
 * possibili, da che giorno si parte e quanto dura l'express stanno tutti in
 * lib/quando-arriva.ts, insieme alla decisione su cosa finisce sull'ordine.
 * Prima erano scritti qui: due elenchi, due funzioni che leggevano l'orologio e
 * un numero di minuti diverso da quello di tutto il resto del sito.
 */

type Props = {
  /** giorno selezionato */
  day: Giorno;
  onDayChange: (day: Giorno) => void;
  /** fascia oraria selezionata per "oggi" */
  todayTime: string;
  onTodayTimeChange: (t: string) => void;
  /** fascia oraria selezionata per "domani" */
  tomorrowTime: string;
  onTomorrowTimeChange: (t: string) => void;
  /**
   * 29/10/2026 — La veloce si può mantenere adesso? Lo dice il server (`veloceSiPuo`): negozi
   * aperti e un fattorino online. Senza, «Adesso» non si offre, qualunque ora sia.
   *
   * 30/10/2026 (ondata 18) — `null` = il server non ha ancora risposto: è «non so ancora», non
   * «no». Chi torna dall'accesso con «Adesso» nella bozza la ritrova scelta, e la cassa tiene
   * fermo il pulsante finché la risposta non arriva. Solo un `false` sposta la scelta.
   */
  veloceDisponibile: boolean | null;
  /** «+1 €» o «compresa» (`prezzoDellaVeloce`): la veloce dice il suo prezzo prima di sceglierla. */
  prezzoVeloce: string;
  /** Perché adesso la veloce non si può, come lo dice il server. `null` = non lo sappiamo. */
  motivoVeloce?: string | null;
  /**
   * 30/10/2026 (ondata 21) — Gli orari dei negozi del carrello (`store_hours`), gli stessi che
   * legge la rotta. Senza, giovedì alle 14:00 la cassa proponeva «Oggi · 15:00–18:00» a un forno
   * che il giovedì pomeriggio è chiuso, e il no arrivava solo premendo «Ordina».
   */
  orariNegozi?: readonly unknown[];
};

/**
 * 29/10/2026 — La riga che si legge quando «Adesso» era scelta e la veloce non si può più.
 *
 * 30/10/2026 (ondata 18) — Diceva «ho scelto la prima fascia libera», ma la fascia segnata era
 * quella di partenza della cassa (Domani · 15:00–18:30, non 9:00–12:00), e il selettore non sa se
 * il negozio a quell'ora è aperto: «libera» non lo può dire. Adesso dice QUALE fascia ha messo e
 * chiede di controllarla.
 */
export function avvisoVeloceCaduta(fascia: string): string {
  return `La consegna veloce adesso non si può più: ho messo «${fascia}». Controlla qui sotto che l’ora ti vada bene; il prezzo della consegna lo vedi nel riepilogo.`;
}

/** 30/10/2026 (ondata 18) — Mentre il server non ha ancora detto se la veloce si può. */
export const RIGA_VELOCE_IN_ATTESA =
  'Sto controllando che ci sia un fattorino in servizio per la consegna veloce: appena arriva la risposta puoi ordinare.';

/**
 * Cosa fa la cassa quando la veloce cade dopo che il cliente ha scelto «Adesso»: torna alla prima
 * fascia ancora possibile (la rotta rifiuterebbe «Adesso» con un 409) e LO DICE, nominandola.
 * Mentre il server non ha ancora risposto (`inAttesa`) non cade niente: «non so» non è un «no».
 * Pura, per la prova.
 */
export function quandoLaVeloceCade(a: {
  day: Giorno;
  expressAvailable: boolean;
  ora: number;
  inAttesa?: boolean;
  /** 30/10/2026 (ondata 21) — L'orologio di Roma e gli orari dei negozi: si cade su una fascia servibile. */
  adesso?: Date;
  orari?: readonly unknown[];
}): { day: Giorno; fascia: string; avviso: string } | null {
  if (a.day !== 'now' || a.expressAvailable || a.inAttesa) return null;
  const day = a.adesso ? giornoDiPartenza(a.adesso, a.orari) : giornoDiPartenza(a.ora);
  const oggi = a.adesso ? fasciaDiPartenzaOggi(a.adesso, a.orari) : fasciaDiPartenzaOggi(a.ora);
  const domani = (a.adesso ? fasceDiDomaniPossibili(a.adesso, a.orari) : FASCE_DI_DOMANI)[0] ?? FASCE_DI_DOMANI[0];
  // `giornoDiPartenza` dà «oggi» solo se per oggi resta una fascia: il ripiego non scatta mai.
  const fascia = day === 'today' ? (oggi ?? domani) : domani;
  return { day, fascia, avviso: avvisoVeloceCaduta(fascia) };
}

export function DeliverySlotPicker({
  day,
  onDayChange,
  todayTime,
  onTodayTimeChange,
  tomorrowTime,
  onTomorrowTimeChange,
  veloceDisponibile,
  prezzoVeloce,
  motivoVeloce = null,
  orariNegozi = [],
}: Props) {
  // Calcolato a render: le fasce di "Oggi" già trascorse sono escluse.
  // 30/10/2026 (ondata 18) — L'ora è quella di Roma, come la vetrina, il carrello e le rotte: con
  // l'ora del telefono, un telefono a Bucarest alle 21:30 (a Roma le 20:30) si vedeva togliere la
  // veloce che la vetrina prometteva, e uno a Londra alle 20:30 se la vedeva offrire alle 21:30.
  //
  // 30/10/2026 (ondata 21) — Coi minuti e con gli orari dei negozi del carrello: si propone solo
  // quello che la rotta accetterebbe. Una fascia di oggi vale fino a 60 minuti dalla sua fine
  // (alle 17:50 non si promette «entro le 18»), e solo se ogni negozio in quella fascia è aperto.
  const adesso = romeNow();
  const ora = adesso.getHours();
  const todayTimes = fasceAncoraPossibili(adesso, orariNegozi);
  const oggiPossibile = todayTimes.length > 0;
  const tomorrowTimes = fasceDiDomaniPossibili(adesso, orariNegozi);
  const domaniPossibile = tomorrowTimes.length > 0;
  const expressAvailable = expressSiPuo(ora) && veloceDisponibile === true;
  // Il server non ha ancora risposto e l'orologio non dice già di no: la veloce è «non so ancora».
  const veloceInAttesa = expressSiPuo(ora) && veloceDisponibile === null;
  const adessoInAttesa = veloceInAttesa && day === 'now';

  // Se «Adesso» era scelta e non si può più (fattorino spento, negozio chiuso, le 21), si torna
  // alla prima fascia possibile, come dopo le 21: la rotta la rifiuterebbe comunque con un 409.
  // 29/10/2026 — Lo spostamento era muto: la rete cadeva un minuto e l'ordine partiva con la
  // fascia, senza che nessuno lo dicesse. Adesso una riga lo dice finché il cliente non sceglie.
  const [avvisoSpostata, setAvvisoSpostata] = useState<string | null>(null);
  useEffect(() => {
    const caduta = quandoLaVeloceCade({ day, expressAvailable, ora, inAttesa: veloceInAttesa, adesso, orari: orariNegozi });
    if (!caduta) return;
    setAvvisoSpostata(caduta.avviso);
    // La fascia nominata nell'avviso è quella che resta segnata: si mette prima di cambiare giorno.
    if (caduta.day === 'today') onTodayTimeChange(caduta.fascia);
    else onTomorrowTimeChange(caduta.fascia);
    onDayChange(caduta.day);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, expressAvailable, veloceInAttesa]);
  const scegliGiorno = (g: Giorno) => {
    setAvvisoSpostata(null);
    onDayChange(g);
  };
  const times = day === 'today' ? todayTimes : tomorrowTimes;
  const current = day === 'today' ? todayTime : tomorrowTime;
  const onTimeChange = day === 'today' ? onTodayTimeChange : onTomorrowTimeChange;

  // Se si è su "Oggi" e la fascia selezionata non è (più) tra quelle future,
  // scegli automaticamente la prima fascia futura disponibile.
  //
  // ⚠️ E se per oggi non ne resta NESSUNA si passa a domani. Prima qui c'era un
  // `return` che usciva subito: il giorno restava "oggi", la mattonella restava
  // premuta e la fascia restava quella di partenza — cioè un orario già passato,
  // che finiva dritto su orders.delivery_slot.
  useEffect(() => {
    if (day !== 'today') return;
    if (!oggiPossibile) { onDayChange('tomorrow'); return; }
    if (!todayTimes.includes(todayTime)) onTodayTimeChange(todayTimes[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, todayTime, oggiPossibile, todayTimes.join('|')]);

  // 30/10/2026 (ondata 21) — Lo stesso per «Domani»: sabato per la domenica chiusa non resta
  // niente, e si torna a oggi se oggi si può; una fascia che i negozi non servono si sposta.
  useEffect(() => {
    if (day !== 'tomorrow') return;
    if (!domaniPossibile) { if (oggiPossibile) onDayChange('today'); return; }
    if (!tomorrowTimes.includes(tomorrowTime)) onTomorrowTimeChange(tomorrowTimes[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, tomorrowTime, domaniPossibile, oggiPossibile, tomorrowTimes.join('|')]);

  return (
    <div className="space-y-3">
      {/* Day tiles: Adesso / Oggi / Domani */}
      <div className="grid grid-cols-3 gap-3">
        <DayTile
          active={day === 'now'}
          onClick={() => expressAvailable && scegliGiorno('now')}
          // In attesa della risposta, la tessera già scelta resta com'è: spenta sembrerebbe tolta.
          disabled={!expressAvailable && !adessoInAttesa}
          title="Adesso"
          subtitle={
            expressAvailable || adessoInAttesa
              ? `${SOTTOTITOLO_ADESSO} · ${prezzoVeloce}`
              : veloceInAttesa
                ? 'Sto controllando…'
                : 'Non disponibile'
          }
          badge={{ text: 'Veloce', cls: 'text-ink-700 bg-cream-100' }}
        />
        <DayTile
          active={day === 'today'}
          onClick={() => oggiPossibile && scegliGiorno('today')}
          disabled={!oggiPossibile}
          title="Oggi"
          subtitle={oggiPossibile ? "Scegli l'ora" : 'Non più oggi'}
        />
        <DayTile
          active={day === 'tomorrow'}
          onClick={() => domaniPossibile && scegliGiorno('tomorrow')}
          disabled={!domaniPossibile}
          title="Domani"
          subtitle={domaniPossibile ? "Scegli l'ora" : 'Negozio chiuso'}
        />
      </div>
      {avvisoSpostata && (
        <p role="status" className="text-sm text-ink-700">{avvisoSpostata}</p>
      )}
      {adessoInAttesa && (
        <p role="status" className="text-sm text-ink-700">{RIGA_VELOCE_IN_ATTESA}</p>
      )}
      {!expressAvailable && motivoVeloce && !avvisoSpostata && (
        <p className="text-xs text-ink-500">{motivoVeloce}</p>
      )}

      {/* Lista fasce orarie — solo per Oggi / Domani */}
      {day !== 'now' && (
        <fieldset>
          <legend className="block text-sm font-semibold text-ink-700 mb-2">
            Fascia oraria{' '}
            <span className="font-normal text-ink-400">· scegli quando ricevere</span>
          </legend>
          {times.length === 0 ? (
            <p className="text-sm text-ink-600">
              {day === 'today' ? (
                <>Nessuna fascia disponibile per oggi — scegli <strong>Domani</strong>.</>
              ) : (
                <>Domani i negozi del carrello sono chiusi: nessuna fascia di consegna disponibile.</>
              )}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {times.map((t) => {
                const checked = current === t;
                return (
                  <label
                    key={t}
                    className={`flex items-center justify-between gap-2.5 rounded-lg border-[1.5px] px-3.5 py-2.5 transition-colors ${
                      checked
                        ? 'cursor-pointer border-primary-500 bg-primary-50'
                        : 'cursor-pointer border-cream-300 bg-white hover:border-primary-200'
                    }`}
                  >
                    <span className="inline-flex items-center gap-2.5 text-sm font-semibold text-ink-900">
                      <input
                        type="radio"
                        name="deliverySlot"
                        value={t}
                        checked={checked}
                        onChange={() => onTimeChange(t)}
                        className="w-4 h-4 accent-primary-600"
                      />
                      {t}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </fieldset>
      )}
    </div>
  );
}

function DayTile({
  active,
  onClick,
  disabled,
  title,
  subtitle,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  title: string;
  subtitle: string;
  badge?: { text: string; cls: string };
}) {
  return (
    // 150 — La tile scelta era segnalata solo dal bordo colorato: un lettore di
    // schermo leggeva tre pulsanti identici, senza dire quale fosse attivo.
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      aria-label={`${title}, ${subtitle}`}
      className={`relative rounded-xl border-[1.5px] px-3 py-3 text-left transition-colors ${
        disabled
          ? 'border-cream-200 bg-cream-50 cursor-not-allowed opacity-50'
          : active ? 'border-primary-500 bg-primary-50' : 'border-cream-300 bg-white hover:border-primary-200'
      }`}
    >
      {badge && (
        <span
          className={`absolute -top-2 left-3 rounded-full px-2 py-0.5 text-2xs font-bold ${badge.cls}`}
        >
          {badge.text}
        </span>
      )}
      <p className="font-bold text-ink-900 text-sm">{title}</p>
      <p className="text-xs text-ink-600 mt-0.5">{subtitle}</p>
    </button>
  );
}
