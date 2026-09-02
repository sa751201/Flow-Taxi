# Image generation placeholder (Pro)

## When to use

A placeholder card for **AI image generation** (or any slow image fetch) that earns its
wait: at rest the card shows a frozen field of dots, while generating every dot breathes
in and out of existence on its own randomized clock, and when the result arrives the
whole field blurs away as the finished image cross-fades in. The field reads as shifting
generation noise — no two moments alike, nothing sweeping — which is exactly the texture
of "the model is thinking".

Three states, all class-driven on the card:

1. **Idle** — no class. The field is static, but NOT uniform: each dot holds the exact
   opacity/scale its twinkle would have at its own phase, so the card is a *frozen frame*
   of the loader rather than a solid grid.
2. **`.is-loading`** — every dot runs the twinkle keyframe on its own baked tempo
   (`--k`) and phase (`--delay`). Because the delays are negative, the field is already
   mid-shimmer on the first frame — it wakes up, it doesn't start up.
3. **`.is-revealed`** — the dot field fades out through a small blur while the image
   fades in from the same blur; the two surfaces cross through each other.

JS builds the lattice once (positions, tempo, phase, and the frozen-frame value are baked
per dot) and flips the two classes. Everything that moves is CSS.

## HTML usage

```html
<div class="t-imgen" id="imgen">
  <span class="t-imgen-field" aria-hidden="true"></span>
  <img class="t-imgen-img" src="finished.jpg" alt="Generated image" />
</div>
```

The card is square (the demo uses 142×142); the builder derives the grid from the
field's rendered width, so any size works — just keep width and height equal. Set the
`<img>` src whenever you like; it stays invisible until `.is-revealed`.

## Tunable variables

| Variable | Default | Notes |
| --- | --- | --- |
| `--imgen-cycle` | `1400ms` | base breath cycle — scales every dot's tempo **live** |
| `--imgen-spread` | `0.1` | per-dot tempo lands in [1 − spread, 1 + spread] × cycle (baked at build) |
| `--imgen-phase` | `6000ms` | span of the random per-dot phase offsets (baked at build) |
| `--imgen-dot` | `1.5px` | dot diameter |
| `--imgen-pitch` | `5px` | lattice pitch — distance between dot centres (baked at build) |
| `--imgen-scale-min` | `0` | dot scale at the bottom of the breath |
| `--imgen-peak` | `1` | dot opacity at the top of the breath |
| `--imgen-dot-color` | `rgba(0, 0, 0, 0.28)` | dot ink |
| `--imgen-reveal-dur` | `650ms` | dot-field / image cross-fade |
| `--imgen-reveal-blur` | `3px` | blur each surface crosses during the reveal |
| `--imgen-ease` | `ease-in-out` | twinkle curve (symmetric in/out reads as breathing) |
| `--imgen-reveal-ease` | `cubic-bezier(0.22, 1, 0.36, 1)` | reveal curve |

Changing `--imgen-pitch`, `--imgen-spread`, or `--imgen-phase` requires a rebuild
(`build()` below) — those three are baked into each dot. Everything else is a live CSS
variable.

```css
:root {
  --imgen-dot:         1.5px;
  --imgen-pitch:       5px;
  --imgen-dot-color:   rgba(0, 0, 0, 0.28);
  --imgen-cycle:       1400ms;
  --imgen-spread:      0.1;
  --imgen-phase:       6000ms;
  --imgen-scale-min:   0;
  --imgen-peak:        1;
  --imgen-ease:        ease-in-out;
  --imgen-reveal-dur:  650ms;
  --imgen-reveal-blur: 3px;
  --imgen-reveal-ease: cubic-bezier(0.22, 1, 0.36, 1);
}
```

## CSS

```css
/* The card owns both surfaces — the dot field and the finished
   image — so the reveal is a true cross-fade through a shared blur. */
.t-imgen {
  position: relative;
  width: 142px;
  height: 142px;
  border-radius: 12px;
  background: #eaeaea;
  overflow: hidden;
  isolation: isolate;
}
.t-imgen-field {
  position: absolute;
  inset: 0;
  pointer-events: none;
  transition:
    opacity var(--imgen-reveal-dur) var(--imgen-reveal-ease),
    filter var(--imgen-reveal-dur) var(--imgen-reveal-ease);
}
.t-imgen-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  pointer-events: none;
  opacity: 0;
  filter: blur(var(--imgen-reveal-blur));
  transition:
    opacity var(--imgen-reveal-dur) var(--imgen-reveal-ease),
    filter var(--imgen-reveal-dur) var(--imgen-reveal-ease);
}
.t-imgen.is-revealed .t-imgen-field {
  opacity: 0;
  filter: blur(var(--imgen-reveal-blur));
}
.t-imgen.is-revealed .t-imgen-img {
  opacity: 1;
  filter: blur(0);
}

/* Each dot owns a randomized clock: --k multiplies the shared cycle
   and --delay is a negative phase offset, so the field is already
   mid-shimmer on first paint. Grow-in / shrink-out reads as dots
   condensing rather than blinking. */
/* At rest every dot holds --v, the value its twinkle would have at
   its own phase — so the idle card is a frozen frame of the loader
   rather than a solid grid. */
.t-imgen-field i {
  position: absolute;
  width: var(--imgen-dot);
  height: var(--imgen-dot);
  border-radius: 50%;
  background: var(--imgen-dot-color);
  opacity: calc(var(--imgen-peak) * var(--v, 1));
  transform: scale(
    calc(var(--imgen-scale-min) + (1 - var(--imgen-scale-min)) * var(--v, 1))
  );
}

/* The lattice only breathes while the card is generating; at rest it
   is a plain static field. */
.t-imgen.is-loading .t-imgen-field i {
  animation: t-imgen-twinkle calc(var(--imgen-cycle) * var(--k, 1))
    var(--imgen-ease) var(--delay, 0ms) infinite;
}
@keyframes t-imgen-twinkle {
  0%, 100% {
    opacity: 0;
    transform: scale(var(--imgen-scale-min));
  }
  50% {
    opacity: var(--imgen-peak);
    transform: scale(1);
  }
}

/* Reduced motion — required: the twinkle stops (the frozen frame
   stands in for it) and the reveal snaps instead of blurring. */
@media (prefers-reduced-motion: reduce) {
  .t-imgen.is-loading .t-imgen-field i { animation: none !important; }
  .t-imgen-field,
  .t-imgen-img {
    filter: none !important;
    transition: none !important;
  }
}
```

## JavaScript

The builder does all the baking: per dot it rolls a tempo multiplier `--k`, a **negative**
phase `--delay` (negative delays start the animation mid-flight instead of queueing it),
and the frozen-frame value `--v` — where that phase lands inside the dot's own cycle,
shaped like the keyframe's 0 → 1 → 0 sweep (`0.5 − 0.5·cos(2π·frac)`). That last number
is what makes the idle card look like a paused loader instead of a grid of full-strength
dots.

```js
function createImgenPlaceholder(card) {
  const field = card.querySelector(".t-imgen-field");

  function build() {
    field.textContent = "";
    const cs = getComputedStyle(field);
    const pitch = parseFloat(cs.getPropertyValue("--imgen-pitch")) || 8;
    const spread = Math.min(0.9, Math.max(0, parseFloat(cs.getPropertyValue("--imgen-spread"))) || 0);
    const phase = Math.max(0, parseFloat(cs.getPropertyValue("--imgen-phase")) || 0);
    const cycle = parseFloat(cs.getPropertyValue("--imgen-cycle")) || 1400;
    const size = field.clientWidth || 142;
    const n = Math.max(1, Math.floor(size / pitch));
    const off = (size - (n - 1) * pitch) / 2; // centre the lattice
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const dot = document.createElement("i");
        dot.style.left = (off + col * pitch) + "px";
        dot.style.top = (off + row * pitch) + "px";
        dot.style.marginLeft = "calc(var(--imgen-dot) / -2)";
        dot.style.marginTop = "calc(var(--imgen-dot) / -2)";
        // Baked randoms: tempo in [1 − spread, 1 + spread] and a
        // phase offset somewhere inside --imgen-phase.
        const k = 1 - spread + Math.random() * spread * 2;
        const offset = Math.random() * phase;
        dot.style.setProperty("--k", k.toFixed(3));
        dot.style.setProperty("--delay", Math.round(-offset) + "ms");
        // Where that phase lands inside the dot's own cycle, shaped
        // like the keyframe's 0 → 1 → 0 sweep — the frozen frame.
        const frac = (offset % (cycle * k)) / (cycle * k);
        const v = 0.5 - 0.5 * Math.cos(frac * Math.PI * 2);
        dot.style.setProperty("--v", v.toFixed(3));
        field.appendChild(dot);
      }
    }
  }

  build();

  return {
    build, // call again after changing --imgen-pitch / -spread / -phase
    load()   { card.classList.remove("is-revealed"); card.classList.add("is-loading"); },
    reveal() { card.classList.remove("is-loading");  card.classList.add("is-revealed"); },
    reset()  { card.classList.remove("is-loading", "is-revealed"); },
  };
}
```

### State walkthrough

```js
const placeholder = createImgenPlaceholder(document.getElementById("imgen"));
const img = document.querySelector("#imgen .t-imgen-img");

// 1. Generation starts: the frozen field wakes into noise.
placeholder.load();

// 2. The result lands. Point the img at it and reveal only once the
//    bytes are actually there — the cross-fade should never race the
//    network and blur into an empty rectangle.
generateImage(prompt).then(function (url) {
  img.onload = function () { placeholder.reveal(); };
  img.src = url;
});

// 3. Starting over (a new prompt): back to the frozen frame.
// placeholder.reset();
```

## Notes

- **The frozen frame is the trick.** Skipping `--v` (or defaulting it to 1) makes the
  idle card a flat grid of full-strength dots, and the first `.is-loading` frame visibly
  *snaps* as every dot jumps to its mid-animation value. With `--v` baked from the same
  phase as `--delay`, idle → loading is seamless: the dots simply start moving from
  where they already were.
- **Negative delays, not staggered starts.** `--delay` is negative so each dot's
  animation is already `offset` ms into its cycle on the first paint — the field never
  "boots up" in sync.
- The twinkle animates `opacity` and `transform: scale()` only, and the reveal animates
  `opacity`/`filter` on two small surfaces — no layout, and paint is confined to the
  card.
- The reduced-motion guard above is required: the static frozen frame already
  communicates "placeholder", so under `prefers-reduced-motion` the card skips the
  breathing entirely and the image appears without the blur crossing.
