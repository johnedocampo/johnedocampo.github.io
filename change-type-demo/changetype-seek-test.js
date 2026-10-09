// ChangeTypeSeek MSE test.
//
// Simulates a YouTube Shorts transition from VP9 Profile 0 (SDR) to VP9
// Profile 2 (HDR PQ):
//   1. One MediaSource and one SourceBuffer for both videos.
//   2. Append the first video at time 0.
//   3. changeType() to the second video's mime type, set the append window and
//      timestampOffset to a later slot (SLOT_S), and append the second video.
//   4. Play the first video, then seek to the second video's start.
// PASS: playback advances 2 s past the seek target within 30 s, with no error.
// Results are logged to the console with a [ChangeTypeSeek] prefix.

const FROM = {
  url: 'sdr_vp9_p0_720p.webm',
  mime: 'video/webm; codecs="vp09.00.31.08.01.01.01.01.00"',
};
const TO = {
  url: 'hdr_vp9_p2_720p.webm',
  mime: 'video/webm; codecs="vp09.02.31.10.01.09.16.09.00"',
};

// Matches PSEUDO_GAPLESS_OFFSET in the YouTube web player.
const SLOT_S = 100;
const TIMEOUT_MS = 30000;

const video = document.getElementById('video');

function log(msg) {
  console.log(`[ChangeTypeSeek] ${msg}`);
}

function append(sb, data) {
  return new Promise((resolve) => {
    sb.addEventListener('updateend', resolve, { once: true });
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
  });
}

async function run() {
  const [fromData, toData] = await Promise.all(
      [FROM.url, TO.url].map((url) => fetch(url).then((r) => r.arrayBuffer())));

  const ms = new MediaSource();
  video.src = URL.createObjectURL(ms);
  await new Promise((r) => ms.addEventListener('sourceopen', r, { once: true }));

  // First video at time 0.
  const sb = ms.addSourceBuffer(FROM.mime);
  sb.appendWindowEnd = 2;
  await append(sb, fromData);

  // Second video in a later slot, in the player's order:
  // changeType() -> append window -> timestampOffset -> append.
  sb.changeType(TO.mime);
  sb.appendWindowEnd = SLOT_S + 3;
  sb.appendWindowStart = SLOT_S;
  sb.timestampOffset = SLOT_S;
  await append(sb, toData);
  ms.endOfStream();

  await video.play();
  await waitForTime(1);

  log(`Seeking to ${SLOT_S}s`);
  const seekStart = performance.now();
  video.currentTime = SLOT_S;
  await waitForTime(SLOT_S + 2);
  return `resumed ${(performance.now() - seekStart).toFixed(0)} ms after the seek`;
}

const timeout = new Promise((_, reject) => setTimeout(
    () => reject(new Error(`timed out at ${video.currentTime.toFixed(3)}s`)),
    TIMEOUT_MS));
const mediaError = new Promise((_, reject) => video.addEventListener(
    'error', () => reject(new Error(`media error ${video.error?.code}`))));

Promise.race([run(), timeout, mediaError])
    .then((detail) => log(`PASS: ${detail}`))
    .catch((e) => log(`FAIL: ${e.message || e}`));
