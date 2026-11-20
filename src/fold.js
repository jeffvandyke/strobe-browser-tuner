// Strobe folds: the physics of a strobe disc, worked out once per sample instead of once per pixel.
//
// A ring of a disc lit by a lamp shows, at each angle, the lamp's light added up over the moments when
// the segment at that angle is white. Grouping those moments by the disc's phase gives the fold: the
// light added up at its phase of one period of the strobe's note. A ring's pattern is the fold seen
// through the ring's segment, so one fold per strobe gives every ring, at any whole multiple of the note.
//
// The fold fades with age, weighting a sample of age d by d·e^(−d/τ). The weight starts at zero and
// ends smoothly, so a sample fades in and out instead of popping, and the window is the same at any
// frame rate. Its smooth ends also keep a ring from seeing the partials next to its own.

(function (exports) {
'use strict';

const FOLD_BINS = 1024;      // over one period of the strobe's note
const FOLD_HARMONICS = 128;  // the fold's harmonics used, held by the 1024 bins to within 5%, corrected
const PATTERN_TEXELS = 256;  // over one period of a ring's pattern, twice the most harmonics drawn
const RINGS = 7;
// The disc is dark only in digital silence, under −100 dBFS RMS, and fully lit from −90 dBFS. A note
// sinking into the room's noise fades by itself: its stripes are measured against the input's RMS,
// which the noise then sets, and the noise averages out to an even grey.
const LEVEL_DARK = 1e-5;
const LEVEL_LIT = 10 ** (-90 / 20);

const RING_INTERVALS = {
    octaves: [1, 2, 4, 8, 16, 32, 64],
    harmonics: [1, 2, 3, 4, 5, 6, 7],
};

// The lamp's light for a sample. Linear light is signed: a lamp biased to half brightness, which the
// wave turns up and down. Half-wave light can't go below dark. On/off lights only above the RMS.
const LAMPS = {
    linear: (s) => s,
    halfwave: (s) => (s > 0 ? s : 0),
    onoff: (s, rms) => (s > rms ? 1 : 0),
};

// How much of the fold's harmonic m a segment passes. A square segment is white for half a period;
// a sine segment fades from white to black and back, so it passes only the first harmonic.
const SEGMENTS = {
    square: (m) => (m === 0 ? 0.5 : Math.sin(Math.PI * m / 2) / (Math.PI * m)),
    sine: (m) => (m === 0 ? 0.5 : m === 1 ? 0.25 : 0),
};

// The weights of a batch of n samples, the newest last, and how much the batch ages what came before
class FadeWindow {
    constructor() {
        this.w0 = new Float64Array(0);
        this.w1 = new Float64Array(0);
        this.n = 0;
    }

    prepare(n, tauSamples) {
        if (this.w0.length < n) {
            this.w0 = new Float64Array(n);
            this.w1 = new Float64Array(n);
        }
        const a = 1 / tauSamples;
        this.sum0 = 0;
        this.sum1 = 0;
        for (let i = 0; i < n; i++) {
            const age = n - 1 - i;
            const e = Math.exp(-a * age);
            this.w0[i] = e;
            this.w1[i] = age * e;
            this.sum0 += e;
            this.sum1 += age * e;
        }
        this.n = n;
        this.decay = Math.exp(-a * n);
    }
}

// Two running sums with the weights e^(−d/τ) and d·e^(−d/τ). The second is the one shown; the first is
// what it needs to age: after n more samples, d·e^(−d/τ) becomes (d + n)·e^(−(d + n)/τ).
function age(x1, x0, n, decay) {
    return [decay * (x1 + n * x0), decay * x0];
}

// The input's loudness over the same window, for the on/off lamp's threshold and the disc's brightness
class Level {
    constructor() { this.reset(); }

    reset() {
        this.p0 = this.p1 = this.w0 = this.w1 = 0;
    }

    add(samples, win) {
        [this.p1, this.p0] = age(this.p1, this.p0, win.n, win.decay);
        [this.w1, this.w0] = age(this.w1, this.w0, win.n, win.decay);
        for (let i = 0; i < win.n; i++) {
            const power = samples[i] * samples[i];
            this.p0 += win.w0[i] * power;
            this.p1 += win.w1[i] * power;
        }
        this.w0 += win.sum0;
        this.w1 += win.sum1;
    }

    skip(n, tauSamples) {
        const decay = Math.exp(-n / tauSamples);
        [this.p1, this.p0] = age(this.p1, this.p0, n, decay);
        [this.w1, this.w0] = age(this.w1, this.w0, n, decay);
    }

    rms() {
        return this.w1 > 0 ? Math.sqrt(this.p1 / this.w1) : 0;
    }
}

class Fold {
    constructor() {
        this.f0 = new Float64Array(FOLD_BINS);
        this.f1 = new Float64Array(FOLD_BINS);
        this.re = new Float64Array(FOLD_BINS);
        this.im = new Float64Array(FOLD_BINS);
        this.reset(0);
    }

    reset(freq) {
        this.freq = freq;
        this.f0.fill(0);
        this.f1.fill(0);
        this.w0 = this.w1 = 0;
    }

    ageBy(n, decay) {
        const f0 = this.f0, f1 = this.f1;
        for (let b = 0; b < FOLD_BINS; b++) {
            f1[b] = decay * (f1[b] + n * f0[b]);
            f0[b] *= decay;
        }
        [this.w1, this.w0] = age(this.w1, this.w0, n, decay);
    }

    // The light of samples start .. start + n − 1, start counted from the stream's first sample, each
    // split between the two bins either side of its phase
    add(light, start, sampleRate, win) {
        this.ageBy(win.n, win.decay);
        this.w0 += win.sum0;
        this.w1 += win.sum1;

        const f0 = this.f0, f1 = this.f1, w0 = win.w0, w1 = win.w1;
        const step = this.freq / sampleRate;
        let phase = (this.freq * start / sampleRate) % 1;
        for (let i = 0; i < win.n; i++) {
            const pos = phase * FOLD_BINS;
            const b = pos | 0;
            const next = (b + 1) & (FOLD_BINS - 1);
            const frac = pos - b;
            const x0 = w0[i] * light[i];
            const x1 = w1[i] * light[i];
            f0[b] += x0 - frac * x0;
            f0[next] += frac * x0;
            f1[b] += x1 - frac * x1;
            f1[next] += frac * x1;
            phase += step;
            if (phase >= 1) phase -= 1;
        }
    }

    // The fold's harmonics into re and im. Splitting a sample between two bins passes harmonic h by
    // sinc²(h / bins) on average, which is undone here.
    harmonics() {
        this.re.set(this.f1);
        this.im.fill(0);
        fft(this.re, this.im);
        for (let h = 1; h <= FOLD_HARMONICS; h++) {
            const x = Math.PI * h / FOLD_BINS;
            const gain = (x / Math.sin(x)) ** 2;
            this.re[h] *= gain;
            this.im[h] *= gain;
        }
    }
}

// An in-place radix-2 FFT of FOLD_BINS points, e^(−i2πhb/N)
const FFT_REV = new Uint32Array(FOLD_BINS);
const FFT_COS = new Float64Array(FOLD_BINS / 2);
const FFT_SIN = new Float64Array(FOLD_BINS / 2);
{
    const bits = Math.log2(FOLD_BINS);
    for (let i = 0; i < FOLD_BINS; i++) {
        let r = 0;
        for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
        FFT_REV[i] = r;
    }
    for (let i = 0; i < FOLD_BINS / 2; i++) {
        FFT_COS[i] = Math.cos(2 * Math.PI * i / FOLD_BINS);
        FFT_SIN[i] = Math.sin(2 * Math.PI * i / FOLD_BINS);
    }
}

function fft(re, im) {
    for (let i = 0; i < FOLD_BINS; i++) {
        const j = FFT_REV[i];
        if (j > i) {
            let t = re[i]; re[i] = re[j]; re[j] = t;
            t = im[i]; im[i] = im[j]; im[j] = t;
        }
    }
    for (let size = 2; size <= FOLD_BINS; size *= 2) {
        const half = size / 2;
        const step = FOLD_BINS / size;
        for (let start = 0; start < FOLD_BINS; start += size) {
            for (let j = 0, k = 0; j < half; j++, k += step) {
                const a = start + j, b = a + half;
                const tre = re[b] * FFT_COS[k] + im[b] * FFT_SIN[k];
                const tim = im[b] * FFT_COS[k] - re[b] * FFT_SIN[k];
                re[b] = re[a] - tre;
                im[b] = im[a] - tim;
                re[a] += tre;
                im[a] += tim;
            }
        }
    }
}

const PATTERN_COS = new Float64Array(PATTERN_TEXELS);
const PATTERN_SIN = new Float64Array(PATTERN_TEXELS);
for (let j = 0; j < PATTERN_TEXELS; j++) {
    PATTERN_COS[j] = Math.cos(2 * Math.PI * j / PATTERN_TEXELS);
    PATTERN_SIN[j] = Math.sin(2 * Math.PI * j / PATTERN_TEXELS);
}

// The strobes on screen, each with its fold, fed the same samples
class StrobeBank {
    constructor() {
        this.folds = [];
        this.level = new Level();
        this.window = new FadeWindow();
        this.light = new Float32Array(0);
        this.next = -1;  // the next sample expected, −1 before the first
    }

    reset() {
        this.level.reset();
        for (const fold of this.folds) fold.reset(fold.freq);
        this.next = -1;
    }

    // A strobe whose note changes starts over, its old samples folded onto the old note's period
    setFreqs(freqs) {
        while (this.folds.length < freqs.length) this.folds.push(new Fold());
        this.folds.length = freqs.length;
        freqs.forEach((freq, i) => {
            if (this.folds[i].freq !== freq) this.folds[i].reset(freq);
        });
    }

    // Samples start .. start + n − 1 of the stream. A gap since the last ones ages the folds by it.
    push(samples, start, sampleRate, lamp, persistenceS) {
        const tau = Math.max(1, persistenceS * sampleRate / 2);  // the window's mean age is 2τ
        if (this.next >= 0 && start > this.next) {
            const gap = start - this.next;
            const decay = Math.exp(-gap / tau);
            this.level.skip(gap, tau);
            for (const fold of this.folds) fold.ageBy(gap, decay);
        }
        this.next = start + samples.length;

        const n = samples.length;
        if (this.light.length < n) this.light = new Float32Array(n);
        const lampOf = LAMPS[lamp] || LAMPS.linear;
        const rms = this.level.rms();
        for (let i = 0; i < n; i++) this.light[i] = lampOf(samples[i], rms);

        this.window.prepare(n, tau);
        this.level.add(samples, this.window);
        for (const fold of this.folds) fold.add(this.light, start, sampleRate, this.window);
    }

    // Every ring's brightness over one period of its pattern, from 0 to 1 before gamma: a row per
    // ring, RINGS rows per strobe. Rings at or above half the sample rate stay dark.
    patterns(out, { lamp, segments, rings, gain, sampleRate }) {
        const intervals = RING_INTERVALS[rings] || RING_INTERVALS.harmonics;
        const pass = SEGMENTS[segments] || SEGMENTS.sine;
        const rms = this.level.rms();
        const lit = Math.min(1, Math.max(0, (rms - LEVEL_DARK) / (LEVEL_LIT - LEVEL_DARK)));
        const brightness = lit * lit * (3 - 2 * lit);

        this.folds.forEach((fold, s) => {
            fold.harmonics();
            const re = fold.re, im = fold.im;
            // The highest harmonic under half the sample rate, and a gentle roll-off over the top half
            // of the harmonics, so a sharp lamp doesn't ring at the segment's edges
            const top = Math.min(FOLD_HARMONICS, Math.ceil(sampleRate / 2 / fold.freq) - 1);
            const rollOff = (h) => (h <= top / 2 ? 1 : 0.5 * (1 + Math.cos(Math.PI * (h - top / 2) / (top / 2 + 1))));

            // A locked sine as loud as the input swings a ring from black to white. Light that can't go
            // negative shows black where no light passed and white where all of it did.
            const scale = lamp === 'linear'
                ? 2 * fold.w1 * Math.SQRT2 * rms * pass(1)
                : re[0];
            const usable = brightness > 0 && scale > 1e-12 && fold.w1 > 0;

            for (let r = 0; r < RINGS; r++) {
                const row = (s * RINGS + r) * PATTERN_TEXELS;
                const k = intervals[r];
                if (!usable || k > top) {
                    out.fill(0, row, row + PATTERN_TEXELS);
                    continue;
                }
                const pattern = out.subarray(row, row + PATTERN_TEXELS);
                pattern.fill(0.5);
                for (let m = 1; m < PATTERN_TEXELS / 2 && m * k <= top; m++) {
                    const t = pass(m);
                    if (t === 0) continue;
                    const c = 2 * t * rollOff(m * k) * gain / scale;
                    const a = c * re[m * k], b = c * im[m * k];
                    for (let j = 0, idx = 0; j < PATTERN_TEXELS; j++, idx = (idx + m) & (PATTERN_TEXELS - 1)) {
                        pattern[j] += a * PATTERN_COS[idx] - b * PATTERN_SIN[idx];
                    }
                }
                for (let j = 0; j < PATTERN_TEXELS; j++) {
                    pattern[j] = brightness * Math.min(1, Math.max(0, pattern[j]));
                }
            }
        });
    }
}

exports.StrobeBank = StrobeBank;
exports.RINGS = RINGS;
exports.RING_INTERVALS = RING_INTERVALS;
exports.PATTERN_TEXELS = PATTERN_TEXELS;
})(typeof module !== 'undefined' ? module.exports : (window.StrobeFold = {}));
