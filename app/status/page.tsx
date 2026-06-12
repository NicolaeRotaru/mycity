import Link from 'next/link';
import {
  CheckCircle2, AlertCircle, AlertTriangle, MinusCircle,
  Activity, Database, Mail, CreditCard, MessageCircle, Bell, ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { getSystemHealth, type ServiceStatus } from '@/lib/health/checks';

export const metadata = {
  title: 'Stato servizi · MyCity',
  description: 'Stato in tempo reale dei servizi MyCity: marketplace, pagamenti, notifiche, email.',
  alternates: { canonical: '/status' },
  openGraph: {
    title: 'Stato servizi · MyCity',
    description: 'Stato in tempo reale dei servizi MyCity: marketplace, pagamenti, notifiche, email.',
    type: 'website',
    locale: 'it_IT',
    siteName: 'MyCity',
    url: '/status',
  },
};

// Sempre reso fresco: i controlli reali sono comunque messi in cache 60s
// dentro getSystemHealth, quindi gli endpoint esterni non vengono martellati.
export const dynamic = 'force-dynamic';

const STATUS_META: Record<ServiceStatus, { label: string; color: string; bg: string; dot: string; icon: LucideIcon }> = {
  operational: { label: 'Operativo',       color: 'text-olive-700',     bg: 'bg-olive-50 border-olive-300',         dot: 'bg-olive-500',     icon: CheckCircle2 },
  degraded:    { label: 'Rallentato',      color: 'text-accent-700',    bg: 'bg-accent-50 border-accent-300',       dot: 'bg-accent-500',    icon: AlertTriangle },
  outage:      { label: 'Non disponibile', color: 'text-secondary-700', bg: 'bg-secondary-50 border-secondary-300', dot: 'bg-secondary-500', icon: AlertCircle },
  unknown:     { label: 'Non configurato', color: 'text-ink-500',       bg: 'bg-cream-100 border-cream-300',        dot: 'bg-ink-300',       icon: MinusCircle },
};

const OVERALL_HEADLINE: Record<ServiceStatus, string> = {
  operational: 'Tutti i sistemi operativi',
  degraded: 'Alcuni servizi sono rallentati',
  outage: 'Disservizio in corso',
  unknown: 'Stato parzialmente disponibile',
};

const SERVICE_ICON: Record<string, LucideIcon> = {
  web: Activity,
  db: Database,
  auth: ShieldCheck,
  payments: CreditCard,
  realtime: MessageCircle,
  email: Mail,
  push: Bell,
};

export default async function StatusPage() {
  const health = await getSystemHealth();
  const meta = STATUS_META[health.overall];
  const Icon = meta.icon;
  const down = health.services.filter((s) => s.status === 'outage' || s.status === 'degraded');

  return (
    <div className="container mx-auto px-4 sm:px-6 py-12 max-w-3xl space-y-6">
      <div>
        <h1 className="text-3xl font-serif font-bold text-ink-900">Stato dei servizi</h1>
        <p className="text-sm text-ink-500 mt-1">Verifica in tempo reale della piattaforma MyCity</p>
      </div>

      {/* Stato globale */}
      <div className={`rounded-2xl border-2 ${meta.bg} p-6 shadow-warm`}>
        <div className="flex items-center gap-4">
          <Icon size={40} className={meta.color} strokeWidth={2} aria-hidden />
          <div>
            <p className={`text-2xl font-serif font-bold ${meta.color}`}>{OVERALL_HEADLINE[health.overall]}</p>
            <p className="text-sm text-ink-600 mt-1">
              Verificato: {new Date(health.checkedAt).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}
            </p>
          </div>
        </div>
      </div>

      {/* Singoli servizi */}
      <div className="bg-white border border-cream-300 rounded-2xl divide-y divide-cream-200 overflow-hidden shadow-warm">
        {health.services.map((s) => {
          const sMeta = STATUS_META[s.status];
          const SIcon = SERVICE_ICON[s.id] ?? Activity;
          return (
            <div key={s.id} className="p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-cream-100 text-ink-700 flex items-center justify-center shrink-0">
                <SIcon size={20} strokeWidth={2} aria-hidden />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-ink-900">{s.name}</p>
                <p className="text-xs text-ink-500">{s.description}</p>
              </div>
              <div className="text-right shrink-0">
                <p className={`text-sm font-semibold ${sMeta.color} flex items-center gap-1.5 justify-end`}>
                  <span className={`inline-block w-2 h-2 rounded-full ${sMeta.dot}`} aria-hidden />
                  {sMeta.label}
                </p>
                <p className="text-xs text-ink-500">
                  {s.detail ?? (s.latencyMs != null ? `${s.latencyMs} ms` : '—')}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Riepilogo disservizi (derivato dai check reali) */}
      <section>
        <h2 className="font-serif font-bold text-lg text-ink-900 mb-3">Disservizi in corso</h2>
        {down.length === 0 ? (
          <div className="bg-white border border-cream-300 rounded-2xl p-8 text-center">
            <CheckCircle2 size={32} className="mx-auto text-olive-600 mb-2" aria-hidden />
            <p className="text-ink-700 font-medium">Nessun disservizio in corso</p>
          </div>
        ) : (
          <div className="bg-white border border-cream-300 rounded-2xl divide-y divide-cream-200 overflow-hidden">
            {down.map((s) => {
              const sMeta = STATUS_META[s.status];
              return (
                <div key={s.id} className="px-4 py-3 flex items-center justify-between">
                  <p className="text-sm font-medium text-ink-900">{s.name}</p>
                  <span className={`text-sm font-semibold ${sMeta.color}`}>{s.detail ?? sMeta.label}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="text-center text-xs text-ink-400">
        Hai un problema? <Link href="/contact" className="text-primary-700 hover:underline">Contattaci</Link>
      </div>
    </div>
  );
}
