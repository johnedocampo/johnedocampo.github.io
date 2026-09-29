// YouTube Shorts SDR <-> HDR transition demo (changeType path).
//
// Mirrors the TV "pseudo-gapless" Shorts path in the YouTube web player with
// the SourceBuffer.changeType() gate enabled: one MediaSource and one pair of
// SourceBuffers are shared by all shorts. Each short is placed on the timeline
// SLOT_S seconds after the previous one so their content never overlaps. The
// next short is buffered ahead of time; changeType() is called before its
// init segment when its mime type differs from the current one. Transitions
// are a seek to the next short's start.
//
// Shorts behavior:
//   - The current short loops back to its start when it ends.
//   - Down arrow (or D-pad down) moves to the next short.
//   - Shorts alternate SDR, HDR, SDR, HDR, ...
//
// URL params:
//   ?changetype=0  Do not call changeType() before appending a short whose mime
//                  type differs (default 1).
//
// Per-transition metrics (logged to the console, so they show up in logcat):
//   seek         Down press -> 'seeked'.
//   clock stall  Over the first WINDOW_MS of wall time after 'seeked', wall
//                time minus media time elapsed.
//   dropped      droppedVideoFrames delta from the press to the end of the
//                window (player-reported, approximate).

const params = new URLSearchParams(window.location.search);
const useChangeType = params.get('changetype') !== '0';

const AUDIO = { url: 'audio_opus.webm', mime: 'audio/webm; codecs="opus"' };
const SDR = {
  url: 'sdr_vp9_p0_720p.webm',
  mime: 'video/webm; codecs="vp09.00.31.08.01.01.01.01.00"',
  label: 'SDR',
  name: 'SDR (VP9 profile 0, bt709)',
};
const HDR = {
  url: 'hdr_vp9_p2_720p.webm',
  mime: 'video/webm; codecs="vp09.02.31.10.01.09.16.09.00"',
  label: 'HDR',
  name: 'HDR (VP9 profile 2, bt2020 / PQ)',
};
const SHORTS = [SDR, HDR];

// Matches PSEUDO_GAPLESS_OFFSET in the web player.
const SLOT_S = 100;
// Matches the player's gapless seek target (next start + 1 ms).
const SEEK_EPSILON_S = 0.001;
// Loop back once currentTime is this close to the short's end.
const LOOP_MARGIN_S = 0.05;
const WINDOW_MS = 2000;
const POLL_MS = 20;

const KEY_DOWN = new Set(['ArrowDown', 'Down']);
const KEYCODE_DOWN = 40;

const video = document.getElementById('video');
const statsEl = document.getElementById('stats');
const segmentEl = document.getElementById('segment');
const logEl = document.getElementById('log');

const t0 = performance.now();
function log(msg, warn) {
  const line = document.createElement('div');
  if (warn) line.className = 'warn';
  const wall = ((performance.now() - t0) / 1000).toFixed(3);
  const ct = video.currentTime.toFixed(3);
  line.textContent = `[wall ${wall}s | ct ${ct}s] ${msg}`;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
  console.log(line.textContent);
}

function quality() {
  if (video.getVideoPlaybackQuality) {
    return video.getVideoPlaybackQuality().droppedVideoFrames;
  }
  return video.webkitDroppedFrameCount || 0;
}

function waitUpdateEnd(sb) {
  return new Promise((resolve, reject) => {
    const done = () => { cleanup(); resolve(); };
    const fail = (e) => { cleanup(); reject(e); };
    const cleanup = () => {
      sb.removeEventListener('updateend', done);
      sb.removeEventListener('error', fail);
    };
    sb.addEventListener('updateend', done);
    sb.addEventListener('error', fail);
  });
}

async function append(sb, data) {
  const p = waitUpdateEnd(sb);
  sb.appendBuffer(data);
  await p;
}

async function remove(sb, start, end) {
  const p = waitUpdateEnd(sb);
  sb.remove(start, end);
  await p;
}

async function fetchBuffer(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch ${url}: ${r.status}`);
  return r.arrayBuffer();
}

// Same order as the player's SourceBufferWrapper: when moving the window
// forward, set the end first so start never exceeds end.
function setAppendWindow(sb, start, end) {
  if (start > sb.appendWindowStart) {
    sb.appendWindowEnd = end;
    sb.appendWindowStart = start;
  } else {
    sb.appendWindowStart = start;
    sb.appendWindowEnd = end;
  }
}

function rangeEndAt(sb, t) {
  const b = sb.buffered;
  for (let i = 0; i < b.length; i++) {
    if (b.start(i) <= t + 0.1 && t < b.end(i)) return b.end(i);
  }
  return null;
}

function formatRanges(sb) {
  const out = [];
  for (let i = 0; i < sb.buffered.length; i++) {
    out.push(`[${sb.buffered.start(i).toFixed(2)}, ${sb.buffered.end(i).toFixed(2)}]`);
  }
  return out.join(' ') || '-';
}

let ms = null;
let audioSb = null;
let videoSb = null;
let videoMime = null;
const media = new Map();  // url -> ArrayBuffer
const shorts = [];        // index -> {format, start, end}
let current = 0;
let pending = null;       // In-flight transition measurement.
let transitions = 0;
let sbQueue = Promise.resolve();

// SourceBuffer operations run one at a time.
function enqueue(fn) {
  sbQueue = sbQueue.then(fn).catch((e) => log(`SourceBuffer op failed: ${e}`, true));
  return sbQueue;
}

function formatFor(index) {
  return SHORTS[index % SHORTS.length];
}

async function bufferShort(index) {
  const format = formatFor(index);
  const start = index * SLOT_S;

  if (format.mime !== videoMime) {
    if (useChangeType) {
      videoSb.changeType(format.mime);
      log(`changeType(${format.mime})`);
    } else {
      log(`mime changes to ${format.mime}; changeType() skipped`);
    }
    videoMime = format.mime;
  }
  setAppendWindow(videoSb, start, Infinity);
  videoSb.timestampOffset = start;
  await append(videoSb, media.get(format.url));
  const end = rangeEndAt(videoSb, start);
  if (end === null) throw new Error(`short ${index} not buffered at ${start}`);

  setAppendWindow(audioSb, start, end);
  audioSb.timestampOffset = start;
  await append(audioSb, media.get(AUDIO.url));

  shorts[index] = { format, start, end };
  log(`Buffered short ${index} (${format.label}) at [${start.toFixed(3)}, ${end.toFixed(3)}]`);
}

async function evictShort(index) {
  const s = shorts[index];
  if (!s) return;
  await remove(videoSb, s.start, s.end + 1);
  await remove(audioSb, s.start, s.end + 1);
  delete shorts[index];
  log(`Evicted short ${index}`);
}

async function setup() {
  for (const m of [AUDIO.mime, SDR.mime, HDR.mime]) {
    log(`isTypeSupported(${m}) = ${MediaSource.isTypeSupported(m)}`);
  }
  log(`changeType() on mime change: ${useChangeType ? 'yes' : 'no'}`);

  ms = new MediaSource();
  video.src = URL.createObjectURL(ms);
  await new Promise((r) => ms.addEventListener('sourceopen', r, { once: true }));

  const urls = [AUDIO.url, ...SHORTS.map((f) => f.url)];
  const buffers = await Promise.all(urls.map(fetchBuffer));
  urls.forEach((u, i) => media.set(u, buffers[i]));
  log('Fetched all media.');

  audioSb = ms.addSourceBuffer(AUDIO.mime);
  videoMime = formatFor(0).mime;
  videoSb = ms.addSourceBuffer(videoMime);

  await enqueue(() => bufferShort(0));
  enqueue(() => bufferShort(1));

  video.currentTime = shorts[0].start;
  video.play().catch((e) => log(`play() rejected: ${e}. Press Enter.`, true));
}

function goToNextShort() {
  const next = current + 1;
  const target = shorts[next];
  if (!target) {
    log(`Short ${next} is still buffering`, true);
    return;
  }
  const from = shorts[current].format.label;
  const to = target.format.label;
  transitions++;
  pending = {
    id: transitions,
    from,
    to,
    pressWall: performance.now(),
    pressDropped: quality(),
    seekedWall: null,
    seekedCt: null,
  };
  log(`Transition ${transitions}: short ${current} (${from}) -> short ${next} (${to})`);

  const previous = current;
  current = next;
  video.currentTime = target.start + SEEK_EPSILON_S;

  enqueue(() => bufferShort(next + 1));
  enqueue(() => evictShort(previous));
}

function poll() {
  const now = performance.now();
  const s = shorts[current];

  // Loop the current short.
  if (s && !video.seeking && video.currentTime >= s.end - LOOP_MARGIN_S) {
    video.currentTime = s.start;
  }

  if (pending && pending.seekedWall !== null &&
      now - pending.seekedWall >= WINDOW_MS) {
    const p = pending;
    const mediaMs = (video.currentTime - p.seekedCt) * 1000;
    // Clamp: timer jitter can make this slightly negative.
    const stallMs = Math.max(0, (now - p.seekedWall) - mediaMs);
    p.result = {
      seekMs: p.seekedWall - p.pressWall,
      stallMs,
      dropped: quality() - p.pressDropped,
    };
    log(`Transition ${p.id} (${p.from} -> ${p.to}) result: ` +
        `seek ${p.result.seekMs.toFixed(0)} ms, ` +
        `clock stall ${stallMs.toFixed(0)} ms, ` +
        `dropped ${p.result.dropped} (player-reported, approx.)`);
    lastResult = p;
    pending = null;
  }

  render();
}

let lastResult = null;

function render() {
  const s = shorts[current];
  if (s) {
    segmentEl.textContent = `Short ${current}: ${s.format.name}`;
    segmentEl.className = s.format.label === 'HDR' ? 'hdr' : 'sdr';
  }
  const r = lastResult && lastResult.result;
  const lines = [
    `short           ${current} (${s ? s.format.label : '-'})`,
    `short range     ${s ? `[${s.start.toFixed(3)}, ${s.end.toFixed(3)}]` : '-'}`,
    `position        ${s ? (video.currentTime - s.start).toFixed(3) : '-'} s`,
    `currentTime     ${video.currentTime.toFixed(3)} s`,
    `readyState      ${video.readyState}`,
    `resolution      ${video.videoWidth}x${video.videoHeight}`,
    `changeType      ${useChangeType ? 'on' : 'off'}`,
    `dropped total   ${quality()} (player-reported, approx.)`,
    ``,
    `-- buffered --`,
    `video  ${videoSb ? formatRanges(videoSb) : '-'}`,
    `audio  ${audioSb ? formatRanges(audioSb) : '-'}`,
    ``,
    `-- last transition --`,
    `${lastResult ? `#${lastResult.id} ${lastResult.from} -> ${lastResult.to}` : '-'}`,
    `seek            ${r ? r.seekMs.toFixed(0) + ' ms' : '-'}`,
    `clock stall     ${r ? r.stallMs.toFixed(0) + ' ms' : '-'}`,
    `dropped         ${r ? r.dropped + ' (approx.)' : '-'}`,
    ``,
    `Down: next short`,
  ];
  statsEl.textContent = lines.join('\n');
}

for (const ev of ['waiting', 'playing', 'stalled', 'pause', 'play']) {
  video.addEventListener(ev, () => log(`event: ${ev}`));
}
video.addEventListener('seeked', () => {
  if (pending && pending.seekedWall === null) {
    pending.seekedWall = performance.now();
    pending.seekedCt = video.currentTime;
    log(`event: seeked (transition ${pending.id})`);
  }
});
video.addEventListener('resize', () =>
    log(`event: resize ${video.videoWidth}x${video.videoHeight}`));
video.addEventListener('error', () =>
    log(`event: error ${video.error && video.error.code} ${video.error && video.error.message}`, true));

document.addEventListener('keydown', (e) => {
  if (KEY_DOWN.has(e.key) || e.keyCode === KEYCODE_DOWN) {
    e.preventDefault();
    goToNextShort();
  } else if (e.key === 'Enter' && video.paused) {
    video.play();
  }
});

setInterval(poll, POLL_MS);
setup().catch((e) => log(`Setup failed: ${e}`, true));
