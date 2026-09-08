---
name: custom-voice-from-sample
description: "Create a reusable custom TTS voice from a single audio sample file by cloning the speaker with Coqui XTTS-v2. The resulting voice shows up in the Hermes Client per-agent voice dropdown."
category: productivity
---

# Custom Voice From Sample

## When to use
When the user asks you to make a custom TTS voice from an audio sample — "make a voice from this clip", "clone this character's voice", "turn `cartoon - Raven - Teen Titan.wav` into a voice", "add a custom voice", or similar. Turns one reference audio file into a speaking voice usable by any agent in the Hermes Client web UI.

## How it works
- The reference wav is stored at `~/.hermes/client_voices/<name>/ref.wav` (plus optional `ref.txt` transcript).
- The Hermes Client `/api/message/speak` endpoint detects the agent's configured voice is a custom one and synthesizes it with **Coqui XTTS-v2** (single-sample voice cloning on GPU) instead of edge-tts.
- The voice automatically appears in the per-agent voice dropdown (grouped under "Custom") via `GET /api/voices`.

### Daemon lifecycle (no manual management needed)
- A warm XTTS daemon is spawned **lazily on first custom-voice speak** (first call pays a ~35–50s model load; it auto-loads and stays resident).
- Warm calls are ~1.5–2s.
- After **30 minutes with no requests** the daemon **auto-exits and frees ~2.5GB VRAM** (configurable via `HERMES_XTTS_IDLE_TIMEOUT_MS` env in the `hermes_client` systemd unit).
- It **auto-restarts on the next speak request** — no user action ever required.

## The one-step helper
`register_voice.py` in this skill dir does everything:

```bash
# From an audio sample, derive a name and register the voice:
~/.hermes/profiles/aria/skills/custom-voice-from-sample/register_voice.py \
  /path/to/<sample>.wav --set-agent

# Explicit name:
.../register_voice.py /path/to/sample.wav --name "My Voice" --set-agent

# List registered custom voices:
.../register_voice.py --list
```

Naming default mimics the user's convention: `cartoon - Raven - Teen Titan.wav` → voice name **`cartoon - Teen Titan`** (drops the last ` - <segment>` which is usually the episode/version). Pass `--name` to override.

`--set-agent` also switches the current profile's TTS voice to the new custom voice so it's immediately active.

## Best practices
- **Choose a clean reference clip.** ~5–15 seconds of a single speaker, clear audio, no music/effects in the background. The cleaner the sample, the better the clone.
- **One-time GPU model load.** XTTS-v2 loads the model on first use (~10–30s, model cached in `~/.cache/coqui`). Subsequent synthesis is fast. Keep that in mind if the first speak is slow.
- **Verify it works.** After registering, ask the user to trigger a spoken reply (or curl `/api/message/speak`) for an agent using that voice, and confirm the output audio clearly matches the reference speaker.
- **Transcription is best-effort** (faster-whisper) and stored as `ref.txt` — it is informational, not required for cloning.

## What NOT to do
- Do NOT edit the Hermes Client source just to add a voice — the client already lists custom voices and routes custom-voice synthesis automatically.
- Do NOT register a voice from copyrighted or multi-speaker audio.
- Do NOT overwrite an existing voice the user didn't ask to replace; list first if unsure.
