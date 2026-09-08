#!/usr/bin/env python3
"""Register an audio sample as a reusable custom TTS voice for Hermes Client.

Usage:
  register_voice.py <sample.wav> [--name "Voice Name"] [--set-agent]
  register_voice.py --list

A custom voice is just an audio reference stored at
  ~/.hermes/client_voices/<name>/ref.wav   (the cloning reference)
  ~/.hermes/client_voices/<name>/ref.txt   (optional transcript)

The Hermes Client speak endpoint detects the configured voice is custom and
synthesizes it through Coqui XTTS-v2 (single-sample cloning) instead of edge-tts.
"""
import argparse
import json
import os
import re
import shutil
import sys
import hashlib

HERMES_HOME = os.environ.get("HERMES_HOME", os.path.expanduser("~/.hermes"))
VOICES_DIR = os.path.join(HERMES_HOME, "client_voices")


def strip_version(name: str) -> str:
    """Turn 'cartoon - Raven - Teen Titan' -> 'cartoon - Teen Titan'.

    Character samples like '<show> - <character> - <other>' drop the middle
    (character) segment, keeping '<show> - <other>'.
    """
    parts = [p.strip() for p in name.split("-") if p.strip()]
    if len(parts) > 2:
        parts = parts[:1] + parts[2:]
    return " - ".join(parts)


def safe_name(name: str) -> str:
    name = re.sub(r"\s+", " ", name).strip()
    name = re.sub(r"[^A-Za-z0-9 _.-]", "", name)
    if not name:
        name = "custom-voice"
    return name[:60]


def default_name_from(sample: str) -> str:
    base = os.path.splitext(os.path.basename(sample))[0]
    base = re.sub(r"[\s_]+", " ", base).strip()
    return safe_name(strip_version(base))


def transcribe(sample: str) -> str:
    """Best-effort transcript via faster-whisper; returns '' if unavailable."""
    try:
        from faster_whisper import WhisperModel

        for device, ct in (("cuda", "float16"), ("cpu", "int8")):
            try:
                model = WhisperModel("small", device=device, compute_type=ct)
                segments, _ = model.transcribe(sample, language="en")
                return " ".join(s.text.strip() for s in segments).strip()
            except Exception:  # noqa: BLE001
                continue
        return ""
    except Exception as exc:  # noqa: BLE001
        print(f"[register_voice] transcription skipped: {exc}", file=sys.stderr)
        return ""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sample", nargs="?", help="path to the reference audio sample (.wav/.mp3)")
    parser.add_argument("--name", help="voice name (defaults to the file name, version-stripped)")
    parser.add_argument("--set-agent", action="store_true", help="set this as the profile's TTS voice")
    parser.add_argument("--list", action="store_true", help="list registered custom voices")
    args = parser.parse_args()

    if args.list:
        if not os.path.isdir(VOICES_DIR):
            print("[]")
            return 0
        out = []
        for name in sorted(os.listdir(VOICES_DIR)):
            ref = os.path.join(VOICES_DIR, name, "ref.wav")
            if os.path.exists(ref):
                out.append({"name": name, "ref": ref})
        print(json.dumps(out, indent=2))
        return 0

    if not args.sample or not os.path.exists(args.sample):
        print(f"error: sample not found: {args.sample}", file=sys.stderr)
        return 2

    name = safe_name(args.name) if args.name else default_name_from(args.sample)
    if name.lower() == "custom-voice":
        print("error: could not derive a voice name; pass --name", file=sys.stderr)
        return 2

    dest = os.path.join(VOICES_DIR, name)
    os.makedirs(dest, exist_ok=True)
    ref_wav = os.path.join(dest, "ref.wav")

    if not ref_wav.lower().endswith(".wav"):
        shutil.copyfile(args.sample, ref_wav)
    else:
        shutil.copyfile(args.sample, ref_wav)

    txt = transcribe(args.sample)
    if txt:
        with open(os.path.join(dest, "ref.txt"), "w", encoding="utf-8") as fh:
            fh.write(txt)

    print(json.dumps({"name": name, "ref": ref_wav, "transcript": txt}, indent=2))

    if args.set_agent:
        hermes_bin = shutil.which("hermes") or os.path.join(HERMES_HOME, "bin", "hermes")
        profile = os.environ.get("HERMES_PROFILE", "")
        argv = [hermes_bin]
        if profile:
            argv += ["-p", profile]
        argv += ["config", "set", "tts.edge.voice", name]
        try:
            subprocess.run(argv, check=False)
        except Exception as exc:  # noqa: BLE001
            print(f"[register_voice] could not set agent voice: {exc}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    import subprocess

    sys.exit(main())
