import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import StoreHoursEditor from '@/components/seller/StoreHoursEditor';
import type { StoreHours } from '@/lib/store-hours';

const SETTIMANA_TIPO: StoreHours = {
  mon: [['09:00', '13:00'], ['15:30', '19:30']],
  tue: [['09:00', '13:00'], ['15:30', '19:30']],
  wed: [['09:00', '13:00']],
  thu: [['09:00', '13:00'], ['15:30', '19:30']],
  fri: [['09:00', '13:00'], ['15:30', '19:30']],
  sat: [['09:00', '13:00']],
  sun: [],
};

function Demo({ initial = {} }: { initial?: StoreHours }) {
  const [value, setValue] = useState<StoreHours>(initial);
  return (
    <div className="max-w-xl bg-white p-4 rounded-xl border border-cream-300">
      <StoreHoursEditor value={value} onChange={setValue} />
    </div>
  );
}

const meta: Meta<typeof StoreHoursEditor> = {
  title: 'Seller/StoreHoursEditor',
  component: StoreHoursEditor,
  parameters: { layout: 'padded' },
};
export default meta;

type Story = StoryObj<typeof StoreHoursEditor>;

export const Vuoto: Story = { render: () => <Demo /> };
export const SettimanaTipo: Story = { render: () => <Demo initial={SETTIMANA_TIPO} /> };
