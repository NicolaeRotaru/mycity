import { Check } from 'lucide-react';

type Props = {
  status: string;
  createdAt?: string | null;
  acceptedAt?: string | null;
  readyAt?: string | null;
  pickedUpAt?: string | null;
  deliveredAt?: string | null;
  canceledAt?: string | null;
  className?: string;
};

const fmt = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : null;

/**
 * Timeline di avanzamento ordine (stile delivery app): step con check sui
 * completati, step corrente evidenziato, orari reali sotto ogni tappa.
 * Condivisa tra buyer / seller / rider. Gli orari vengono dai timestamp su
 * `orders` (created_at, accepted_at, ready_at, picked_up_at, delivered_at).
 */
export default function OrderTimeline(p: Props) {
  if (p.status === 'CANCELED') {
    return (
      <div className={`flex items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 ${p.className ?? ''}`}>
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-rose-500 text-sm font-bold text-white">✕</span>
        <div>
          <p className="font-semibold text-rose-800">Ordine annullato</p>
          {fmt(p.canceledAt) && <p className="text-xs text-rose-600">{fmt(p.canceledAt)}</p>}
        </div>
      </div>
    );
  }

  const steps: { label: string; at?: string | null }[] = [
    { label: 'Ordine ricevuto', at: p.createdAt },
    { label: 'Accettato dal negozio', at: p.acceptedAt },
    { label: 'Pronto per il ritiro', at: p.readyAt },
    { label: 'Ritirato dal rider', at: p.pickedUpAt },
    { label: 'Consegnato', at: p.deliveredAt },
  ];

  let lastDone = -1;
  steps.forEach((s, i) => { if (s.at) lastDone = i; });
  // Lo step "in corso" è il primo senza orario (es. OUT_FOR_DELIVERY → "Consegnato").
  const activeIdx = Math.min(lastDone + 1, steps.length - 1);

  return (
    <div className={`rounded-2xl border border-cream-300 bg-white p-5 ${p.className ?? ''}`}>
      <ol className="space-y-4">
        {steps.map((s, i) => {
          const done = i <= lastDone;
          const active = !done && i === activeIdx;
          const isLast = i === steps.length - 1;
          return (
            <li key={s.label} className="relative flex items-start gap-3">
              {!isLast && (
                <span
                  aria-hidden
                  className={`absolute left-[11px] top-6 -bottom-4 w-0.5 ${done ? 'bg-olive-400' : 'bg-cream-300'}`}
                />
              )}
              <span
                className={`relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                  done
                    ? 'bg-olive-500 text-white'
                    : active
                      ? 'bg-primary-600 text-white ring-4 ring-primary-100'
                      : 'bg-cream-200 text-ink-400'
                }`}
              >
                {done ? <Check size={14} strokeWidth={3} /> : i + 1}
              </span>
              <div className="min-w-0 pb-0.5">
                <p className={`text-sm font-semibold ${done || active ? 'text-ink-900' : 'text-ink-400'}`}>{s.label}</p>
                {s.at ? (
                  <p className="text-xs text-ink-500">{fmt(s.at)}</p>
                ) : active ? (
                  <p className="text-xs font-medium text-primary-600">In corso…</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
