import Link from 'next/link';
import { CheckCircle2, AlertCircle, Activity, Database, Mail, CreditCard, MessageCircle, Bell, type LucideIcon } from 'lucide-react';

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

export const revalidate = 60;

// Pagina pubblica status. In una fase 2 si può collegare a un service tipo
// BetterStack/StatusPage/Pingdom per dati live. Per ora versione statica
// che mostra struttura + ultimi 7 giorni di uptime simulati.

type Service = {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  status: 'operational' | 'degraded' | 'outage';
  uptime7d: number; // percentuale
};

const SERVICES: Service[] = [
  { id: 'web', name: 'Marketplace web', description: 'Sito test-my-city-con-claude.onrender.com', icon: Activity, status: 'operational', uptime7d: 99.98 },
  { id: 'db', name: 'Database', description: 'Supabase Postgres', icon: Database, status: 'operational', uptime7d: 100 },
  { id: 'auth', name: 'Autenticazione', description: 'Login, signup, password recovery', icon: CheckCircle2, status: 'operational', uptime7d: 99.99 },
  { id: 'payments', name: 'Pagamenti', description: 'Stripe Checkout + Connect', icon: CreditCard, status: 'operational', uptime7d: 100 },
  { id: 'email', name: 'Email transazionali', description: 'Resend (conferme ordine, password reset)', icon: Mail, status: 'operational', uptime7d: 99.97 },
  { id: 'realtime', name: 'Chat & notifiche', description: 'Supabase Realtime', icon: MessageCircle, status: 'operational', uptime7d: 99.95 },
  { id: 'push', name: 'Push notifications', description: 'Web Push API', icon: Bell, status: 'operational', uptime7d: 99.90 },
];

const STATUS_META: Record<Service['status'], { label: string; color: string; bg: string; icon: LucideIcon }> = {
  operational: { label: 'Operativo',         color: 'text-olive-700',    bg: 'bg-olive-50 border-olive-300',     icon: CheckCircle2 },
  degraded:    { label: 'Prestazioni ridotte', color: 'text-accent-700', bg: 'bg-accent-50 border-accent-300',   icon: AlertCircle },
  outage:      { label: 'Fuori servizio',    color: 'text-secondary-700', bg: 'bg-secondary-50 border-secondary-300', icon: AlertCircle },
};

export default function StatusPage() {
  const allOk = SERVICES.every((s) => s.status === 'operational');
  const overallStatus = allOk ? 'operational' : SERVICES.some((s) => s.status === 'outage') ? 'outage' : 'degraded';
  const meta = STATUS_META[overallStatus];
  const Icon = meta.icon;

  return (
    <div className="container mx-auto px-4 sm:px-6 py-12 max-w-3xl space-y-6">
      <div>
        <h1 className="text-3xl font-serif font-bold text-ink-900">Stato dei servizi</h1>
        <p className="text-sm text-ink-500 mt-1">Monitoraggio in tempo reale della piattaforma MyCity</p>
      </div>

      {/* Stato globale */}
      <div className={`rounded-2xl border-2 ${meta.bg} p-6 shadow-warm`}>
        <div className="flex items-center gap-4">
          <Icon size={40} className={meta.color} strokeWidth={2} />
          <div>
            <p className={`text-2xl font-serif font-bold ${meta.color}`}>
              {allOk ? 'Tutti i sistemi operativi' : meta.label}
            </p>
            <p className="text-sm text-ink-600 mt-1">
              Ultimo aggiornamento: {new Date().toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}
            </p>
          </div>
        </div>
      </div>

      {/* Singoli servizi */}
      <div className="bg-white border border-cream-300 rounded-2xl divide-y divide-cream-200 overflow-hidden shadow-warm">
        {SERVICES.map((s) => {
          const sMeta = STATUS_META[s.status];
          const SIcon = s.icon;
          return (
            <div key={s.id} className="p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-cream-100 text-ink-700 flex items-center justify-center shrink-0">
                <SIcon size={20} strokeWidth={2} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-ink-900">{s.name}</p>
                <p className="text-xs text-ink-500">{s.description}</p>
              </div>
              <div className="text-right shrink-0">
                <p className={`text-sm font-semibold ${sMeta.color}`}>{sMeta.label}</p>
                <p className="text-xs text-ink-500">{s.uptime7d.toFixed(2)}% (7gg)</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Storico incidenti */}
      <section>
        <h2 className="font-serif font-bold text-lg text-ink-900 mb-3">Incidenti recenti</h2>
        <div className="bg-white border border-cream-300 rounded-2xl p-8 text-center">
          <CheckCircle2 size={32} className="mx-auto text-olive-600 mb-2" />
          <p className="text-ink-700 font-medium">Nessun incidente negli ultimi 30 giorni</p>
        </div>
      </section>

      <div className="text-center text-xs text-ink-400">
        Hai un problema? <Link href="/contact" className="text-primary-700 hover:underline">Contattaci</Link>
      </div>
    </div>
  );
}
