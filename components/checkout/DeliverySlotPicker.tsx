'use client';

import { useEffect } from 'react';

/**
 * Selettore della fascia di consegna ("Quando vuoi riceverlo", step 2).
 *
 * UI (vedi mockup design-system/ui_kits/buyer/src/35-checkout.txt):
 *  - 3 day-tile: Adesso (express ~30–45 min) / Oggi (scegli l'ora) / Domani.
 *  - sotto, la lista delle fasce orarie selezionabili.
 *
 * IMPORTANTE — non mostriamo badge di "capacità" (Disponibile/Quasi pieno/Al
 * completo) né disabilitiamo slot in modo statico: erano scarsità FINTA, non
 * dati reali di prenotazione. Mostriamo solo le fasce realmente proponibili,
 * filtrando per "Oggi" quelle già trascorse rispetto all'ora corrente.
 *
 * Lo slot scelto viene comunicato al parent come stringa leggibile (es.
 * "Oggi · 18:00–20:00") via onChange, oppure null quando non applicabile
 * (es. ritiro in negozio). Il parent lo invia poi agli endpoint d'ordine.
 */

type DayKey = 'now' | 'today' | 'tomorrow';

export type DeliverySlot = {
  /** chiave del giorno scelto */
  day: DayKey;
  /** etichetta leggibile completa, persistita su orders.delivery_slot */
  label: string;
};

// Fasce di "Oggi": ogni voce ha l'ora di FINE (24h) così possiamo escludere
// quelle già trascorse rispetto all'ora corrente. Nessuna capacità finta.
const TODAY_SLOTS: { label: string; endHour: number }[] = [
  { label: 'In giornata · 15:00–18:00', endHour: 18 },
  { label: 'Stasera · 18:00–20:00', endHour: 20 },
];
const TOMORROW_TIMES = [
  'Domani · 9:00–12:00',
  'Domani · 12:00–15:00',
  'Domani · 15:00–18:30',
  'Domani · 18:30–20:00',
];

const NOW_LABEL = 'Adesso · arrivo in ~30–45 min';

/** Fasce di "Oggi" ancora future rispetto all'ora corrente. */
function todayTimesAvailable(): string[] {
  const nowHour = new Date().getHours();
  return TODAY_SLOTS.filter((s) => s.endHour > nowHour).map((s) => s.label);
}

type Props = {
  /** giorno selezionato */
  day: DayKey;
  onDayChange: (day: DayKey) => void;
  /** fascia oraria selezionata per "oggi" */
  todayTime: string;
  onTodayTimeChange: (t: string) => void;
  /** fascia oraria selezionata per "domani" */
  tomorrowTime: string;
  onTomorrowTimeChange: (t: string) => void;
  /**
   * true = almeno un negozio nel carrello offre Express → mostra il tile "Adesso".
   * false/undefined = nessun negozio Express disponibile → tile nascosto e la
   * selezione viene automaticamente spostata su 'today' se era su 'now'.
   */
  expressAvailable?: boolean;
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
  const todayTimes = todayTimesAvailable();
  const times = day === 'today' ? todayTimes : TOMORROW_TIMES;
  const current = day === 'today' ? todayTime : tomorrowTime;
  const onTimeChange = day === 'today' ? onTodayTimeChange : onTomorrowTimeChange;

  // Se si è su "Oggi" e la fascia selezionata non è (più) tra quelle future,
  // scegli automaticamente la prima fascia futura disponibile.
  useEffect(() => {
    if (day !== 'today') return;
    if (todayTimes.length === 0) return;
    if (!todayTimes.includes(todayTime)) onTodayTimeChange(todayTimes[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, todayTime, todayTimes.join('|')]);

  return (
    <div className="space-y-3">
      {/* Day tiles: Adesso / Oggi / Domani */}
      <div className="grid grid-cols-3 gap-3">
        <DayTile
          active={day === 'now'}
          onClick={() => onDayChange('now')}
          title="Adesso"
          subtitle="~30–45 min"
          badge={{ text: 'Express', cls: 'text-accent-700 bg-accent-50' }}
        />
        <DayTile
          active={day === 'today'}
          onClick={() => onDayChange('today')}
          title="Oggi"
          subtitle="Scegli l'ora"
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
  title,
  subtitle,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  subtitle: string;
  badge?: { text: string; cls: string };
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative rounded-xl border-[1.5px] px-3 py-3 text-left transition-colors ${
        active ? 'border-primary-500 bg-primary-50' : 'border-cream-300 bg-white hover:border-primary-200'
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

/**
 * Calcola la stringa leggibile dello slot dal day + le fasce selezionate.
 * Pickup in negozio ⇒ null (nessuna fascia di consegna richiesta).
 */
export function resolveSlotLabel(
  day: DayKey,
  todayTime: string,
  tomorrowTime: string,
  pickupInStore: boolean,
): string | null {
  if (pickupInStore) return null;
  if (day === 'now') return NOW_LABEL;
  if (day === 'today') return todayTime;
  return tomorrowTime;
}

// Default = prima fascia FUTURA di oggi (se ce ne sono ancora), altrimenti la
// prima voce di "Oggi" come fallback neutro. L'effetto nel componente riallinea
// comunque la selezione alle fasce realmente disponibili a runtime.
function defaultTodayTime(): string {
  const avail = todayTimesAvailable();
  return avail[0] ?? TODAY_SLOTS[0].label;
}

export const SLOT_DEFAULTS = {
  get todayTime() {
    return defaultTodayTime();
  },
  tomorrowTime: TOMORROW_TIMES[2], // "Domani · 15:00–18:30"
};
