# Image generation placeholder — React (Pro)

`<ImagePlaceholder state="idle | loading | revealed">` — the three-phase placeholder as a
component. React does only what CSS can't: build the dot lattice once on mount, baking
each dot's tempo (`--k`), negative phase (`--delay`), and frozen-frame value (`--v`).
Every visible transition — the breathing, the cross-fade reveal — hangs off the two state
classes and lives in the stylesheet. Pair with the CSS variant's styles and `:root`
tokens (identical class names).

```jsx
import { useLayoutEffect, useRef } from "react";

// Build the lattice inside `field`. Per dot: a tempo multiplier
// (--k), a NEGATIVE phase (--delay, so the field is already
// mid-twinkle on first paint), and the frozen-frame value (--v) —
// where that phase lands inside the dot's own cycle, shaped like the
// keyframe's 0 → 1 → 0 sweep.
function buildField(field) {
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
      const k = 1 - spread + Math.random() * spread * 2;
      const offset = Math.random() * phase;
      dot.style.setProperty("--k", k.toFixed(3));
      dot.style.setProperty("--delay", Math.round(-offset) + "ms");
      const frac = (offset % (cycle * k)) / (cycle * k);
      const v = 0.5 - 0.5 * Math.cos(frac * Math.PI * 2);
      dot.style.setProperty("--v", v.toFixed(3));
      field.appendChild(dot);
    }
  }
}

const STATE_CLASS = {
  idle: "",
  loading: " is-loading",
  revealed: " is-revealed",
};

export function ImagePlaceholder({ state = "idle", src, alt = "" }) {
  const fieldRef = useRef(null);

  // Build once, before first paint — the idle card must open on the
  // frozen frame, not flash an empty grey square. The dots are plain
  // DOM inside an aria-hidden span, so React never diffs them.
  useLayoutEffect(() => {
    if (fieldRef.current) buildField(fieldRef.current);
  }, []);

  return (
    <div className={"t-imgen" + (STATE_CLASS[state] || "")}>
      <span ref={fieldRef} className="t-imgen-field" aria-hidden="true" />
      {/* Keep the img mounted throughout: the reveal is a cross-fade
          between two surfaces that both already exist. */}
      <img className="t-imgen-img" src={src ?? undefined} alt={alt} />
    </div>
  );
}
```

## Usage

Driven by real async generation. Reveal only once the bytes are actually there —
decode the image first so the cross-fade never blurs into an empty rectangle.

```jsx
function GeneratedImage({ prompt }) {
  const [state, setState] = useState("loading");
  const [src, setSrc] = useState(null);

  useEffect(() => {
    let alive = true;
    setState("loading");
    generateImage(prompt).then((url) => {
      const img = new Image();
      img.onload = () => {
        if (!alive) return;
        setSrc(url);
        setState("revealed");
      };
      img.src = url;
    });
    return () => {
      alive = false;
    };
  }, [prompt]);

  return <ImagePlaceholder state={state} src={src} alt={prompt} />;
}
```

Going back to `"loading"` (a new prompt, a retry) needs no extra code: dropping
`.is-revealed` reverses the cross-fade on the same `--imgen-reveal-dur` clock, and the
field resumes breathing from wherever its clocks are.

## Notes

- **Build once, flip classes forever.** The lattice is baked on mount; `state` changes
  only swap a class on the card. If you change `--imgen-pitch`, `--imgen-spread`, or
  `--imgen-phase` at runtime, call `buildField(fieldRef.current)` again — those three
  are baked into each dot.
- The frozen frame (`--v`) is what makes `idle → loading` seamless: each dot starts
  moving from the exact opacity/scale it was already resting at. See the CSS variant
  for the full walkthrough.
- Don't conditionally unmount the `<img>`: the reveal is a cross-fade between two
  mounted surfaces, and unmounting would restart the field's clocks on the way back.

## Reduced motion

The CSS variant's guard is required — the frozen frame stands in for the breathing, and
the reveal snaps instead of blurring:

```css
@media (prefers-reduced-motion: reduce) {
  .t-imgen.is-loading .t-imgen-field i { animation: none !important; }
  .t-imgen-field,
  .t-imgen-img {
    filter: none !important;
    transition: none !important;
  }
}
```
