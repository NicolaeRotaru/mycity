import type { Meta, StoryObj } from '@storybook/react';
import { Breadcrumb } from '@/components/ui/Breadcrumb';

const meta: Meta<typeof Breadcrumb> = {
  title: 'UI/Breadcrumb',
  component: Breadcrumb,
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj<typeof Breadcrumb>;

export const TwoLevels: Story = {
  args: {
    items: [
      { label: 'Home', href: '/' },
      { label: 'Profilo' },
    ],
  },
};

export const ThreeLevels: Story = {
  args: {
    items: [
      { label: 'Home', href: '/' },
      { label: 'Categorie', href: '/categories' },
      { label: 'Alimentari' },
    ],
  },
};

export const DeepHierarchy: Story = {
  args: {
    items: [
      { label: 'Home', href: '/' },
      { label: 'Negozi', href: '/stores' },
      { label: 'Panificio Rossi', href: '/store/abc' },
      { label: 'Pane di Genzano' },
    ],
  },
};
