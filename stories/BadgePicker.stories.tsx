import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import BadgePicker from '@/components/seller/BadgePicker';

function Demo({ initial = [] }: { initial?: string[] }) {
  const [value, setValue] = useState<string[]>(initial);
  return (
    <div className="max-w-lg bg-white p-4 rounded-xl border border-cream-300">
      <BadgePicker value={value} onChange={setValue} />
    </div>
  );
}

const meta: Meta<typeof BadgePicker> = {
  title: 'Seller/BadgePicker',
  component: BadgePicker,
  parameters: { layout: 'padded' },
};
export default meta;

type Story = StoryObj<typeof BadgePicker>;

export const Vuoto: Story = { render: () => <Demo /> };
export const AlcuniSelezionati: Story = {
  render: () => <Demo initial={['produzione_propria', 'bio', 'artigianale']} />,
};
export const AlMassimo: Story = {
  render: () => (
    <Demo initial={['produzione_propria', 'consegna_rapida', 'prodotti_locali', 'tradizione', 'bio', 'artigianale']} />
  ),
};
