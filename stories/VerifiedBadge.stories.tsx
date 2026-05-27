import type { Meta, StoryObj } from '@storybook/react';
import { VerifiedBadge } from '@/components/ui/VerifiedBadge';

const meta: Meta<typeof VerifiedBadge> = {
  title: 'UI/VerifiedBadge',
  component: VerifiedBadge,
  parameters: { layout: 'centered' },
  argTypes: {
    size: { control: 'select', options: ['sm', 'md', 'lg'] },
    showLabel: { control: 'boolean' },
  },
  args: { size: 'md', showLabel: false },
};

export default meta;
type Story = StoryObj<typeof VerifiedBadge>;

export const IconOnly: Story = {};

export const WithLabel: Story = {
  args: { showLabel: true },
};

export const Small: Story = {
  args: { size: 'sm', showLabel: true },
};

export const Large: Story = {
  args: { size: 'lg', showLabel: true },
};

export const InContext: Story = {
  render: (args) => (
    <div className="bg-white border border-cream-300 rounded-2xl p-5 max-w-sm">
      <h3 className="font-serif font-bold text-lg flex items-center gap-2">
        Panificio Rossi <VerifiedBadge {...args} />
      </h3>
      <p className="text-sm text-ink-500 mt-1">Pane fresco e pasticceria · Piacenza centro</p>
    </div>
  ),
};
