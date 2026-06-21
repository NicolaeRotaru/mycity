'use client';

/**
 * Selettore della fascia di consegna ("Quando vuoi riceverlo", step 2).
 *
 * UI (vedi mockup design-system/ui_kits/buyer/src/35-checkout.txt):
 *  - 3 day-tile: Adesso (express ~30–45 min) / Oggi (scegli l'ora) / Domani.
 *  - sotto, la lista delle fasce orarie con un badge di capacità
 *    Disponibile / Quasi pieno / Al completo.
 *
 * IMPORTANTE — i badge di capacità NON sono dati di prenotazione reali: sono
 * un'etichetta euristica deterministica (vedi SLOT_CAP qui sotto). È una label,
 * non un contatore live. Le fasce "Al completo" sono disabilitate.
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

const TODAY_TIMES = ['In giornata · 15:00–18:00', 'Stasera · 18:00–20:00'];
const TOMORROW_TIMES = [
  'Domani · 9:00–12:00',
  'Domani · 12:00–15:00',
  'Domani · 15:00–18:30',
  'Domani · 18:30–20:00',
];

const NOW_LABEL = 'Adesso · arrivo in ~30–45 min';

// Capacità delle fasce — euristica DETERMINISTICA (scarsità tipo food-delivery),
// non un conteggio reale di prenotazioni: free = Disponibile, low = Quasi pieno,
// full = Al completo (disabilitata). È una label statica, mai dati live.
type Cap = 'free' | 'low' | 'full';
const SLOT_CAP: Record<string, Cap> = {
  'In giornata · 15:00–18:00': 'low',
  'Stasera · 18:00–20:00': 'free',
  'Domani · 9:00–12:00': 'free',
  'Domani · 12:00–15:00': 'full',
  'Domani · 15:00–18:30': 'low',
  'Domani · 18:30–20:00': 'free',
};

const CAP_META: Record<Cap, { label: string; cls: string }> = {
  free: { label: 'Disponibile', cls: 'text-olive-700 bg-olive-50' },
  low: { label: 'Quasi pieno', cls: 'text-accent-700 bg-accent-50' },
  full: { label: 'Al completo', cls: 'text-ink-400 bg-surface-100' },
};

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
};

export function DeliverySlotPicker({
  day,
  onDayChange,
  todayTime,
  onTodayTimeChange,
  tomorrowTime,
  onTomorrowTimeChange,
}: Props) {
  const times = day === 'today' ? TODAY_TIMES : TOMORROW_TIMES;
  const current = day === 'today' ? todayTime : tomorrowTime;
  const onTimeChange = day === 'today' ? onTodayTimeChange : onTomorrowTimeChange;

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
          <div className="flex flex-col gap-2">
            {times.map((t) => {
              const cap = SLOT_CAP[t] ?? 'free';
              const full = cap === 'full';
              const checked = current === t && !full;
              const meta = CAP_META[cap];
              return (
                <label
                  key={t}
                  className={`flex items-center justify-between gap-2.5 rounded-lg border-[1.5px] px-3.5 py-2.5 transition-colors ${
                    full
                      ? 'cursor-not-allowed border-cream-300 bg-surface-50 opacity-60'
                      : checked
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
                      disabled={full}
                      onChange={() => onTimeChange(t)}
                      className="w-4 h-4 accent-primary-600"
                    />
                    {t}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-2xs font-bold ${meta.cls}`}
                  >
                    <span
                      className="inline-block h-1.5 w-1.5 rounded-full bg-current"
                      aria-hidden
                    />
                    {meta.label}
                  </span>
                </label>
              );
            })}
          </div>
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

export const SLOT_DEFAULTS = {
  todayTime: TODAY_TIMES[1], // "Stasera · 18:00–20:00" (Disponibile)
  tomorrowTime: TOMORROW_TIMES[2], // "Domani · 15:00–18:30"
};
