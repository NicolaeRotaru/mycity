import type { Meta, StoryObj } from '@storybook/react';
import { Card } from '@/components/ui/Card';

const meta: Meta<typeof Card> = {
  title: 'UI/Card',
  component: Card,
  parameters: { layout: 'padded' },
  argTypes: {
    variant: { control: 'select', options: ['bordered', 'elevated', 'flat'] },
    padding: { control: 'select', options: ['none', 'sm', 'md', 'lg'] },
  },
  args: {
    children: 'Card content goes here. Mix di testo e altri componenti.',
    variant: 'bordered',
    padding: 'md',
  },
};

export default meta;
type Story = StoryObj<typeof Card>;

export const Bordered: Story = {};

export const Elevated: Story = {
  args: { variant: 'elevated' },
};

export const Flat: Story = {
  args: { variant: 'flat' },
};

export const NoPadding: Story = {
  args: { padding: 'none' },
};

export const LargePadding: Story = {
  args: { padding: 'lg' },
};

export const WithRichContent: Story = {
  args: {
    variant: 'elevated',
    children: (
      <div>
        <h3 className="font-bold text-lg mb-2">Titolo card</h3>
        <p className="text-sm text-ink-600">Descrizione di esempio.</p>
        <button className="mt-3 text-primary-700 font-semibold text-sm">Azione →</button>
      </div>
    ),
  },
};
