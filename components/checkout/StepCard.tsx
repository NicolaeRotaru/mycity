'use client';

import type { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/Card';

/**
 * StepCard — sezione numerata del checkout (indirizzo → consegna → pagamento).
 *
 * RESKIN: pallino numerato + icona primary + titolo serif, dentro una Card
 * bordata. Pura presentazione; non contiene logica.
 */

type Props = {
  n: number;
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
};

export function StepCard({ n, icon: Icon, title, children }: Props) {
  return (
    <Card variant="bordered" padding="lg">
      <div className="flex items-center gap-2.5 mb-4">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-700 text-sm font-bold text-white">
          {n}
        </span>
        <Icon size={18} className="text-primary-700 shrink-0" aria-hidden />
        <h2 className="font-serif text-lg font-bold text-ink-900">{title}</h2>
      </div>
      {children}
    </Card>
  );
}
