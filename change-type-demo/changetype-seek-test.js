// ChangeTypeSeek MSE test.
//
// Simulates a YouTube Shorts transition, as done by the YouTube TV player's
// "pseudo-gapless" Shorts path with changeType() enabled:
//   1. One MediaSource and one SourceBuffer (segments mode) for both clips.
//   2. Append the first clip at time 0 and start playing it.
//   3. changeType() to the second clip's mime type, set the append window and
//      timestampOffset to a later slot (SLOT_S), and append the second clip.
//   4. Seek to the second clip's start.
// PASS: playback advances PLAY_AFTER_SEEK_S past the seek target, with no
// error, within TIMEOUT_MS.
//
// URL params:
//   ?test=0to2 | 2to0   Run a single case (default: both, in order).

const SDR_P0 = {
  name: 'VP9 Profile 0 (SDR)',
  url: 'sdr_vp9_p0_720p.webm',
  mime: 'video/webm; codecs="vp09.00.31.08.01.01.01.01.00"',
};
const HDR_P2 = {
  name: 'VP9 Profile 2 (HDR PQ)',
  url: 'hdr_vp9_p2_720p.webm',
  mime: 'video/webm; codecs="vp09.02.31.10.01.09.16.09.00"',
};

const TESTS = [
  { id: '0to2', title: 'ChangeTypeSeek.VP9.VP9.Profile0To2', from: SDR_P0, to: HDR_P2 },
  { id: '2to0', title: 'ChangeTypeSeek.VP9.VP9.Profile2To0', from: HDR_P2, to: SDR_P0 },
];

// Matches PSEUDO_GAPLESS_OFFSET in the YouTube web player.
const SLOT_S = 100;
// Seconds of each clip to keep (via the append window).
const FROM_SECONDS = 2;
const TO_SECONDS = 3;
// Play this long in the first clip before seeking.
const PLAY_BEFORE_SEEK_S = 1;
// Required playback progress after the seek.
const PLAY_AFTER_SEEK_S = 2;
const TIMEOUT_MS = 30000;

const video = document.getElementById('video');
const resultsEl = document.getElementById('results');
const logEl = document.getElementById('log');

function log(msg) {
  const line = `[${(performance.now() / 1000).toFixed(3)}s] ${msg}`;
  console.log(`[ChangeTypeSeek] ${line}`);
  const div = document.createElement('div');
  div.textContent = line;
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
}

async function fetchBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`fetch ${url}: ${response.status}`);
  return response.arrayBuffer();
}

function waitForEvent(target, name) {
  return new Promise((resolve) => target.addEventListener(name, resolve, { once: true }));
}

function append(sb, data) {
  return new Promise((resolve, reject) => {
    const onEnd = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error('SourceBuffer error event')); };
    const cleanup = () => {
      sb.removeEventListener('updateend', onEnd);
      sb.removeEventListener('error', onError);
    };
    sb.addEventListener('updateend', onEnd);
    sb.addEventListener('error', onError);
    sb.appendBuffer(data);
  });
}

function waitForTime(target) {
  return new Promise((resolve) => {
    const check = () => {
      if (video.currentTime >= target) {
        video.removeEventListener('timeupdate', check);
        resolve();
      }
    };
    video.addEventListener('timeupdate', check);
    check();
  });
}

function rangesToString(ranges) {
  const parts = [];
  for (let i = 0; i < ranges.length; i++) {
    parts.push(`[${ranges.start(i).toFixed(3)}, ${ranges.end(i).toFixed(3)}]`);
  }
  return parts.join(' ') || 'none';
}

async function runTest(test, media) {
  log(`=== ${test.title}: ${test.from.name} -> ${test.to.name} ===`);
  for (const f of [test.from, test.to]) {
    if (!MediaSource.isTypeSupported(f.mime)) {
      throw new Error(`Unsupported type: ${f.mime}`);
    }
  }

  const ms = new MediaSource();
  video.src = URL.createObjectURL(ms);
  await waitForEvent(ms, 'sourceopen');

  const sb = ms.addSourceBuffer(test.from.mime);
  log(`addSourceBuffer(${test.from.mime})`);

  // First clip at time 0.
  sb.appendWindowEnd = FROM_SECONDS;
  await append(sb, media.get(test.from.url));
  log(`Appended first clip; buffered ${rangesToString(sb.buffered)}`);

  // Next clip in a later slot, same order as the player:
  // changeType() -> append window -> timestampOffset -> append.
  sb.changeType(test.to.mime);
  log(`changeType(${test.to.mime})`);
  sb.appendWindowEnd = SLOT_S + TO_SECONDS;
  sb.appendWindowStart = SLOT_S;
  sb.timestampOffset = SLOT_S;
  await append(sb, media.get(test.to.url));
  log(`Appended second clip at ${SLOT_S}s; buffered ${rangesToString(sb.buffered)}`);
  ms.endOfStream();

  // Play the first clip.
  const droppedBefore = video.getVideoPlaybackQuality?.().droppedVideoFrames ?? 0;
  await video.play();
  await waitForTime(PLAY_BEFORE_SEEK_S);
  log(`Played first clip to ${video.currentTime.toFixed(3)}s; seeking to ${SLOT_S}s`);

  // Seek to the next clip.
  const seekStart = performance.now();
  video.currentTime = SLOT_S;
  await waitForEvent(video, 'seeked');
  const seekMs = performance.now() - seekStart;
  log(`seeked after ${seekMs.toFixed(0)} ms`);

  await waitForTime(SLOT_S + PLAY_AFTER_SEEK_S);
  const totalMs = performance.now() - seekStart;
  const droppedAfter = video.getVideoPlaybackQuality?.().droppedVideoFrames ?? 0;
  video.pause();
  log(`Reached ${video.currentTime.toFixed(3)}s, ${totalMs.toFixed(0)} ms after the seek`);
  return `seek ${seekMs.toFixed(0)} ms, +${PLAY_AFTER_SEEK_S}s played after ` +
      `${totalMs.toFixed(0)} ms, dropped ${droppedAfter - droppedBefore}`;
}

function withTimeout(promise) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${TIMEOUT_MS} ms ` +
        `(currentTime ${video.currentTime.toFixed(3)}s)`)), TIMEOUT_MS);
  });
  const mediaError = new Promise((_, reject) => {
    video.onerror = () => reject(new Error(`Media error: ${video.error?.code} ` +
        `${video.error?.message || ''}`));
  });
  return Promise.race([promise, timeout, mediaError]).finally(() => {
    clearTimeout(timer);
    video.onerror = null;
  });
}

function addResultRow(test) {
  const row = document.createElement('div');
  row.className = 'test pending';
  row.innerHTML = `<div><span class="status">PENDING</span> ${test.title}</div>` +
      '<div class="detail"></div>';
  resultsEl.appendChild(row);
  return {
    set(state, detail = '') {
      row.className = `test ${state}`;
      row.querySelector('.status').textContent = state.toUpperCase();
      row.querySelector('.detail').textContent = detail;
    },
  };
}

async function main() {
  const only = new URLSearchParams(location.search).get('test');
  const tests = TESTS.filter((t) => !only || t.id === only);
  const rows = tests.map(addResultRow);

  const media = new Map();
  for (const url of new Set(tests.flatMap((t) => [t.from.url, t.to.url]))) {
    media.set(url, await fetchBuffer(url));
  }
  log('Fetched media.');

  for (let i = 0; i < tests.length; i++) {
    rows[i].set('running');
    try {
      const detail = await withTimeout(runTest(tests[i], media));
      rows[i].set('pass', detail);
      log(`PASS ${tests[i].title}: ${detail}`);
    } catch (e) {
      rows[i].set('fail', String(e.message || e));
      log(`FAIL ${tests[i].title}: ${e.message || e}`);
    }
    video.removeAttribute('src');
    video.load();
  }
  log('Done.');
}

main().catch((e) => log(`Setup failed: ${e.message || e}`));
