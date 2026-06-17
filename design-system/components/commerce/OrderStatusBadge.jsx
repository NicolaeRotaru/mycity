import React from 'react';

/**
 * MyCity OrderStatusBadge — status pill for the buyer/seller/rider order flow.
 * Tinted background + ring + Lucide icon, one source of truth for 8 states.
 */
const STATUS = {
  NEW:              { label: 'In attesa di conferma', icon: 'clock',         color: 'var(--status-new)',       bg: '#FFFBEB' },
  ACCEPTED:         { label: 'In preparazione',        icon: 'chef-hat',      color: 'var(--status-accepted)',  bg: '#EFF6FF' },
  READY:            { label: 'Pronto per il pickup',   icon: 'package',       color: 'var(--status-ready)',     bg: '#F5F3FF' },
  ASSIGNED:         { label: 'Rider in arrivo',        icon: 'bike',          color: 'var(--status-assigned)',  bg: '#EEF2FF' },
  PICKED_UP:        { label: 'Ritirato dal negozio',   icon: 'hand',          color: 'var(--status-pickedup)',  bg: '#ECFEFF' },
  OUT_FOR_DELIVERY: { label: 'In consegna',            icon: 'truck',         color: 'var(--status-delivery)',  bg: '#FAF5FF' },
  DELIVERED:        { label: 'Consegnato',             icon: 'check-circle-2',color: 'var(--status-delivered)', bg: '#ECFDF5' },
  CANCELED:         { label: 'Annullato',              icon: 'x-circle',      color: 'var(--status-canceled)',  bg: '#FFF1F2' },
};

const SIZES = { sm: { fontSize: '12px', padding: '3px 10px', gap: '5px', icon: 12 }, md: { fontSize: '14px', padding: '6px 12px', gap: '6px', icon: 14 } };

export function OrderStatusBadge({ status = 'NEW', size = 'md', variant = 'pill', style }) {
  const s = STATUS[status] || STATUS.NEW;
  const z = SIZES[size] || SIZES.md;
  const iconEl = <i data-lucide={s.icon} ref={(el) => { if (el && window.lucide) try { window.lucide.createIcons({ attrs: { width: z.icon, height: z.icon, 'stroke-width': 2.2 } }); } catch (e) {} }} style={{ width: z.icon, height: z.icon, display: 'inline-flex' }} />;

  if (variant === 'icon-only') return <span style={{ color: s.color, display: 'inline-flex' }} aria-label={s.label}>{iconEl}</span>;
  if (variant === 'inline') return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: z.gap, color: s.color, fontFamily: 'var(--font-sans)', fontSize: z.fontSize, fontWeight: 500 }}>{iconEl}{s.label}</span>
  );
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: z.gap,
      fontFamily: 'var(--font-sans)', fontSize: z.fontSize, fontWeight: 500,
      color: s.color, background: s.bg, padding: z.padding,
      borderRadius: 'var(--radius-full)', boxShadow: 'inset 0 0 0 1px currentColor',
      ...style,
    }}>{iconEl}{s.label}</span>
  );
}
