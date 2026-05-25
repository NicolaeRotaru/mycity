import { Truck, Banknote, Store, Zap, type LucideIcon } from 'lucide-react';

const PROPS: { Icon: LucideIcon; title: string; subtitle: string; color: string }[] = [
  { Icon: Truck,    title: 'Spedizione gratuita',      subtitle: 'sopra €30',                color: 'primary' },
  { Icon: Banknote, title: 'Pagamento alla consegna',  subtitle: 'in contanti, zero rischi', color: 'olive'   },
  { Icon: Store,    title: '100% locale',              subtitle: 'venditori della tua città',color: 'accent'  },
  { Icon: Zap,      title: 'Consegna rapida',          subtitle: 'entro 24-48h',             color: 'secondary' },
];

const ValueProps = () => (
  <div className="bg-white border-y border-cream-200">
    <div className="container mx-auto px-4 py-8 grid grid-cols-2 md:grid-cols-4 gap-6">
      {PROPS.map(({ Icon, title, subtitle, color }) => (
        <div key={title} className="flex items-center gap-3">
          <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
            color === 'primary'   ? 'bg-primary-100 text-primary-700' :
            color === 'olive'     ? 'bg-olive-100 text-olive-700' :
            color === 'accent'    ? 'bg-accent-100 text-accent-700' :
                                    'bg-secondary-100 text-secondary-700'
          }`}>
            <Icon size={22} strokeWidth={1.75} />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-ink-900 text-sm leading-tight">{title}</p>
            <p className="text-xs text-ink-500 mt-0.5">{subtitle}</p>
          </div>
        </div>
      ))}
    </div>
  </div>
);

export default ValueProps;
