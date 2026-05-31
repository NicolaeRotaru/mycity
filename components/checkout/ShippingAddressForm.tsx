'use client';

import Link from 'next/link';
import type { ChangeEvent, FormEvent } from 'react';
import { MapPin } from 'lucide-react';
import { Input, Textarea, Select } from '@/components/ui/Field';

/**
 * Form indirizzo di consegna per checkout.
 *
 * Estratto da app/checkout/page.tsx per ridurre il monolite.
 * Riceve form state + handlers come props (controlled component).
 * Usa la primitiva Input/Textarea/Select: label, errori per-campo, aria,
 * autocomplete/inputmode (UX mobile, no zoom iOS).
 */

export type AddressForm = {
  fullName: string;
  address: string;
  city: string;
  zip: string;
  phone: string;
  notes: string;
};

export type SavedAddress = {
  id: string;
  label?: string;
  address: string;
  city: string;
  is_default: boolean;
  // Campi opzionali (presenti quando l'address arriva da user_addresses)
  full_name?: string;
  zip?: string;
  phone?: string;
  notes?: string | null;
  lat?: number | null;
  lng?: number | null;
};

type Props = {
  form: AddressForm;
  savedAddresses: SavedAddress[];
  errors?: Partial<Record<keyof AddressForm, string>>;
  onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  onSubmit: (e: FormEvent) => void;
  onApplySavedAddress: (id: string) => void;
};

export function ShippingAddressForm({
  form,
  savedAddresses,
  errors = {},
  onChange,
  onSubmit,
  onApplySavedAddress,
}: Props) {
  return (
    <div className="bg-white border rounded-xl p-6 space-y-4">
      <h2 className="text-xl font-bold flex items-center gap-2"><MapPin size={20} strokeWidth={2.2} aria-hidden /> Indirizzo di consegna</h2>

      {savedAddresses.length > 0 && (
        <div>
          <Select
            label="Indirizzo salvato"
            onChange={(e) => onApplySavedAddress(e.target.value)}
          >
            {savedAddresses.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label} — {a.address}, {a.city}
                {a.is_default ? ' (predefinito)' : ''}
              </option>
            ))}
          </Select>
          <p className="text-xs text-ink-400 mt-1">
            Oppure modifica i campi sotto.{' '}
            <Link href="/profile/addresses" className="text-primary-700 hover:underline">Gestisci indirizzi</Link>
          </p>
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-4" id="checkout-form">
        <Input
          label="Nome e cognome"
          name="fullName"
          value={form.fullName}
          onChange={onChange}
          placeholder="Es. Luca Bianchi"
          autoComplete="name"
          required
          error={errors.fullName}
        />
        <Input
          label="Indirizzo"
          name="address"
          value={form.address}
          onChange={onChange}
          placeholder="Via Roma 1"
          autoComplete="street-address"
          required
          error={errors.address}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Città"
            name="city"
            value={form.city}
            onChange={onChange}
            autoComplete="address-level2"
            required
            error={errors.city}
          />
          <Input
            label="CAP"
            name="zip"
            value={form.zip}
            onChange={onChange}
            autoComplete="postal-code"
            inputMode="numeric"
            required
            error={errors.zip}
          />
        </div>
        <Input
          label="Telefono"
          name="phone"
          type="tel"
          value={form.phone}
          onChange={onChange}
          placeholder="3331234567"
          autoComplete="tel"
          inputMode="tel"
          required
          error={errors.phone}
          hint="Il rider ti chiamerà se serve per la consegna"
        />
        <Textarea
          label="Note per il rider (opzionale)"
          name="notes"
          value={form.notes}
          onChange={onChange}
          rows={2}
          placeholder="Es. citofono Rossi, suonare al 2° piano…"
          className="resize-none"
        />
      </form>
    </div>
  );
}
