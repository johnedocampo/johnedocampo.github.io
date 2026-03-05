// Copyright 2026 The Cobalt Authors. All Rights Reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

const video = document.getElementById('video_player');
const changePosterBtn = document.getElementById('changePosterBtn');

const focusableElements = [video, changePosterBtn];
let currentFocusIndex = 0;
let videoData;
let mseInitialized = false;

const setFocus = () => {
  focusableElements[currentFocusIndex].focus();
};

// This function sets up the MediaSource and starts playback.
const startMsePlayback = () => {
  if (!videoData) {
    console.error('Video data has not been downloaded yet.');
    return;
  }
  if (mseInitialized) {
    console.log('MSE already initialized.');
    return;
  }
  console.log('Initializing MediaSource playback...');

  const ms = new MediaSource();
  video.src = URL.createObjectURL(ms);

  ms.addEventListener('sourceopen', () => {
    console.log('MediaSource opened.');
    // NOTE: The codec string must be exact.
    const videoBuffer = ms.addSourceBuffer('video/webm; codecs="vp9"');

    videoBuffer.addEventListener('updateend', () => {
      console.log('Buffer update ended.');
      if (!videoBuffer.updating && ms.readyState === 'open') {
        ms.endOfStream();
      }
      // The data is now in the buffer. We can safely play.
      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise.catch(error => {
          console.error('Video playback failed:', error);
        });
      }
    });

    console.log('Appending buffer...');
    videoBuffer.appendBuffer(videoData);
    mseInitialized = true;
  });
};

const downloadMedia = (callback) => {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', '../big-buck-bunny-vp9-1080p-1mb.webm', true);
  xhr.responseType = 'arraybuffer';

  xhr.onload = () => {
    console.log('Video data downloaded.');
    videoData = xhr.response;
    if (callback) {
      callback();
    }
  };

  xhr.onerror = () => {
    console.error('Failed to download video data.');
  };

  xhr.send();
};

window.addEventListener('load', () => {
  setFocus();
  downloadMedia();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault();
    if (e.key === 'ArrowUp') {
      currentFocusIndex = (currentFocusIndex - 1 + focusableElements.length) %
          focusableElements.length;
    } else {
      currentFocusIndex = (currentFocusIndex + 1) % focusableElements.length;
    }
    setFocus();
  } else if (e.key === 'Enter' || e.keyCode === 13) {
    e.preventDefault();
    if (document.activeElement === changePosterBtn) {
      changePosterBtn.click();
    } else if (document.activeElement === video) {
      if (!mseInitialized) {
        // First time playing: use MSE.
        startMsePlayback();
      } else {
        // Subsequent times: just toggle play/pause.
        if (video.paused) {
          video.play();
        } else {
          video.pause();
        }
      }
    }
  }
});

video.addEventListener('click', () => {
  if (!mseInitialized) {
    startMsePlayback();
  } else {
    if (video.paused) {
      video.play();
    } else {
      video.pause();
    }
  }
});

const posters = [
  'sddefault.jpg',
  'sddefault_poster_1.jpg',
  'sddefault_poster_2.jpg'
];
let currentPosterIndex = 0;

changePosterBtn.addEventListener('click', () => {
  currentPosterIndex = (currentPosterIndex + 1) % posters.length;
  const newPoster = posters[currentPosterIndex];
  video.poster = newPoster;
  console.log(`Poster changed to: ${newPoster}`);
});

video.addEventListener('play', () => {
  console.log('Video playback started, poster is now hidden.');
});

video.addEventListener('pause', () => {
  if (video.currentTime === 0) {
    console.log('Video is at the beginning, poster is visible.');
  } else {
    console.log('Video is paused, current frame is visible.');
  }
});

video.addEventListener('ended', () => {
  console.log('Video ended, poster will be shown again.');
  // Reset state to allow playing again from the start with MSE.
  video.src = '';
  mseInitialized = false;
});

console.log(`Initial poster: ${video.poster}`);
