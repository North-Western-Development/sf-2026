// Android release builds. Signs them with the publisher's key, read at build time from the properties
// file named by SUBSPACE_ANDROID_SIGNING (storeFile, storePassword, keyAlias, keyPassword). The key
// lives off the repository (~/.subspace/android-release.*); without it, release builds stay
// signed with the debug key, as Expo makes them. Losing the key means installed copies can only
// be replaced by uninstalling first: back it up.
const { withAppBuildGradle, withGradleProperties } = require('expo/config-plugins');

const MARK = '// subspace: release signing';

module.exports = function withAndroidBuild(config) {
  // Phones only (and 64-bit emulators): 32-bit x86 just makes the download bigger.
  config = withGradleProperties(config, (cfg) => {
    cfg.modResults = cfg.modResults.filter((p) => p.key !== 'reactNativeArchitectures');
    cfg.modResults.push({ type: 'property', key: 'reactNativeArchitectures', value: 'armeabi-v7a,arm64-v8a,x86_64' });
    return cfg;
  });
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;
    if (gradle.includes(MARK)) return cfg;
    gradle = gradle.replace(
      /signingConfigs \{/,
      `signingConfigs {
        ${MARK}
        def subspaceSigning = System.getenv('SUBSPACE_ANDROID_SIGNING')
        if (subspaceSigning && file(subspaceSigning).exists()) {
            def props = new Properties()
            file(subspaceSigning).withInputStream { props.load(it) }
            release {
                storeFile file(props['storeFile'])
                storePassword props['storePassword']
                keyAlias props['keyAlias']
                keyPassword props['keyPassword']
            }
        }`
    );
    // The release build type uses that key when it was found.
    gradle = gradle.replace(
      /(buildTypes \{[\s\S]*?release \{[\s\S]*?)signingConfig signingConfigs\.debug/,
      `$1signingConfig signingConfigs.findByName('release') ?: signingConfigs.debug`
    );
    // React Native runs the Hermes compiler through `cmd /c`, which breaks on a path with a space
    // (C:\Users\Some Name\...). On Windows, use the folder's short 8.3 form instead.
    gradle = gradle.replace(
      /hermesCommand = new File\((\[[^\n]*?\])\.execute\(null, rootDir\)\.text\.trim\(\)\)\.getParentFile\(\)\.getAbsolutePath\(\)/,
      `hermesCommand = subspaceNoSpaces(new File($1.execute(null, rootDir).text.trim()).getParentFile())`
    );
    gradle = gradle.replace(
      /\nreact \{/,
      `
// subspace: a folder's path without spaces (Windows short names), for commands run through cmd.
def subspaceNoSpaces = { File dir ->
    def path = dir.getAbsolutePath()
    if (!path.contains(' ') || !System.getProperty('os.name').toLowerCase().contains('windows')) return path
    def shortPath = ['cmd', '/c', 'for %I in (.) do @echo %~sI'].execute(null, dir).text.trim()
    return shortPath ?: path
}

react {`
    );
    cfg.modResults.contents = gradle;
    return cfg;
  });
};
