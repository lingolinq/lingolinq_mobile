// The native shell speaks through www/tts_bridge.js, including on iOS.
// Spoken buttons must ask the text-to-speech plugin for category "playback"
// so the iOS patch can keep speech audible with the Ring/Silent switch on.
// Deleting that option, or dropping the patch that honors it, fails this file.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const BRIDGE = fs.readFileSync(path.join(__dirname, '..', 'www', 'tts_bridge.js'), 'utf8');
const PATCH = fs.readFileSync(path.join(__dirname, '..', 'patches', '@capacitor-community+text-to-speech+8.0.2.patch'), 'utf8');
const PACKAGE = fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8');

function loadBridge(plugin) {
  const window = {
    Capacitor: {
      isNativePlatform: () => true,
      Plugins: { TextToSpeech: plugin }
    },
    navigator: { language: 'en-US' },
    dispatchEvent() {}
  };
  const context = vm.createContext({
    window,
    console: { log() {}, warn() {} },
    Event: class Event {
      constructor(type) { this.type = type; }
    },
    Promise
  });
  vm.runInContext(BRIDGE, context);
  return window;
}

test('npm install applies the iOS text-to-speech patch', () => {
  assert.match(PACKAGE, /"postinstall": "patch-package"/);
});

test('the iOS text-to-speech patch uses the app session and playback', () => {
  assert.match(PATCH, /usesApplicationAudioSession = true/);
  assert.match(PATCH, /setCategory\(\.playback, mode: \.spokenAudio, options: \[\.duckOthers\]\)/);
  assert.match(PATCH, /notifyOthersOnDeactivation/);
});

test('native speak asks for the playback audio category', async () => {
  const speakCalls = [];
  let resolveSpeak;
  const spoken = new Promise((resolve) => { resolveSpeak = resolve; });
  const window = loadBridge({
    speak: (opts) => {
      speakCalls.push(opts);
      resolveSpeak();
      return Promise.resolve();
    },
    stop: () => Promise.resolve(),
    getSupportedVoices: () => Promise.resolve({ voices: [] })
  });

  const utterance = new window.polyspeech.SpeechSynthesisUtterance('hello');
  utterance.lang = 'en-US';
  utterance.rate = 1.2;
  utterance.pitch = 0.8;
  utterance.volume = 0.5;
  window.polyspeech.speechSynthesis.speak(utterance);

  await spoken;
  assert.equal(speakCalls.length, 1);
  assert.equal(speakCalls[0].text, 'hello');
  assert.equal(speakCalls[0].category, 'playback');
  assert.equal(speakCalls[0].queueStrategy, 0);
  assert.equal(speakCalls[0].lang, 'en-US');
});
