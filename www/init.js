(function() {
  window.time_log = function(str) {
    var stamp = Math.round(new Date().getTime() / 1000 % 100 * 100) / 100;
    console.log(str + "  :" + stamp);
  };

  time_log("init started");

  window.load_state = window.load_state || {};
  window.load_state.state = "init";
  window.load_state.init = true;

  function loadingSay(html) {
    var message = document.getElementById('loading_message');
    if(message) {
      message.style.display = 'block';
      message.innerHTML = html;
    }
  }

  function checkState() {
    time_log("LINGOLINQ: checking state...");
    window.load_state = window.load_state || {};
    if(!window.FileReader) {
      loadingSay("your device's built-in web browser appears out of date and will not work with LingoLinq.");
    } else if(!window.load_state.js_retrieved) {
      if(!window.load_state.js_still_waiting) {
        window.load_state.js_still_waiting = true;
        loadingSay("downloading resources, this may take a little while...");
        setTimeout(checkState, 5000);
      } else if(!window.load_state.js_really_still_waiting) {
        window.load_state.js_really_still_waiting = true;
        loadingSay("still downloading. It doesn't usually take this long, there may be a slow connection...");
        setTimeout(checkState, 60000);
      } else {
        loadingSay("looks like there might be a problem loading the app. You can keep waiting or reinstall.");
      }
    } else if(!window.load_state.js_loaded) {
      if(!window.load_state.js_still_loading) {
        window.load_state.js_still_loading = true;
        loadingSay("initializing...");
        setTimeout(checkState, 5000);
      } else if(!window.load_state.js_really_still_loading) {
        window.load_state.js_really_still_loading = true;
        loadingSay("initialization is taking longer than expected...");
        setTimeout(checkState, 30000);
      } else {
        loadingSay("something may be broken. You can keep waiting or reinstall the app.");
      }
    }
  }
  setTimeout(checkState, 500);

  window.app_version = window.app_version || "capacitor-8";
  // Capacitor does not use Cordova deviceReady; installed_app is set here before Ember boots.
  window.capabilities = {
    installed_app: true,
    api_host: "http://localhost:5000",
    wait_for_deviceready: false,
    app_id: "com.lingolinq.app",
    native_iap_enabled: false
  };

  var elem = document.getElementById('enabled_frontend_features');
  window.enabled_frontend_features = [];
  if(elem && elem.getAttribute) {
    var list = elem.getAttribute('data-list') || '';
    window.enabled_frontend_features = list.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
  }
})();
