// SDR -> HDR mid-stream transition demo.
//
// Video: one SourceBuffer in 'sequence' mode, VP9 profile 0 SDR (bt709)
// followed by VP9 profile 2 HDR10 (bt2020/PQ) at the same resolution and frame
// rate. Timing mirrors the YTS ChangeType conformance test: the first stream is
// clipped to FROM_SECONDS with appendWindowEnd, the window is widened to
// FROM_SECONDS + TO_SECONDS before changeType(), and the run passes once
// currentTime reaches transition + 2 s.
// Audio: a separate SourceBuffer with one continuous Opus track spanning both
// video segments, so the audio renderer drives the media clock.
//
// URL params:
//   ?changetype=0  Do not call SourceBuffer.changeType() before the HDR segment
//                  (default 1). The decoder-side transition triggers on color
//                  metadata either way.
//   ?res=1         Use an SDR 1080p segment instead of HDR (720p -> 1080p SDR
//                  switch with no color change).
//
// Transition metrics, measured over [T - WINDOW_BEFORE_S, T + WINDOW_AFTER_S]:
//   clock stall  Wall time minus media time elapsed. This is how long the
//                audio-driven media clock stopped (e.g. an audio underrun).
//   dropped      droppedVideoFrames delta, as reported by the player
//                (approximate). Frames skipped to catch up with the clock. On
//                devices using the video frame tracker, frames rendered right
//                before a codec release may be counted too.
// currentTime is interpolated by the renderer and totalVideoFrames counts
// frames written (not shown), so neither can measure the picture gap.

const params = new URLSearchParams(window.location.search);

const AUDIO = { url: 'audio_opus.webm', mime: 'audio/webm; codecs="opus"' };
const SDR = {
  url: 'sdr_vp9_p0_720p.webm',
  mime: 'video/webm; codecs="vp09.00.31.08.01.01.01.01.00"',
  name: 'SDR  (talk show, VP9 profile 0, bt709)',
};
const HDR = {
  url: 'hdr_vp9_p2_720p.webm',
  mime: 'video/webm; codecs="vp09.02.31.10.01.09.16.09.00"',
  name: 'HDR  (home video, VP9 profile 2, bt2020 / PQ)',
};
const SDR_1080P = {
  url: 'sdr_vp9_p0_1080p.webm',
  mime: 'video/webm; codecs="vp09.00.40.08.01.01.01.01.00"',
  name: 'SDR 1080p  (home video, VP9 profile 0, bt709)',
};
const SECOND = params.get('res') === '1' ? SDR_1080P : HDR;

// YTS defaults (fromSeconds = 2, toSeconds = 3, target = transition + 2).
const FROM_SECONDS = 2;
const TO_SECONDS = 3;
const PASS_AFTER_S = 2;

// Window around the transition used for the metrics above.
const WINDOW_BEFORE_S = 1.0;
const WINDOW_AFTER_S = 2.0;
const POLL_MS = 20;

const useChangeType = params.get('changetype') !== '0';

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

let transitionTime = null;  // Media time where HDR starts.
const stats = {
  lastCt: null,
  regressions: 0,
  maxRegressionMs: 0,
  windowStart: null,  // {wall, ct, dropped}
  windowResult: null, // {stallMs, dropped}
  result: 'pending',  // YTS criterion: 'pending' | 'PASS' | 'FAIL'
};

function quality() {
  if (video.getVideoPlaybackQuality) {
    const q = video.getVideoPlaybackQuality();
    return { dropped: q.droppedVideoFrames, total: q.totalVideoFrames };
  }
  return {
    dropped: video.webkitDroppedFrameCount || 0,
    total: video.webkitDecodedFrameCount || 0,
  };
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

async function fetchBuffer(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch ${url}: ${r.status}`);
  return r.arrayBuffer();
}

async function setup() {
  for (const m of [AUDIO.mime, SDR.mime, SECOND.mime]) {
    log(`isTypeSupported(${m}) = ${MediaSource.isTypeSupported(m)}`);
  }
  log(`changeType() before HDR: ${useChangeType ? 'yes' : 'no'}`);

  const ms = new MediaSource();
  video.src = URL.createObjectURL(ms);
  await new Promise((r) => ms.addEventListener('sourceopen', r, { once: true }));

  const [audioData, sdrData, hdrData] = await Promise.all(
      [fetchBuffer(AUDIO.url), fetchBuffer(SDR.url), fetchBuffer(SECOND.url)]);
  log('Fetched all media.');

  const audioSb = ms.addSourceBuffer(AUDIO.mime);
  const videoSb = ms.addSourceBuffer(SDR.mime);
  videoSb.mode = 'sequence';

  const windowEnd = FROM_SECONDS + TO_SECONDS;
  audioSb.appendWindowEnd = windowEnd;
  const audioDone = append(audioSb, audioData).then(
      () => log(`Audio appended: [0, ${audioSb.buffered.end(0).toFixed(3)}]`));

  videoSb.appendWindowEnd = FROM_SECONDS;
  await append(videoSb, sdrData);
  transitionTime = videoSb.buffered.end(0);
  log(`SDR appended: [0, ${transitionTime.toFixed(3)}]`);

  videoSb.appendWindowEnd = windowEnd;
  if (useChangeType) {
    videoSb.changeType(SECOND.mime);
    log(`changeType(${SECOND.mime})`);
  }
  await append(videoSb, hdrData);
  const videoEnd = videoSb.buffered.end(videoSb.buffered.length - 1);
  log(`Second segment appended: [${transitionTime.toFixed(3)}, ${videoEnd.toFixed(3)}]` +
      ` (buffered ranges: ${videoSb.buffered.length})`);

  await audioDone;
  ms.endOfStream();
  log(`endOfStream(), duration = ${ms.duration.toFixed(3)}s. ` +
      `Transition at ${transitionTime.toFixed(3)}s.`);

  video.play().catch((e) => log(`play() rejected: ${e}. Press any key.`, true));
}

function poll() {
  const now = performance.now();
  const ct = video.currentTime;
  const playing = !video.paused && !video.ended && !video.seeking;

  if (stats.lastCt !== null && playing && ct < stats.lastCt - 0.001) {
    const ms = (stats.lastCt - ct) * 1000;
    stats.regressions++;
    stats.maxRegressionMs = Math.max(stats.maxRegressionMs, ms);
    log(`currentTime regressed by ${ms.toFixed(1)} ms`, true);
  }

  if (transitionTime !== null && playing) {
    const q = quality();
    const winStart = transitionTime - WINDOW_BEFORE_S;
    const winEnd = transitionTime + WINDOW_AFTER_S;
    if (!stats.windowStart && ct >= winStart && ct < transitionTime) {
      stats.windowStart = { wall: now, ct, dropped: q.dropped };
    }
    if (stats.windowStart && !stats.windowResult && ct >= winEnd) {
      const w = stats.windowStart;
      // Clamp: timer jitter can make this slightly negative.
      const stallMs = Math.max(0, (now - w.wall) - (ct - w.ct) * 1000);
      const dropped = q.dropped - w.dropped;
      stats.windowResult = { stallMs, dropped };
      log(`Transition window [T-${WINDOW_BEFORE_S}s, T+${WINDOW_AFTER_S}s]: ` +
          `clock stall ${stallMs.toFixed(0)} ms, ` +
          `dropped ${dropped} (player-reported, approx.)`);
    }
  }

  if (stats.result === 'pending' && transitionTime !== null &&
      ct >= transitionTime + PASS_AFTER_S) {
    stats.result = 'PASS';
    log(`PASS: currentTime reached T+${PASS_AFTER_S}s`);
  }

  const inHdr = transitionTime !== null && ct >= transitionTime;
  segmentEl.textContent = `Segment: ${inHdr ? SECOND.name : SDR.name}`;
  segmentEl.className = inHdr ? 'hdr' : 'sdr';

  stats.lastCt = ct;
  render();
}

function render() {
  const q = quality();
  const w = stats.windowResult;
  const lines = [
    `currentTime     ${video.currentTime.toFixed(3)} s`,
    `transition T    ${transitionTime === null ? '-' : transitionTime.toFixed(3) + ' s'}`,
    `readyState      ${video.readyState}`,
    `resolution      ${video.videoWidth}x${video.videoHeight}`,
    `paused/ended    ${video.paused}/${video.ended}`,
    `changeType      ${useChangeType ? 'on' : 'off'}`,
    `YTS criterion   ${stats.result} (ct >= T+${PASS_AFTER_S}s)`,
    ``,
    `-- totals --`,
    `dropped         ${q.dropped} (player-reported, approx.)`,
    `ct regressions  ${stats.regressions} (max ${stats.maxRegressionMs.toFixed(1)} ms)`,
    ``,
    `-- transition window --`,
    `[T-${WINDOW_BEFORE_S}s, T+${WINDOW_AFTER_S}s]`,
    `clock stall     ${w ? w.stallMs.toFixed(0) + ' ms' : '-'}`,
    `dropped         ${w ? w.dropped + ' (player-reported, approx.)' : '-'}`,
    ``,
    `Any key: reload for a clean run`,
  ];
  statsEl.textContent = lines.join('\n');
}

for (const ev of ['waiting', 'playing', 'stalled', 'seeking', 'seeked', 'pause', 'play']) {
  video.addEventListener(ev, () => log(`event: ${ev}`));
}
video.addEventListener('resize', () =>
    log(`event: resize ${video.videoWidth}x${video.videoHeight}`));
video.addEventListener('error', () =>
    log(`event: error ${video.error && video.error.code} ${video.error && video.error.message}`, true));
video.addEventListener('ended', () => {
  log('event: ended');
  if (stats.result === 'pending') {
    stats.result = 'FAIL';
    log(`FAIL: ended before currentTime reached T+${PASS_AFTER_S}s`, true);
  }
  render();
});
// Replaying via seek would start from an HDR-configured decoder and could add
// an extra transition at t=0, so a fresh page load is used instead.
document.addEventListener('keyup', () => {
  if (video.paused && !video.ended && video.currentTime === 0) {
    video.play();
  } else {
    location.reload();
  }
});

setInterval(poll, POLL_MS);
setup().catch((e) => log(`Setup failed: ${e}`, true));
