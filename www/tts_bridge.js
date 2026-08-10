/**
 * Android System WebView does not implement a working Web Speech API
 * (speechSynthesis.speak is a no-op / empty voices). Cordova used
 * cordova-plugin-tts; Capacitor uses @capacitor-community/text-to-speech.
 *
 * speecher.js uses `scope: (window.polyspeech || window)`. Setting
 * window.polyspeech *before* app.js loads routes speak() through this bridge
 * without changing the Ember bundle.
 */
(function() {
  function isNativeCapacitor() {
    try {
      return !!(window.Capacitor &&
        typeof window.Capacitor.isNativePlatform === 'function' &&
        window.Capacitor.isNativePlatform());
    } catch (e) {
      return false;
    }
  }

  if (!isNativeCapacitor()) { return; }

  var plugin = window.Capacitor.Plugins && window.Capacitor.Plugins.TextToSpeech;
  if (!plugin || typeof plugin.speak !== 'function') {
    console.warn('LINGOLINQ: TextToSpeech plugin missing — speak boards will be silent on Android WebView');
    return;
  }

  var voices = [];
  var speaking = false;

  function CapacitorUtterance(text) {
    this.text = text || '';
    this.lang = '';
    this.voiceURI = '';
    this.voice = null;
    this.volume = 1;
    this.rate = 1;
    this.pitch = 1;
    this._listeners = {};
  }
  CapacitorUtterance.prototype.addEventListener = function(type, fn) {
    if (!this._listeners[type]) { this._listeners[type] = []; }
    this._listeners[type].push(fn);
  };
  CapacitorUtterance.prototype.removeEventListener = function(type, fn) {
    var list = this._listeners[type] || [];
    this._listeners[type] = list.filter(function(f) { return f !== fn; });
  };
  CapacitorUtterance.prototype._emit = function(type, event) {
    var list = this._listeners[type] || [];
    for (var i = 0; i < list.length; i++) {
      try { list[i](event || { type: type, utterance: this }); } catch (e) { }
    }
    var handler = this['on' + type];
    if (typeof handler === 'function') {
      try { handler(event || { type: type, utterance: this }); } catch (e) { }
    }
  };

  function voiceIndexFor(utterance) {
    if (!utterance || !voices.length) { return undefined; }
    var uri = (utterance.voice && utterance.voice.voiceURI) || utterance.voiceURI;
    var lang = (utterance.voice && utterance.voice.lang) || utterance.lang;
    if (uri) {
      for (var i = 0; i < voices.length; i++) {
        if (voices[i].voiceURI === uri) { return i; }
      }
    }
    if (lang) {
      var want = String(lang).toLowerCase().split(/[-_]/)[0];
      for (var j = 0; j < voices.length; j++) {
        var vlang = String(voices[j].lang || '').toLowerCase().split(/[-_]/)[0];
        if (vlang === want) { return j; }
      }
    }
    return undefined;
  }

  var synthesis = {
    speaking: false,
    pending: false,
    paused: false,
    polyfill: true,
    capacitor: true,
    getVoices: function() { return voices.slice(); },
    speak: function(utterance) {
      if (!utterance) { return; }
      var text = utterance.text || '';
      // unlock_speech uses a zero-width space at volume 0 — skip native speak
      if (!text || text === '\u200B' || utterance.volume === 0) {
        speaking = false;
        synthesis.speaking = false;
        utterance._emit('end');
        return;
      }
      speaking = true;
      synthesis.speaking = true;
      var opts = {
        text: text,
        lang: utterance.lang || (utterance.voice && utterance.voice.lang) || navigator.language || 'en-US',
        rate: typeof utterance.rate === 'number' ? utterance.rate : 1.0,
        pitch: typeof utterance.pitch === 'number' ? utterance.pitch : 1.0,
        volume: typeof utterance.volume === 'number' ? utterance.volume : 1.0,
        category: 'playback',
        queueStrategy: 0
      };
      var idx = voiceIndexFor(utterance);
      if (typeof idx === 'number') { opts.voice = idx; }

      utterance._emit('start');
      plugin.speak(opts).then(function() {
        speaking = false;
        synthesis.speaking = false;
        utterance._emit('end');
      }, function(err) {
        console.warn('LINGOLINQ: Capacitor TTS speak failed', err);
        speaking = false;
        synthesis.speaking = false;
        utterance._emit('error', { type: 'error', error: err, utterance: utterance });
      });
    },
    cancel: function() {
      speaking = false;
      synthesis.speaking = false;
      try { plugin.stop(); } catch (e) { }
    },
    pause: function() { synthesis.paused = true; try { plugin.stop(); } catch (e) { } },
    resume: function() { synthesis.paused = false; }
  };

  window.polyspeech = {
    speechSynthesis: synthesis,
    SpeechSynthesisUtterance: CapacitorUtterance,
    SpeechSynthesis: function() { return synthesis; }
  };

  plugin.getSupportedVoices().then(function(res) {
    var list = (res && res.voices) || [];
    voices = list.map(function(v, i) {
      return {
        default: !!v.default,
        lang: v.lang || 'en-US',
        localService: v.localService !== false,
        name: v.name || ('Voice ' + i),
        voiceURI: v.voiceURI || ('capacitor-tts:' + i)
      };
    });
    try {
      window.dispatchEvent(new Event('voiceschanged'));
    } catch (e) { }
    console.log('LINGOLINQ: Capacitor TTS ready, voices=' + voices.length);
  }, function(err) {
    console.warn('LINGOLINQ: Capacitor TTS getSupportedVoices failed', err);
  });
})();
