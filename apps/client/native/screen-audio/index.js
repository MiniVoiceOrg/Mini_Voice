'use strict';

const path = require('path');

let binding;
try {
  binding = require('./build/Release/screen_audio.node');
} catch {
  try {
    binding = require('./build/Debug/screen_audio.node');
  } catch {
    binding = null;
  }
}

/**
 * Check if screen audio capture is supported on this platform.
 * @returns {boolean}
 */
function isSupported() {
  if (!binding) return false;
  return binding.isSupported();
}

/**
 * Start capturing screen/system audio excluding the current process.
 * @param {{ excludePid?: number, sampleRate?: number, channels?: number }} options
 * @param {(buffer: Buffer) => void} callback - Called with PCM float32 frames
 * @returns {{ success: boolean, error?: string }}
 */
function start(options, callback) {
  if (!binding) return { success: false, error: 'Native module not available' };
  return binding.start(options, callback);
}

/**
 * Stop the screen audio capture.
 * @returns {{ success: boolean }}
 */
function stop() {
  if (!binding) return { success: false };
  return binding.stop();
}

module.exports = { isSupported, start, stop };
