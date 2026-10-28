// Hostile-input tests for deploy/server/registry-index.mjs, the script that rebuilds the package
// registry's indexes on the server (run as root by deploy/server/publish-packages.sh). It is a CLI
// with no exports, so every case builds a package tree in a temp dir and spawns it with node:
//   node registry-index.mjs <root> <base>
// Cases marked "Fixed (was a security bug)" were real defects found by these tests; they stay as
// regression tests.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';

const SCRIPT = path.resolve(__dirname, '../../deploy/server/registry-index.mjs');
const BASE = 'https://registry.test/packages';
let TMP = '';

beforeAll(() => {
  TMP = mkdtempSync(path.join(tmpdir(), 'registry-index-test-'));
});
afterAll(() => {
  if (TMP) rmSync(TMP, { recursive: true, force: true });
});

// --- helpers ---------------------------------------------------------------------------------------

/** A fresh sandbox: <case>/packages is the registry root, <case> its parent (watched for strays). */
let caseNo = 0;
function sandbox() {
  const parent = path.join(TMP, `case-${++caseNo}`);
  const root = path.join(parent, 'packages');
  mkdirSync(root, { recursive: true });
  return { parent, root };
}

function put(file: string, data: string | Buffer) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, data);
}

function run(root: string, timeout = 20_000) {
  const r = spawnSync(process.execPath, [SCRIPT, root, BASE], { encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024 });
  return { status: r.status, signal: r.signal, stdout: r.stdout ?? '', stderr: r.stderr ?? '', timedOut: (r.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT' };
}

/** Everything under dir, as relative paths (does not follow links). */
function tree(dir: string, rel = ''): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    out.push(r);
    if (e.isDirectory()) out.push(...tree(path.join(dir, e.name), r));
  }
  return out.sort();
}

const escHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Whether this filesystem accepts a name (Windows rejects < > " : | ? * and trailing dots). */
function canName(name: string) {
  const probe = path.join(TMP, `probe-${Math.random().toString(36).slice(2)}`);
  try {
    mkdirSync(path.join(probe, name), { recursive: true });
    return existsSync(path.join(probe, name));
  } catch {
    return false;
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
}

/** A directory link: a junction on Windows (no privilege needed), a symlink elsewhere. */
function linkDir(target: string, link: string) {
  mkdirSync(path.dirname(link), { recursive: true });
  symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
}

type ZipEntry = { name: string; data: Buffer; method?: 0 | 8 };
/** A minimal well-formed zip; the reader under test does not check CRCs, but they are right anyway. */
function zip(entries: ZipEntry[]) {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const method = e.method ?? 8;
    const body = method === 8 ? deflateRawSync(e.data) : e.data;
    const name = Buffer.from(e.name, 'utf8');
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc32(e.data), 14);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(e.data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(crc32(e.data), 16);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(e.data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    locals.push(lh, name, body);
    centrals.push(ch, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return { buf: Buffer.concat([...locals, cd, eocd]), cdOffset: offset };
}

const nuspecXml = (id: string, extra = '') =>
  `<?xml version="1.0"?><package><metadata><id>${id}</id><version>1.0.0</version><authors>A</authors><description>D</description>${extra}</metadata></package>`;

/** nuget/<id>/1.0.0/<id>.1.0.0.nupkg, plus a healthy npm package so a crash is visible as a lost index. */
function nugetCase(nupkg: Buffer, id = 'evil') {
  const s = sandbox();
  put(path.join(s.root, 'nuget', id, '1.0.0', `${id}.1.0.0.nupkg`), nupkg);
  addNpm(s.root, 'healthy', { name: 'healthy', version: '1.0.0', description: 'ok' });
  return s;
}

function addNpm(root: string, name: string, manifest: Record<string, unknown>, tgzName = `${name.split('/').pop()}-1.0.0.tgz`) {
  const dir = path.join(root, 'npm', name, '-');
  put(path.join(dir, tgzName), 'tgz');
  put(path.join(dir, `${tgzName}.json`), JSON.stringify({ manifest, shasum: 'x', integrity: 'sha512-x' }));
}

/** The run finished normally and wrote the landing page. */
function expectHealthyRun(r: ReturnType<typeof run>, root: string) {
  expect(r.timedOut, 'timed out').toBe(false);
  expect(r.stderr).toBe('');
  expect(r.status).toBe(0);
  expect(existsSync(path.join(root, 'index.html'))).toBe(true);
}

// --- baseline ----------------------------------------------------------------------------------------

describe('registry-index baseline', () => {
  it('indexes one package of every ecosystem and writes valid JSON', () => {
    const s = sandbox();
    addNpm(s.root, '@subspace/bot-sdk', { name: '@subspace/bot-sdk', version: '0.1.0', description: 'bots' });
    put(path.join(s.root, 'pypi', 'subspace-bot', 'subspace_bot-0.1.0-py3-none-any.whl'), 'whl');
    put(path.join(s.root, 'maven', 'click', 'subspace', 'subspace-bot', '0.1.0', 'subspace-bot-0.1.0.pom'), '<project/>');
    put(path.join(s.root, 'nuget', 'subspace.rp', '0.1.0', 'subspace.rp.0.1.0.nupkg'), zip([{ name: 'Subspace.RP.nuspec', data: Buffer.from(nuspecXml('Subspace.RP')) }]).buf);
    put(path.join(s.root, 'files', 'subspace-cpp-0.1.0.tar.gz'), 'tar');
    const r = run(s.root);
    expectHealthyRun(r, s.root);
    expect(r.stdout).toContain('indexed 5 packages');
    for (const f of ['npm/@subspace/bot-sdk/index.json', 'nuget/index.json', 'nuget/subspace.rp/index.json', 'nuget/registration/subspace.rp/index.json']) {
      expect(() => JSON.parse(readFileSync(path.join(s.root, f), 'utf8')), f).not.toThrow();
    }
    expect(readFileSync(path.join(s.root, 'nuget', 'subspace.rp', '0.1.0', 'subspace.rp.nuspec'), 'utf8')).toContain('<id>Subspace.RP</id>');
    expect(tree(s.parent)).toEqual(['packages', ...tree(s.root).map((p) => `packages/${p}`)].sort());
  });
});

// --- traversal and hostile names -----------------------------------------------------------------------

describe('hostile names and paths', () => {
  it('content-derived versions and ids (../, ..\\, absolute, NUL) never become paths', () => {
    const s = sandbox();
    const hostile = ['../../escaped-npm', '..\\..\\escaped-npm2', '/tmp/escaped-abs', 'C:\\escaped-win', '1.0.0\u0000../../nul', 'x'.repeat(5000)];
    hostile.forEach((v, i) => addNpm(s.root, `pkg${i}`, { name: `pkg${i}`, version: v }));
    // NuGet: the nuspec <id> is attacker-ish content; only the folder name may reach the filesystem.
    put(path.join(s.root, 'nuget', 'safe', '1.0.0', 'safe.1.0.0.nupkg'), zip([{ name: 'safe.nuspec', data: Buffer.from(nuspecXml('../../../escaped-nuget')) }]).buf);
    const before = readdirSync(s.parent);
    const r = run(s.root);
    expectHealthyRun(r, s.root);
    expect(readdirSync(s.parent)).toEqual(before);
    expect(tree(s.root).some((p) => p.includes('escaped'))).toBe(false);
    for (let i = 0; i < hostile.length; i++) {
      const doc = JSON.parse(readFileSync(path.join(s.root, 'npm', `pkg${i}`, 'index.json'), 'utf8'));
      expect(Object.keys(doc.versions)).toEqual([hostile[i]]);
    }
  });

  it('the filesystem itself refuses NUL in names and readdir never yields "." or "..", so folder names cannot traverse', () => {
    expect(() => mkdirSync(path.join(TMP, 'a\u0000b'))).toThrow();
    expect(readdirSync(TMP)).not.toContain('..');
  });

  it('dot-dot-looking folder names stay inside the root', () => {
    const s = sandbox();
    for (const n of ['..foo', '.. ', '%2e%2e', '..%2f..']) {
      if (!canName(n)) continue;
      addNpm(s.root, n, { name: n, version: '1.0.0' });
      put(path.join(s.root, 'pypi', n, `${n}-1.0.0.tar.gz`), 'x');
      put(path.join(s.root, 'maven', 'g', n, '1.0.0', `${n}-1.0.0.pom`), 'x');
    }
    const before = readdirSync(s.parent);
    expectHealthyRun(run(s.root), s.root);
    expect(readdirSync(s.parent)).toEqual(before);
  });

  // Fixed (was a security bug): statSync()/existsSync() follow links, so a directory link inside the upload tree
  // (the server runs `sudo tar -xzf` then `sudo node registry-index.mjs`) makes the script write
  // index.json / maven-metadata.xml / *.sha1 / *.md5 / *.sha256 wherever the link points, as root.
  it('a linked npm package folder does not get index.json written outside the root', () => {
    const s = sandbox();
    const outside = path.join(s.parent, 'outside-npm');
    addNpm(outside, 'victim', { name: 'victim', version: '1.0.0' }); // outside/npm/victim/-/...
    linkDir(path.join(outside, 'npm', 'victim'), path.join(s.root, 'npm', 'victim'));
    expectHealthyRun(run(s.root), s.root);
    expect(existsSync(path.join(outside, 'npm', 'victim', 'index.json'))).toBe(false);
  });

  // Fixed (was a security bug): same link-following, Maven flavour: checksum files and metadata land outside.
  it('a linked maven folder does not get checksums written outside the root', () => {
    const s = sandbox();
    const outside = path.join(s.parent, 'outside-maven');
    put(path.join(outside, '1.0.0', 'victim-1.0.0.pom'), '<project/>');
    linkDir(outside, path.join(s.root, 'maven', 'g', 'victim'));
    expectHealthyRun(run(s.root), s.root);
    expect(tree(outside).filter((p) => /\.(sha1|md5|sha256)$|maven-metadata/.test(p))).toEqual([]);
  });

  it('a link loop under maven terminates (no hang)', () => {
    const s = sandbox();
    linkDir(path.join(s.root, 'maven'), path.join(s.root, 'maven', 'loop'));
    expect(run(s.root, 60_000).timedOut).toBe(false);
  }, 70_000);

  // Fixed (was a security bug) (robustness/DoS): findArtifacts() follows links, and dirs() calls statSync() on each
  // child unguarded, so a link loop ends in an uncaught ELOOP (or ENAMETOOLONG) and the run aborts.
  it('a link loop under maven does not abort the run', () => {
    const s = sandbox();
    linkDir(path.join(s.root, 'maven'), path.join(s.root, 'maven', 'loop'));
    expectHealthyRun(run(s.root, 60_000), s.root);
  }, 70_000);

  // Fixed (was a security bug) (robustness/DoS): `${file}.sha256` is written next to every Maven file, so a file
  // whose name is 249-255 bytes makes writeFileSync throw ENAMETOOLONG and aborts the whole run;
  // NuGet and the landing page are then never rebuilt.
  it('a very long maven file name does not abort the run', () => {
    const s = sandbox();
    const long = `${'a'.repeat(244)}-1.0.0.pom`; // 254 chars: legal, but +".sha256" is not
    put(path.join(s.root, 'maven', 'g', 'a', '1.0.0', long), '<project/>');
    expectHealthyRun(run(s.root), s.root);
  });

  it('a very long npm package folder name is fine', () => {
    const s = sandbox();
    const long = 'n'.repeat(200);
    addNpm(s.root, long, { name: long, version: '1.0.0' }, 'n-1.0.0.tgz');
    expectHealthyRun(run(s.root), s.root);
  });

  // Fixed (was a security bug) (robustness/DoS): one malformed .tgz.json, or a .tgz.json whose .tgz is missing,
  // throws out of the npm loop and nothing after it (PyPI, Maven, NuGet, index.html) is written.
  it('a malformed npm metadata file does not abort the run', () => {
    const s = sandbox();
    put(path.join(s.root, 'npm', 'broken', '-', 'broken-1.0.0.tgz.json'), '{not json');
    put(path.join(s.root, 'npm', 'broken', '-', 'broken-1.0.0.tgz'), 'x');
    expectHealthyRun(run(s.root), s.root);
  });

  it('npm metadata without its tarball does not abort the run', () => {
    const s = sandbox();
    put(path.join(s.root, 'npm', 'orphan', '-', 'orphan-1.0.0.tgz.json'), JSON.stringify({ manifest: { name: 'orphan', version: '1.0.0' } }));
    expectHealthyRun(run(s.root), s.root);
  });
});

// --- HTML / XML injection -----------------------------------------------------------------------------

const PAYLOADS = ['<script>alert(1)</script>', '"><img src=x onerror=alert(1)>', "' onmouseover='alert(1)", '`${alert(1)}`', 'javascript:alert(1)'];

describe('HTML injection into the landing page (index.html)', () => {
  it('escapes npm versions, descriptions and install text (text context)', () => {
    const s = sandbox();
    PAYLOADS.forEach((p, i) => addNpm(s.root, `@s/p${i}`, { name: `@s/p${i}`, version: p, description: p, author: p, homepage: p, readme: p }));
    expectHealthyRun(run(s.root), s.root);
    const html = readFileSync(path.join(s.root, 'index.html'), 'utf8');
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;');
    // Every element and attribute is the page's own: payload text only ever sits in text nodes.
    const tags = [...html.matchAll(/<([a-zA-Z][\w-]*)/g)].map((m) => m[1]);
    expect(new Set(tags)).toEqual(new Set(['html', 'head', 'meta', 'title', 'style', 'body', 'main', 'h1', 'p', 'a', 'div', 'table', 'thead', 'tr', 'th', 'tbody', 'td', 'code']));
    expect([...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]).every((h) => h.startsWith('https://docs.registry.test/'))).toBe(true);
    // The JSON side keeps the values verbatim and stays valid.
    const doc = JSON.parse(readFileSync(path.join(s.root, 'npm', '@s', 'p0', 'index.json'), 'utf8'));
    expect(doc.description).toBe(PAYLOADS[0]);
  });

  it('escapes NuGet ids and keeps nuspec descriptions/authors valid in the registration JSON', () => {
    const s = sandbox();
    PAYLOADS.forEach((p, i) => {
      const xmlish = nuspecXml(p.replace(/</g, '&lt;').replace(/>/g, '&gt;'), '').replace('<description>D</description>', `<description>${p}</description>`).replace('<authors>A</authors>', `<authors>${p}"\u2028</authors>`);
      put(path.join(s.root, 'nuget', `n${i}`, '1.0.0', `n${i}.1.0.0.nupkg`), zip([{ name: `n${i}.nuspec`, data: Buffer.from(xmlish) }]).buf);
    });
    // An id that is raw markup (the nuspec regex takes whatever sits between the tags).
    put(path.join(s.root, 'nuget', 'raw', '1.0.0', 'raw.1.0.0.nupkg'), zip([{ name: 'raw.nuspec', data: Buffer.from('<id>"><img src=x onerror=alert(1)><script>alert(2)</script></id>') }]).buf);
    expectHealthyRun(run(s.root), s.root);
    const html = readFileSync(path.join(s.root, 'index.html'), 'utf8');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script>');
    for (let i = 0; i < PAYLOADS.length; i++) {
      const reg = JSON.parse(readFileSync(path.join(s.root, 'nuget', 'registration', `n${i}`, 'index.json'), 'utf8'));
      expect(reg.items[0].items[0].catalogEntry.description).toBe(PAYLOADS[i]);
    }
  });

  it('escapes hostile file and folder names in the landing page', () => {
    const s = sandbox();
    const names = ["q'uote&amp`tick", '<img src=x onerror=alert(1)>', '"><b>x'].filter(canName);
    for (const n of names) {
      put(path.join(s.root, 'files', `${n}.tar.gz`), 'x');
      addNpm(s.root, n, { name: n, version: '1.0.0' }, 'x-1.0.0.tgz');
    }
    expectHealthyRun(run(s.root), s.root);
    const html = readFileSync(path.join(s.root, 'index.html'), 'utf8');
    for (const n of names) expect(html).toContain(escHtml(n).replace(/&#39;/g, "'"));
    expect(html).not.toContain('<img');
  });
});

/**
 * The PyPI simple pages interpolate the project folder name raw into <title>, <h1> and href, and the
 * file name raw into href (only the link text goes through esc()). Windows cannot name folders with
 * < > " :, so there the probe uses & and ' (proving the missing escape); on Linux the real XSS payload.
 */
const PYPI_PROJECT = canName('<img src=x onerror=alert(1)>') ? '<img src=x onerror=alert(1)>' : "a&b'c";
const PYPI_FILE = canName('"><img src=x onerror=alert(2)>-1.0.0.tar.gz') ? '"><img src=x onerror=alert(2)>-1.0.0.tar.gz' : "x&y'z-1.0.0.tar.gz";
const PYPI_JS = canName('javascript:alert(1)<!--') ? 'javascript:alert(1)<!--' : null;

describe('HTML injection into the PyPI simple index', () => {
  function pypiCase(project: string, file: string) {
    const s = sandbox();
    put(path.join(s.root, 'pypi', project, file), 'dist');
    expectHealthyRun(run(s.root), s.root);
    return {
      page: readFileSync(path.join(s.root, 'pypi', 'simple', project, 'index.html'), 'utf8'),
      root: readFileSync(path.join(s.root, 'pypi', 'simple', 'index.html'), 'utf8'),
    };
  }

  it('escapes the link text of distribution files', () => {
    const { page } = pypiCase('proj', PYPI_FILE);
    expect(page).toContain(`>${escHtml(PYPI_FILE).replace(/&#39;/g, "'")}</a>`);
  });

  // Fixed (was a security bug): registry-index.mjs:105 puts ${project} raw into <title>, <h1> and the href, and
  // :111 puts ${p} raw into href. A folder named `<img src=x onerror=alert(1)>` is stored HTML on
  // the app's own origin (CSP script-src 'self' blocks inline handlers, but not <script src> to a
  // .js uploaded under /packages/files/).
  it('escapes the project name in the per-project page', () => {
    const { page } = pypiCase(PYPI_PROJECT, 'proj-1.0.0.tar.gz');
    expect(page).toContain(`<title>Links for ${escHtml(PYPI_PROJECT)}</title>`);
    expect(page).toContain(`<h1>Links for ${escHtml(PYPI_PROJECT)}</h1>`);
  });

  it('escapes the project name in the root simple index href', () => {
    const { root } = pypiCase(PYPI_PROJECT, 'proj-1.0.0.tar.gz');
    expect(root).toContain(`href="${escHtml(PYPI_PROJECT)}/"`);
  });

  // Fixed (was a security bug): registry-index.mjs:102 puts the file name raw into href="../../${project}/${f}#…",
  // so a `"` in a wheel/sdist name breaks out of the attribute.
  it('escapes distribution file names inside href', () => {
    const { page } = pypiCase('proj', PYPI_FILE);
    const hrefs = [...page.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    expect(hrefs).toHaveLength(1);
    expect(hrefs[0]).toContain(escHtml(PYPI_FILE).replace(/&#39;/g, "'"));
  });

  // Fixed (was a security bug) (Linux only, folder names may contain ':'): the root simple index emits
  // href="javascript:alert(1)<!--/" — a javascript: URL. Hrefs should be percent-encoded relative paths.
  it.skipIf(!PYPI_JS)('never emits a javascript: href in the root simple index', () => {
    const { root } = pypiCase(PYPI_JS!, 'x-1.0.0.tar.gz');
    expect([...root.matchAll(/href="([^"]*)"/g)].some((m) => /^\s*javascript:/i.test(m[1]))).toBe(false);
  });
});

describe('XML injection into maven-metadata.xml', () => {
  // Fixed (was a security bug) (low): groupId/artifactId/version folder names go raw into maven-metadata.xml, so a
  // version folder named "1.0&x" (or "<x>" on Linux) produces malformed / attacker-shaped XML.
  it('escapes folder names in maven-metadata.xml', () => {
    const s = sandbox();
    const v = canName('1.0<x>') ? '1.0<x>&y' : '1.0&y';
    put(path.join(s.root, 'maven', 'g', 'a', v, `a-${v}.pom`), '<project/>');
    expectHealthyRun(run(s.root), s.root);
    const xml = readFileSync(path.join(s.root, 'maven', 'g', 'a', 'maven-metadata.xml'), 'utf8');
    expect(xml).toContain(`<version>${v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</version>`);
  });
});

// --- the .nupkg zip reader -------------------------------------------------------------------------------

describe('readZipEntry on malformed .nupkg files', () => {
  const good = () => zip([{ name: 'evil.nuspec', data: Buffer.from(nuspecXml('Evil')) }]);
  // No .nuspec at all, so the reader walks every central record the count claims.
  const noNuspec = () => zip([{ name: 'readme.txt', data: Buffer.from('hello') }]);

  it('a file shorter than an end-of-central-directory record is skipped', () => {
    const s = nugetCase(Buffer.from('PK'));
    expectHealthyRun(run(s.root), s.root);
  });

  it('a truncated zip (end record cut off) is skipped', () => {
    const { buf } = good();
    const s = nugetCase(buf.subarray(0, Math.floor(buf.length / 2)));
    expectHealthyRun(run(s.root), s.root);
  });

  it('an empty file is skipped', () => {
    const s = nugetCase(Buffer.alloc(0));
    expectHealthyRun(run(s.root), s.root);
  });

  it('a stored entry declaring a 4 GiB size is clamped to the file', () => {
    const { buf, cdOffset } = zip([{ name: 'evil.nuspec', data: Buffer.from(nuspecXml('Evil')), method: 0 }]);
    buf.writeUInt32LE(0xffffffff, cdOffset + 20);
    buf.writeUInt32LE(0xffffffff, cdOffset + 24);
    const s = nugetCase(buf);
    expectHealthyRun(run(s.root), s.root);
  });

  // Fixed (was a security bug) (robustness/DoS), registry-index.mjs:44-57: no bounds checks. Every offset read from
  // the zip is trusted, so Buffer.readUInt*LE throws RangeError, or inflateRawSync throws on a cut
  // or corrupt stream, and the exception escapes: the NuGet index and the landing page are not written.
  const crashers: Array<[string, () => Buffer]> = [
    ['central directory offset past the end', () => { const z = good(); z.buf.writeUInt32LE(0xfffffff0, z.buf.length - 22 + 16); return z.buf; }],
    ['central directory offset pointing into the last bytes', () => { const z = good(); z.buf.writeUInt32LE(z.buf.length - 4, z.buf.length - 22 + 16); return z.buf; }],
    ['entry count 65535 with one real entry', () => { const z = noNuspec(); z.buf.writeUInt16LE(0xffff, z.buf.length - 22 + 10); return z.buf; }],
    ['local header offset past the end', () => { const z = good(); z.buf.writeUInt32LE(0x7fffffff, z.cdOffset + 42); return z.buf; }],
    ['deflate stream cut short', () => { const z = zip([{ name: 'evil.nuspec', data: Buffer.from(nuspecXml('Evil').repeat(50)) }]); z.buf.writeUInt32LE(8, z.cdOffset + 20); return z.buf; }],
    ['corrupt deflate data', () => { const z = zip([{ name: 'evil.nuspec', data: Buffer.alloc(64, 0xff), method: 0 }]); z.buf.writeUInt16LE(8, z.cdOffset + 10); return z.buf; }],
    ['central record cut mid-name (name length 65535)', () => { const z = good(); z.buf.writeUInt16LE(0xffff, z.cdOffset + 28); z.buf.writeUInt16LE(2, z.buf.length - 22 + 10); return z.buf; }],
  ];
  for (const [label, make] of crashers) {
    it(`${label}: the run survives`, () => {
      const s = nugetCase(make());
      expectHealthyRun(run(s.root, 15_000), s.root);
    }, 20_000);
  }

  it('a deflate entry whose compressed size runs past the end of file is clamped (trailing bytes ignored)', () => {
    const { buf, cdOffset } = good();
    buf.writeUInt32LE(0xffffffff, cdOffset + 20);
    const s = nugetCase(buf);
    expectHealthyRun(run(s.root), s.root);
    expect(readFileSync(path.join(s.root, 'nuget', 'evil', '1.0.0', 'evil.nuspec'), 'utf8')).toContain('<id>Evil</id>');
  });

  it('an unknown compression method does not crash (bytes are passed through as-is)', () => {
    const { buf, cdOffset } = good();
    buf.writeUInt16LE(12, cdOffset + 10); // bzip2
    const s = nugetCase(buf);
    expectHealthyRun(run(s.root), s.root);
  });

  // Fixed (was a security bug) (DoS): inflateRawSync has no maxOutputLength and the inflated nuspec is written to
  // disk verbatim. A ~64 KiB nupkg inflates to 64 MiB here (deflate tops out near 1032:1, so a 4 MiB
  // nupkg is ~4 GiB of RAM in a root process, then the same on disk).
  it('a high-ratio deflate nuspec is capped', () => {
    const bomb = zip([{ name: 'evil.nuspec', data: Buffer.alloc(64 * 1024 * 1024, 0x20) }]);
    expect(bomb.buf.length).toBeLessThan(256 * 1024);
    const s = nugetCase(bomb.buf);
    const r = run(s.root, 30_000);
    expect(r.timedOut).toBe(false);
    const out = path.join(s.root, 'nuget', 'evil', '1.0.0', 'evil.nuspec');
    expect(existsSync(out) ? statSync(out).size : 0).toBeLessThan(4 * 1024 * 1024);
  }, 40_000);

  // Fixed (was a security bug) (DoS): the dependency-group regex at registry-index.mjs:162 is quadratic on
  // unterminated `<group>` openers (each one lazily scans to the end of the nuspec). ~1 MiB of them
  // (a few KiB compressed) keeps the root process busy for tens of seconds; 8 MiB for hours.
  it('a nuspec of unterminated <group> tags is parsed in linear time', () => {
    const nuspec = nuspecXml('Evil', '<dependencies>' + '<group>'.repeat(150_000));
    const s = nugetCase(zip([{ name: 'evil.nuspec', data: Buffer.from(nuspec) }]).buf);
    const r = run(s.root, 8_000);
    expect(r.timedOut).toBe(false);
    expect(r.status).toBe(0);
  }, 15_000);

  // Fixed (was a security bug) (DoS): tag() at registry-index.mjs:160 builds /<t>([\s\S]*?)<\/t>/ and is just as
  // quadratic: ~2.6 MiB of unterminated <description> openers runs for well over 15 s.
  it('a nuspec of unterminated <description> tags is parsed in linear time', () => {
    const nuspec = '<description>'.repeat(200_000);
    const s = nugetCase(zip([{ name: 'evil.nuspec', data: Buffer.from(nuspec) }]).buf);
    const r = run(s.root, 8_000);
    expect(r.timedOut).toBe(false);
    expect(r.status).toBe(0);
  }, 15_000);

  it('only a top-level .nuspec is read (nested ones and zip-slip names are ignored, nothing extracted)', () => {
    const z = zip([
      { name: '../../../escaped.nuspec', data: Buffer.from(nuspecXml('Slip')) },
      { name: 'sub/dir.nuspec', data: Buffer.from(nuspecXml('Nested')) },
      { name: 'evil.nuspec', data: Buffer.from(nuspecXml('Real')) },
    ]);
    const s = nugetCase(z.buf);
    const before = readdirSync(s.parent);
    expectHealthyRun(run(s.root), s.root);
    expect(readdirSync(s.parent)).toEqual(before);
    expect(tree(s.root).some((p) => p.includes('escaped'))).toBe(false);
    expect(readFileSync(path.join(s.root, 'nuget', 'evil', '1.0.0', 'evil.nuspec'), 'utf8')).toContain('<id>Real</id>');
  });
});
