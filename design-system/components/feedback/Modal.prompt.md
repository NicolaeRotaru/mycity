Dialog primitive — slide-up bottom sheet on mobile, centered card on desktop. Locks body scroll, closes on Esc / backdrop. Pass `footer` for actions (compose with `Button`).

```jsx
const [open, setOpen] = React.useState(false);
<Modal open={open} onClose={() => setOpen(false)}
  title="Conferma ordine" description="Paghi alla consegna"
  footer={<>
    <Button variant="secondary" onClick={() => setOpen(false)}>Annulla</Button>
    <Button variant="primary" onClick={() => setOpen(false)}>Conferma</Button>
  </>}>
  Il rider arriva in 24–48h. Tieni pronti €18,90 in contanti.
</Modal>
```

Sizes `sm`/`md`/`lg`/`xl`. Renders through a portal to `document.body`.
