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

// Using MSE implementation to ensure compatibility with TV browsers.

document.addEventListener('DOMContentLoaded', () => {
  const video = document.getElementById('videoPlayer');
  var audioData;
  var videoData;

  function downloadMediaData(downloadedCallback) {
    var xhr = new XMLHttpRequest;

    xhr.onload = function() {
      audioData = xhr.response;
      console.log("Downloaded " + audioData.byteLength + " of audio data.");

      xhr.onload = function() {
        videoData = xhr.response;
        console.log("Downloaded " + videoData.byteLength + " of video data.");
        downloadedCallback();
      }

      xhr.open("GET", "../video-background-demo/vp9-720p.webm", true);
      xhr.send();
    }

    xhr.open("GET", "../video-background-demo/dash-audio.mp4", true);
    xhr.responseType = "arraybuffer";
    xhr.send();
  }

  function playVideoOn(videoElement) {
    // Prevent starting if already playing
    if (videoElement.src && !videoElement.paused) {
      console.log("Ignore key press as a video is still playing.");
      return;
    }

    var ms = new MediaSource;
    ms.addEventListener('sourceopen', function() {
      console.log("Creating SourceBuffer objects.");
      var audioBuffer = ms.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"');
      // Using the decode-to-texture hint as it might be important for the TV platform
      var videoBuffer = ms.addSourceBuffer('video/webm; codecs="vp9"; decode-to-texture=true');
      audioBuffer.addEventListener("updateend", function() {
        audioBuffer.abort();
        videoBuffer.addEventListener("updateend", function() {
          videoBuffer.addEventListener("updateend", function() {
            videoBuffer.abort();
            ms.endOfStream();
            videoElement.ontimeupdate = function() {
              // Stop playback after 5 seconds
              if (videoElement.currentTime > 5) {
                console.log("Stop playback after 5 seconds.");
                videoElement.src = '';
                videoElement.load(); // This resets the video and shows the poster
                videoElement.ontimeupdate = null;
              }
            }
            console.log("Start playback.");
            videoElement.play();
          });
          videoBuffer.appendBuffer(videoData.slice(1024));
        });
        videoBuffer.appendBuffer(videoData.slice(0, 1024));
      });
      audioBuffer.appendBuffer(audioData);
    });

    console.log("Attaching MediaSource to video element.");
    videoElement.src = URL.createObjectURL(ms);
  }

  function setupKeyHandler() {
    document.onkeydown = function() {
      playVideoOn(video);
    };
    console.log('Key handler set up. Press any key to play video.');
  }

  console.log('Starting media download...');
  downloadMediaData(setupKeyHandler);

  // --- Initial Console Log ---
  console.log(`Initial poster is: ${video.poster}`);
});