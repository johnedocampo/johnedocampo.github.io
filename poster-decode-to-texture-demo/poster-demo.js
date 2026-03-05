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

const setFocus = () => {
  focusableElements[currentFocusIndex].focus();
};

window.addEventListener('load', () => {
  setFocus();
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
    if (document.activeElement === changePosterBtn) {
      changePosterBtn.click();
    } else if (document.activeElement === video) {
      if (video.paused) {
        video.play();
      } else {
        video.pause();
      }
    }
    e.preventDefault();
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
  // The poster is typically only shown when the video is at the very
  // beginning. If paused during playback, the current frame is shown.
  if (video.currentTime === 0) {
    console.log('Video is at the beginning, poster is visible.');
  } else {
    console.log('Video is paused, current frame is visible.');
  }
});

// When the video ends and seeks back to the beginning, the poster is shown again.
video.addEventListener('ended', () => {
  console.log('Video ended, poster will be shown again.');
});


console.log(`Initial poster: ${video.poster}`);
