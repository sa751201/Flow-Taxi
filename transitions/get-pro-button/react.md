# Get Pro button — React (Pro)

`<GetProButton>` — the rim-glow upgrade CTA as a component. The effect is pure CSS
(seven drifting SVG gradient washes + a hue cycle on one masked pseudo-element), so the
component is a thin wrapper; pair it with the CSS variant's styles and tokens
(identical class names).

```jsx
export function GetProButton({
  children = "Get Pro",
  strength,
  hueDur,
  driftDur,
  className,
  ...props
}) {
  const style = {};
  if (strength !== undefined) style["--probtn-strength"] = strength;
  if (hueDur) style["--probtn-hue-dur"] = hueDur;
  if (driftDur) style["--probtn-drift-dur"] = driftDur;
  return (
    <button
      type="button"
      className={"t-pro-btn" + (className ? " " + className : "")}
      style={style}
      {...props}
    >
      {/* The label span is required: it lifts the text above the wash. */}
      <span className="t-pro-btn-label">{children}</span>
    </button>
  );
}
```

## Usage

```jsx
<GetProButton onClick={openCheckout} />

// Quieter, slower — e.g. inside a dense settings page:
<GetProButton strength={0.45} driftDur="8000ms" onClick={openCheckout}>
  Upgrade
</GetProButton>
```

The wash lives entirely in `::before`, so the button behaves like any other button —
add icons next to the label span, restyle the pill chrome via `className`, attach
whatever handlers you need through the prop spread.

## Notes

- **No state, no effects.** Nothing here needs JavaScript at runtime; the component
  only forwards props and optionally pins the per-instance tokens inline.
- Keep children to a word or two — the mask's clean core is sized for a compact label,
  and a long line would run into the rim glow.
- Don't give the button a non-white background without revisiting `--probtn-strength`:
  the wash is tuned to read against white.

## Reduced motion

The CSS variant's guard is required — the wash freezes on its first frame, which still
reads as a premium rim glow:

```css
@media (prefers-reduced-motion: reduce) {
  .t-pro-btn::before { animation: none; }
}
```
