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

const setFocus = () => {
  focusableElements[currentFocusIndex].focus();
};

const playVideo = () => {
  if (!videoData) {
    console.error('Video data has not been downloaded yet.');
    return;
  }

  const ms = new MediaSource();
  video.src = URL.createObjectURL(ms);

  ms.addEventListener('sourceopen', () => {
    // NOTE: The codec string must be exact. You may need to adjust this
    // based on the actual encoding of your media file.
    const videoBuffer = ms.addSourceBuffer('video/webm; codecs="vp9"');

    videoBuffer.addEventListener('updateend', () => {
      if (!videoBuffer.updating && ms.readyState === 'open') {
        ms.endOfStream();
      }
    });

    videoBuffer.appendBuffer(videoData);
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
  // Pre-download the video data so it's ready for playback.
  downloadMedia();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowUp') {
    currentFocusIndex = (currentFocusIndex - 1 + focusableElements.length) %
        focusableElements.length;
    setFocus();
    e.preventDefault();
    e.preventDefault();
  } else if (e.key === 'ArrowDown') {
    currentFocusIndex = (currentFocusIndex + 1) % focusableElements.length;
    setFocus();
    e.preventDefault();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (document.activeElement === changePosterBtn) {
      changePosterBtn.click();
    } else if (document.activeElement === video) {
      if (video.paused) {
        // If the video hasn't started yet, its src will be empty.
        // Use MSE to play it for the first time.
        if (!video.src || video.src.startsWith('blob:')) {
          playVideo();
        }
        const playPromise = video.play();
        if (playPromise !== undefined) {
          playPromise.catch(error => {
            console.error('Video playback failed:', error);
          });
        }
      } else {
        video.pause();
      }
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
  // Reset src to allow playing again from the start with MSE.
  video.src = '';
});

console.log(`Initial poster: ${video.poster}`);