/* eslint-disable no-console */
import fs from 'fs';
import path from 'path';
import colors from 'colors';
import { HERMES_HOME } from './paths';

/** Files this young are likely being written by a live synthesis — never touch. */
const MIN_AGE_MS = 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 12 * 60 * 60 * 1000;

/**
 * All directories that hold synthesized audio: the default profile at
 * ~/.hermes/cache/audio plus every ~/.hermes/profiles/<name>/cache/audio.
 */
function audioCacheDirs(): string[] {
  const dirs: string[] = [path.join(HERMES_HOME, 'cache', 'audio')];
  const profilesRoot = path.join(HERMES_HOME, 'profiles');
  let entries: string[] = [];
  try {
    entries = fs.existsSync(profilesRoot) ? fs.readdirSync(profilesRoot) : [];
  } catch {
    /* unreadable profiles dir — treat as empty */
  }
  entries.forEach((name) => dirs.push(path.join(profilesRoot, name, 'cache', 'audio')));
  return dirs;
}

/**
 * Remove synthesized-audio files older than `MIN_AGE_MS` from every profile's
 * cache/audio dir. Orphaned/incomplete files are the only candidates: anything
 * streamed through /message/speak is unlinked right after being read, so files
 * this old can only be leftovers from an aborted or killed synthesis.
 */
export function sweepStaleAudio(): number {
  const now = Date.now();
  return audioCacheDirs().reduce<number>((removed, dir) => {
    let files: string[] = [];
    try {
      files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    } catch {
      return removed;
    }
    return (
      removed +
      files.reduce<number>((acc, file) => {
        const fp = path.join(dir, file);
        try {
          const stat = fs.statSync(fp);
          if (!stat.isFile() || now - stat.mtimeMs < MIN_AGE_MS) return acc;
          fs.unlinkSync(fp);
          return acc + 1;
        } catch {
          /* file vanished between readdir and unlink — fine */
          return acc;
        }
      }, 0)
    );
  }, 0);
}

export function startAudioCacheSweeper(): void {
  const sweep = () => {
    try {
      const removed = sweepStaleAudio();
      if (removed > 0) console.log(colors.blue(`[tts] swept ${removed} stale audio file(s)`));
    } catch (error) {
      console.log(colors.yellow(`[tts] audio sweep failed: ${(error as Error).message}`));
    }
  };
  sweep();
  setInterval(sweep, SWEEP_INTERVAL_MS);
}