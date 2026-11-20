# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

A browser-based strobe tuner simulation — no build step, no dependencies, no package manager. Open `index.html` directly in a browser or serve it with any static file server:

```sh
python3 -m http.server
# then open http://localhost:8000
```

The entire application is four files: `index.html`, `styles.css`, `src/fold.js` (the strobe physics) and `src/main.js` (audio, UI and WebGL).

`src/fold.js` also loads in Node (`require('./src/fold.js')`), so the physics can be tested on generated signals without a browser.

**Live demo**: https://jeffvandyke.github.io/strobe-browser-tuner/ (served from the `main` branch root via GitHub Pages)

**Photosensitivity warning**: The app displays a dismissable banner warning users about flashing strobe content. Dismissal is stored in `localStorage` under key `strobe-warning-dismissed`. Do not remove this warning.

## Architecture

### The strobe physics (`src/fold.js`)

A disk ring's brightness at an angle is the lamp's light added up over the moments when the segment at that angle is white. Grouping those moments by the disk's phase gives the **fold**: every sample's light added at its phase of one period of the strobe rate (`FOLD_BINS` bins, each sample split between the two nearest). A ring at k× the strobe rate sees the fold's harmonics k, 2k, 3k…, weighted by its segment shape, so one fold per strobe (`StrobeBank`) gives every ring at any whole multiple:

- `LAMPS`: `linear` light is signed, a lamp biased to half brightness, and keeps the partials apart. `halfwave` can't go below dark, and `onoff` fires above the input's RMS like a neon lamp. Both mix the partials, because they are not linear.
- `SEGMENTS`: how much of the fold's harmonic m a segment passes. A `square` segment, white for half a period, passes the odd harmonics (1, 1/3, 1/5…). A `sine` segment passes only the first.
- The fold fades with age: a sample of age d weighs d·e^(−d/τ), with a mean age of 2τ, the Persistence setting. The weight starts at zero, so samples fade in smoothly. It depends only on the sample count, so the display is the same at any frame rate, and its smooth ends keep neighbouring partials out of a ring.
- `patterns()` takes each fold's harmonics with an FFT. It drops those at or above half the sample rate, rolls off the top half of the rest so a sharp lamp doesn't ring at the segments' edges, and writes each ring's brightness over one period of its pattern (`PATTERN_TEXELS` values, a row per ring).

The brightness is normalised so a locked sine as loud as the input swings a ring from black to white. Weaker partials give fainter rings, and Gain scales them. A note sinking into the room's noise fades by itself, since the noise then sets the input's RMS, and noise averages to an even grey. The disk goes dark only in digital silence, between `LEVEL_DARK` (−100 dBFS) and `LEVEL_LIT` (−90 dBFS).

### Rendering pipeline

The tuner uses **WebGL2**. Both fragment shaders (`FRAGMENT_SHADER_SINGLE` and `FRAGMENT_SHADER_MULTI`) find the pixel's strobe and ring, then look up the ring's pattern in the R32F `patternTex` with `texelFetch` (`PATTERN_LOOKUP`). A ring with `u_ringN` segment pairs repeats its pattern `u_ringN` times around the disk; `u_ringN` is twice the ring's multiple of the strobe rate. Gamma is applied in the shader.

### Single vs. multi mode

- **Single mode** (`FRAGMENT_SHADER_SINGLE`): one full-circle disk, strobe rate set manually. The inner ring has 2 segment pairs and locks at `fStrobe`, as if the disk turned at `fStrobe * 0.5`.
- **Multi mode** (`FRAGMENT_SHADER_MULTI`): 12 arc-shaped strobes (each a 90° arc) laid out like a piano keyboard (white keys on the bottom row, black keys on top). The inner ring radius is pushed far toward the center — roughly 2 ring-widths in from the midpoint — so the active ring band is concentrated near the outer edge. Each arc shows one chromatic note of the selected octave, a fold per note at `noteFreq(i, octave)`. Layout geometry is computed in CSS pixels then scaled by `devicePixelRatio` for the GPU uniforms. A single label row below each arc shows: note name, fundamental Hz, and 2× Hz.

### Audio sources

Every source feeds samples with their absolute sample numbers to `bank.push()` in `updatePatterns()`, once per frame:

- `sine`: synthetic, made on the main thread at `SYNTH_RATE`, as many samples as the frame's elapsed time (at most `SYNTH_MAX_S`)
- `mic`: `getUserMedia` → `MediaStreamSource` → the `strobe-capture` AudioWorklet (`CAPTURE_WORKLET`, loaded from a Blob URL, or a data: URL on file:// pages) → `captureQueue`
- `loopback`: `getDisplayMedia` (Chrome only) → the same worklet path

The worklet posts every render quantum with the number of its first sample (`currentFrame`). Contiguous chunks are folded as one run. A gap ages the folds by the missing samples, so the phase stays right. Changing a strobe's frequency, or the source, starts its fold over.

### State persistence

`PERSIST_FIELDS` are saved to `localStorage` under key `strobe-tuner-state-v1` on every user interaction. On load, `loadPersisted()` restores them before any UI is initialized, so `syncAllUI()` picks up the saved values.

### Frequency / slider mapping

Both the strobe rate and audio frequency sliders use a **log2 scale** (`freqToSliderV` / `sliderVToFreq`): `v = log2(f / RATE_MIN)`, range `[0, log2(2000)]`. Note frequency uses equal temperament: `440 * 2^((midi - 69) / 12)`.

## Potential future improvements

- **Pitch detection**: add autocorrelation or YIN on the captured samples to display the detected input frequency in the readout rather than just the sample rate.
- **Mobile / touch**: the 12-note keyboard layout is cramped on narrow screens; consider a scrollable or collapsible piano layout.
- **Multi-mode audio frequency tracking**: in multi mode, the sine source is still fixed to a single note; auto-follow to the nearest locking note would be more useful.
- **Canvas resize observer**: currently uses `window resize` + `requestAnimationFrame`; a `ResizeObserver` on `canvasWrap` would be more robust.
- **Export / share**: serialize the current state to a URL hash so a tuning setup can be bookmarked or shared.
