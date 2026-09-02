# Get Pro button (Pro)

## When to use

An upgrade CTA that carries the brand's living gradient without shouting: a plain white
pill whose **rim** glows with the Pro colour system — seven rotated radial washes
(blue / magenta / orange / green / teal) drifting around the perimeter while a full hue
rotation cycles the palette. A radial mask clears the middle of the pill, so the label
sits on clean white and the colour reads as atmosphere creeping in from the edges rather
than a gradient fill. Use it for "Get Pro" / "Upgrade" buttons, pricing-page CTAs —
anywhere one button should feel premium next to ordinary ones.

This is the same seven-layer system as the *Pro gradient text* recipe, minus its grey
base ramp (the pill supplies the body), plus a soft blur so the blobs read as washes
rather than shapes, and the whole overlay held down at `--probtn-strength`.

Everything animates on the compositor (`background-position` + `filter` on one small
pseudo-element); there is no JavaScript at all.

## HTML usage

```html
<button type="button" class="t-pro-btn">
  <span class="t-pro-btn-label">Get Pro</span>
</button>
```

The label span is required: it lifts the text above the wash (`z-index: 1`). Everything
else about the pill — height, padding, typography, shadow — is ordinary button styling
you can swap for your own; the effect lives entirely in `::before`.

## Tunable variables

| Variable | Default | Notes |
| --- | --- | --- |
| `--probtn-strength` | `0.7` | overall wash opacity — can run high, the mask protects the label |
| `--probtn-core` | `50%` | radius of the clean centre (of the mask ellipse) |
| `--probtn-core-blur` | `150%` | width of the ramp from clean core to full wash — the softness of the core's edge |
| `--probtn-blur` | `6px` | blob blur: higher = atmosphere, lower = visible shapes |
| `--probtn-hue-dur` | `4000ms` | one full hue-rotate cycle (seamless loop) |
| `--probtn-drift-dur` | `5000ms` | one full lap of the washes around the pill |

```css
:root {
  --probtn-strength:  0.7;
  --probtn-core:      50%;
  --probtn-core-blur: 150%;
  --probtn-blur:      6px;
  --probtn-hue-dur:   4000ms;
  --probtn-drift-dur: 5000ms;
}
```

## CSS

```css
/* The pill: plain white button chrome. Only `position: relative` and
   `overflow: hidden` matter to the effect — restyle the rest freely. */
.t-pro-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 18px;
  border: 0;
  cursor: pointer;
  background: #fff;
  border-radius: 50px;
  overflow: hidden;
  font-weight: 500;
  font-size: 13px;
  line-height: 1.4;
  color: #0f0f0f;
  white-space: nowrap;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  box-shadow:
    0 1px 3px 0 rgba(0, 0, 0, 0.04),
    inset 0 0 0 1px rgba(0, 0, 0, 0.06),
    inset 0 -1px 0 0 rgba(0, 0, 0, 0.1),
    inset 0 0 0 1px rgba(196, 196, 196, 0.1);
}

/* The wash. Seven Figma radial gradients preserved as inline-SVG
   layers (their rotated ellipses can't be expressed with CSS
   radial-gradient()), blown up to 180% so the blobs sweep
   corner-to-corner as they orbit. */
.t-pro-btn::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  background-image:
    url("data:image/svg+xml;utf8,<svg viewBox='0 0 67 42' xmlns='http://www.w3.org/2000/svg' preserveAspectRatio='none'><rect x='0' y='0' height='100%' width='100%' fill='url(%23grad)' opacity='0.88'/><defs><radialGradient id='grad' gradientUnits='userSpaceOnUse' cx='0' cy='0' r='10' gradientTransform='matrix(0.34726 -1.3118e-7 8.6482e-7 0.89585 33.5 21)'><stop stop-color='rgba(0,110,245,1)' offset='0'/><stop stop-color='rgba(0,110,245,0)' offset='1'/></radialGradient></defs></svg>"),
    url("data:image/svg+xml;utf8,<svg viewBox='0 0 67 42' xmlns='http://www.w3.org/2000/svg' preserveAspectRatio='none'><rect x='0' y='0' height='100%' width='100%' fill='url(%23grad)' opacity='0.5'/><defs><radialGradient id='grad' gradientUnits='userSpaceOnUse' cx='0' cy='0' r='10' gradientTransform='matrix(-1.3 0.25 -1.2633 -2.7471 33.5 21)'><stop stop-color='rgba(0,110,245,1)' offset='0'/><stop stop-color='rgba(0,110,245,0)' offset='1'/></radialGradient></defs></svg>"),
    url("data:image/svg+xml;utf8,<svg viewBox='0 0 67 42' xmlns='http://www.w3.org/2000/svg' preserveAspectRatio='none'><rect x='0' y='0' height='100%' width='100%' fill='url(%23grad)' opacity='0.4'/><defs><radialGradient id='grad' gradientUnits='userSpaceOnUse' cx='0' cy='0' r='10' gradientTransform='matrix(1.05 -0.8 0.46018 3.6184 33.5 21)'><stop stop-color='rgba(204,0,167,1)' offset='0'/><stop stop-color='rgba(170,0,204,0)' offset='0.71709'/></radialGradient></defs></svg>"),
    url("data:image/svg+xml;utf8,<svg viewBox='0 0 67 42' xmlns='http://www.w3.org/2000/svg' preserveAspectRatio='none'><rect x='0' y='0' height='100%' width='100%' fill='url(%23grad)'/><defs><radialGradient id='grad' gradientUnits='userSpaceOnUse' cx='0' cy='0' r='10' gradientTransform='matrix(-0.51067 -3.3275e-16 -4.3352e-14 -1.1396 33.5 21)'><stop stop-color='rgba(204,0,167,1)' offset='0'/><stop stop-color='rgba(170,0,204,0)' offset='1'/></radialGradient></defs></svg>"),
    url("data:image/svg+xml;utf8,<svg viewBox='0 0 67 42' xmlns='http://www.w3.org/2000/svg' preserveAspectRatio='none'><rect x='0' y='0' height='100%' width='100%' fill='url(%23grad)'/><defs><radialGradient id='grad' gradientUnits='userSpaceOnUse' cx='0' cy='0' r='10' gradientTransform='matrix(-0.45 -0.75 1.9052 -0.7091 33.5 21)'><stop stop-color='rgba(255,173,85,1)' offset='0'/><stop stop-color='rgba(255,173,85,0)' offset='1'/></radialGradient></defs></svg>"),
    url("data:image/svg+xml;utf8,<svg viewBox='0 0 67 42' xmlns='http://www.w3.org/2000/svg' preserveAspectRatio='none'><rect x='0' y='0' height='100%' width='100%' fill='url(%23grad)'/><defs><radialGradient id='grad' gradientUnits='userSpaceOnUse' cx='0' cy='0' r='10' gradientTransform='matrix(1.25 -0.35 -0.4013 3.5959 33.5 21)'><stop stop-color='rgba(0,204,68,1)' offset='0'/><stop stop-color='rgba(0,196,102,0.75)' offset='0.25'/><stop stop-color='rgba(0,187,136,0.5)' offset='0.5'/><stop stop-color='rgba(0,170,204,0)' offset='1'/></radialGradient></defs></svg>"),
    url("data:image/svg+xml;utf8,<svg viewBox='0 0 67 42' xmlns='http://www.w3.org/2000/svg' preserveAspectRatio='none'><rect x='0' y='0' height='100%' width='100%' fill='url(%23grad)'/><defs><radialGradient id='grad' gradientUnits='userSpaceOnUse' cx='0' cy='0' r='10' gradientTransform='matrix(-0.87391 0.73043 -4.1482 -1.9503 33.5 21)'><stop stop-color='rgba(0,170,204,1)' offset='0'/><stop stop-color='rgba(0,170,204,0)' offset='1'/></radialGradient></defs></svg>");
  background-size: 180% 180%, 180% 180%, 180% 180%, 180% 180%,
                   180% 180%, 180% 180%, 180% 180%;
  background-repeat: no-repeat;
  /* Rim-only wash: the mask clears the centre so the label sits on
     clean white and the colour reads as a glow creeping in from the
     edges. The ellipse is deliberately smaller than the pill (46%)
     so full opacity is reached INSIDE the border — sizing it past
     the edge would clip the opaque end of the ramp and leave the
     whole wash near-invisible. */
  -webkit-mask-image: radial-gradient(
    ellipse 46% 46% at 50% 50%,
    transparent var(--probtn-core),
    black calc(var(--probtn-core) + var(--probtn-core-blur))
  );
  mask-image: radial-gradient(
    ellipse 46% 46% at 50% 50%,
    transparent var(--probtn-core),
    black calc(var(--probtn-core) + var(--probtn-core-blur))
  );
  opacity: var(--probtn-strength);
  animation:
    t-pro-btn-hue var(--probtn-hue-dur) linear infinite,
    t-pro-btn-drift var(--probtn-drift-dur) ease-in-out infinite;
}

/* The label rides above the wash. */
.t-pro-btn-label {
  position: relative;
  z-index: 1;
}

/* Full hue cycle — ends where it starts, so the loop is seamless.
   The saturate boost keeps the washes punchy at the 180% blow-up;
   the blur turns blobs into atmosphere. Compositor-only. */
@keyframes t-pro-btn-hue {
  from { filter: hue-rotate(0deg) saturate(1.3) blur(var(--probtn-blur)); }
  to   { filter: hue-rotate(-360deg) saturate(1.3) blur(var(--probtn-blur)); }
}
/* Blob travel — the same perimeter orbit as the Pro gradient text,
   minus its static grey-ramp layer: each blob is pinned to the ring
   of edge stops TL,T,TR,R,BR,B,BL,L and advances two ring stops per
   keyframe — a full lap around the pill per cycle, so colour hugs
   and travels the rim while the mask keeps the middle clean. */
@keyframes t-pro-btn-drift {
  0%, 100% {
    background-position:
      100% 0%, 0% 50%, 100% 50%, 0% 100%,
      0% 0%, 50% 0%, 50% 100%;
  }
  25% {
    background-position:
      100% 100%, 50% 0%, 50% 100%, 0% 0%,
      100% 0%, 100% 50%, 0% 50%;
  }
  50% {
    background-position:
      0% 100%, 100% 0%, 0% 100%, 100% 0%,
      100% 100%, 100% 100%, 0% 0%;
  }
  75% {
    background-position:
      0% 0%, 100% 100%, 0% 0%, 100% 100%,
      50% 100%, 0% 100%, 100% 50%;
  }
}

/* Reduced motion — required: the wash freezes on its first frame,
   which still reads as a premium rim glow. */
@media (prefers-reduced-motion: reduce) {
  .t-pro-btn::before { animation: none; }
}
```

## JavaScript

None. The whole effect is one animated pseudo-element.

## Notes

- **Why inline-SVG layers:** each wash is a Figma radial gradient with a rotation +
  non-uniform scale (`gradientTransform`). CSS `radial-gradient()` has no rotation, so
  the layers are kept as data-URI SVGs — identical bytes to the design, not re-derived.
- **The mask is a gradient, not a blur.** The soft edge of the clean core comes from the
  `--probtn-core-blur` ramp inside the mask gradient; actually blurring the mask would
  cost a filter pass on every frame of the drift.
- `--probtn-strength` can sit surprisingly high (0.7 by default) precisely because the
  mask keeps the label's backdrop clean — lower it for a whisper, raise it for a halo.
- Both animations are compositor-only (`background-position`, `filter`) on one
  button-sized pseudo-element — no layout, no paint churn.
- The reduced-motion guard above is required: under `prefers-reduced-motion` the wash
  holds its first frame — still colourful, no longer moving.
