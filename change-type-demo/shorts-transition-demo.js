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
// Transition UI (mirrors the YouTube TV ytlr Shorts page, default flags):
//   On Down: pause the player, start loading the next short (seek), slide the
//   thumbnail list up by one item height (300 ms,
//   cubic-bezier(0.26, 0.86, 0.44, 0.985)), and hide the player behind its
//   background. Thumbnails are visible while playback is not ready. When the
//   player reports playing, the player is shown and thumbnails are hidden
//   immediately, whether or not the slide has finished. The overlay fades out
//   (0.1 s) on Down and back in (0.3 s) once playing.
//   Approximations: thumbnails are the first frame of each clip, and the player
//   background is black (the limited-memory variant of the TV page).
//
// Per-transition metrics (logged to the console, so they show up in logcat):
//   seek     Down press -> 'seeked'.
//   shown    Down press -> 'playing' (player shown again).
//   resume   Down press -> currentTime first advances in the new short.
//            logcat's "Render() hasn't been called" line is the exact measure
//            of the picture gap.
//   dropped  droppedVideoFrames delta from the press to RESULT_AFTER_MS later
//            (player-reported, approximate).

const params = new URLSearchParams(window.location.search);
const useChangeType = params.get('changetype') !== '0';

const AUDIO = { url: 'audio_opus.webm', mime: 'audio/webm; codecs="opus"' };
const SDR = {
  url: 'sdr_short_vp9_p0_720p.webm',
  mime: 'video/webm; codecs="vp09.00.31.08.01.01.01.01.00"',
  poster: 'sdr_short_poster.jpg',
  label: 'SDR',
  title: 'Big Buck Bunny wakes up',
  detail: 'VP9 profile 0, bt709',
};
const HDR = {
  url: 'hdr_vp9_p2_720p.webm',
  mime: 'video/webm; codecs="vp09.02.31.10.01.09.16.09.00"',
  poster: 'hdr_short_poster.jpg',
  label: 'HDR',
  title: 'Game night reaction',
  detail: 'VP9 profile 2, bt2020 / PQ',
};
const SHORTS = [SDR, HDR];

// Matches PSEUDO_GAPLESS_OFFSET in the web player.
const SLOT_S = 100;
// Matches the player's gapless seek target (next start + 1 ms).
const SEEK_EPSILON_S = 0.001;
// Loop back once currentTime is this close to the short's end.
const LOOP_MARGIN_S = 0.05;
// currentTime must advance this far past the seek target to count as resumed.
const RESUME_THRESHOLD_S = 0.05;
const RESULT_AFTER_MS = 2000;
const HISTORY_SIZE = 5;
const TOAST_MS = 1500;
const POLL_MS = 20;

const KEY_DOWN = new Set(['ArrowDown', 'Down']);
const KEYCODE_DOWN = 40;

const video = document.getElementById('video');
const shortEl = document.getElementById('short');
const listEl = document.getElementById('list');
const overlayEl = document.getElementById('overlay');
const statsEl = document.getElementById('stats');
const titleEl = document.getElementById('title');
const toastEl = document.getElementById('toast');
const navDownEl = document.getElementById('nav-down');

const t0 = performance.now();
let toastTimer = null;
function log(msg, warn) {
  const wall = ((performance.now() - t0) / 1000).toFixed(3);
  const ct = video.currentTime.toFixed(3);
  console.log(`[wall ${wall}s | ct ${ct}s] ${msg}`);
  if (warn) {
    toastEl.textContent = msg;
    toastEl.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.style.display = 'none'; }, TOAST_MS);
  }
}

function droppedFrames() {
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

let audioSb = null;
let videoSb = null;
let videoMime = null;
const media = new Map();  // url -> ArrayBuffer
const shorts = [];        // index -> {format, start, end}
let current = 0;
let pending = null;       // In-flight transition measurement.
let transitions = 0;
const history = [];       // Most recent transition results, newest first.
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

  const ms = new MediaSource();
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

  renderItems();
  layoutList(false);
  hidePlayer();
  video.currentTime = shorts[0].start;
  video.play().catch((e) => log(`play() rejected: ${e}. Press Enter.`, true));
}

// --- Transition UI -----------------------------------------------------------

let playbackReady = false;
const items = new Map();  // short index -> thumbnail element

function itemHeight() {
  return shortEl.clientHeight;
}

// Keeps thumbnails for the previous, current and next shorts.
function renderItems() {
  const h = itemHeight();
  for (const [index, el] of items) {
    if (index < current - 1 || index > current + 1) {
      el.remove();
      items.delete(index);
    }
  }
  for (let index = Math.max(0, current - 1); index <= current + 1; index++) {
    let el = items.get(index);
    if (!el) {
      el = document.createElement('div');
      el.className = 'item';
      el.style.backgroundImage = `url(${formatFor(index).poster})`;
      el.classList.toggle('thumbnail-hidden', playbackReady);
      listEl.appendChild(el);
      items.set(index, el);
    }
    el.style.top = `${index * h}px`;
    el.style.height = `${h}px`;
  }
}

function layoutList(animate) {
  listEl.style.transition = animate ? '' : 'none';
  listEl.style.transform = `translateY(${-current * itemHeight()}px) translateZ(0)`;
}

function setPlaybackReady(ready) {
  playbackReady = ready;
  for (const el of items.values()) {
    el.classList.toggle('thumbnail-hidden', ready);
  }
  overlayEl.classList.toggle('hidden', !ready);
}

function hidePlayer() {
  shortEl.classList.add('hide-player');
}

function showPlayer() {
  shortEl.classList.remove('hide-player');
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
    targetStart: target.start + SEEK_EPSILON_S,
    pressWall: performance.now(),
    pressDropped: droppedFrames(),
    seekedWall: null,
    shownWall: null,
    resumedWall: null,
  };
  log(`Transition ${transitions}: short ${current} (${from}) -> short ${next} (${to})`);

  // Same order as the TV Shorts page: pause, load the next short, scroll the
  // list with playback marked not ready, then hide the player.
  video.pause();
  const previous = current;
  current = next;
  video.currentTime = pending.targetStart;
  renderItems();
  setPlaybackReady(false);
  layoutList(true);
  hidePlayer();

  enqueue(() => bufferShort(next + 1));
  enqueue(() => evictShort(previous));
}

function updatePending(now) {
  const p = pending;
  if (!p) return;
  if (p.seekedWall !== null && p.resumedWall === null &&
      video.currentTime >= p.targetStart + RESUME_THRESHOLD_S) {
    p.resumedWall = now;
  }
  if (p.resumedWall === null || p.shownWall === null ||
      now - p.pressWall < RESULT_AFTER_MS) {
    return;
  }

  const result = {
    id: p.id,
    from: p.from,
    to: p.to,
    seekMs: p.seekedWall - p.pressWall,
    shownMs: p.shownWall - p.pressWall,
    resumeMs: p.resumedWall - p.pressWall,
    dropped: droppedFrames() - p.pressDropped,
  };
  log(`Transition ${result.id} (${result.from} -> ${result.to}) result: ` +
      `seek ${result.seekMs.toFixed(0)} ms, ` +
      `shown ${result.shownMs.toFixed(0)} ms, ` +
      `resume ${result.resumeMs.toFixed(0)} ms, ` +
      `dropped ${result.dropped} (player-reported, approx.)`);
  history.unshift(result);
  history.length = Math.min(history.length, HISTORY_SIZE);
  pending = null;
}

function poll() {
  const now = performance.now();
  const s = shorts[current];

  // Loop the current short.
  if (s && !video.seeking && video.currentTime >= s.end - LOOP_MARGIN_S) {
    video.currentTime = s.start;
  }

  updatePending(now);
  render(now);
}

function pad(text, width) {
  return String(text).padEnd(width);
}

function render(now) {
  const s = shorts[current];
  if (s) {
    const badge = s.format.label === 'HDR' ? 'hdr' : 'sdr';
    titleEl.innerHTML = `${s.format.title} #shorts` +
        `<span class="badge ${badge}">${s.format.label}</span>`;
  }
  navDownEl.style.opacity = shorts[current + 1] ? '1' : '0.4';

  const lines = [
    `short ${current} (${s ? s.format.label : '-'})  ${s ? s.format.detail : ''}`,
    `position        ${s ? (video.currentTime - s.start).toFixed(2) : '-'} s`,
    `resolution      ${video.videoWidth}x${video.videoHeight}`,
    `changeType      ${useChangeType ? 'on' : 'off'}`,
    `next short      ${shorts[current + 1] ? 'ready' : 'buffering'}`,
    ``,
  ];
  if (pending) {
    const elapsed = (now - pending.pressWall).toFixed(0);
    const stage = pending.seekedWall === null ? 'seeking' :
        pending.shownWall === null ? 'waiting for playing' :
        pending.resumedWall === null ? 'waiting for playback' : 'measuring';
    lines.push(`transition #${pending.id} ${pending.from} -> ${pending.to}: ${stage} (${elapsed} ms)`);
    lines.push(``);
  }
  lines.push(`#   dir         seek   shown  resume  dropped`);
  if (history.length === 0) lines.push(`-`);
  for (const r of history) {
    lines.push(`${pad(r.id, 4)}${pad(`${r.from}->${r.to}`, 12)}` +
               `${pad(r.seekMs.toFixed(0) + 'ms', 7)}${pad(r.shownMs.toFixed(0) + 'ms', 7)}` +
               `${pad(r.resumeMs.toFixed(0) + 'ms', 8)}${r.dropped}`);
  }
  statsEl.textContent = lines.join('\n');
}

for (const ev of ['waiting', 'stalled', 'pause', 'play']) {
  video.addEventListener(ev, () => log(`event: ${ev}`));
}
video.addEventListener('seeked', () => {
  if (pending && pending.seekedWall === null) {
    pending.seekedWall = performance.now();
    log(`event: seeked (transition ${pending.id})`);
    video.play().catch((e) => log(`play() rejected: ${e}`, true));
  }
});
// Mirrors the TV page's onIsPlayingChange(true): show the player and hide the
// thumbnails as soon as playback starts, independent of the list animation.
video.addEventListener('playing', () => {
  log('event: playing');
  if (pending && pending.shownWall === null) {
    pending.shownWall = performance.now();
  }
  if (!playbackReady) {
    showPlayer();
    setPlaybackReady(true);
  }
});
video.addEventListener('resize', () =>
    log(`event: resize ${video.videoWidth}x${video.videoHeight}`));
video.addEventListener('error', () =>
    log(`event: error ${video.error && video.error.code} ${video.error && video.error.message}`, true));
window.addEventListener('resize', () => {
  renderItems();
  layoutList(false);
});

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
