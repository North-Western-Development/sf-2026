#!/usr/bin/env node
// Collect the SDKs into a staging tree for the self-hosted package registry (served at
// https://<domain>/packages; deploy/server/registry-index.mjs writes the indexes and
// deploy/server/publish-packages.sh uploads). Publishing only adds files: versions already
// published stay, so pinned installs keep working.
//
//   node scripts/registry/collect.mjs [out-dir]
//
// Layout written:
//   npm/<name>/-/<file>.tgz  + <file>.tgz.json   (the package.json, shasum, integrity)
//   pypi/<project>/<wheel or sdist>
//   maven/<group path>/<artifact>/<version>/<artifact>-<version>[.jar|.pom|-sources.jar]
//   nuget/<id lowercase>/<version>/<id lowercase>.<version>.nupkg
//   files/<archive>                                  C++ sources, the Unreal plugin
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.resolve(process.argv[2] ?? path.join(ROOT, 'registry-out'));

// On Windows npm, pnpm and dotnet are .cmd shims that need a shell: quote each argument for it
// (this repository lives under a path with a space in it).
const shell = process.platform === 'win32';
const quote = (a) => (shell && /[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
const run = (cmd, args, cwd) => execFileSync(cmd, args.map(quote), { cwd, stdio: ['ignore', 'pipe', 'inherit'], shell }).toString();
const ok = (msg) => console.log(`  + ${msg}`);
const skip = (msg) => console.log(`  - skipped: ${msg}`);
const put = (rel, from) => {
  const to = path.join(OUT, rel);
  mkdirSync(path.dirname(to), { recursive: true });
  cpSync(from, to);
  return to;
};

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// --- npm: JavaScript, Deno, and the Unity package (Unity's Package Manager reads npm registries) ---
console.log('npm');
const npmPackages = [
  { dir: 'packages/rich-presence', build: true },
  { dir: 'packages/bot-sdk', build: true },
  { dir: 'sdk/unity/com.subspace.rich-presence', build: false },
];
for (const pkg of npmPackages) {
  const dir = path.join(ROOT, pkg.dir);
  if (!existsSync(path.join(dir, 'package.json'))) {
    skip(pkg.dir);
    continue;
  }
  if (pkg.build) run('pnpm', ['run', 'build'], dir);
  const tmp = mkdtempSync(path.join(tmpdir(), 'npm-pack-'));
  const [packed] = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', tmp], dir));
  const manifest = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
  delete manifest.scripts;
  delete manifest.devDependencies;
  // Scoped tarballs are named after the bare name (bot-sdk-0.1.0.tgz), as npm's own registry does.
  const file = manifest.name.startsWith('@') ? `${manifest.name.split('/')[1]}-${manifest.version}.tgz` : path.basename(packed.filename);
  const rel = `npm/${manifest.name}/-/${file}`;
  put(rel, path.join(tmp, path.basename(packed.filename)));
  writeFileSync(path.join(OUT, `${rel}.json`), JSON.stringify({ manifest, shasum: packed.shasum, integrity: packed.integrity }, null, 2));
  rmSync(tmp, { recursive: true, force: true });
  ok(`${manifest.name}@${manifest.version}`);
}

// --- PyPI ------------------------------------------------------------------------------------------
console.log('pypi');
const pyDist = path.join(ROOT, 'sdk/bot/python/dist');
if (existsSync(pyDist)) {
  for (const f of readdirSync(pyDist).filter((f) => f.endsWith('.whl') || f.endsWith('.tar.gz'))) {
    put(`pypi/subspace-bot/${f}`, path.join(pyDist, f));
    ok(f);
  }
} else skip('sdk/bot/python/dist (build the wheel first)');

// --- Maven ---------------------------------------------------------------------------------------
console.log('maven');
const javaTarget = path.join(ROOT, 'sdk/bot/java/target');
const jar = existsSync(javaTarget) ? readdirSync(javaTarget).find((f) => /^subspace-bot-[\d.]+\.jar$/.test(f)) : undefined;
if (jar) {
  const version = jar.match(/^subspace-bot-([\d.]+)\.jar$/)[1];
  const base = `maven/click/subspace/subspace-bot/${version}/subspace-bot-${version}`;
  put(`${base}.jar`, path.join(javaTarget, jar));
  const sources = path.join(javaTarget, `subspace-bot-${version}-sources.jar`);
  if (existsSync(sources)) put(`${base}-sources.jar`, sources);
  put(`${base}.pom`, [path.join(javaTarget, `subspace-bot-${version}.pom`), path.join(ROOT, 'sdk/bot/java/pom.xml')].find(existsSync));
  ok(`click.subspace:subspace-bot:${version}`);
} else skip('sdk/bot/java/target (build the jar first)');

// --- NuGet ---------------------------------------------------------------------------------------
console.log('nuget');
const richPresenceOut = path.join(ROOT, 'sdk/csharp/artifacts');
run('dotnet', ['pack', '-c', 'Release', '-o', richPresenceOut, '--nologo'], path.join(ROOT, 'sdk/csharp/src/Subspace.RichPresence'));
for (const dir of [richPresenceOut, path.join(ROOT, 'sdk/bot/csharp/artifacts')]) {
  if (!existsSync(dir)) {
    skip(path.relative(ROOT, dir));
    continue;
  }
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.nupkg'))) {
    const m = f.match(/^(.+?)\.(\d+\.\d+\.\d+(?:-[\w.]+)?)\.nupkg$/);
    if (!m) continue;
    const id = m[1].toLowerCase();
    put(`nuget/${id}/${m[2]}/${id}.${m[2]}.nupkg`, path.join(dir, f));
    ok(`${m[1]} ${m[2]}`);
  }
}

// --- Source archives: the C++ SDKs and the Unreal plugin ----------------------------------------
console.log('files');
const archive = (name, dir) => {
  // Exactly the tracked or added files (never build output), under a folder named for the release.
  const files = run('git', ['ls-files', '--cached', '--others', '--exclude-standard', dir], ROOT).split('\n').filter(Boolean);
  if (!files.length) return skip(dir);
  const prefix = name.replace(/\.(tar\.gz|zip)$/, '');
  const stage = mkdtempSync(path.join(tmpdir(), 'archive-'));
  for (const f of files) {
    const target = path.join(stage, prefix, path.relative(dir, f));
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(path.join(ROOT, f), target);
  }
  const to = path.join(OUT, 'files', name);
  mkdirSync(path.dirname(to), { recursive: true });
  // bsdtar writes .tar.gz and .zip alike (-a: by the name). Windows ships it; GNU tar (Linux)
  // takes the same flags for .tar.gz, and would read "C:" as a remote host.
  const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  run(tar, [...(name.endsWith('.zip') ? ['-a'] : ['-z']), '-cf', to, '-C', stage, prefix], ROOT);
  rmSync(stage, { recursive: true, force: true });
  ok(name);
};
const versionIn = (file, re) => (existsSync(path.join(ROOT, file)) ? readFileSync(path.join(ROOT, file), 'utf8').match(re)?.[1] : null) ?? '0.1.0';
const cmakeVersion = /project\([^)]*VERSION\s+([\d.]+)/;
archive(`subspace-rich-presence-cpp-${versionIn('sdk/cpp/CMakeLists.txt', cmakeVersion)}.tar.gz`, 'sdk/cpp');
archive(`subspace-bot-cpp-${versionIn('sdk/bot/cpp/CMakeLists.txt', cmakeVersion)}.tar.gz`, 'sdk/bot/cpp');
archive(`SubspaceRichPresence-unreal-${versionIn('sdk/unreal/SubspaceRichPresence/SubspaceRichPresence.uplugin', /"VersionName":\s*"([\d.]+)"/)}.zip`, 'sdk/unreal/SubspaceRichPresence');

console.log(`collected into ${OUT}`);
