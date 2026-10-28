#!/usr/bin/env node
// Build the release APK: generate the Android project, build it signed with the publisher's key
// (SUBSPACE_ANDROID_SIGNING, default ~/.subspace/android-release.properties), and copy it to
// build/Subspace-Frequency-<version>.apk for deploy/server/publish-mobile.sh.
// Needs JDK 17+ (JAVA_HOME) and the Android SDK (ANDROID_HOME).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(fs.readFileSync(path.join(app, 'app.json'), 'utf8')).expo;
const signing = process.env.SUBSPACE_ANDROID_SIGNING || path.join(os.homedir(), '.subspace', 'android-release.properties');
if (!fs.existsSync(signing)) {
  console.error(`No signing key at ${signing}: a release must be signed with the publisher's key.`);
  process.exit(1);
}
// A Windows path without spaces (its short 8.3 form): JAVA_TOOL_OPTIONS is split on spaces.
const noSpaces = (dir) =>
  process.platform === 'win32' && dir.includes(' ') ? spawnSync('cmd', ['/c', 'for %I in (.) do @echo %~sI'], { cwd: dir, encoding: 'utf8' }).stdout.trim() || dir : dir;
// Java on Windows makes its internal pipes as Unix sockets in the temp folder, and fails there
// ("Unable to establish loopback connection") when the folder is not usable for them.
fs.mkdirSync(path.join(os.homedir(), '.gradle', 'tmp'), { recursive: true });
const tmp = noSpaces(path.join(os.homedir(), '.gradle', 'tmp'));
// The SDK must be at a path without spaces: given one with a space, CMake calls the NDK's
// clang++.exe by its 8.3 name (CLANG_~1.EXE), and clang, not recognising itself, links without
// the C++ library. Gradle expands 8.3 names, so on Windows reach it through a junction instead:
//   mklink /J C:\Users\Public\subspace-android-sdk "%LOCALAPPDATA%\Android\Sdk"
const JUNCTION = 'C:\\Users\\Public\\subspace-android-sdk';
let sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
if (process.platform === 'win32' && sdk?.includes(' ')) {
  if (!fs.existsSync(JUNCTION)) {
    console.error(`The Android SDK path has a space (${sdk}), which breaks the native build. Make a junction to it:\n  mklink /J ${JUNCTION} "${sdk}"`);
    process.exit(1);
  }
  sdk = JUNCTION;
}
const env = { ...process.env, ...(sdk ? { ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk } : {}), SUBSPACE_ANDROID_SIGNING: signing, JAVA_TOOL_OPTIONS: `-Djdk.net.unixdomain.tmpdir=${tmp} -Djava.io.tmpdir=${tmp}` };

const run = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { cwd, env, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
run('npx', ['expo', 'prebuild', '--platform', 'android', '--clean', '--no-install'], app);
const android = path.join(app, 'android');
// The newest CMake in the SDK: the default one's ninja cannot open paths over 260 characters,
// which pnpm's store reaches on Windows (install another with: sdkmanager "cmake;3.31.6").
const cmakes = sdk && fs.existsSync(path.join(sdk, 'cmake')) ? fs.readdirSync(path.join(sdk, 'cmake')).filter((v) => /^\d+\.\d+\.\d+$/.test(v)) : [];
const newest = cmakes.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop();
if (newest) fs.appendFileSync(path.join(android, 'local.properties'), `cmake.dir=${path.join(sdk, 'cmake', newest).replace(/\\/g, '/')}\n`);
// By full path: cmd may be set not to look in the current folder.
run(process.platform === 'win32' ? `"${path.join(android, 'gradlew.bat')}"` : './gradlew', ['assembleRelease', '--no-daemon'], android);

const out = path.join(app, 'build', `Subspace-Frequency-${version}.apk`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.copyFileSync(path.join(app, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk'), out);
console.log(`built ${out}`);
