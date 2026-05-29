import type { Meta, StoryObj } from '@storybook/react';
import { Palette } from 'lucide-react';
import CustomizationSection from '@/components/seller/CustomizationSection';

const meta: Meta<typeof CustomizationSection> = {
  title: 'Seller/CustomizationSection',
  component: CustomizationSection,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div className="max-w-lg">{Story()}</div>],
  args: {
    title: 'Aspetto della vetrina',
    description: 'Colore, sfondo cover e slogan',
    icon: <Palette size={18} />,
    children: <p className="text-sm text-ink-600">Contenuto della sezione (controlli di personalizzazione).</p>,
  },
};
export default meta;

type Story = StoryObj<typeof CustomizationSection>;

export const Aperta: Story = { args: { defaultOpen: true } };
export const Chiusa: Story = { args: { defaultOpen: false } };
