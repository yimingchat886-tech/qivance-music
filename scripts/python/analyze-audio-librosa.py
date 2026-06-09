#!/usr/bin/env python3
import json
import sys
from pathlib import Path

import librosa


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: analyze-audio-librosa.py <input.mp3> <output-dir>", file=sys.stderr)
        return 2

    audio_path = Path(sys.argv[1])
    output_dir = Path(sys.argv[2])
    output_dir.mkdir(parents=True, exist_ok=True)

    y, sr = librosa.load(audio_path, sr=None, mono=True)
    duration = float(librosa.get_duration(y=y, sr=sr))
    hop_length = max(1, round(sr * 0.1))

    tempo, beats = librosa.beat.beat_track(y=y, sr=sr, hop_length=hop_length)
    beat_times = librosa.frames_to_time(beats, sr=sr, hop_length=hop_length)

    onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop_length)
    onset_frames = librosa.onset.onset_detect(onset_envelope=onset_env, sr=sr, hop_length=hop_length)
    onset_times = librosa.frames_to_time(onset_frames, sr=sr, hop_length=hop_length)

    rms = librosa.feature.rms(y=y, hop_length=hop_length)[0]
    rms_times = librosa.frames_to_time(range(len(rms)), sr=sr, hop_length=hop_length)
    peak = max((float(value) for value in rms), default=1.0)
    if peak <= 0:
        peak = 1.0

    tempo_bpm = scalar_float(tempo)
    write_json(output_dir / "beat_grid.json", {
        "schema_version": 1,
        "duration_sec": round(duration, 3),
        "tempo_bpm": round(tempo_bpm, 3),
        "tempo_candidates": [round(tempo_bpm, 3)],
        "beats": [
            {"index": index, "time_sec": round(float(time_sec), 3), "confidence": 1.0}
            for index, time_sec in enumerate(beat_times)
        ],
    })
    write_json(output_dir / "onset_events.json", {
        "schema_version": 1,
        "duration_sec": round(duration, 3),
        "events": [
            {"time_sec": round(float(time_sec), 3), "strength": 1.0}
            for time_sec in onset_times
        ],
    })
    write_json(output_dir / "energy_curve.json", {
        "schema_version": 1,
        "duration_sec": round(duration, 3),
        "frame_hop_sec": round(hop_length / sr, 3),
        "points": [
            {
                "time_sec": round(float(time_sec), 3),
                "rms": round(float(value), 6),
                "normalized_energy": round(float(value) / peak, 6),
            }
            for time_sec, value in zip(rms_times, rms)
        ],
        "low_energy_ranges": [],
    })
    return 0


def write_json(path: Path, data: object) -> None:
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def scalar_float(value: object) -> float:
    try:
        return float(value)
    except TypeError:
        try:
            return float(next(iter(value)))  # type: ignore[arg-type]
        except StopIteration:
            return 0.0


if __name__ == "__main__":
    raise SystemExit(main())
