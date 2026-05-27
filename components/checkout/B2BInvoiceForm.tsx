'use client';

/**
 * Form opt-in fattura elettronica B2B per checkout.
 *
 * Estratto da app/checkout/page.tsx. Toggle che apre form 4 campi:
 * ragione sociale, P.IVA, SDI (7 char) o PEC.
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

export function B2BInvoiceForm({ active, onToggle, form, onChange }: Props) {
  return (
    <div className="bg-white border rounded-xl p-6">
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => onToggle(e.target.checked)}
          className="mt-1 w-4 h-4 accent-primary-600"
        />
        <div className="flex-1">
          <p className="font-bold text-ink-900">🏢 Sto comprando per la mia azienda — voglio la fattura elettronica</p>
          <p className="text-sm text-ink-600 mt-0.5">
            Inviata via SDI/PEC entro 12 giorni. Detraibilità completa.
          </p>
        </div>
      </label>
      {active && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4 pt-4 border-t border-cream-200">
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-ink-700 mb-1">Ragione sociale *</label>
            <input
              type="text"
              value={form.company_name}
              onChange={(e) => onChange({ ...form, company_name: e.target.value })}
              placeholder="Acme S.r.l."
              className="w-full bg-cream-50 border border-cream-300 rounded-lg px-3 py-2 text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink-700 mb-1">Partita IVA *</label>
            <input
              type="text"
              value={form.vat_number}
              onChange={(e) => onChange({ ...form, vat_number: e.target.value.toUpperCase() })}
              placeholder="IT12345678901"
              pattern="^(IT)?[0-9]{11}$"
              className="w-full bg-cream-50 border border-cream-300 rounded-lg px-3 py-2 text-sm font-mono"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-ink-700 mb-1">Codice SDI (7 caratteri)</label>
            <input
              type="text"
              value={form.sdi_code}
              onChange={(e) => onChange({ ...form, sdi_code: e.target.value.toUpperCase() })}
              placeholder="0000000"
              maxLength={7}
              className="w-full bg-cream-50 border border-cream-300 rounded-lg px-3 py-2 text-sm font-mono"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-ink-700 mb-1">PEC (alternativa a SDI)</label>
            <input
              type="email"
              value={form.pec}
              onChange={(e) => onChange({ ...form, pec: e.target.value })}
              placeholder="azienda@pec.it"
              className="w-full bg-cream-50 border border-cream-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <p className="sm:col-span-2 text-xs text-ink-500">
            Compila SDI <strong>o</strong> PEC. Se nessuno, la fattura va al sistema di interscambio centrale.
          </p>
        </div>
      )}
    </div>
  );
}
