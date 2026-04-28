// Strobe Browser Tuner — POC
// Two display modes:
//   single — one full-circle strobe disk
//   multi  — 13-note piano layout, each note shown as a 90° arc strobe

const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
out vec2 v_pos;
void main() {
    v_pos = a_position;
    gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER_SINGLE = `#version 300 es
precision highp float;

in vec2 v_pos;
out vec4 outColor;

uniform float u_diskPhase;
uniform float u_audioPhase;
uniform float u_fDisk;
uniform float u_fAudio;
uniform float u_dt;
uniform float u_innerR;
uniform float u_outerR;
uniform float u_gamma;
uniform float u_ledThreshold;
uniform float u_ledNorm;

uniform sampler2D u_audioTex;
uniform int u_useAudioBuf;
uniform float u_audioStart;
uniform float u_audioStep;

const float TAU = 6.28318530717959;
const int NUM_RINGS = 7;
const int SAMPLES = 256;

void main() {
    float r = length(v_pos);
    float theta = atan(v_pos.y, v_pos.x);

    if (r > u_outerR + 0.005) {
        outColor = vec4(0.05, 0.06, 0.08, 1.0);
        return;
    }
    if (r < u_innerR) {
        float h = smoothstep(u_innerR, u_innerR - 0.02, r);
        outColor = vec4(vec3(0.10 + 0.04 * h), 1.0);
        return;
    }

    float ringSpan = (u_outerR - u_innerR) / float(NUM_RINGS);
    float ringPos = (r - u_innerR) / ringSpan;
    int ringIdx = int(floor(ringPos));
    if (ringIdx >= NUM_RINGS) ringIdx = NUM_RINGS - 1;
    float ringN = pow(2.0, float(ringIdx + 1));

    float omegaDisk = TAU * u_fDisk;
    float omegaAudio = TAU * u_fAudio;
    float invSamples = 1.0 / float(SAMPLES);

    float accum = 0.0;

    for (int i = 0; i < SAMPLES; i++) {
        float frac = (float(i) + 0.5) * invSamples;
        float t = frac * u_dt;

        float diskAng = u_diskPhase + omegaDisk * t;
        float maskArg = ringN * (theta - diskAng);
        float mask = step(0.0, cos(maskArg));

        float led;
        if (u_useAudioBuf == 1) {
            float u = u_audioStart + frac * u_audioStep;
            float s = texture(u_audioTex, vec2(u, 0.5)).r * 2.0 - 1.0;
            led = step(u_ledThreshold, s);
        } else {
            float audioCos = cos(u_audioPhase + omegaAudio * t);
            led = step(u_ledThreshold, audioCos);
        }

        accum += mask * led;
    }

    float brightness = clamp(accum * u_ledNorm * invSamples, 0.0, 1.0);
    brightness = pow(brightness, u_gamma);

    float ringFrac = ringPos - float(ringIdx);
    float edge = min(ringFrac, 1.0 - ringFrac);
    if (edge < 0.012) brightness *= edge / 0.012;

    outColor = vec4(brightness, brightness * 0.15, brightness * 0.1, 1.0);
}
`;

const FRAGMENT_SHADER_MULTI = `#version 300 es
precision highp float;

in vec2 v_pos;
out vec4 outColor;

uniform vec2 u_canvasSize;
uniform vec2 u_strobeCenters[12];
uniform float u_strobeRadii[12];
uniform float u_strobePhases[12];
uniform float u_strobeFreqs[12];
uniform int u_strobeCount;

uniform float u_audioPhase;
uniform float u_fAudio;
uniform float u_dt;
uniform float u_innerR;
uniform float u_outerR;
uniform float u_gamma;
uniform float u_ledThreshold;
uniform float u_ledNorm;

uniform sampler2D u_audioTex;
uniform int u_useAudioBuf;
uniform float u_audioStart;
uniform float u_audioStep;

const float TAU = 6.28318530717959;
const int MAX_STROBES = 12;
const int NUM_RINGS = 7;
const int SAMPLES = 256;
const float ARC_HALF_ANGLE = 0.7853981634;

void main() {
    vec2 px = vec2(gl_FragCoord.x, u_canvasSize.y - gl_FragCoord.y);

    int hitIdx = -1;
    vec2 hitLocal = vec2(0.0);
    float hitR = 1.0;

    for (int i = 0; i < MAX_STROBES; i++) {
        if (i >= u_strobeCount) break;
        vec2 local = px - u_strobeCenters[i];
        float dist = length(local);
        float strobeR = u_strobeRadii[i];
        if (dist > strobeR * u_outerR) continue;
        float angleFromUp = atan(local.x, -local.y);
        if (abs(angleFromUp) > ARC_HALF_ANGLE) continue;
        if (dist < strobeR * u_innerR) {
            outColor = vec4(0.10, 0.11, 0.14, 1.0);
            return;
        }
        hitIdx = i;
        hitLocal = local;
        hitR = strobeR;
        break;
    }

    if (hitIdx < 0) {
        outColor = vec4(0.05, 0.06, 0.08, 1.0);
        return;
    }

    float dist = length(hitLocal);
    float r_norm = dist / hitR;
    float theta = atan(-hitLocal.y, hitLocal.x);

    float fDisk = u_strobeFreqs[hitIdx];
    float diskPhase = u_strobePhases[hitIdx];

    float ringSpan = (u_outerR - u_innerR) / float(NUM_RINGS);
    float ringPos = (r_norm - u_innerR) / ringSpan;
    int ringIdx = int(floor(ringPos));
    if (ringIdx >= NUM_RINGS) ringIdx = NUM_RINGS - 1;
    float ringN = pow(2.0, float(ringIdx + 1));

    float omegaDisk = TAU * fDisk;
    float omegaAudio = TAU * u_fAudio;
    float invSamples = 1.0 / float(SAMPLES);

    float accum = 0.0;

    for (int j = 0; j < SAMPLES; j++) {
        float frac = (float(j) + 0.5) * invSamples;
        float t = frac * u_dt;

        float diskAng = diskPhase + omegaDisk * t;
        float maskArg = ringN * (theta - diskAng);
        float mask = step(0.0, cos(maskArg));

        float led;
        if (u_useAudioBuf == 1) {
            float u = u_audioStart + frac * u_audioStep;
            float s = texture(u_audioTex, vec2(u, 0.5)).r * 2.0 - 1.0;
            led = step(u_ledThreshold, s);
        } else {
            float audioCos = cos(u_audioPhase + omegaAudio * t);
            led = step(u_ledThreshold, audioCos);
        }

        accum += mask * led;
    }

    float brightness = clamp(accum * u_ledNorm * invSamples, 0.0, 1.0);
    brightness = pow(brightness, u_gamma);

    float ringFrac = ringPos - float(ringIdx);
    float edge = min(ringFrac, 1.0 - ringFrac);
    if (edge < 0.012) brightness *= edge / 0.012;

    outColor = vec4(brightness, brightness * 0.15, brightness * 0.1, 1.0);
}
`;

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const SHARP_SET = new Set(['C#', 'D#', 'F#', 'G#', 'A#']);
const RATE_MIN = 1;
const RATE_MAX = 2000;
const RATE_LOG_MAX = Math.log2(RATE_MAX / RATE_MIN);
const AUDIO_BUF_LEN = 2048;

// LED threshold: fire when signal exceeds its own RMS level.
// For a pure sine this fires ~25% of the cycle; ledNorm=4 normalises locked brightness to 1.
// Using RMS (not peak) makes the threshold robust to transients and high-crest-factor signals.
const LED_THRESHOLD_SINE = 1.0 / Math.SQRT2; // RMS of unit-amplitude sine ≈ 0.707
const LED_NORM = 4.0;                          // 1 / duty_cycle (duty ≈ 0.25 at RMS threshold)
let ledThreshold = LED_THRESHOLD_SINE;
let ledNorm = LED_NORM;

const WHITE_NOTES = [0, 2, 4, 5, 7, 9, 11];
const BLACK_NOTES = [1, 3, 6, 8, 10];
const BLACK_X_POS = [1, 2, 4, 5, 6];
const MULTI_COUNT = 12;


function noteFreq(noteIdx, octave) {
    const midi = (octave + 1) * 12 + noteIdx;
    return 440 * Math.pow(2, (midi - 69) / 12);
}

function fmtFreq(f) {
    return f >= 100 ? f.toFixed(2) : f >= 10 ? f.toFixed(3) : f.toFixed(4);
}

function compileShader(gl, type, source) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, source);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(sh);
        gl.deleteShader(sh);
        throw new Error('Shader compile error: ' + log);
    }
    return sh;
}

function createProgram(gl, vsSrc, fsSrc) {
    const prog = gl.createProgram();
    gl.attachShader(prog, compileShader(gl, gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(prog, compileShader(gl, gl.FRAGMENT_SHADER, fsSrc));
    gl.bindAttribLocation(prog, 0, 'a_position');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        const log = gl.getProgramInfoLog(prog);
        gl.deleteProgram(prog);
        throw new Error('Program link error: ' + log);
    }
    return prog;
}

const state = {
    mode: 'single',
    fStrobe: noteFreq(9, 4),
    audioFreq: noteFreq(9, 4),
    detuneCents: 0,
    audioMode: 'sine',
    activeSource: 'sine',
    activeNoteIdx: 9,
    activeOctave: 4,
    gamma: 2.0,
    diskPhase: 0,
    audioPhase: 0,
    lastFrameTime: 0,
    fpsAvg: 60,
};

const PERSIST_KEY = 'strobe-tuner-state-v1';
const PERSIST_FIELDS = ['mode', 'fStrobe', 'audioFreq', 'detuneCents',
    'activeNoteIdx', 'activeOctave', 'gamma', 'activeSource'];

function loadPersisted() {
    try {
        const raw = localStorage.getItem(PERSIST_KEY);
        if (!raw) return;
        const data = JSON.parse(raw);
        for (const k of PERSIST_FIELDS) {
            if (data[k] !== undefined) state[k] = data[k];
        }
    } catch (_) {}
}

function savePersisted() {
    try {
        const out = {};
        for (const k of PERSIST_FIELDS) out[k] = state[k];
        // loopback requires a user gesture each session; save as sine so we don't persist an un-restorable source
        if (out.activeSource === 'loopback') out.activeSource = 'sine';
        localStorage.setItem(PERSIST_KEY, JSON.stringify(out));
    } catch (_) {}
}

loadPersisted();

const multiPhases    = new Float32Array(MULTI_COUNT);
const intMultiPhases = new Float32Array(MULTI_COUNT);
const multiFreqs     = new Float32Array(MULTI_COUNT);
const multiCenters   = new Float32Array(MULTI_COUNT * 2);
const multiRadii     = new Float32Array(MULTI_COUNT);
let multiLayoutCSS = null;

let audioCtx = null;
let toneOsc = null, toneGain = null;
let micStream = null, micSourceNode = null, analyser = null;
const audioBuf = new Float32Array(AUDIO_BUF_LEN);
const audioU8 = new Uint8Array(AUDIO_BUF_LEN);
let audioBufRate = 44100;

// Audio-clock sync tracking
let lastCaptureTime = 0;      // audioCtx.currentTime of most recent buffer capture
let audioSyncOffset = NaN;   // baseline of (wallTime - audioTime); NaN until first capture
let syncStrikes = 0;
let syncStrikeWindowStart = 0;

function ensureAudioCtx() {
    if (!audioCtx) {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        audioCtx = new Ctor();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
}

function startTone(freq) {
    ensureAudioCtx();
    if (toneOsc) return;
    toneOsc = audioCtx.createOscillator();
    toneOsc.type = 'sine';
    toneOsc.frequency.value = freq;
    toneGain = audioCtx.createGain();
    toneGain.gain.value = 0.06;
    toneOsc.connect(toneGain).connect(audioCtx.destination);
    toneOsc.start();
}

function stopTone() {
    if (!toneOsc) return;
    try { toneOsc.stop(); } catch (_) {}
    toneOsc.disconnect();
    if (toneGain) toneGain.disconnect();
    toneOsc = null;
    toneGain = null;
}

// Compute phase angle for a given frequency at a given audio-clock time.
// Uses fractional-revolution form to stay precise for large time values
// (avoids precision loss from TAU * freq * time when time is large).
function audioPhaseAt(freq, time) {
    const rev = freq * time;
    return (rev - Math.floor(rev)) * (2 * Math.PI);
}

function resetAudioSync() {
    audioSyncOffset = NaN;
    syncStrikes = 0;
    const w = document.getElementById('audioSyncWarning');
    if (w) w.hidden = true;
}

// Compare wall-clock elapsed vs audio-clock elapsed each frame.
// If the audio clock falls >50 ms behind wall clock (stall/throttle),
// count a strike and resync the baseline. Three strikes in 10 s → show warning.
function checkAudioSync(wallTime, audioTime) {
    const offset = wallTime - audioTime;
    if (isNaN(audioSyncOffset)) { audioSyncOffset = offset; return; }
    const drift = offset - audioSyncOffset;
    if (drift > 0.05) {
        audioSyncOffset = offset; // resync baseline ("drop" to catch up)
        if (syncStrikes === 0) syncStrikeWindowStart = wallTime;
        else if (wallTime - syncStrikeWindowStart > 10) {
            syncStrikes = 0;
            syncStrikeWindowStart = wallTime;
        }
        if (++syncStrikes >= 3) {
            const w = document.getElementById('audioSyncWarning');
            if (w) w.hidden = false;
        }
    } else {
        audioSyncOffset += (offset - audioSyncOffset) * 0.005; // slow baseline drift
        if (wallTime - syncStrikeWindowStart > 10) syncStrikes = 0;
    }
}

function cleanupCapture() {
    resetAudioSync();
    if (micStream) {
        micStream.getTracks().forEach(t => t.stop());
        micStream = null;
    }
    if (micSourceNode) {
        micSourceNode.disconnect();
        micSourceNode = null;
    }
    if (analyser) {
        analyser.disconnect();
        analyser = null;
    }
}

function attachStreamToAnalyser(stream) {
    ensureAudioCtx();
    const src = audioCtx.createMediaStreamSource(stream);
    const an = audioCtx.createAnalyser();
    an.fftSize = AUDIO_BUF_LEN;
    an.smoothingTimeConstant = 0;
    src.connect(an);
    micStream = stream;
    micSourceNode = src;
    analyser = an;
    audioBufRate = audioCtx.sampleRate;
}

async function activateMic(deviceId) {
    cleanupCapture();
    try {
        const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
        if (deviceId) audio.deviceId = { exact: deviceId };
        const stream = await navigator.mediaDevices.getUserMedia({ audio });
        attachStreamToAnalyser(stream);
        state.audioMode = 'mic';
        updateSourceUI();
        await refreshDeviceList();
    } catch (e) {
        alert('Microphone unavailable: ' + (e.message || e));
        revertSourceSelector();
    }
}

async function activateLoopback() {
    cleanupCapture();
    try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        const audioTracks = stream.getAudioTracks();
        if (audioTracks.length === 0) {
            stream.getTracks().forEach(t => t.stop());
            throw new Error('No audio track. In the browser dialog, choose a tab/window and check "Share tab audio".');
        }
        stream.getVideoTracks().forEach(t => t.stop());
        const audioOnly = new MediaStream(audioTracks);
        attachStreamToAnalyser(audioOnly);
        state.audioMode = 'loopback';
    } catch (e) {
        alert('System audio capture failed: ' + (e.message || e));
        revertSourceSelector();
    }
}

function revertSourceSelector() {
    state.audioMode = 'sine';
    state.activeSource = 'sine';
    sourceSelect.value = 'sine';
    updateSourceUI();
}

async function initDevicesAndRestoreSource() {
    if (!navigator.mediaDevices) return;
    // If mic permission is already granted, briefly open a stream so enumerateDevices returns labels
    try {
        const perm = await navigator.permissions.query({ name: 'microphone' });
        if (perm.state === 'granted') {
            const s = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
            });
            s.getTracks().forEach(t => t.stop());
        }
    } catch (_) {}
    await refreshDeviceList();
    // Restore last mic source if the device is still available
    const src = state.activeSource;
    if (src === 'mic' || src.startsWith('mic:')) {
        const deviceId = src.startsWith('mic:') ? src.slice(4) : undefined;
        const optionExists = [...sourceSelect.options].some(o => o.value === src);
        if (src === 'mic' || optionExists) {
            sourceSelect.value = src;
            activateMic(deviceId);
        }
    }
    // loopback: never auto-restore — requires user gesture for getDisplayMedia
}

async function refreshDeviceList() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    let devices;
    try { devices = await navigator.mediaDevices.enumerateDevices(); }
    catch (_) { return; }
    const mics = devices.filter(d => d.kind === 'audioinput');
    const current = sourceSelect.value;
    Array.from(sourceSelect.options).forEach(opt => {
        if (opt.value.startsWith('mic:')) opt.remove();
    });
    const loopOpt = sourceSelect.querySelector('option[value="loopback"]');
    mics.forEach((mic, i) => {
        const opt = document.createElement('option');
        opt.value = 'mic:' + mic.deviceId;
        opt.textContent = mic.label || `Microphone ${i + 1}`;
        sourceSelect.insertBefore(opt, loopOpt);
    });
    if ([...sourceSelect.options].some(o => o.value === current)) {
        sourceSelect.value = current;
    }
}

function nearestNoteLabel(freq) {
    if (!isFinite(freq) || freq <= 0) return '';
    const midi = 69 + 12 * Math.log2(freq / 440);
    const midiRound = Math.round(midi);
    const cents = Math.round((midi - midiRound) * 100);
    const noteIdx = ((midiRound % 12) + 12) % 12;
    const octave = Math.floor(midiRound / 12) - 1;
    let label = NOTE_NAMES[noteIdx] + octave;
    if (cents !== 0) label += (cents > 0 ? ' +' : ' ') + cents + '\u00A2';
    return label;
}

const canvas = document.getElementById('strobe');
const canvasWrap = document.getElementById('canvasWrap');
const labelContainer = document.getElementById('strobeLabels');
const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, premultipliedAlpha: false });
if (!gl) {
    const msg = document.createElement('p');
    msg.style.cssText = 'color:#fff;padding:2rem;font-family:system-ui';
    msg.textContent = 'WebGL2 is required and not available in this browser.';
    document.body.replaceChildren(msg);
    throw new Error('WebGL2 not supported');
}

const programSingle = createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER_SINGLE);
const programMulti  = createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER_MULTI);

const vao = gl.createVertexArray();
gl.bindVertexArray(vao);
const buf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, buf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1,  1, -1,  -1, 1,
    -1,  1,  1, -1,   1, 1,
]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

function getUniforms(prog, names) {
    const out = {};
    names.forEach(n => { out[n] = gl.getUniformLocation(prog, n); });
    return out;
}

const SINGLE_UNIFORMS = ['u_diskPhase', 'u_audioPhase', 'u_fDisk', 'u_fAudio', 'u_dt',
    'u_innerR', 'u_outerR', 'u_gamma', 'u_ledThreshold', 'u_ledNorm',
    'u_audioTex', 'u_useAudioBuf', 'u_audioStart', 'u_audioStep'];
const MULTI_UNIFORMS = ['u_canvasSize', 'u_strobeCenters', 'u_strobeRadii',
    'u_strobePhases', 'u_strobeFreqs', 'u_strobeCount',
    'u_audioPhase', 'u_fAudio', 'u_dt', 'u_innerR', 'u_outerR', 'u_gamma',
    'u_ledThreshold', 'u_ledNorm',
    'u_audioTex', 'u_useAudioBuf', 'u_audioStart', 'u_audioStep'];

const uSingle = getUniforms(programSingle, SINGLE_UNIFORMS);
const uMulti  = getUniforms(programMulti, MULTI_UNIFORMS);

const audioTex = gl.createTexture();
gl.activeTexture(gl.TEXTURE0);
gl.bindTexture(gl.TEXTURE_2D, audioTex);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, AUDIO_BUF_LEN, 1, 0, gl.RED, gl.UNSIGNED_BYTE, null);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
gl.useProgram(programSingle);
gl.uniform1i(uSingle.u_audioTex, 0);
gl.useProgram(programMulti);
gl.uniform1i(uMulti.u_audioTex, 0);

function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(64, Math.floor(rect.width * dpr));
    const h = Math.max(64, Math.floor(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        if (state.mode === 'multi') {
            updateMultiLayout();
            updateLabels();
        }
    }
}

const targetReadout = document.getElementById('targetReadout');
const inputReadout = document.getElementById('inputReadout');
const fpsReadout = document.getElementById('fpsReadout');

function uploadAudioBuffer(wallTime) {
    if (!analyser) return false;
    analyser.getFloatTimeDomainData(audioBuf);
    lastCaptureTime = audioCtx.currentTime;
    checkAudioSync(wallTime, lastCaptureTime);

    // Compute RMS over the buffer; use as threshold so any sustained signal level triggers.
    // RMS tracks average energy and is immune to brief transient peaks that would
    // otherwise drive a peak-based threshold too high and starve the display.
    let sumSq = 0;
    for (let i = 0; i < AUDIO_BUF_LEN; i++) sumSq += audioBuf[i] * audioBuf[i];
    const rms = Math.sqrt(sumSq / AUDIO_BUF_LEN);
    if (rms > 0.005) {
        ledThreshold = rms;
        ledNorm = LED_NORM;
    } else {
        ledThreshold = 1.1; // silence → never fires
        ledNorm = 1.0;
    }

    for (let i = 0; i < AUDIO_BUF_LEN; i++) {
        const v = audioBuf[i];
        const c = v < -1 ? -1 : v > 1 ? 1 : v;
        audioU8[i] = ((c + 1) * 127.5) | 0;
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, audioTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, AUDIO_BUF_LEN, 1, gl.RED, gl.UNSIGNED_BYTE, audioU8);
    return true;
}

function updateMultiFreqs() {
    for (let i = 0; i < MULTI_COUNT; i++) {
        multiFreqs[i] = noteFreq(i, state.activeOctave) * 0.5;
    }
}

function updateMultiLayout() {
    const rect = canvas.getBoundingClientRect();
    const cssW = rect.width;
    const cssH = rect.height;
    if (cssW <= 0 || cssH <= 0) return;
    const dpr = canvas.width / cssW;

    const cellW = cssW / 7;
    const labelGap = 22;
    const margin = 8;
    const stackGap = 4;

    // r is constrained horizontally: gap = cellW - 2*r*sin(45°) = 10% of arc width
    // → r = cellW / (2 * sin(45°) * 1.1) ≈ cellW * 0.643
    // and vertically (two rows of r + labelGap must fit in canvas)
    const horizMaxR = cellW * 0.643;
    const fitR = (cssH - 2 * margin - stackGap - 2 * labelGap) / 2;
    const r = Math.max(8, Math.min(horizMaxR, fitR));

    // Cell spans from arc top (cy - r) to label bottom (cy + labelGap)
    const cellH = r + labelGap;
    const totalH = 2 * cellH + stackGap;
    const offsetY = Math.max(margin, (cssH - totalH) / 2);
    const topCellTop = offsetY;
    const bottomCellTop = offsetY + cellH + stackGap;

    const positions = new Array(MULTI_COUNT);

    WHITE_NOTES.forEach((noteIdx, col) => {
        const cx = (col + 0.5) * cellW;
        const cy = bottomCellTop + r;
        positions[noteIdx] = { cx, cy, r, arcBottomY: cy };
    });

    BLACK_NOTES.forEach((noteIdx, i) => {
        const cx = BLACK_X_POS[i] * cellW;
        const cy = topCellTop + r;
        positions[noteIdx] = { cx, cy, r, arcBottomY: cy };
    });

    multiLayoutCSS = positions;
    for (let i = 0; i < MULTI_COUNT; i++) {
        multiCenters[2 * i]     = positions[i].cx * dpr;
        multiCenters[2 * i + 1] = positions[i].cy * dpr;
        multiRadii[i]           = positions[i].r * dpr;
    }
}

const labelEls = [];
for (let i = 0; i < MULTI_COUNT; i++) {
    const el = document.createElement('div');
    el.className = 'strobe-label';
    const noteEl = document.createElement('span');
    noteEl.className = 'note';
    const freqEl = document.createElement('span');
    freqEl.className = 'freq';
    const freq2El = document.createElement('span');
    freq2El.className = 'freq2';
    el.appendChild(noteEl);
    el.appendChild(freqEl);
    el.appendChild(freq2El);
    labelContainer.appendChild(el);
    labelEls.push({ el, noteEl, freqEl, freq2El });
}

function updateLabels() {
    if (!multiLayoutCSS) return;
    const oct = state.activeOctave;
    for (let i = 0; i < MULTI_COUNT; i++) {
        const pos = multiLayoutCSS[i];
        labelEls[i].el.style.left = pos.cx + 'px';
        labelEls[i].el.style.top = (pos.arcBottomY + 3) + 'px';
        labelEls[i].noteEl.textContent = NOTE_NAMES[i] + oct;
        const f = noteFreq(i, oct);
        labelEls[i].freqEl.textContent = f.toFixed(1);
        labelEls[i].freq2El.textContent = (f * 2).toFixed(1);
    }
}

function setReadouts(fStrobeRate, fAudio) {
    if (state.mode === 'multi') {
        const oct = state.activeOctave;
        targetReadout.textContent = `Octave ${oct} (C${oct} ${noteFreq(0, oct).toFixed(1)} - C${oct + 1} ${noteFreq(0, oct + 1).toFixed(1)} Hz)`;
    } else {
        targetReadout.textContent = `${fmtFreq(fStrobeRate)} Hz · ${nearestNoteLabel(fStrobeRate)}`;
    }
    if (state.audioMode === 'sine') {
        const sign = state.detuneCents >= 0 ? '+' : '';
        inputReadout.textContent = `${fmtFreq(fAudio)} Hz · ${sign}${state.detuneCents.toFixed(1)}\u00A2`;
    } else if (state.audioMode === 'mic') {
        inputReadout.textContent = `Live mic · ${audioBufRate} Hz`;
    } else if (state.audioMode === 'loopback') {
        inputReadout.textContent = `Tab audio · ${audioBufRate} Hz`;
    }
}

const INNER_R = 2 / 9; // 2 ring-widths of center gap with 7 rings

function renderSingle(dt, elapsed, wallTime) {
    gl.useProgram(programSingle);

    const fStrobeRate = state.fStrobe;
    const fDiskRotation = fStrobeRate * 0.5;
    const fAudio = state.audioFreq * Math.pow(2, state.detuneCents / 1200);
    const TAU = 2 * Math.PI;

    const usingBuf = state.audioMode !== 'sine' && uploadAudioBuffer(wallTime);
    const bufDuration = AUDIO_BUF_LEN / audioBufRate;
    const intDt = usingBuf ? Math.min(dt, bufDuration) : dt;

    let intDiskPhase, intAudioPhase;
    if (usingBuf) {
        // Anchor to audio clock — avoids drift between performance.now() and audioCtx.currentTime.
        state.diskPhase  = audioPhaseAt(fDiskRotation, lastCaptureTime);
        state.audioPhase = audioPhaseAt(fAudio, lastCaptureTime);
        intDiskPhase  = audioPhaseAt(fDiskRotation, lastCaptureTime - intDt);
        intAudioPhase = audioPhaseAt(fAudio,        lastCaptureTime - intDt);
    } else {
        ledThreshold = LED_THRESHOLD_SINE;
        ledNorm = LED_NORM;
        state.diskPhase  = (state.diskPhase  + TAU * fDiskRotation * elapsed) % TAU;
        state.audioPhase = (state.audioPhase + TAU * fAudio        * elapsed) % TAU;
        intDiskPhase  = state.diskPhase  - TAU * fDiskRotation * intDt;
        intAudioPhase = state.audioPhase - TAU * fAudio        * intDt;
    }

    gl.uniform1f(uSingle.u_diskPhase, intDiskPhase);
    gl.uniform1f(uSingle.u_audioPhase, intAudioPhase);
    gl.uniform1f(uSingle.u_fDisk, fDiskRotation);
    gl.uniform1f(uSingle.u_fAudio, fAudio);
    gl.uniform1f(uSingle.u_dt, intDt);
    gl.uniform1f(uSingle.u_innerR, INNER_R);
    gl.uniform1f(uSingle.u_outerR, 0.92);
    gl.uniform1f(uSingle.u_gamma, state.gamma);
    gl.uniform1f(uSingle.u_ledThreshold, ledThreshold);
    gl.uniform1f(uSingle.u_ledNorm, ledNorm);
    gl.uniform1i(uSingle.u_useAudioBuf, usingBuf ? 1 : 0);
    if (usingBuf) {
        const span = Math.min(intDt / bufDuration, 1);
        gl.uniform1f(uSingle.u_audioStart, 1 - span);
        gl.uniform1f(uSingle.u_audioStep, span);
    } else {
        gl.uniform1f(uSingle.u_audioStart, 0);
        gl.uniform1f(uSingle.u_audioStep, 0);
    }

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    if (toneOsc && audioCtx) {
        toneOsc.frequency.setTargetAtTime(fAudio, audioCtx.currentTime, 0.01);
    }

    setReadouts(fStrobeRate, fAudio);
}

function renderMulti(dt, elapsed, wallTime) {
    gl.useProgram(programMulti);

    updateMultiFreqs();
    const fAudio = state.audioFreq * Math.pow(2, state.detuneCents / 1200);
    const TAU = 2 * Math.PI;

    const usingBuf = state.audioMode !== 'sine' && uploadAudioBuffer(wallTime);
    const bufDuration = AUDIO_BUF_LEN / audioBufRate;
    const intDt = usingBuf ? Math.min(dt, bufDuration) : dt;

    let intAudioPhase;
    if (usingBuf) {
        for (let i = 0; i < MULTI_COUNT; i++) {
            multiPhases[i]    = audioPhaseAt(multiFreqs[i], lastCaptureTime);
            intMultiPhases[i] = audioPhaseAt(multiFreqs[i], lastCaptureTime - intDt);
        }
        state.audioPhase = audioPhaseAt(fAudio, lastCaptureTime);
        intAudioPhase    = audioPhaseAt(fAudio, lastCaptureTime - intDt);
    } else {
        ledThreshold = LED_THRESHOLD_SINE;
        ledNorm = LED_NORM;
        for (let i = 0; i < MULTI_COUNT; i++) {
            multiPhases[i]    = (multiPhases[i] + TAU * multiFreqs[i] * elapsed) % TAU;
            intMultiPhases[i] = multiPhases[i] - TAU * multiFreqs[i] * intDt;
        }
        state.audioPhase = (state.audioPhase + TAU * fAudio * elapsed) % TAU;
        intAudioPhase    = state.audioPhase - TAU * fAudio * intDt;
    }

    gl.uniform2f(uMulti.u_canvasSize, canvas.width, canvas.height);
    gl.uniform2fv(uMulti.u_strobeCenters, multiCenters);
    gl.uniform1fv(uMulti.u_strobeRadii, multiRadii);
    gl.uniform1fv(uMulti.u_strobePhases, intMultiPhases);
    gl.uniform1fv(uMulti.u_strobeFreqs, multiFreqs);
    gl.uniform1i(uMulti.u_strobeCount, MULTI_COUNT);
    gl.uniform1f(uMulti.u_audioPhase, intAudioPhase);
    gl.uniform1f(uMulti.u_fAudio, fAudio);
    gl.uniform1f(uMulti.u_dt, intDt);
    gl.uniform1f(uMulti.u_innerR, INNER_R);
    gl.uniform1f(uMulti.u_outerR, 1.0);
    gl.uniform1f(uMulti.u_gamma, state.gamma);
    gl.uniform1f(uMulti.u_ledThreshold, ledThreshold);
    gl.uniform1f(uMulti.u_ledNorm, ledNorm);
    gl.uniform1i(uMulti.u_useAudioBuf, usingBuf ? 1 : 0);
    if (usingBuf) {
        const span = Math.min(intDt / bufDuration, 1);
        gl.uniform1f(uMulti.u_audioStart, 1 - span);
        gl.uniform1f(uMulti.u_audioStep, span);
    } else {
        gl.uniform1f(uMulti.u_audioStart, 0);
        gl.uniform1f(uMulti.u_audioStep, 0);
    }

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    if (toneOsc && audioCtx) {
        toneOsc.frequency.setTargetAtTime(fAudio, audioCtx.currentTime, 0.01);
    }

    setReadouts(state.fStrobe, fAudio);
}

function render(dt, elapsed, wallTime) {
    resizeCanvas();

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.BLEND);

    if (state.mode === 'multi') renderMulti(dt, elapsed, wallTime);
    else renderSingle(dt, elapsed, wallTime);
}

function loop(timeMs) {
    const t = timeMs / 1000;
    let elapsed = state.lastFrameTime ? t - state.lastFrameTime : 1 / 60;
    state.lastFrameTime = t;
    if (elapsed <= 0) elapsed = 1 / 60;

    const dt = Math.min(elapsed, 0.1);

    state.fpsAvg = state.fpsAvg * 0.92 + (1 / dt) * 0.08;
    fpsReadout.textContent = state.fpsAvg.toFixed(1);

    render(dt, elapsed, t);
    requestAnimationFrame(loop);
}

const rateSlider = document.getElementById('rateSlider');
const rateInput = document.getElementById('rateInput');
const audioFreqSlider = document.getElementById('audioFreqSlider');
const audioFreqInput = document.getElementById('audioFreqInput');
const sourceSelect = document.getElementById('audioSource');
const noteContainer = document.getElementById('noteButtons');
const noteButtonEls = [];
const octaveBtns = document.querySelectorAll('#octaveButtons button');
const noteRow = noteContainer;
const strobeRateRow = document.getElementById('strobeRateRow');

function freqToSliderV(f) {
    return Math.max(0, Math.min(RATE_LOG_MAX, Math.log2(Math.max(f, RATE_MIN) / RATE_MIN)));
}
function sliderVToFreq(v) { return RATE_MIN * Math.pow(2, v); }

function syncRateUI() {
    rateSlider.value = String(freqToSliderV(state.fStrobe));
    if (document.activeElement !== rateInput) rateInput.value = fmtFreq(state.fStrobe);
}
function syncAudioFreqUI() {
    audioFreqSlider.value = String(freqToSliderV(state.audioFreq));
    if (document.activeElement !== audioFreqInput) audioFreqInput.value = fmtFreq(state.audioFreq);
}

function updateNoteHighlight() {
    const f = noteFreq(state.activeNoteIdx, state.activeOctave);
    const matches = Math.abs(state.fStrobe - f) < 1e-4;
    noteButtonEls.forEach((b, i) => {
        b.classList.toggle('active', matches && i === state.activeNoteIdx);
    });
    octaveBtns.forEach(b => {
        b.classList.toggle('active',
            (matches || state.mode === 'multi') &&
            parseInt(b.dataset.octave, 10) === state.activeOctave);
    });
}

for (let i = 0; i < 12; i++) {
    const btn = document.createElement('button');
    btn.textContent = NOTE_NAMES[i];
    if (SHARP_SET.has(NOTE_NAMES[i])) btn.classList.add('sharp');
    btn.addEventListener('click', () => {
        state.activeNoteIdx = i;
        const f = noteFreq(i, state.activeOctave);
        state.fStrobe = f;
        state.audioFreq = f;
        syncRateUI();
        syncAudioFreqUI();
        updateNoteHighlight();
        savePersisted();
    });
    noteContainer.appendChild(btn);
    noteButtonEls.push(btn);
}

octaveBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        state.activeOctave = parseInt(btn.dataset.octave, 10);
        const f = noteFreq(state.activeNoteIdx, state.activeOctave);
        state.fStrobe = f;
        state.audioFreq = f;
        syncRateUI();
        syncAudioFreqUI();
        updateNoteHighlight();
        if (state.mode === 'multi') updateLabels();
        savePersisted();
    });
});

rateSlider.addEventListener('input', () => {
    state.fStrobe = sliderVToFreq(parseFloat(rateSlider.value));
    rateInput.value = fmtFreq(state.fStrobe);
    updateNoteHighlight();
});
function commitRateInput() {
    const v = parseFloat(rateInput.value);
    if (!isFinite(v) || v <= 0) { syncRateUI(); return; }
    state.fStrobe = Math.min(5000, Math.max(0.01, v));
    syncRateUI();
    updateNoteHighlight();
    savePersisted();
}
rateSlider.addEventListener('change', savePersisted);
rateInput.addEventListener('change', commitRateInput);
rateInput.addEventListener('keydown', e => { if (e.key === 'Enter') rateInput.blur(); });

audioFreqSlider.addEventListener('input', () => {
    state.audioFreq = sliderVToFreq(parseFloat(audioFreqSlider.value));
    audioFreqInput.value = fmtFreq(state.audioFreq);
    updateNoteHighlight();
});
audioFreqSlider.addEventListener('change', savePersisted);
function commitAudioFreqInput() {
    const v = parseFloat(audioFreqInput.value);
    if (!isFinite(v) || v <= 0) { syncAudioFreqUI(); return; }
    state.audioFreq = Math.min(20000, Math.max(0.01, v));
    syncAudioFreqUI();
    savePersisted();
}
audioFreqInput.addEventListener('change', commitAudioFreqInput);
audioFreqInput.addEventListener('keydown', e => { if (e.key === 'Enter') audioFreqInput.blur(); });

const detuneSlider = document.getElementById('detune');
const detuneVal = document.getElementById('detuneValue');
detuneSlider.addEventListener('input', () => {
    state.detuneCents = parseFloat(detuneSlider.value);
    const sign = state.detuneCents >= 0 ? '+' : '';
    detuneVal.textContent = `${sign}${state.detuneCents.toFixed(1)}\u00A2`;
});
detuneSlider.addEventListener('change', savePersisted);

const gammaSlider = document.getElementById('gammaSlider');
const gammaVal = document.getElementById('gammaValue');
gammaSlider.addEventListener('input', () => {
    state.gamma = parseFloat(gammaSlider.value);
    gammaVal.textContent = state.gamma.toFixed(2);
});
gammaSlider.addEventListener('change', savePersisted);

const advancedDetails = document.getElementById('advancedAppearance');
const ADVANCED_OPEN_KEY = 'strobe-tuner-advanced-open';
if (localStorage.getItem(ADVANCED_OPEN_KEY) === 'true') advancedDetails.open = true;
advancedDetails.addEventListener('toggle', () => {
    localStorage.setItem(ADVANCED_OPEN_KEY, String(advancedDetails.open));
});

document.getElementById('playTone').addEventListener('change', e => {
    if (e.target.checked) {
        const f = state.audioFreq * Math.pow(2, state.detuneCents / 1200);
        startTone(f);
    } else {
        stopTone();
    }
});

function updateSourceUI() {
    const isSine = state.audioMode === 'sine';
    document.getElementById('audioFreqControl').style.display = isSine ? '' : 'none';
    document.getElementById('detuneControl').style.display = isSine ? '' : 'none';
}

sourceSelect.addEventListener('change', e => {
    const v = e.target.value;
    state.activeSource = v;
    if (v === 'sine') {
        cleanupCapture();
        state.audioMode = 'sine';
    } else if (v === 'mic') {
        activateMic();
    } else if (v.startsWith('mic:')) {
        activateMic(v.slice(4));
    } else if (v === 'loopback') {
        activateLoopback();
    }
    updateSourceUI();
    savePersisted();
});

const multiToggle = document.getElementById('multiMode');
function setMode(mode) {
    state.mode = mode;
    canvasWrap.classList.toggle('single-mode', mode === 'single');
    canvasWrap.classList.toggle('multi-mode', mode === 'multi');
    if (noteRow) noteRow.style.display = mode === 'multi' ? 'none' : '';
    if (strobeRateRow) strobeRateRow.style.display = mode === 'multi' ? 'none' : '';
    updateNoteHighlight();
    requestAnimationFrame(() => {
        resizeCanvas();
        if (mode === 'multi') {
            updateMultiLayout();
            updateLabels();
        }
    });
}
multiToggle.addEventListener('change', e => {
    setMode(e.target.checked ? 'multi' : 'single');
    savePersisted();
});

if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', refreshDeviceList);
}

document.addEventListener('visibilitychange', () => {
    if (document.hidden) state.lastFrameTime = 0;
});

window.addEventListener('resize', () => {
    if (state.mode === 'multi') {
        requestAnimationFrame(() => {
            resizeCanvas();
            updateMultiLayout();
            updateLabels();
        });
    }
});

function syncAllUI() {
    syncRateUI();
    syncAudioFreqUI();
    detuneSlider.value = String(state.detuneCents);
    const dSign = state.detuneCents >= 0 ? '+' : '';
    detuneVal.textContent = `${dSign}${state.detuneCents.toFixed(1)}\u00A2`;
    gammaSlider.value = String(state.gamma);
    gammaVal.textContent = state.gamma.toFixed(2);
    multiToggle.checked = (state.mode === 'multi');
    document.getElementById('playTone').checked = false;
    sourceSelect.value = 'sine';  // shown initially; updated after device enumeration restores mic
    state.audioMode = 'sine';
    updateNoteHighlight();
    updateSourceUI();
}

const CONSENT_KEY = 'strobe-consent';

function startStrobe() {
    initDevicesAndRestoreSource();
    requestAnimationFrame(loop);
}

syncAllUI();
setMode(state.mode);

const consentOverlay = document.getElementById('consentOverlay');

function hideConsentAndStart() {
    consentOverlay.style.display = 'none';
    startStrobe();
}

if (localStorage.getItem(CONSENT_KEY) === '1') {
    hideConsentAndStart();
} else {
    document.getElementById('consentBtn').addEventListener('click', () => {
        localStorage.setItem(CONSENT_KEY, '1');
        hideConsentAndStart();
    });
}
