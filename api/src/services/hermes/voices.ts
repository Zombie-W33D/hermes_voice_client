/* eslint-disable no-console */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { HERMES_HOME, HERMES_BIN } from './paths';

/**
 * Available TTS voices.
 * - `edge-tts` voices (the free endpoint) — enumerated once and cached.
 * - custom XTTS voices — cloned from a reference audio sample, stored under
 *   `~/.hermes/client_voices/<name>/`.
 */
export interface TtsVoice {
  /** ShortName, e.g. "en-AU-NatashaNeural", or a custom voice name. */
  voice: string;
  gender: 'Female' | 'Male' | string;
  locale: string;
  localeName: string;
  friendlyName: string;
  /** true for locally-registered XTTS clones. */
  custom?: boolean;
}

const VOICE_CACHE_MS = 12 * 60 * 60 * 1000;
let voiceCache: { at: number; voices: TtsVoice[] } | null = null;

function agentRoot(): string {
  return path.join(HERMES_HOME, 'hermes-agent');
}

function venvPython(): string {
  return path.join(agentRoot(), 'venv', 'bin', 'python');
}

/** Custom voices live here; each <name>/ holds ref.wav (+ optional ref.txt). */
export function customVoicesDir(): string {
  return path.join(HERMES_HOME, 'client_voices');
}

export function customVoiceRef(name: string): string {
  return path.join(customVoicesDir(), name, 'ref.wav');
}

export function customVoiceRefText(name: string): string {
  return path.join(customVoicesDir(), name, 'ref.txt');
}

function profileArg(profile: string | null | undefined): string | null {
  const p = !profile || profile === 'default' ? null : profile;
  return p;
}

/** Enumerate locally-registered XTTS custom voices. */
export function listCustomVoices(): TtsVoice[] {
  const dir = customVoicesDir();
  const voices: TtsVoice[] = [];
  if (!fs.existsSync(dir)) return voices;
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return voices;
  }
  entries.forEach((name) => {
    if (!fs.existsSync(customVoiceRef(name))) return;
    voices.push({
      voice: name,
      gender: '',
      locale: 'custom',
      localeName: 'Custom (XTTS clone)',
      friendlyName: `${name} (custom voice)`,
      custom: true,
    });
  });
  return voices.sort((a, b) => a.voice.localeCompare(b.voice));
}

/** Enumerate the voices the edge endpoint exposes right now. Never throws. */
function listEdgeVoices(): TtsVoice[] {
  if (voiceCache && Date.now() - voiceCache.at < VOICE_CACHE_MS) return voiceCache.voices;

  let voices: TtsVoice[] = [];
  try {
    const out = execFileSync(
      venvPython(),
      [
        '-c',
        `
import asyncio, json, edge_tts
vs = asyncio.run(edge_tts.list_voices())
print(json.dumps([
  {
    "voice": v["ShortName"],
    "gender": v.get("Gender") or "",
    "locale": v.get("Locale") or "",
    "localeName": v.get("LocaleName") or "",
    "friendlyName": v.get("FriendlyName") or v["ShortName"],
  } for v in vs
]))
`,
      ],
      {
        cwd: agentRoot(),
        env: { ...process.env, HERMES_HOME, NO_COLOR: '1', TERM: 'dumb' },
        encoding: 'utf-8',
        timeout: 60_000,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    const parsed = JSON.parse(out.trim()) as TtsVoice[];
    voices = Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('[tts] failed to list voices:', (err as Error).message);
  }

  voices.sort((a, b) =>
    `${a.locale} ${a.gender} ${a.voice}`.localeCompare(`${b.locale} ${b.gender} ${b.voice}`)
  );
  voiceCache = { at: Date.now(), voices };
  return voices;
}

/** Edge + custom voices. */
export function listTtsVoices(): TtsVoice[] {
  return [...listEdgeVoices(), ...listCustomVoices()];
}

export function voiceInCatalog(voice: string): boolean {
  return listTtsVoices().some((v) => v.voice === voice);
}

/** Is this a locally-registered XTTS custom voice? */
export function isCustomVoice(voice: string): boolean {
  return listCustomVoices().some((v) => v.voice === voice);
}

/** Register a custom voice from a reference audio sample. */
export function registerCustomVoice(
  name: string,
  refWav: string
): { ok: boolean; voice?: string; error?: string } {
  const safe = path.basename(name).replace(/[^A-Za-z0-9 ._-]/g, '').trim() || 'voice';
  if (!fs.existsSync(refWav)) return { ok: false, error: `Reference audio not found: ${refWav}` };
  const dir = path.join(customVoicesDir(), safe);
  fs.mkdirSync(dir, { recursive: true });
  const dest = customVoiceRef(safe);
  fs.copyFileSync(refWav, dest);
  return { ok: true, voice: safe };
}

function runHermesConfig(
  profile: string | null | undefined,
  args: string[]
): { ok: boolean; stdout: string; stderr: string } {
  const profileFlag = profileArg(profile);
  const argv = [...(profileFlag ? ['-p', profileFlag] : []), 'config', ...args];
  try {
    const stdout = execFileSync(HERMES_BIN, argv, {
      encoding: 'utf-8',
      timeout: 15_000,
      env: { ...process.env, HERMES_NO_COLOR: '1', NO_COLOR: '1', TERM: 'dumb' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, stdout: stdout.trim(), stderr: '' };
  } catch (err) {
    const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; message?: string };
    return {
      ok: false,
      stdout: (e.stdout ?? '').toString().trim(),
      stderr: (e.stderr ?? '').toString().trim() || (err as Error).message,
    };
  }
}

/** Current voice for a profile; undefined when the profile isn't configured. */
export function getAgentVoice(profile: string | null | undefined): {
  ok: boolean;
  voice?: string;
  error?: string;
} {
  const res = runHermesConfig(profile, ['get', 'tts.edge.voice']);
  if (!res.ok && !res.stdout) return { ok: false, error: res.stderr || res.stdout || 'read failed' };
  const voice = res.stdout.trim() || res.stderr.trim();
  return voice ? { ok: true, voice } : { ok: true, voice: undefined };
}

/** Persist a voice for the profile via `hermes config set`. */
export function setAgentVoice(
  profile: string | null | undefined,
  voice: string
): { ok: boolean; voice?: string; error?: string } {
  if (!voiceInCatalog(voice)) {
    return { ok: false, error: `Unknown voice '${voice}'` };
  }
  const res = runHermesConfig(profile, ['set', 'tts.edge.voice', voice]);
  if (!res.ok) return { ok: false, error: res.stderr || res.stdout || 'write failed' };
  const written = res.stdout.trim();
  return { ok: true, voice: /([\w -]+)/i.exec(written)?.[1] ?? voice };
}
