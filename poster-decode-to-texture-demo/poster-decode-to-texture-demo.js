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

document.addEventListener('DOMContentLoaded', () => {
  const video = document.getElementById('videoPlayer');

  video.src = 'vp9-720p.webm';

  // --- Keyboard Playback Control ---
  document.addEventListener('keydown', () => {
    if (video.paused) {
      setTimeout(() => {
        video.play();
      }, 3000);
    } else {
      video.pause();
    }
  });

  // Stop the video after 5 seconds of playback
  video.addEventListener('play', () => {
    console.log('Video playback started. Poster is now hidden.');
    setTimeout(() => {
      video.pause();
      video.load(); // Reset the video to show the poster
      console.log('Video stopped after 5 seconds.');
    }, 6000);
  });

  // Log when the video is paused
  video.addEventListener('pause', () => {
    // The poster is only shown again if the video is reset to the beginning.
    // Otherwise, the current video frame is shown.
    if (video.currentTime === 0) {
      console.log('Video is at the beginning; poster is visible.');
    } else {
      console.log(`Video paused at ${video.currentTime.toFixed(2)}s. Current frame is visible.`);
    }
  });

  video.addEventListener('ended', () => {
    console.log('Video ended. Resetting to show poster.');
    video.load();
  });
  console.log(`Initial poster is: ${video.poster}`);
});
