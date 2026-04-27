# Strobe Browser Tuner

A browser-based strobe tuner simulation — no install, no build step, no dependencies.

**[Live demo &rarr;](https://jeffvandyke.github.io/strobe-browser-tuner/)**

> **Photosensitivity warning:** This app displays rapidly flashing strobe patterns. Do not use if you have photosensitive epilepsy or similar conditions.

## What it does

Simulates a Peterson/Stroboconn-style optical strobe tuner entirely in the browser using WebGL2. A virtual disk with alternating black and white segments is strobed by your audio signal — when the strobe rate matches the audio frequency, the disk pattern appears frozen (locked).

Two display modes:

- **Single mode** — one full-circle disk, strobe rate set manually
- **Multi mode** — 12-note chromatic layout (piano-style), each note displayed as a 90° arc strobe; all notes of the selected octave shown simultaneously

Each strobe display renders 7 concentric rings with doubling segment counts, so the fundamental and its next six octaves all appear at once.

## How to use

1. Open [the live demo](https://jeffvandyke.github.io/strobe-browser-tuner/) in Chrome or any modern browser with WebGL2
2. Select an audio source: **Synthetic sine** (default), **Microphone**, or **System / tab audio**
3. In **single mode**, set the strobe rate to match your target pitch — when the disk locks (pattern appears still), you're in tune
4. In **multi mode**, the arc that locks tells you which note is closest to your audio input; select the matching note button and octave to confirm

For tab audio (Chrome only): click the audio source dropdown, choose "System / tab audio," select a browser tab in the share dialog, and check **Share tab audio**.

## Audio sources

| Source | Notes |
|--------|-------|
| Synthetic sine | No permissions needed; good for dial-in and calibration |
| Microphone | `getUserMedia` — works in all modern browsers |
| System / tab audio | `getDisplayMedia` — Chrome only |

## Technical details

- **Renderer**: WebGL2 fragment shader; stateless per-frame render (no accumulation buffer)
- **Integration**: 256 sub-steps per frame across the integration window, wall-clock-aligned to prevent drift during frame-rate hiccups
- **LED model**: fires only at peak amplitude (top 10% of signal range) for crisp lock indication
- **Phase tracking**: disk and audio phases advance by true elapsed time, not capped `dt`
- **Pitch reference**: A4 = 440 Hz, equal temperament
- **State persistence**: UI state is saved to `localStorage` and restored on reload

## Browser compatibility

Requires WebGL2. Works in Chrome 56+, Firefox 51+, Edge 79+, Safari 16+.

## Running locally

```sh
python3 -m http.server
# open http://localhost:8000
```

Or any static file server — the entire app is `index.html`, `styles.css`, and `src/main.js`.
