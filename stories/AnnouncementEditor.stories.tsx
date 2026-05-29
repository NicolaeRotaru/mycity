import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import AnnouncementEditor from '@/components/seller/AnnouncementEditor';
import type { StoreCustomization } from '@/lib/store-customization';

type Announcement = NonNullable<StoreCustomization['announcement']>;

function Demo({ initial }: { initial?: Announcement }) {
  const [value, setValue] = useState<Announcement | undefined>(initial);
  return (
    <div className="max-w-md bg-white p-4 rounded-xl border border-cream-300">
      <AnnouncementEditor value={value} onChange={setValue} />
    </div>
  );
}

const meta: Meta<typeof AnnouncementEditor> = {
  title: 'Seller/AnnouncementEditor',
  component: AnnouncementEditor,
  parameters: { layout: 'padded' },
};
export default meta;

type Story = StoryObj<typeof AnnouncementEditor>;

export const Disattivato: Story = { render: () => <Demo /> };
export const Attivo: Story = {
  render: () => (
    <Demo initial={{ enabled: true, text: 'Chiusi per ferie dal 10 al 20 agosto · Riapriamo con tante novità!', until: '2026-08-20' }} />
  ),
};
