/* eslint-disable no-console */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { HERMES_HOME } from './paths';

/**
 * Synthesize speech for a profile using Hermes' own TTS tooling
 * (`tools/tts_tool.text_to_speech_tool`). Returns a base64 data URL so
 * the browser can play the reply in the web UI without a round trip
 * through an audio file endpoint.
 *
 * The function is invoked through the Hermes agent venv python — the same
 * interpreter the `hermes` launcher uses — with HERMES_HOME pinned to the
 * profile's home directory so the profile's `config.yaml` (TTS provider,
 * voice, …) is honoured.
 */
export default async function synthesizeSpeechToDataUrl(
  text: string,
  profile: string | null | undefined
): Promise<{ ok: true; dataUrl: string; mimeType: string } | { ok: false; error: string }> {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: 'Text is required' };

  const profileName = !profile || profile === 'default' ? 'default' : profile;
  const profileHome = path.join(HERMES_HOME, 'profiles', profileName);
  const agentRoot = path.join(HERMES_HOME, 'hermes-agent');
  const venvPython = path.join(agentRoot, 'venv', 'bin', 'python');

  const script = `
import json
import sys
from tools.tts_tool import text_to_speech_tool

text = sys.stdin.read()
raw = text_to_speech_tool(text)
try:
    result = json.loads(raw)
except Exception:
    result = {"success": False, "error": raw}
print(json.dumps(result))
`;

  return new Promise((resolve) => {
    const child = spawn(venvPython, ['-c', script], {
      cwd: agentRoot,
      env: {
        ...process.env,
        HERMES_HOME: profileHome,
        NO_COLOR: '1',
        TERM: 'dumb',
      },
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ ok: false, error: 'TTS synthesis timed out after 120s' });
    }, 120_000);

    child.stdout.setEncoding('utf-8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf-8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: (err as Error).message });
    });

    child.on('close', () => {
      clearTimeout(timer);
      try {
        const result = JSON.parse(stdout.trim());
        if (!result.success) {
          return resolve({ ok: false, error: result.error || 'TTS synthesis failed' });
        }
        const filePath = result.file_path;
        if (!filePath || !fs.existsSync(filePath)) {
          return resolve({ ok: false, error: 'TTS produced no audio file' });
        }
        const mimeType = (() => {
          if (filePath.endsWith('.ogg')) return 'audio/ogg';
          if (filePath.endsWith('.wav')) return 'audio/wav';
          return 'audio/mpeg';
        })();
        const dataUrl = `data:${mimeType};base64,${fs.readFileSync(filePath).toString('base64')}`;
        fs.unlink(filePath, () => {
          /* best-effort: don't leave synthesized audio on disk */
        });
        return resolve({ ok: true, dataUrl, mimeType });
      } catch (e) {
        const detail = (stderr || '').trim() || (e as Error).message;
        console.error('[tts] synthesis failed:', detail);
        return resolve({ ok: false, error: detail || 'TTS returned an unparseable response' });
      }
    });

    child.stdin.on('error', () => {
      /* the child closed stdin first — nothing to do */
    });
    child.stdin.end(trimmed);
  });
}