// Starts optional infrastructure for native runs when it is installed but not running:
//   MinIO   - binary from MINIO_BIN, or ~/.subspace-tools/bin/minio(.exe)
//   LiveKit - binary from LIVEKIT_BIN, or (on Windows) ~/.local/subspace/livekit-server inside WSL
// Children are tied to this process and stop with it.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from './env.mjs';

export const probe = (port) =>
  new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1');
    s.setTimeout(1500);
    s.once('connect', () => (s.destroy(), resolve(true)));
    s.once('error', () => resolve(false));
    s.once('timeout', () => (s.destroy(), resolve(false)));
  });

const waitFor = async (port, ms = 20000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await probe(port)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
};

const children = [];
const stopAll = () => children.forEach((c) => !c.killed && c.kill());
process.on('exit', stopAll);

function startMinio(env) {
  const exe = process.platform === 'win32' ? 'minio.exe' : 'minio';
  const bin = env.MINIO_BIN || path.join(os.homedir(), '.subspace-tools', 'bin', exe);
  if (!existsSync(bin)) return null;
  const dataDir = path.join(ROOT, '.native-data', 'minio');
  mkdirSync(dataDir, { recursive: true });
  const child = spawn(bin, ['server', dataDir, '--address', '127.0.0.1:9000', '--console-address', '127.0.0.1:9001', '--quiet'], {
    env: { ...env, MINIO_ROOT_USER: env.MINIO_ROOT_USER, MINIO_ROOT_PASSWORD: env.MINIO_ROOT_PASSWORD },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  children.push(child);
  return child;
}

function startLivekit(env) {
  const keys = `${env.LIVEKIT_API_KEY}: ${env.LIVEKIT_API_SECRET}`;
  if (env.LIVEKIT_BIN && existsSync(env.LIVEKIT_BIN)) {
    const child = spawn(env.LIVEKIT_BIN, ['--config', path.join(ROOT, 'docker', 'livekit.native.yaml')], {
      env: { ...env, LIVEKIT_KEYS: keys },
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    children.push(child);
    return child;
  }
  if (process.platform !== 'win32') return null;
  // WSL: translate the repo path and pass keys through the environment (never argv).
  const wslConfig = path
    .join(ROOT, 'docker', 'livekit.native.yaml')
    .replace(/^([A-Za-z]):/, (_, d) => `/mnt/${d.toLowerCase()}`)
    .split(path.sep)
    .join('/');
  const script = `test -x ~/.local/subspace/livekit-server || exit 3; exec ~/.local/subspace/livekit-server --config "${wslConfig}"`;
  const child = spawn('wsl', ['-d', env.WSL_DISTRO || 'Ubuntu', '--', 'bash', '-lc', script], {
    env: { ...env, LIVEKIT_KEYS: keys, WSLENV: `${process.env.WSLENV ? process.env.WSLENV + ':' : ''}LIVEKIT_KEYS/u` },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  children.push(child);
  return child;
}

/** Ensure optional services are up; returns which ones are available. */
export async function ensureInfra(env) {
  const status = { minio: await probe(9000), livekit: await probe(7880) };
  if (!status.minio && env.MINIO_ROOT_PASSWORD && startMinio(env)) {
    status.minio = await waitFor(9000);
    console.log(`[native] MinIO ${status.minio ? 'started on :9000' : 'failed to start'}`);
  }
  if (!status.livekit && env.LIVEKIT_API_SECRET && startLivekit(env)) {
    status.livekit = await waitFor(7880);
    console.log(`[native] LiveKit ${status.livekit ? 'started on :7880' : 'failed to start'}`);
  }
  return status;
}
