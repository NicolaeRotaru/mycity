import { cn } from '@/lib/cn';

/**
 * SellerPageTitle — header condiviso delle pagine venditore.
 *
 * Design language (design-system/ui_kits/seller/src/00-ui.txt → PageTitle):
 * eyebrow uppercase + barretta gradient verticale + titolo serif + sub
 * opzionale + slot azione opzionale allineato a destra. Brand token only.
 */
type Props = {
  /** Sopratitolo in maiuscolo (es. "Catalogo"). */
  eyebrow?: string;
  /** Titolo serif principale. */
  title: string;
  /** Sottotitolo descrittivo opzionale. */
  sub?: string;
  /** Slot azione (bottoni) allineato a destra. */
  action?: React.ReactNode;
  className?: string;
};

export default function SellerPageTitle({ eyebrow, title, sub, action, className }: Props) {
  return (
    <div
      className={cn(
        'mb-6 flex flex-wrap items-end justify-between gap-4',
        className,
      )}
    >
      <div className="flex items-stretch gap-3.5">
        <span
          aria-hidden
          className="w-1 shrink-0 rounded-full bg-gradient-to-b from-primary-500 to-secondary-600"
        />
        <div className="min-w-0">
          {eyebrow && (
            <p className="mb-1 text-xs font-bold uppercase tracking-[0.06em] text-primary-700">
              {eyebrow}
            </p>
          )}
          <h1 className="font-serif text-[30px] font-extrabold leading-[1.1] tracking-[-0.01em] text-ink-900">
            {title}
          </h1>
          {sub && <p className="mt-1.5 text-sm leading-relaxed text-ink-500">{sub}</p>}
        </div>
      </div>
      {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
    </div>
  );
}
