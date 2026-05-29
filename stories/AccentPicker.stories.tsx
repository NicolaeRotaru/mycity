import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import AccentPicker from '@/components/seller/AccentPicker';
import { DEFAULT_ACCENT } from '@/lib/store-customization';

/** Wrapper con stato locale per rendere la story interattiva. */
function Demo({ initial }: { initial?: string }) {
  const [value, setValue] = useState<string | undefined>(initial);
  return (
    <div className="max-w-md bg-white p-4 rounded-xl border border-cream-300">
      <AccentPicker value={value} onChange={setValue} />
    </div>
  );
}

const meta: Meta<typeof AccentPicker> = {
  title: 'Seller/AccentPicker',
  component: AccentPicker,
  parameters: { layout: 'padded' },
};
export default meta;

type Story = StoryObj<typeof AccentPicker>;

export const Default: Story = { render: () => <Demo initial={DEFAULT_ACCENT} /> };
export const NessunaSelezione: Story = { render: () => <Demo /> };
