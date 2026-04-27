# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

A browser-based strobe tuner simulation — no build step, no dependencies, no package manager. Open `index.html` directly in a browser or serve it with any static file server:

```sh
python3 -m http.server
# then open http://localhost:8000
```

The entire application is three files: `index.html`, `styles.css`, and `src/main.js`.

**Live demo**: https://jeffvandyke.github.io/strobe-browser-tuner/ (served from the `main` branch root via GitHub Pages)

**Photosensitivity warning**: The app displays a dismissable banner warning users about flashing strobe content. Dismissal is stored in `localStorage` under key `strobe-warning-dismissed`. Do not remove this warning.

## Architecture

### Rendering pipeline

The tuner uses **WebGL2**. Each frame, the strobe/audio shader renders directly to the canvas — there is no offscreen accumulation buffer or phosphor persistence. The result is a clean, stateless frame each render tick.

### Shader integration loop (the core physics)

Both fragment shaders (`FRAGMENT_SHADER_SINGLE` and `FRAGMENT_SHADER_MULTI`) implement the same strobe physics: for each pixel, they loop over 256 sub-steps (hard-coded) across the integration window `u_dt`, computing `mask * led` at each sub-step, where:

- `mask` = whether the spinning disk's black/white segment covers this pixel's angle
- `led` = 1 only when the audio sample falls in the top 10% of amplitude over the sample window (hard-coded threshold behavior); 0 otherwise

The pixel is bright when disk and audio are phase-locked. `ringN = 2^(ringIdx+1)` gives each ring a different segment count, so a single disk displays the fundamental and the next six octaves simultaneously (7 rings, hard-coded). This matches the Peterson/Stroboconn design.

### Phase tracking

`state.diskPhase` and `state.audioPhase` are advanced by the **true elapsed time** each frame (wall-clock-aligned), not by the capped `dt`. This ensures the disk doesn't drift during frame rate hiccups. The shader receives the phase rewound by `intDt` (the integration window) so it integrates forward from that point to "now".

### Single vs. multi mode

- **Single mode** (`FRAGMENT_SHADER_SINGLE`): one full-circle disk, strobe rate set manually. The disk rotates at `fStrobe * 0.5` (inner ring has 2 segment-pairs, so it locks at `fStrobe`).
- **Multi mode** (`FRAGMENT_SHADER_MULTI`): 12 arc-shaped strobes (each a 90° arc) laid out like a piano keyboard (white keys on the bottom row, black keys on top). The inner ring radius is pushed far toward the center — roughly 2 ring-widths in from the midpoint — so the active ring band is concentrated near the outer edge. Each arc shows one chromatic note of the selected octave. Strobe frequencies are `noteFreq(i, octave) * 0.5`. Layout geometry is computed in CSS pixels then scaled by `devicePixelRatio` for the GPU uniforms. A single label row below each arc shows: note name, fundamental Hz, and 2× Hz.

### Audio sources

Three modes, all feeding the same `audioBuf` / `audioU8` → `audioTex` (GL_R8 texture) path when live audio is active:

- `sine`: synthetic — shader uses `cos(audioPhase + omega*t)` analytically; no texture lookup
- `mic`: `getUserMedia` → `AnalyserNode` → float time-domain samples
- `loopback`: `getDisplayMedia` (Chrome only) → same `AnalyserNode` path

When using a live buffer, the integration window is clamped to the buffer duration (`AUDIO_BUF_LEN / sampleRate`) to avoid disk/audio time divergence.

### State persistence

`PERSIST_FIELDS` are saved to `localStorage` under key `strobe-tuner-state-v1` on every user interaction. On load, `loadPersisted()` restores them before any UI is initialized, so `syncAllUI()` picks up the saved values.

### Frequency / slider mapping

Both the strobe rate and audio frequency sliders use a **log2 scale** (`freqToSliderV` / `sliderVToFreq`): `v = log2(f / RATE_MIN)`, range `[0, log2(2000)]`. Note frequency uses equal temperament: `440 * 2^((midi - 69) / 12)`.

## Potential future improvements

- **Pitch detection**: add autocorrelation or YIN algorithm on `audioBuf` to display the detected input frequency in the readout rather than just the sample rate.
- **Mobile / touch**: the 12-note keyboard layout is cramped on narrow screens; consider a scrollable or collapsible piano layout.
- **Multi-mode audio frequency tracking**: in multi mode, the sine source is still fixed to a single note; auto-follow to the nearest locking note would be more useful.
- **WebAudio worklet**: move the float-sample capture to an `AudioWorkletProcessor` to get lower-latency, glitch-free buffers independent of the animation frame.
- **Canvas resize observer**: currently uses `window resize` + `requestAnimationFrame`; a `ResizeObserver` on `canvasWrap` would be more robust.
- **Export / share**: serialize the current state to a URL hash so a tuning setup can be bookmarked or shared.
