import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import CoverPicker from '@/components/seller/CoverPicker';
import { DEFAULT_COVER } from '@/lib/store-customization';

function Demo({ initial }: { initial?: string }) {
  const [value, setValue] = useState<string | undefined>(initial);
  return (
    <div className="max-w-lg bg-white p-4 rounded-xl border border-cream-300">
      <CoverPicker value={value} onChange={setValue} />
    </div>
  );
}

const meta: Meta<typeof CoverPicker> = {
  title: 'Seller/CoverPicker',
  component: CoverPicker,
  parameters: { layout: 'padded' },
};
export default meta;

type Story = StoryObj<typeof CoverPicker>;

export const Default: Story = { render: () => <Demo initial={DEFAULT_COVER} /> };
export const NessunaSelezione: Story = { render: () => <Demo /> };
