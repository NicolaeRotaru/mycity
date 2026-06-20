'use client';

import Link from 'next/link';
import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Plus, X } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Input, Textarea } from '@/components/ui/Field';

/**
 * Form indirizzo di consegna per checkout.
 *
 * RESKIN: gli indirizzi salvati sono *tile cliccabili* (+ una tile tratteggiata
 * "aggiungi indirizzo" che apre il form manuale), al posto della vecchia Select.
 *
 * LOGICA INVARIATA: stesso form `#checkout-form` (target del submit della
 * OrderSummary), stessi `name`/handlers dei campi, stesso `onSubmit`,
 * `onChange`, `onApplySavedAddress` ed errori per-campo. Le tile chiamano
 * `onApplySavedAddress` esattamente come faceva la Select.
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
  // UI-only: il form manuale è aperto di default solo senza indirizzi salvati.
  const [editing, setEditing] = useState(savedAddresses.length === 0);

  // Tile attiva = indirizzo salvato i cui campi combaciano col form corrente.
  // Pura derivazione visiva, nessuna logica di stato dell'indirizzo qui.
  const activeId = savedAddresses.find(
    (a) =>
      a.address === form.address &&
      a.city === form.city &&
      (a.full_name ?? '') === form.fullName,
  )?.id;

  const selectTile = (id: string) => {
    onApplySavedAddress(id);
    setEditing(false);
  };

  return (
    <div className="space-y-4">
      {savedAddresses.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {savedAddresses.map((a) => {
            const active = !editing && a.id === activeId;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => selectTile(a.id)}
                aria-pressed={active}
                className={`text-left rounded-xl border-2 p-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1 ${
                  active
                    ? 'border-primary-500 bg-primary-50'
                    : 'border-cream-300 bg-white hover:border-primary-200'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  {a.label && <Badge variant="local">{a.label}</Badge>}
                  {a.is_default && <span className="text-2xs text-ink-400">Predefinito</span>}
                </div>
                {a.full_name && <p className="text-sm font-semibold text-ink-900">{a.full_name}</p>}
                <p className="text-sm text-ink-600">{a.address}, {a.city}</p>
              </button>
            );
          })}

          {/* Tile tratteggiata "aggiungi / inserisci a mano" */}
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            aria-expanded={editing}
            className={`flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed p-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1 ${
              editing
                ? 'border-primary-400 bg-primary-50 text-primary-700'
                : 'border-cream-400 text-primary-700 hover:border-primary-300 hover:bg-primary-50/50'
            }`}
          >
            {editing ? <X size={18} aria-hidden /> : <Plus size={18} aria-hidden />}
            {editing ? 'Chiudi' : 'Inserisci nuovo indirizzo'}
          </button>
        </div>
      )}

      {savedAddresses.length > 0 && (
        <p className="text-xs text-ink-400">
          <Link href="/profile/addresses" className="text-primary-700 hover:underline">Gestisci indirizzi</Link>
        </p>
      )}

      {/* Il form resta SEMPRE montato (è il target di submit della OrderSummary);
          su mobile/desktop lo nascondiamo visivamente quando si usa una tile. */}
      <form onSubmit={onSubmit} className={`space-y-4 ${editing ? '' : 'hidden'}`} id="checkout-form">
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
