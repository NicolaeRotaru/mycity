'use client';

import { useEffect } from 'react';

import {
  FASCE_DI_DOMANI,
  SOTTOTITOLO_ADESSO,
  expressSiPuo,
  fasceAncoraPossibili,
  type Giorno,
} from '@/lib/quando-arriva';

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
};

export function DeliverySlotPicker({
  day,
  onDayChange,
  todayTime,
  onTodayTimeChange,
  tomorrowTime,
  onTomorrowTimeChange,
}: Props) {
  // Calcolato a render: le fasce di "Oggi" già trascorse sono escluse.
  const ora = new Date().getHours();
  const todayTimes = fasceAncoraPossibili(ora);
  const oggiPossibile = todayTimes.length > 0;
  const expressAvailable = expressSiPuo(ora);
  const times = day === 'today' ? todayTimes : FASCE_DI_DOMANI;
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

  return (
    <div className="space-y-3">
      {/* Day tiles: Adesso / Oggi / Domani */}
      <div className="grid grid-cols-3 gap-3">
        <DayTile
          active={day === 'now'}
          onClick={() => expressAvailable && onDayChange('now')}
          disabled={!expressAvailable}
          title="Adesso"
          subtitle={expressAvailable ? SOTTOTITOLO_ADESSO : 'Non disponibile'}
          badge={{ text: 'Express', cls: 'text-accent-700 bg-accent-50' }}
        />
        <DayTile
          active={day === 'today'}
          onClick={() => oggiPossibile && onDayChange('today')}
          disabled={!oggiPossibile}
          title="Oggi"
          subtitle={oggiPossibile ? "Scegli l'ora" : 'Non più oggi'}
        />
        <DayTile
          active={day === 'tomorrow'}
          onClick={() => onDayChange('tomorrow')}
          title="Domani"
          subtitle="Standard"
        />
      </div>

      {/* Lista fasce orarie — solo per Oggi / Domani */}
      {day !== 'now' && (
        <fieldset>
          <legend className="block text-sm font-semibold text-ink-700 mb-2">
            Fascia oraria{' '}
            <span className="font-normal text-ink-400">· scegli quando ricevere</span>
          </legend>
          {times.length === 0 ? (
            <p className="text-sm text-ink-600">
              Nessuna fascia disponibile per oggi — scegli <strong>Domani</strong>.
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
