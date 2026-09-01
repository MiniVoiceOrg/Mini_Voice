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

function isSupported() {
  if (!binding) return false;
  return binding.isSupported();
}

function start(options, callback) {
  if (!binding) return { success: false, error: 'Native module not available' };
  return binding.start(options, callback);
}

function stop() {
  if (!binding) return { success: false };
  return binding.stop();
}

function getLastError() {
  if (!binding) return '';
  return binding.getLastError();
}

function getStatus() {
  if (!binding) return 0;
  return binding.getStatus();
}

function listWindowOwners() {
  if (!binding || typeof binding.listWindowOwners !== 'function') return [];
  return binding.listWindowOwners();
}

module.exports = { isSupported, start, stop, getLastError, getStatus, listWindowOwners };
