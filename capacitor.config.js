// Release config. Local sync sets CAP_DEV_NAV=1 so the WebView may open a dev host.
// A store sync must not: Capacitor grants camera and microphone to any page
// allowNavigation lets the WebView open, after the user has allowed them.
const devHosts = process.env.CAP_DEV_NAV === '1'
  ? ['localhost', '127.0.0.1', '10.0.2.2']
  : [];

module.exports = {
  appId: 'com.lingolinq.app',
  appName: 'LingoLinq',
  webDir: 'www',
  server: {
    androidScheme: 'https',
    allowNavigation: [
      'app.lingolinq.com',
      '*.lingolinq.com',
      '*.lingolinq-aac.com'
    ].concat(devHosts)
  },
  plugins: {
    CapacitorHttp: {
      enabled: true
    },
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: '#ffffff'
    },
    Keyboard: {
      resize: 'body'
    },
    CapacitorSQLite: {
      // Custom Library path: the plugin excludes this folder from iCloud backup
      // and moves databases that are already in Documents.
      iosDatabaseLocation: 'Library/CapacitorDatabase',
      // SQLCipher stays off until the passphrase can live only in the iOS Keychain
      // and the Android Keystore. www/sqlite_bridge.js opens with mode 'no-encryption'.
      androidIsEncryption: false,
      iosIsEncryption: false
    }
  }
};
