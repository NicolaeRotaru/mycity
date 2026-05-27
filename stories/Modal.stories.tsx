import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';

const meta: Meta<typeof Modal> = {
  title: 'UI/Modal',
  component: Modal,
  parameters: { layout: 'centered' },
};

export default meta;
type Story = StoryObj<typeof Modal>;

function ModalDemo({ size = 'md' as 'sm' | 'md' | 'lg' | 'xl', withFooter = false, description = '' }) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        onClick={() => setOpen(true)}
        className="bg-primary-700 hover:bg-primary-800 text-white px-4 py-2 rounded-lg font-semibold"
      >
        Apri modal
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Conferma azione"
        description={description}
        size={size}
        footer={
          withFooter ? (
            <div className="flex gap-2 justify-end">
              <button onClick={() => setOpen(false)} className="px-4 py-2 border border-cream-300 rounded-lg text-sm">
                Annulla
              </button>
              <button onClick={() => setOpen(false)} className="px-4 py-2 bg-primary-700 text-white rounded-lg text-sm font-semibold">
                Conferma
              </button>
            </div>
          ) : undefined
        }
      >
        <p className="text-sm text-ink-700">
          Sei sicuro di voler procedere? Questa azione non è reversibile.
        </p>
      </Modal>
    </div>
  );
}

export const Default: Story = {
  render: () => <ModalDemo />,
};

export const WithDescription: Story = {
  render: () => <ModalDemo description="Una descrizione che aiuta l'utente a capire il contesto." />,
};

export const WithFooter: Story = {
  render: () => <ModalDemo withFooter />,
};

export const Small: Story = {
  render: () => <ModalDemo size="sm" />,
};

export const Large: Story = {
  render: () => <ModalDemo size="lg" withFooter />,
};
