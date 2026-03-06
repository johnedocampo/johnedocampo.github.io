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
  const changePosterBtn = document.getElementById('changePosterButton');

  // Array of available poster images
  const posters = [
    'sddefault.jpg',
    'sddefault_poster_1.jpg',
    'sddefault_poster_2.jpg'
  ];
  let currentPosterIndex = 0;

  // Set the video source directly. H.264 in MP4 is more universally supported on TVs than VP9.
  video.src = '../test-materials_media_big-buck-bunny-h264-240p-30fps.mp4';

  // --- TV Remote Navigation ---

  const focusableElements = [video, changePosterBtn];
  let currentFocusIndex = 0;

  const setFocus = () => {
    // Remove the focus class from all elements
    focusableElements.forEach(el => el.classList.remove('focused'));
    // Add the focus class to the current element
    const currentElement = focusableElements[currentFocusIndex];
    currentElement.classList.add('focused');
    // Programmatically set focus for screen readers and other accessibility tools
    currentElement.focus();
  };

  // Set initial focus on the video player
  setFocus();

  document.addEventListener('keydown', (e) => {
    const activeElement = document.activeElement;

    // --- Navigation between elements ---
    if (activeElement === video && e.key === 'ArrowDown') {
      e.preventDefault();
      currentFocusIndex = 1; // Index of the button
      setFocus();
    } else if (activeElement === changePosterBtn && e.key === 'ArrowUp') {
      e.preventDefault();
      currentFocusIndex = 0; // Index of the video
      setFocus();
    }

    // --- Action for specific elements ---
    // Only handle 'Enter' for the button. Let the Cobalt platform handle 'Enter' for the video player.
    if (activeElement === changePosterBtn && (e.key === 'Enter' || e.keyCode === 13)) {
      e.preventDefault();
      activeElement.click();
    }
  });


  // --- Event Listeners ---

  // Handle the poster change button click
  changePosterBtn.addEventListener('click', () => {
    // Cycle to the next poster in the array
    currentPosterIndex = (currentPosterIndex + 1) % posters.length;
    const newPoster = posters[currentPosterIndex];
    video.poster = newPoster;
    console.log(`Poster changed to: ${newPoster}`);
  });

  // Log when the video starts playing
  video.addEventListener('play', () => {
    console.log('Video playback started. Poster is now hidden.');
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

  // Log when the video finishes
  video.addEventListener('ended', () => {
    console.log('Video ended. Poster will be shown again after a brief moment.');
    // The browser shows the poster automatically when the video ends.
    // To play again, the user can press the play button.
  });

  // --- Initial Console Log ---
  console.log(`Initial poster is: ${video.poster}`);
});
