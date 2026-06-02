const video = document.getElementById('my-video');
const consoleDiv = document.getElementById('console');
const statusOverlay = document.getElementById('status-overlay');

function log(message, type = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry log-${type}`;
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  consoleDiv.appendChild(entry);
  consoleDiv.scrollTop = consoleDiv.scrollHeight;
  console.log(`[DEMO] ${message}`);
}

function updateStatus(status) {
  statusOverlay.textContent = `Status: ${status}`;
  log(`Status changed to: ${status}`, 'info');
}

// Check for changeType support
if (typeof SourceBuffer.prototype.changeType !== 'function') {
  log('ERROR: SourceBuffer.changeType() is NOT supported on this platform!', 'error');
  updateStatus('Unsupported');
} else {
  log('SourceBuffer.changeType() is supported.', 'success');
}

const videos = [
  {
    url: 'dash-video-240p.mp4',
    codec: 'video/mp4; codecs="avc1.640028"',
    name: 'Video 1: AVC (H.264)'
  },
  {
    url: 'vp9_720p.webm',
    codec: 'video/webm; codecs="vp9"',
    name: 'Video 2: VP9 (WebM)'
  },
  {
    url: 'bear-av1.mp4',
    codec: 'video/mp4; codecs="av01.0.04M.08"',
    name: 'Video 3: AV1'
  }
];

const mediaSource = new MediaSource();
video.src = URL.createObjectURL(mediaSource);

let currentVideoIndex = 0;
let sourceBuffer = null;
let nextTimestampOffset = 0;

mediaSource.addEventListener('sourceopen', () => {
  log('MediaSource opened', 'success');
  playNextVideo();
});

mediaSource.addEventListener('sourceended', () => log('MediaSource ended', 'info'));
mediaSource.addEventListener('sourceclose', () => log('MediaSource closed', 'warn'));

video.addEventListener('play', () => log('Video started playing', 'info'));
video.addEventListener('playing', () => updateStatus('Playing'));
video.addEventListener('waiting', () => updateStatus('Waiting/Buffering'));
video.addEventListener('ended', () => {
  updateStatus('Playback Ended');
  log('Playback ended. Seeking to beginning for loop...', 'info');
  video.currentTime = 0;
  video.play().catch(e => log(`Play failed during loop: ${e.message}`, 'error'));
});
video.addEventListener('error', (e) => log(`Video Error: ${video.error.message} (code: ${video.error.code})`, 'error'));

async function playNextVideo() {
  if (currentVideoIndex >= videos.length) {
    log('All videos appended to SourceBuffer!', 'success');
    try {
      mediaSource.endOfStream();
      log('Called mediaSource.endOfStream()', 'success');
    } catch (e) {
      log(`Failed to call endOfStream: ${e.message}`, 'error');
    }
    return;
  }

  const currentVideo = videos[currentVideoIndex];
  log(`--- Preparing ${currentVideo.name} ---`, 'info');
  updateStatus(`Appending ${currentVideo.name}`);

  try {
    if (!sourceBuffer) {
      log(`Creating SourceBuffer with codec: ${currentVideo.codec}`, 'info');
      sourceBuffer = mediaSource.addSourceBuffer(currentVideo.codec);
      
      // Monitor source buffer events
      sourceBuffer.addEventListener('error', (e) => log('SourceBuffer error event triggered', 'error'));
      sourceBuffer.addEventListener('abort', () => log('SourceBuffer abort event triggered', 'warn'));
    } else {
      log(`Calling changeType() to: ${currentVideo.codec}`, 'info');
      // CRITICAL CALL
      sourceBuffer.changeType(currentVideo.codec);
      log(`changeType() call completed.`, 'success');
    }

    log(`Fetching data from: ${currentVideo.url}`, 'info');
    const response = await fetch(currentVideo.url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.arrayBuffer();
    log(`Fetched ${data.byteLength} bytes.`, 'success');

    log(`Setting timestampOffset to ${nextTimestampOffset}s`, 'info');
    sourceBuffer.timestampOffset = nextTimestampOffset;
    const start = nextTimestampOffset;

    log(`Appending buffer to SourceBuffer...`, 'info');
    await appendBufferPromise(sourceBuffer, data);
    log(`Appended ${currentVideo.name} successfully.`, 'success');

    // Check buffered ranges to see the new end and enforce 5s limit
    const buffered = sourceBuffer.buffered;
    if (buffered.length > 0) {
      const end = buffered.end(buffered.length - 1);
      const duration = end - start;
      log(`Appended video duration in timeline: ${duration.toFixed(2)}s`, 'info');

      if (duration > 5) {
        const removeStart = start + 5;
        log(`Video duration (${duration.toFixed(2)}s) exceeds 5s limit. Removing extra range [${removeStart.toFixed(2)}, ${end.toFixed(2)}]...`, 'warn');
        await removePromise(sourceBuffer, removeStart, end);
        log(`Removed extra range successfully.`, 'success');
        nextTimestampOffset = removeStart;
      } else {
        nextTimestampOffset = end;
      }
    } else {
      log('Warning: Buffer is empty after append', 'warn');
    }

    // Log current buffered ranges
    logBufferedRanges();

    currentVideoIndex++;
    
    // Queue next video immediately to build a continuous timeline
    playNextVideo();

  } catch (e) {
    log(`Error in playNextVideo: ${e.message}`, 'error');
    updateStatus('Error');
  }
}

function appendBufferPromise(buffer, data) {
  return new Promise((resolve, reject) => {
    const updateEndHandler = () => {
      buffer.removeEventListener('updateend', updateEndHandler);
      buffer.removeEventListener('error', errorHandler);
      resolve();
    };
    const errorHandler = (e) => {
      buffer.removeEventListener('updateend', updateEndHandler);
      buffer.removeEventListener('error', errorHandler);
      reject(new Error('Append failed'));
    };
    buffer.addEventListener('updateend', updateEndHandler);
    buffer.addEventListener('error', errorHandler);
    buffer.appendBuffer(data);
  });
}

function removePromise(buffer, start, end) {
  return new Promise((resolve, reject) => {
    const updateEndHandler = () => {
      buffer.removeEventListener('updateend', updateEndHandler);
      buffer.removeEventListener('error', errorHandler);
      resolve();
    };
    const errorHandler = (e) => {
      buffer.removeEventListener('updateend', updateEndHandler);
      buffer.removeEventListener('error', errorHandler);
      reject(new Error('Remove failed'));
    };
    buffer.addEventListener('updateend', updateEndHandler);
    buffer.addEventListener('error', errorHandler);
    buffer.remove(start, end);
  });
}

function logBufferedRanges() {
  if (!sourceBuffer) return;
  const buffered = sourceBuffer.buffered;
  log(`Current buffered ranges (${buffered.length}):`, 'info');
  for (let i = 0; i < buffered.length; i++) {
    log(`  Range ${i}: [${buffered.start(i).toFixed(2)}, ${buffered.end(i).toFixed(2)}]`, 'info');
  }
}

// Periodic stats logging
setInterval(() => {
  if (video.readyState > 0) {
    const buffered = video.buffered;
    let bufferedStr = '';
    for (let i = 0; i < buffered.length; i++) {
      bufferedStr += `[${buffered.start(i).toFixed(1)}, ${buffered.end(i).toFixed(1)}] `;
    }
    statusOverlay.textContent = `Status: ${video.paused ? 'Paused' : 'Playing'} | Time: ${video.currentTime.toFixed(1)}s / ${video.duration.toFixed(1)}s`;
  }
}, 250);

// Allow starting the demo with a key press if auto-play is blocked
window.addEventListener('keyup', () => {
  if (video.paused && currentVideoIndex > 0) {
    log('Key pressed, attempting to play video...', 'info');
    video.play().catch(e => log(`Play failed: ${e.message}`, 'error'));
  }
});
