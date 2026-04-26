// Strobe Browser Tuner — POC
// Two display modes:
//   single — one full-circle strobe disk
//   multi  — 13-note piano layout, each note shown as a 120° arc strobe
// LED source: synthetic sine, microphone, or system-audio capture.

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
uniform int u_numRings;
uniform int u_samples;

uniform sampler2D u_audioTex;
uniform int u_useAudioBuf;
uniform float u_audioStart;
uniform float u_audioStep;
uniform float u_alpha;

const float TAU = 6.28318530717959;
const int MAX_SAMPLES = 256;

void main() {
    float r = length(v_pos);
    float theta = atan(v_pos.y, v_pos.x);

    if (r > u_outerR + 0.005) {
        outColor = vec4(0.05, 0.06, 0.08, u_alpha);
        return;
    }
    if (r < u_innerR) {
        float h = smoothstep(u_innerR, u_innerR - 0.02, r);
        outColor = vec4(vec3(0.10 + 0.04 * h), u_alpha);
        return;
    }

    float ringSpan = (u_outerR - u_innerR) / float(u_numRings);
    float ringPos = (r - u_innerR) / ringSpan;
    int ringIdx = int(floor(ringPos));
    if (ringIdx >= u_numRings) ringIdx = u_numRings - 1;
    float ringN = pow(2.0, float(ringIdx + 1));

    float omegaDisk = TAU * u_fDisk;
    float omegaAudio = TAU * u_fAudio;
    float invSamples = 1.0 / float(u_samples);

    float accum = 0.0;
    float ledNorm = 0.0;

    for (int i = 0; i < MAX_SAMPLES; i++) {
        if (i >= u_samples) break;
        float frac = (float(i) + 0.5) * invSamples;
        float t = frac * u_dt;

        float diskAng = u_diskPhase + omegaDisk * t;
        float maskArg = ringN * (theta - diskAng);
        float mask = step(0.0, cos(maskArg));

        float led;
        if (u_useAudioBuf == 1) {
            float u = u_audioStart + frac * u_audioStep;
            float s = texture(u_audioTex, vec2(u, 0.5)).r * 2.0 - 1.0;
            led = max(0.0, s);
        } else {
            float audioCos = cos(u_audioPhase + omegaAudio * t);
            led = max(0.0, audioCos);
        }

        accum += mask * led;
        ledNorm += led;
    }

    float brightness = accum / max(ledNorm, 1e-6);
    brightness = pow(brightness, 0.7);

    float ringFrac = ringPos - float(ringIdx);
    float edge = min(ringFrac, 1.0 - ringFrac);
    if (edge < 0.012) brightness *= edge / 0.012;

    outColor = vec4(vec3(brightness), u_alpha);
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
uniform int u_numRings;
uniform int u_samples;

uniform sampler2D u_audioTex;
uniform int u_useAudioBuf;
uniform float u_audioStart;
uniform float u_audioStep;
uniform float u_alpha;

const float TAU = 6.28318530717959;
const int MAX_SAMPLES = 256;
const int MAX_STROBES = 12;
const float ARC_HALF_ANGLE = 1.04719755;

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
            outColor = vec4(0.10, 0.11, 0.14, u_alpha);
            return;
        }
        hitIdx = i;
        hitLocal = local;
        hitR = strobeR;
        break;
    }

    if (hitIdx < 0) {
        outColor = vec4(0.05, 0.06, 0.08, u_alpha);
        return;
    }

    float dist = length(hitLocal);
    float r_norm = dist / hitR;
    float theta = atan(-hitLocal.y, hitLocal.x);

    float fDisk = u_strobeFreqs[hitIdx];
    float diskPhase = u_strobePhases[hitIdx];

    float ringSpan = (u_outerR - u_innerR) / float(u_numRings);
    float ringPos = (r_norm - u_innerR) / ringSpan;
    int ringIdx = int(floor(ringPos));
    if (ringIdx >= u_numRings) ringIdx = u_numRings - 1;
    float ringN = pow(2.0, float(ringIdx + 1));

    float omegaDisk = TAU * fDisk;
    float omegaAudio = TAU * u_fAudio;
    float invSamples = 1.0 / float(u_samples);

    float accum = 0.0;
    float ledNorm = 0.0;

    for (int j = 0; j < MAX_SAMPLES; j++) {
        if (j >= u_samples) break;
        float frac = (float(j) + 0.5) * invSamples;
        float t = frac * u_dt;

        float diskAng = diskPhase + omegaDisk * t;
        float maskArg = ringN * (theta - diskAng);
        float mask = step(0.0, cos(maskArg));

        float led;
        if (u_useAudioBuf == 1) {
            float u = u_audioStart + frac * u_audioStep;
            float s = texture(u_audioTex, vec2(u, 0.5)).r * 2.0 - 1.0;
            led = max(0.0, s);
        } else {
            float audioCos = cos(u_audioPhase + omegaAudio * t);
            led = max(0.0, audioCos);
        }

        accum += mask * led;
        ledNorm += led;
    }

    float brightness = accum / max(ledNorm, 1e-6);
    brightness = pow(brightness, 0.7);

    float ringFrac = ringPos - float(ringIdx);
    float edge = min(ringFrac, 1.0 - ringFrac);
    if (edge < 0.012) brightness *= edge / 0.012;

    outColor = vec4(vec3(brightness), u_alpha);
}
`;

const FRAGMENT_SHADER_BLIT = `#version 300 es
precision highp float;
in vec2 v_pos;
out vec4 outColor;
uniform sampler2D u_tex;
void main() {
    vec2 uv = v_pos * 0.5 + 0.5;
    outColor = vec4(texture(u_tex, uv).rgb, 1.0);
}
`;

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const SHARP_SET = new Set(['C#', 'D#', 'F#', 'G#', 'A#']);
const RATE_MIN = 1;
const RATE_MAX = 2000;
const RATE_LOG_MAX = Math.log2(RATE_MAX / RATE_MIN);
const AUDIO_BUF_LEN = 2048;

// Multi-strobe layout: one octave, 12 notes
// Notes 0..11 = C, C#, D, D#, E, F, F#, G, G#, A, A#, B
const WHITE_NOTES = [0, 2, 4, 5, 7, 9, 11];
const BLACK_NOTES = [1, 3, 6, 8, 10];
const BLACK_X_POS = [1, 2, 4, 5, 6];   // x position in white-cell-width units
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
    numRings: 4,
    samples: 64,
    persistence: 60,
    diskPhase: 0,
    audioPhase: 0,
    lastFrameTime: 0,
    fpsAvg: 60,
};

function persistenceToAlpha(p) {
    return Math.max(0.05, 1 - (p / 100) * 0.95);
}

const PERSIST_KEY = 'strobe-tuner-state-v1';
const PERSIST_FIELDS = ['mode', 'fStrobe', 'audioFreq', 'detuneCents',
    'activeNoteIdx', 'activeOctave', 'numRings', 'samples', 'persistence'];

function loadPersisted() {
    try {
        const raw = localStorage.getItem(PERSIST_KEY);
        if (!raw) return;
        const data = JSON.parse(raw);
        for (const k of PERSIST_FIELDS) {
            if (data[k] !== undefined) state[k] = data[k];
        }
    } catch (_) { /* corrupt entry; ignore */ }
}

function savePersisted() {
    try {
        const out = {};
        for (const k of PERSIST_FIELDS) out[k] = state[k];
        localStorage.setItem(PERSIST_KEY, JSON.stringify(out));
    } catch (_) {}
}

loadPersisted();

const multiPhases  = new Float32Array(MULTI_COUNT);
const multiFreqs   = new Float32Array(MULTI_COUNT);
const multiCenters = new Float32Array(MULTI_COUNT * 2);
const multiRadii   = new Float32Array(MULTI_COUNT);
let multiLayoutCSS = null;

let audioCtx = null;
let toneOsc = null, toneGain = null;
let micStream = null, micSourceNode = null, analyser = null;
const audioBuf = new Float32Array(AUDIO_BUF_LEN);
const audioU8 = new Uint8Array(AUDIO_BUF_LEN);
let audioBufRate = 44100;

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

function cleanupCapture() {
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
    'u_innerR', 'u_outerR', 'u_numRings', 'u_samples',
    'u_audioTex', 'u_useAudioBuf', 'u_audioStart', 'u_audioStep', 'u_alpha'];
const MULTI_UNIFORMS = ['u_canvasSize', 'u_strobeCenters', 'u_strobeRadii',
    'u_strobePhases', 'u_strobeFreqs', 'u_strobeCount',
    'u_audioPhase', 'u_fAudio', 'u_dt', 'u_innerR', 'u_outerR', 'u_numRings', 'u_samples',
    'u_audioTex', 'u_useAudioBuf', 'u_audioStart', 'u_audioStep', 'u_alpha'];

const uSingle = getUniforms(programSingle, SINGLE_UNIFORMS);
const uMulti  = getUniforms(programMulti, MULTI_UNIFORMS);

const programBlit = createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER_BLIT);
const uBlit = getUniforms(programBlit, ['u_tex']);
gl.useProgram(programBlit);
gl.uniform1i(uBlit.u_tex, 1);

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

const accumTex = gl.createTexture();
gl.activeTexture(gl.TEXTURE1);
gl.bindTexture(gl.TEXTURE_2D, accumTex);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
const accumFBO = gl.createFramebuffer();

let accumW = 0, accumH = 0;

function resizeAccum(w, h) {
    if (accumW === w && accumH === h) return;
    accumW = w;
    accumH = h;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, accumTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, accumFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, accumTex, 0);
    clearAccum();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function clearAccum() {
    gl.bindFramebuffer(gl.FRAMEBUFFER, accumFBO);
    gl.viewport(0, 0, accumW, accumH);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
}

function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(64, Math.floor(rect.width * dpr));
    const h = Math.max(64, Math.floor(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        resizeAccum(w, h);
        if (state.mode === 'multi') {
            updateMultiLayout();
            updateLabels();
        }
    }
}

const targetReadout = document.getElementById('targetReadout');
const inputReadout = document.getElementById('inputReadout');
const fpsReadout = document.getElementById('fpsReadout');

function uploadAudioBuffer() {
    if (!analyser) return false;
    analyser.getFloatTimeDomainData(audioBuf);
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
    const radiusFactor = 0.56;
    const labelGap = 24;
    const margin = 8;

    const horizMaxR = cellW * radiusFactor;
    const cellHFromR = (r) => r * 0.5 + labelGap;

    const stackGap = 4;
    const fitR = (cssH - 2 * margin - stackGap - 2 * labelGap) / (2 * 0.5);
    const r = Math.max(8, Math.min(horizMaxR, fitR));

    const arcH = r * 0.5;
    const cellH = arcH + labelGap;
    const totalH = 2 * cellH + stackGap;
    const offsetY = Math.max(margin, (cssH - totalH) / 2);
    const topCellTop = offsetY;
    const bottomCellTop = offsetY + cellH + stackGap;

    const positions = new Array(MULTI_COUNT);

    WHITE_NOTES.forEach((noteIdx, col) => {
        const cx = (col + 0.5) * cellW;
        const cy = bottomCellTop + r;
        positions[noteIdx] = { cx, cy, r, arcBottomY: cy - r * 0.5 };
    });

    BLACK_NOTES.forEach((noteIdx, i) => {
        const cx = BLACK_X_POS[i] * cellW;
        const cy = topCellTop + r;
        positions[noteIdx] = { cx, cy, r, arcBottomY: cy - r * 0.5 };
    });

    multiLayoutCSS = positions;
    for (let i = 0; i < MULTI_COUNT; i++) {
        multiCenters[2 * i] = positions[i].cx * dpr;
        multiCenters[2 * i + 1] = positions[i].cy * dpr;
        multiRadii[i] = positions[i].r * dpr;
    }
}

const labelEls = [];
for (let i = 0; i < MULTI_COUNT; i++) {
    const el = document.createElement('div');
    el.className = 'strobe-label';
    const noteEl = document.createElement('span');
    noteEl.className = 'note';
    const brEl = document.createElement('br');
    const freqEl = document.createElement('span');
    freqEl.className = 'freq';
    el.appendChild(noteEl);
    el.appendChild(brEl);
    el.appendChild(freqEl);
    labelContainer.appendChild(el);
    labelEls.push({ el, noteEl, freqEl });
}

function updateLabels() {
    if (!multiLayoutCSS) return;
    const oct = state.activeOctave;
    for (let i = 0; i < MULTI_COUNT; i++) {
        const pos = multiLayoutCSS[i];
        labelEls[i].el.style.left = pos.cx + 'px';
        labelEls[i].el.style.top = (pos.arcBottomY + 3) + 'px';
        labelEls[i].noteEl.textContent = NOTE_NAMES[i] + oct;
        labelEls[i].freqEl.textContent = noteFreq(i, oct).toFixed(1);
    }
}

function advanceMultiPhases(dt) {
    const TAU = 2 * Math.PI;
    for (let i = 0; i < MULTI_COUNT; i++) {
        multiPhases[i] = (multiPhases[i] + TAU * multiFreqs[i] * dt) % TAU;
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

function renderSingle(dt) {
    gl.useProgram(programSingle);

    const fStrobeRate = state.fStrobe;
    const fDiskRotation = fStrobeRate * 0.5;
    const fAudio = state.audioFreq * Math.pow(2, state.detuneCents / 1200);

    const usingBuf = state.audioMode !== 'sine' && uploadAudioBuffer();

    gl.uniform1f(uSingle.u_diskPhase, state.diskPhase);
    gl.uniform1f(uSingle.u_audioPhase, state.audioPhase);
    gl.uniform1f(uSingle.u_fDisk, fDiskRotation);
    gl.uniform1f(uSingle.u_fAudio, fAudio);
    gl.uniform1f(uSingle.u_dt, dt);
    gl.uniform1f(uSingle.u_innerR, 0.20);
    gl.uniform1f(uSingle.u_outerR, 0.92);
    gl.uniform1i(uSingle.u_numRings, state.numRings);
    gl.uniform1i(uSingle.u_samples, state.samples);
    gl.uniform1i(uSingle.u_useAudioBuf, usingBuf ? 1 : 0);
    if (usingBuf) {
        const bufDuration = AUDIO_BUF_LEN / audioBufRate;
        const span = Math.min(dt / bufDuration, 1);
        gl.uniform1f(uSingle.u_audioStart, 1 - span);
        gl.uniform1f(uSingle.u_audioStep, span);
    } else {
        gl.uniform1f(uSingle.u_audioStart, 0);
        gl.uniform1f(uSingle.u_audioStep, 0);
    }
    gl.uniform1f(uSingle.u_alpha, persistenceToAlpha(state.persistence));

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    const TAU = 2 * Math.PI;
    state.diskPhase = (state.diskPhase + TAU * fDiskRotation * dt) % TAU;
    state.audioPhase = (state.audioPhase + TAU * fAudio * dt) % TAU;

    if (toneOsc && audioCtx) {
        toneOsc.frequency.setTargetAtTime(fAudio, audioCtx.currentTime, 0.01);
    }

    setReadouts(fStrobeRate, fAudio);
}

function renderMulti(dt) {
    gl.useProgram(programMulti);

    updateMultiFreqs();
    const fAudio = state.audioFreq * Math.pow(2, state.detuneCents / 1200);
    const usingBuf = state.audioMode !== 'sine' && uploadAudioBuffer();

    gl.uniform2f(uMulti.u_canvasSize, canvas.width, canvas.height);
    gl.uniform2fv(uMulti.u_strobeCenters, multiCenters);
    gl.uniform1fv(uMulti.u_strobeRadii, multiRadii);
    gl.uniform1fv(uMulti.u_strobePhases, multiPhases);
    gl.uniform1fv(uMulti.u_strobeFreqs, multiFreqs);
    gl.uniform1i(uMulti.u_strobeCount, MULTI_COUNT);
    gl.uniform1f(uMulti.u_audioPhase, state.audioPhase);
    gl.uniform1f(uMulti.u_fAudio, fAudio);
    gl.uniform1f(uMulti.u_dt, dt);
    gl.uniform1f(uMulti.u_innerR, 0.55);
    gl.uniform1f(uMulti.u_outerR, 1.0);
    gl.uniform1i(uMulti.u_numRings, state.numRings);
    gl.uniform1i(uMulti.u_samples, state.samples);
    gl.uniform1i(uMulti.u_useAudioBuf, usingBuf ? 1 : 0);
    if (usingBuf) {
        const bufDuration = AUDIO_BUF_LEN / audioBufRate;
        const span = Math.min(dt / bufDuration, 1);
        gl.uniform1f(uMulti.u_audioStart, 1 - span);
        gl.uniform1f(uMulti.u_audioStep, span);
    } else {
        gl.uniform1f(uMulti.u_audioStart, 0);
        gl.uniform1f(uMulti.u_audioStep, 0);
    }
    gl.uniform1f(uMulti.u_alpha, persistenceToAlpha(state.persistence));

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    advanceMultiPhases(dt);
    state.audioPhase = (state.audioPhase + 2 * Math.PI * fAudio * dt) % (2 * Math.PI);

    if (toneOsc && audioCtx) {
        toneOsc.frequency.setTargetAtTime(fAudio, audioCtx.currentTime, 0.01);
    }

    setReadouts(state.fStrobe, fAudio);
}

function render(dt) {
    resizeCanvas();

    gl.bindFramebuffer(gl.FRAMEBUFFER, accumFBO);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    if (state.mode === 'multi') renderMulti(dt);
    else renderSingle(dt);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.BLEND);
    gl.useProgram(programBlit);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
}

function loop(timeMs) {
    const t = timeMs / 1000;
    let dt = state.lastFrameTime ? t - state.lastFrameTime : 1 / 60;
    state.lastFrameTime = t;
    if (dt > 0.1 || dt <= 0) dt = 1 / 60;

    state.fpsAvg = state.fpsAvg * 0.92 + (1 / dt) * 0.08;
    fpsReadout.textContent = state.fpsAvg.toFixed(1);

    render(dt);
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

const persistenceSlider = document.getElementById('persistence');
const persistenceVal = document.getElementById('persistenceValue');
persistenceSlider.addEventListener('input', () => {
    state.persistence = parseFloat(persistenceSlider.value);
    persistenceVal.textContent = `${state.persistence.toFixed(0)}%`;
});
persistenceSlider.addEventListener('change', savePersisted);

document.getElementById('rings').addEventListener('change', e => {
    state.numRings = parseInt(e.target.value, 10);
    savePersisted();
});
document.getElementById('samples').addEventListener('change', e => {
    state.samples = parseInt(e.target.value, 10);
    savePersisted();
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
        if (accumW > 0) clearAccum();
    });
}
multiToggle.addEventListener('change', e => {
    setMode(e.target.checked ? 'multi' : 'single');
    savePersisted();
});

if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', refreshDeviceList);
}
refreshDeviceList();

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
    persistenceSlider.value = String(state.persistence);
    persistenceVal.textContent = `${state.persistence.toFixed(0)}%`;
    document.getElementById('rings').value = String(state.numRings);
    document.getElementById('samples').value = String(state.samples);
    multiToggle.checked = (state.mode === 'multi');
    document.getElementById('playTone').checked = false;
    sourceSelect.value = 'sine';
    state.audioMode = 'sine';
    state.activeSource = 'sine';
    updateNoteHighlight();
    updateSourceUI();
}

syncAllUI();
setMode(state.mode);
requestAnimationFrame(loop);
