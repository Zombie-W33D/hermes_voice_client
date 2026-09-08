/* eslint-disable no-console */
import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import { HERMES_HOME } from './paths';

/**
 * Persistent Coqui XTTS-v2 daemon for custom-voice synthesis.
 *
 * Loading the XTTS model takes ~35s, so we keep one worker alive and send it
 * newline-delimited JSON requests over stdio. Warm synthesis is <1s, matching
 * the edge-tts feel. The worker is `tools/xtts_server.py` in the hermes-agent
 * venv and is spawned lazily on first custom-voice use.
 */
export type XttsResult = { ok: true; out: string } | { ok: false; error: string };

let child: ChildProcess | null = null;
let buf = '';
const queue: Array<{ resolve: (v: { ok: boolean; out?: string; error?: string }) => void }> = [];
let spawnPromise: Promise<ChildProcess> | null = null;
let spawnTries = 0;
const MAX_SPAWN_TRIES = 3;
const REQUEST_TIMEOUT_MS = 180_000;

function venvPython(): string {
  return path.join(HERMES_HOME, 'hermes-agent', 'venv', 'bin', 'python');
}

function daemonScript(): string {
  return path.join(HERMES_HOME, 'hermes-agent', 'tools', 'xtts_server.py');
}

function ensureScript(): boolean {
  try {
    return fs.existsSync(daemonScript());
  } catch {
    return false;
  }
}

function handleLine(line: string): void {
  let parsed: { ok: boolean; out?: string; error?: string };
  try {
    parsed = JSON.parse(line);
  } catch {
    return; // ignore stray non-JSON lines
  }
  const entry = queue.shift();
  if (entry) entry.resolve(parsed);
}

/** Split an accumulated stdout buffer into complete newline-terminated lines. */
function drainBuffer(): void {
  let nl = buf.indexOf('\n');
  while (nl >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (line) handleLine(line);
    nl = buf.indexOf('\n');
  }
}

function spawnDaemon(): Promise<ChildProcess> {
  if (spawnPromise) return spawnPromise;
  spawnPromise = new Promise<ChildProcess>((resolveSpawn, rejectSpawn) => {
    const p = spawn(venvPython(), [daemonScript()], {
      env: { ...process.env, HERMES_HOME, NO_COLOR: '1', TERM: 'dumb' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child = p;
    p.stdout.setEncoding('utf-8');
    p.stdout.on('data', (chunk: string) => {
      buf += chunk;
      drainBuffer();
    });
    p.stderr.setEncoding('utf-8');
    p.stderr.on('data', () => {
      /* diagnostics only */
    });
    p.on('error', (err) => {
      console.error('[xtts] daemon error:', (err as Error).message);
    });
    p.on('exit', (code, signal) => {
      console.error(`[xtts] daemon exited${signal ? ` (${signal})` : ` (code ${code})`}`);
      const errResp = { ok: false as const, error: 'XTTS daemon exited' };
      while (queue.length) {
        const entry = queue.shift();
        if (entry) entry.resolve({ ...errResp });
      }
      child = null;
      spawnPromise = null;
      const err = new Error(`XTTS daemon exited (${code ?? signal})`);
      rejectSpawn(err);
    });
    // Only consider the daemon "ready" once it's alive and hasn't immediately died.
    setTimeout(() => resolveSpawn(p), 500);
  });
  return spawnPromise;
}

async function spawnOrRetry(): Promise<ChildProcess> {
  try {
    return await spawnDaemon();
  } catch {
    if (spawnTries >= MAX_SPAWN_TRIES) throw new Error('XTTS daemon failed to start');
    spawnTries += 1;
    spawnPromise = null;
    return spawnOrRetry();
  }
}

/**
 * Synthesize `text` with the cloned voice whose reference is `refWav`.
 * Returns the path to the produced wav (or an error). Keeps the daemon warm
 * across calls.
 */
export async function xttsSynthesize(text: string, refWav: string): Promise<XttsResult> {
  if (!ensureScript()) return { ok: false, error: 'XTTS daemon script not found' };

  let proc: ChildProcess;
  try {
    proc = await spawnOrRetry();
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  const { stdin } = proc;
  if (!stdin) return { ok: false, error: 'XTTS daemon stdin unavailable' };

  const outWav = path.join(
    HERMES_HOME,
    'hermes-agent',
    'cache',
    `xtts_${Date.now()}_${Math.floor(Math.random() * 1e6)}.wav`
  );
  fs.mkdirSync(path.dirname(outWav), { recursive: true });

  return new Promise<XttsResult>((resolve) => {
    const timer = setTimeout(() => {
      resolve({ ok: false, error: 'XTTS synthesis timed out' });
    }, REQUEST_TIMEOUT_MS);
    queue.push({
      resolve: (resp) => {
        clearTimeout(timer);
        if (resp.ok && resp.out) {
          resolve({ ok: true as const, out: resp.out! });
        } else {
          resolve({ ok: false as const, error: resp.error || 'XTTS synthesis failed' });
        }
      },
    });
    if (!stdin.writable) {
      queue.shift();
      clearTimeout(timer);
      resolve({ ok: false, error: 'XTTS daemon stdin closed' });
    } else {
      stdin.write(`${JSON.stringify({ text, ref: refWav, out: outWav })}\n`);
    }
  });
}

/** Best-effort shutdown of the daemon (e.g. on process exit). */
export function shutdownXtTSDaemon(): void {
  if (child) {
    try {
      child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
}
