'use client';

import { Building2 } from 'lucide-react';
import { Input, Checkbox } from '@/components/ui/Field';

/**
 * Form opt-in fattura elettronica B2B per checkout.
 *
 * Estratto da app/checkout/page.tsx. Toggle che apre form 4 campi:
 * ragione sociale, P.IVA, SDI (7 char) o PEC. Usa la primitiva (Checkbox + Input)
 * con validazione P.IVA in tempo reale.
 */

export type B2BForm = {
  company_name: string;
  vat_number: string;
  sdi_code: string;
  pec: string;
};

type Props = {
  active: boolean;
  onToggle: (active: boolean) => void;
  form: B2BForm;
  onChange: (form: B2BForm) => void;
};

const VAT_RE = /^(IT)?[0-9]{11}$/;

export function B2BInvoiceForm({ active, onToggle, form, onChange }: Props) {
  const vat = form.vat_number.trim().toUpperCase();
  const vatError = active && vat && !VAT_RE.test(vat)
    ? 'Partita IVA non valida (11 cifre, con o senza "IT")'
    : undefined;

  return (
    <div className="bg-white border rounded-xl p-6">
      <Checkbox
        checked={active}
        onChange={(e) => onToggle(e.target.checked)}
        label={
          <span className="block">
            <span className="flex items-center gap-2 font-bold text-ink-900"><Building2 size={16} className="shrink-0" aria-hidden /> Sto comprando per la mia azienda — voglio la fattura elettronica</span>
            <span className="block text-ink-600 mt-0.5">Inviata via SDI/PEC entro 12 giorni. Detraibilità completa.</span>
          </span>
        }
      />
      {active && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4 pt-4 border-t border-cream-200">
          <Input
            containerClassName="sm:col-span-2"
            label="Ragione sociale"
            required
            value={form.company_name}
            onChange={(e) => onChange({ ...form, company_name: e.target.value })}
            placeholder="Acme S.r.l."
          />
          <Input
            label="Partita IVA"
            required
            value={form.vat_number}
            onChange={(e) => onChange({ ...form, vat_number: e.target.value.toUpperCase() })}
            placeholder="IT12345678901"
            className="font-mono"
            error={vatError}
          />
          <Input
            label="Codice SDI (7 caratteri)"
            value={form.sdi_code}
            onChange={(e) => onChange({ ...form, sdi_code: e.target.value.toUpperCase() })}
            placeholder="0000000"
            maxLength={7}
            className="font-mono"
          />
          <Input
            containerClassName="sm:col-span-2"
            label="PEC (alternativa a SDI)"
            type="email"
            value={form.pec}
            onChange={(e) => onChange({ ...form, pec: e.target.value })}
            placeholder="azienda@pec.it"
          />
          <p className="sm:col-span-2 text-xs text-ink-500">
            Compila SDI <strong>o</strong> PEC. Se nessuno, la fattura va al sistema di interscambio centrale.
          </p>
        </div>
      )}
    </div>
  );
}
