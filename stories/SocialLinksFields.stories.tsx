import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import SocialLinksFields from '@/components/seller/SocialLinksFields';
import type { StoreCustomization } from '@/lib/store-customization';

type Socials = NonNullable<StoreCustomization['socials']>;

function Demo({ initial = {} }: { initial?: Socials }) {
  const [value, setValue] = useState<Socials>(initial);
  return (
    <div className="max-w-md bg-white p-4 rounded-xl border border-cream-300">
      <SocialLinksFields value={value} onChange={setValue} />
    </div>
  );
}

const meta: Meta<typeof SocialLinksFields> = {
  title: 'Seller/SocialLinksFields',
  component: SocialLinksFields,
  parameters: { layout: 'padded' },
};
export default meta;

type Story = StoryObj<typeof SocialLinksFields>;

export const Vuoto: Story = { render: () => <Demo /> };
export const Compilato: Story = {
  render: () => (
    <Demo
      initial={{
        instagram: 'panificiorossi',
        facebook: 'panificiorossi',
        tiktok: 'panificiorossi',
        whatsapp: '+39 333 1234567',
        website: 'https://panificiorossi.it',
      }}
    />
  ),
};
