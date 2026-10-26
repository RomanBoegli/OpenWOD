"""Renders spoken clips with Piper for scripts/generate-cues.ts. Reads one JSON spec and writes MP3s.

Spec: {"outDir": str, "voicesDir": str, "packs": [{"id": str, "voice": str}], "clips": {"<name>": "<text>"}, "names": {"<movement-id>": "<text>"}}
Each pack renders every clip into <outDir>/<pack>/<name>.mp3 and every movement name into <outDir>/<pack>/names/<id>.mp3.
Files that already exist are kept (an interrupted render resumes). Needs the piper-tts package and ffmpeg on PATH.
"""
import json
import os
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

from piper import PiperVoice

FFMPEG_FILTER = 'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse,loudnorm=I=-16:TP=-1.5'


def download(voice: str, voices_dir: Path) -> Path:
    model = voices_dir / f'{voice}.onnx'
    if not model.exists() or not model.with_suffix('.onnx.json').exists():
        subprocess.run([sys.executable, '-m', 'piper.download_voices', voice, '--download-dir', str(voices_dir)], check=True)
    return model


def render(voice: PiperVoice, text: str, target: Path, work: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    wav_path = work / 'clip.wav'
    with wave.open(str(wav_path), 'wb') as wav_file:
        voice.synthesize_wav(text, wav_file)
    # Trim silence, normalise loudness, encode mono MP3 (decodable by every supported browser).
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(wav_path), '-af', FFMPEG_FILTER, '-ac', '1', '-ar', '32000', '-b:a', '48k', str(target)], check=True)


def main() -> None:
    spec = json.loads(Path(sys.argv[1]).read_text())
    out_dir = Path(spec['outDir'])
    voices_dir = Path(spec['voicesDir'])
    voices_dir.mkdir(parents=True, exist_ok=True)
    rendered = 0
    with tempfile.TemporaryDirectory(prefix='openwod-cues-') as work_name:
        work = Path(work_name)
        for pack in spec['packs']:
            model = download(pack['voice'], voices_dir)
            voice = PiperVoice.load(str(model))
            jobs = [(out_dir / pack['id'] / f'{name}.mp3', text) for name, text in spec['clips'].items()]
            jobs += [(out_dir / pack['id'] / 'names' / f'{movement}.mp3', text) for movement, text in spec['names'].items()]
            todo = [(target, text) for target, text in jobs if not target.exists()]
            for target, text in todo:
                render(voice, text, target, work)
            rendered += len(todo)
            print(f"{pack['id']}: {len(todo)} rendered, {len(jobs) - len(todo)} kept", flush=True)
    print(f'rendered {rendered} clip(s) into {out_dir}')


if __name__ == '__main__':
    os.environ.setdefault('PYTHONUNBUFFERED', '1')
    main()
