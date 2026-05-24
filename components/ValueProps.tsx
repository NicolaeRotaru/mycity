import { Truck, Banknote, Store, Zap, type LucideIcon } from 'lucide-react';

const PROPS: { Icon: LucideIcon; title: string; subtitle: string }[] = [
  { Icon: Truck,    title: 'Spedizione gratuita',      subtitle: 'sopra €30' },
  { Icon: Banknote, title: 'Pagamento alla consegna',  subtitle: 'in contanti, zero rischi' },
  { Icon: Store,    title: '100% locale',              subtitle: 'venditori della tua città' },
  { Icon: Zap,      title: 'Consegna rapida',          subtitle: 'entro 24-48h' },
];

const ValueProps = () => (
  <div className="bg-white border-y border-gray-100">
    <div className="container mx-auto px-4 py-8 grid grid-cols-2 md:grid-cols-4 gap-6">
      {PROPS.map(({ Icon, title, subtitle }) => (
        <div key={title} className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
            <Icon size={22} strokeWidth={1.75} />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 text-sm leading-tight">{title}</p>
            <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>
          </div>
        </div>
      ))}
    </div>
  </div>
);

export default ValueProps;
