#!/usr/bin/env node
// Write the indexes of the self-hosted package registry from every package file present under
// <root> (served at <base>, e.g. https://subspace.click/packages). Run after each upload by
// deploy/server/publish-packages.sh; it only reads the packages and rewrites the indexes, so every
// version ever published stays installable. Node's standard library only.
//
//   node registry-index.mjs /var/www/packages https://subspace.click/packages
//
//   npm    <base>/npm/            npm, pnpm, yarn, Deno and Unity scoped registries
//   pypi   <base>/pypi/simple/    pip --extra-index-url (PEP 503)
//   maven  <base>/maven/          Maven and Gradle repositories
//   nuget  <base>/nuget/index.json  NuGet v3 (dotnet, Visual Studio, Rider)
//   files  <base>/files/          C++ sources and the Unreal plugin
//
// It runs as root over files whoever uploads chose, so links are never followed (lstat, not stat;
// a link where an index goes is replaced, not written through), every name is escaped where it
// lands, and one broken package is skipped without stopping the others from being indexed.
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';

const ROOT = path.resolve(process.argv[2] ?? '/var/www/packages');
const BASE = (process.argv[3] ?? 'https://subspace.click/packages').replace(/\/$/, '');

const lst = (p) => {
  try {
    return lstatSync(p);
  } catch {
    return null;
  }
};
const isDir = (p) => !!lst(p)?.isDirectory();
const isFile = (p) => !!lst(p)?.isFile();
const list = (p) => {
  try {
    return isDir(p) ? readdirSync(p) : [];
  } catch {
    return [];
  }
};
const dirs = (p) => list(p).filter((n) => isDir(path.join(p, n)));
const files = (p) => list(p).filter((n) => isFile(path.join(p, n)));
const hash = (algo, file) => createHash(algo).update(readFileSync(file)).digest('hex');
/** Text and double-quoted attributes. */
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
/** Anywhere in HTML or XML, single quotes included. */
const escAll = (s) => esc(s).replace(/'/g, '&#39;');
/** A name as one relative URL path segment: never a query, a fragment or a scheme ("javascript:"). */
const segment = (name) => String(name).replace(/[%#?]/g, (c) => encodeURIComponent(c));
const leading = (name) => (segment(name).includes(':') ? `./${segment(name)}` : segment(name));
const skipped = (what, err) => console.log(`skipped ${what}: ${err?.code ?? err?.message ?? err}`);

/** Write a file in place of whatever is there: a link or hard link is removed, never written through. */
function write(file, data) {
  const st = lst(file);
  if (st && !st.isDirectory()) unlinkSync(file);
  writeFileSync(file, data, { flag: 'wx' });
}
/** A real directory at p: a link there is removed first. */
function ensureDir(p) {
  const st = lst(p);
  if (st?.isDirectory()) return;
  if (st) {
    try {
      unlinkSync(p);
    } catch {
      rmdirSync(p); // a Windows junction
    }
  }
  mkdirSync(p, { recursive: true });
}

const byVersion = (a, b) => {
  const pa = a.split(/[.-]/).map((x) => (Number.isNaN(+x) ? x : +x));
  const pb = b.split(/[.-]/).map((x) => (Number.isNaN(+x) ? x : +x));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if (pa[i] === pb[i]) continue;
    if (pa[i] === undefined) return 1; // 1.0.0 > 1.0.0-beta
    if (pb[i] === undefined) return -1;
    return typeof pa[i] === typeof pb[i] ? (pa[i] < pb[i] ? -1 : 1) : typeof pa[i] === 'number' ? -1 : 1;
  }
  return 0;
};

/** The largest .nuspec read: real ones are a few KiB. */
const NUSPEC_MAX = 1024 * 1024;

/**
 * One file out of a zip (a .nupkg is a zip): enough of the format to find and inflate it, and at
 * most `max` bytes of it. An offset outside the file, or a stream that does not inflate, gives null.
 */
function readZipEntry(zipPath, wanted, max = NUSPEC_MAX) {
  try {
    return zipEntry(readFileSync(zipPath), wanted, max);
  } catch {
    return null;
  }
}
function zipEntry(buf, wanted, max) {
  // The end record sits in the last 64 KiB (its comment is at most 65535 bytes).
  const stop = Math.max(0, buf.length - 22 - 0xffff);
  let eocd = buf.length - 22;
  while (eocd >= stop && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < stop) return null;
  let p = buf.readUInt32LE(eocd + 16);
  const count = buf.readUInt16LE(eocd + 10);
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) return null;
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    if (p + 46 + nameLen > buf.length) return null;
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (wanted(name)) {
      if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) return null;
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      // A few KiB of deflate can claim gigabytes: past maxOutputLength it throws.
      if (method === 8) return inflateRawSync(data, { maxOutputLength: max });
      return data.length > max ? null : data;
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

/** The text inside the first <t>...</t>. indexOf, so unclosed tags cost one pass, not one per tag. */
function tag(xml, t) {
  const open = xml.indexOf(`<${t}>`);
  if (open < 0) return '';
  const close = xml.indexOf(`</${t}>`, open);
  return close < 0 ? '' : xml.slice(open + t.length + 2, close).trim();
}

/** Dependency groups as the registration API describes them, in one pass over the nuspec. */
function dependencyGroups(xml) {
  const groups = [];
  for (let at = xml.indexOf('<group'); at >= 0; at = xml.indexOf('<group', at)) {
    const end = xml.indexOf('>', at);
    if (end < 0) break;
    const head = xml.slice(at + 6, end);
    at = end + 1;
    if (head && !/^[\s/]/.test(head)) continue; // <groups>, <groupX>
    const tfm = /^\s+targetFramework="([^"]*)"/.exec(head)?.[1];
    let body = '';
    if (!head.endsWith('/')) {
      const close = xml.indexOf('</group>', at);
      if (close < 0) break;
      body = xml.slice(at, close);
      at = close + 8;
    }
    const dependencies = body
      .split('<dependency')
      .slice(1)
      .map((d) => {
        const gt = d.indexOf('>');
        return /^\s+id="([^"]+)"\s+version="([^"]+)"/.exec(gt < 0 ? d : d.slice(0, gt));
      })
      .filter(Boolean)
      .map(([, depId, range]) => ({ id: depId, range }));
    groups.push({ ...(tfm ? { targetFramework: tfm } : {}), dependencies });
  }
  return groups;
}

const listing = []; // For the index page: { ecosystem, name, versions, install }

// --- npm ---------------------------------------------------------------------------------------
const npmRoot = path.join(ROOT, 'npm');
const npmNames = dirs(npmRoot).flatMap((d) => (d.startsWith('@') ? dirs(path.join(npmRoot, d)).map((n) => `${d}/${n}`) : [d]));
for (const name of npmNames) {
  try {
    indexNpm(name);
  } catch (err) {
    skipped(`npm/${name}`, err);
  }
}
function indexNpm(name) {
  const tarDir = path.join(npmRoot, name, '-');
  const versions = {};
  const time = {};
  for (const meta of files(tarDir).filter((f) => f.endsWith('.tgz.json'))) {
    try {
      const { manifest, shasum, integrity } = JSON.parse(readFileSync(path.join(tarDir, meta), 'utf8'));
      if (typeof manifest?.version !== 'string') throw new Error('no version');
      const tgz = meta.replace(/\.json$/, '');
      const tarball = lst(path.join(tarDir, tgz));
      if (!tarball?.isFile()) throw new Error('no tarball');
      versions[manifest.version] = { ...manifest, _id: `${name}@${manifest.version}`, dist: { tarball: `${BASE}/npm/${name}/-/${tgz}`, shasum, integrity } };
      time[manifest.version] = tarball.mtime.toISOString();
    } catch (err) {
      skipped(`npm/${name}/-/${meta}`, err);
    }
  }
  const ordered = Object.keys(versions).sort(byVersion);
  if (!ordered.length) return;
  const latest = versions[ordered[ordered.length - 1]];
  write(
    path.join(npmRoot, name, 'index.json'),
    JSON.stringify({ _id: name, name, description: latest.description ?? '', 'dist-tags': { latest: latest.version }, versions, time: { created: time[ordered[0]], modified: time[latest.version], ...time }, license: latest.license }, null, 2)
  );
  const scope = name.startsWith('@') ? name.split('/')[0] : null;
  listing.push({
    ecosystem: name.startsWith('com.') ? 'Unity' : 'npm',
    name,
    versions: ordered,
    install: name.startsWith('com.')
      ? `Packages/manifest.json: "scopedRegistries": [{ "name": "Subspace", "url": "${BASE}/npm/", "scopes": ["com.subspace"] }], then "${name}": "${latest.version}"`
      : `npm config set ${scope}:registry ${BASE}/npm/ && npm install ${name}   (Deno: add "${scope}:registry=${BASE}/npm/" to .npmrc, import "npm:${name}")`,
  });
}

// --- PyPI (PEP 503 simple index) ----------------------------------------------------------------
const pypiRoot = path.join(ROOT, 'pypi');
const projects = dirs(pypiRoot).filter((d) => d !== 'simple');
const indexedProjects = [];
for (const project of projects) {
  try {
    const dists = files(path.join(pypiRoot, project)).filter((f) => f.endsWith('.whl') || f.endsWith('.tar.gz'));
    const links = dists.map((f) => `<a href="../../${escAll(segment(project))}/${esc(segment(f))}#sha256=${hash('sha256', path.join(pypiRoot, project, f))}">${esc(f)}</a><br>`);
    ensureDir(path.join(pypiRoot, 'simple'));
    const dir = path.join(pypiRoot, 'simple', project);
    ensureDir(dir);
    write(path.join(dir, 'index.html'), `<!DOCTYPE html>\n<html><head><meta name="pypi:repository-version" content="1.0"><title>Links for ${escAll(project)}</title></head><body>\n<h1>Links for ${escAll(project)}</h1>\n${links.join('\n')}\n</body></html>\n`);
    const versions = [...new Set(dists.map((f) => f.match(/-(\d[\w.]*?)(?:-py|\.tar\.gz)/)?.[1]).filter(Boolean))].sort(byVersion);
    listing.push({ ecosystem: 'Python', name: project, versions, install: `pip install --extra-index-url ${BASE}/pypi/simple/ ${project}` });
    indexedProjects.push(project);
  } catch (err) {
    skipped(`pypi/${project}`, err);
  }
}
if (indexedProjects.length) {
  const dir = path.join(pypiRoot, 'simple');
  write(path.join(dir, 'index.html'), `<!DOCTYPE html>\n<html><head><meta name="pypi:repository-version" content="1.0"><title>Simple index</title></head><body>\n${indexedProjects.map((p) => `<a href="${escAll(leading(p))}/">${escAll(p)}</a><br>`).join('\n')}\n</body></html>\n`);
}

// --- Maven ---------------------------------------------------------------------------------------
const mavenRoot = path.join(ROOT, 'maven');
/** Artifact folders: those whose subfolders hold <artifact>-<version>.pom files. */
const artifacts = [];
const findArtifacts = (dir, parts) => {
  if (parts.length > 32) return; // group ids are a few segments deep
  for (const d of dirs(dir)) {
    const sub = path.join(dir, d);
    if (files(sub).some((f) => f.endsWith('.pom'))) artifacts.push({ dir, groupId: parts.slice(0, -1).join('.'), artifactId: parts[parts.length - 1] });
    else findArtifacts(sub, [...parts, d]);
  }
};
findArtifacts(mavenRoot, []);
for (const a of [...new Map(artifacts.map((a) => [a.dir, a])).values()]) {
  try {
    indexMaven(a);
  } catch (err) {
    skipped(`maven ${a.groupId}:${a.artifactId}`, err);
  }
}
function indexMaven(a) {
  const versions = dirs(a.dir).sort(byVersion);
  // Every file gets the checksums Maven and Gradle look for.
  for (const v of versions) {
    for (const f of files(path.join(a.dir, v)).filter((f) => !/\.(sha1|md5|sha256)$/.test(f))) {
      const p = path.join(a.dir, v, f);
      try {
        write(`${p}.sha1`, hash('sha1', p));
        write(`${p}.md5`, hash('md5', p));
        write(`${p}.sha256`, hash('sha256', p));
      } catch (err) {
        skipped(`maven file ${f}`, err);
      }
    }
  }
  const latest = versions[versions.length - 1];
  const meta = path.join(a.dir, 'maven-metadata.xml');
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  write(
    meta,
    `<?xml version="1.0" encoding="UTF-8"?>\n<metadata>\n  <groupId>${escAll(a.groupId)}</groupId>\n  <artifactId>${escAll(a.artifactId)}</artifactId>\n  <versioning>\n    <latest>${escAll(latest)}</latest>\n    <release>${escAll(latest)}</release>\n    <versions>\n${versions.map((v) => `      <version>${escAll(v)}</version>`).join('\n')}\n    </versions>\n    <lastUpdated>${stamp}</lastUpdated>\n  </versioning>\n</metadata>\n`
  );
  write(`${meta}.sha1`, hash('sha1', meta));
  write(`${meta}.md5`, hash('md5', meta));
  listing.push({ ecosystem: 'Java', name: `${a.groupId}:${a.artifactId}`, versions, install: `repositories { maven { url "${BASE}/maven/" } }   dependencies { implementation "${a.groupId}:${a.artifactId}:${latest}" }` });
}

// --- NuGet v3 ------------------------------------------------------------------------------------
const nugetRoot = path.join(ROOT, 'nuget');
const nugetIds = dirs(nugetRoot).filter((d) => !['flat', 'registration'].includes(d));
for (const id of nugetIds) {
  try {
    indexNuget(id);
  } catch (err) {
    skipped(`nuget/${id}`, err);
  }
}
function indexNuget(id) {
  const versions = dirs(path.join(nugetRoot, id)).sort(byVersion);
  const entries = [];
  for (const v of versions) {
    const nupkg = path.join(nugetRoot, id, v, `${id}.${v}.nupkg`);
    if (!isFile(nupkg)) continue;
    const nuspec = readZipEntry(nupkg, (n) => n.endsWith('.nuspec') && !n.includes('/'))?.toString('utf8') ?? '';
    write(path.join(nugetRoot, id, v, `${id}.nuspec`), nuspec);
    entries.push({ v, id: tag(nuspec, 'id') || id, description: tag(nuspec, 'description'), authors: tag(nuspec, 'authors'), groups: dependencyGroups(nuspec) });
  }
  if (!entries.length) return;
  // Flat container: the version list (lower-case ids, as clients ask for them).
  write(path.join(nugetRoot, id, 'index.json'), JSON.stringify({ versions: entries.map((e) => e.v.toLowerCase()) }));
  const regBase = `${BASE}/nuget/registration/${id}`;
  const items = entries.map((e) => ({
    '@id': `${regBase}/${e.v}.json`,
    catalogEntry: { '@id': `${regBase}/${e.v}.json`, id: e.id, version: e.v, description: e.description, authors: e.authors, listed: true, dependencyGroups: e.groups, packageContent: `${BASE}/nuget/${id}/${e.v}/${id}.${e.v}.nupkg` },
    packageContent: `${BASE}/nuget/${id}/${e.v}/${id}.${e.v}.nupkg`,
    registration: `${regBase}/index.json`,
  }));
  ensureDir(path.join(nugetRoot, 'registration'));
  ensureDir(path.join(nugetRoot, 'registration', id));
  write(
    path.join(nugetRoot, 'registration', id, 'index.json'),
    JSON.stringify({ '@id': `${regBase}/index.json`, count: 1, items: [{ '@id': `${regBase}/index.json#page`, count: items.length, lower: entries[0].v, upper: entries[entries.length - 1].v, items }] }, null, 2)
  );
  for (const item of items) write(path.join(nugetRoot, 'registration', id, `${item.catalogEntry.version}.json`), JSON.stringify({ '@id': item['@id'], catalogEntry: item.catalogEntry.packageContent, listed: true, packageContent: item.packageContent, registration: item.registration }));
  const shown = entries[entries.length - 1];
  listing.push({ ecosystem: '.NET', name: shown.id, versions: entries.map((e) => e.v), install: `dotnet nuget add source ${BASE}/nuget/index.json --name subspace && dotnet add package ${shown.id}` });
}
if (nugetIds.length) {
  write(
    path.join(nugetRoot, 'index.json'),
    JSON.stringify(
      {
        version: '3.0.0',
        resources: [
          { '@id': `${BASE}/nuget/`, '@type': 'PackageBaseAddress/3.0.0', comment: 'Flat container: <id>/index.json and <id>/<version>/<id>.<version>.nupkg' },
          ...['RegistrationsBaseUrl', 'RegistrationsBaseUrl/3.0.0-beta', 'RegistrationsBaseUrl/3.0.0-rc', 'RegistrationsBaseUrl/3.4.0', 'RegistrationsBaseUrl/3.6.0'].map((t) => ({ '@id': `${BASE}/nuget/registration/`, '@type': t })),
        ],
      },
      null,
      2
    )
  );
}

// --- Plain downloads -------------------------------------------------------------------------------
const filesRoot = path.join(ROOT, 'files');
for (const f of files(filesRoot).filter((f) => !f.endsWith('.sha256'))) {
  let sum;
  try {
    sum = hash('sha256', path.join(filesRoot, f));
    write(path.join(filesRoot, `${f}.sha256`), `${sum}  ${f}\n`);
  } catch (err) {
    skipped(`files/${f}`, err);
    continue;
  }
  listing.push({ ecosystem: f.includes('unreal') ? 'Unreal Engine' : 'C++', name: f, versions: [], install: f.endsWith('.zip') ? `Unzip into your project's Plugins folder: ${BASE}/files/${f}` : `CMake: FetchContent_Declare(... URL ${BASE}/files/${f} URL_HASH SHA256=${sum})` });
}

// --- The page people land on -------------------------------------------------------------------
const rows = listing
  .sort((a, b) => a.ecosystem.localeCompare(b.ecosystem) || a.name.localeCompare(b.name))
  .map((p) => `<tr><td>${esc(p.ecosystem)}</td><td><code>${esc(p.name)}</code></td><td>${esc(p.versions.join(', '))}</td><td><code>${esc(p.install)}</code></td></tr>`)
  .join('\n');
write(
  path.join(ROOT, 'index.html'),
  `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Subspace packages</title>
<style>
:root { color-scheme: dark; --bg: #030305; --fg: #e8eaf0; --muted: #9aa0b4; --line: #23263a; --accent: #3b8ef2; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.55 system-ui, sans-serif; }
main { max-width: 1100px; margin: 0 auto; padding: 32px 16px; }
h1 { margin: 0 0 4px; } p { color: var(--muted); }
.wrap { overflow-x: auto; } table { border-collapse: collapse; width: 100%; margin-top: 24px; }
th, td { text-align: left; vertical-align: top; padding: 10px 12px; border-bottom: 1px solid var(--line); }
th { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
code { font: 13px/1.5 ui-monospace, monospace; word-break: break-word; } a { color: var(--accent); }
</style></head><body><main>
<h1>Subspace packages</h1>
<p>SDKs for building on Subspace Frequency: bots in JavaScript, Deno, Python, Java, C# and C++, and Rich Presence for JavaScript, C#, C++, Unity and Unreal Engine. Guides: <a href="https://docs.${new URL(BASE).host}/guide/bots">bots</a>, <a href="https://docs.${new URL(BASE).host}/guide/rich-presence">Rich Presence</a>.</p>
<div class="wrap"><table><thead><tr><th>For</th><th>Package</th><th>Versions</th><th>Install</th></tr></thead><tbody>
${rows}
</tbody></table></div>
</main></body></html>
`
);
console.log(`indexed ${listing.length} packages under ${ROOT}`);
