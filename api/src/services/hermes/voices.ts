/* eslint-disable no-console */
import { execFileSync } from 'child_process';
import path from 'path';
import { HERMES_HOME, HERMES_BIN } from './paths';

/**
 * Available TTS voices. `edge-tts` (the free endpoint) only exposes a subset
 * of the paid Azure catalog, so the client must pick from what this list
 * actually contains — paired with the same Python interpreter the agent venv
 * uses. Cached for a while because the edge endpoint round-trips to Microsoft.
 */
export interface TtsVoice {
  /** ShortName, e.g. "en-AU-NatashaNeural" — the value for config set. */
  voice: string;
  gender: 'Female' | 'Male' | string;
  locale: string;
  localeName: string;
  friendlyName: string;
}

const VOICE_CACHE_MS = 12 * 60 * 60 * 1000;
let voiceCache: { at: number; voices: TtsVoice[] } | null = null;

function agentRoot(): string {
  return path.join(HERMES_HOME, 'hermes-agent');
}

function venvPython(): string {
  return path.join(agentRoot(), 'venv', 'bin', 'python');
}

function profileArg(profile: string | null | undefined): string | null {
  const p = !profile || profile === 'default' ? null : profile;
  return p;
}

/** Enumerate the voices the edge endpoint exposes right now. Never throws. */
export function listTtsVoices(): TtsVoice[] {
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

export function voiceInCatalog(voice: string): boolean {
  return listTtsVoices().some((v) => v.voice === voice);
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

/** Current edge voice for a profile; undefined when the profile isn't configured. */
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
  return { ok: true, voice: /([a-z]{2}-[A-Z]{2}-[\w-]+)/i.exec(written)?.[1] ?? voice };
}