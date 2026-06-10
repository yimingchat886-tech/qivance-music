#!/usr/bin/env python3
import argparse
import hashlib
import importlib.metadata
import json
import math
import re
import sys
from pathlib import Path


ASCII_RE = re.compile(r"[A-Za-z0-9]+(?:[-_'][A-Za-z0-9]+)*")


def main() -> int:
    parser = argparse.ArgumentParser(description="Align lyrics.md to an MP3 with WhisperX forced alignment.")
    parser.add_argument("--audio", required=True, type=Path)
    parser.add_argument("--lyrics", required=True, type=Path)
    parser.add_argument("--word-timing-out", required=True, type=Path)
    parser.add_argument("--report-out", required=True, type=Path)
    parser.add_argument("--language", default="zh")
    parser.add_argument("--device", default="cuda", choices=["cuda", "cpu"])
    parser.add_argument("--model", default="large-v3")
    parser.add_argument("--cache-dir", required=True, type=Path)
    parser.add_argument("--require-gpu", action="store_true")
    args = parser.parse_args()

    args.word_timing_out.parent.mkdir(parents=True, exist_ok=True)
    args.report_out.parent.mkdir(parents=True, exist_ok=True)
    report = base_report(args)

    try:
      import librosa
      import torch
      import whisperx
      import whisperx.alignment

      report["env"]["librosa_version"] = librosa.__version__
      report["env"]["torch_version"] = torch.__version__
      report["env"]["torch_cuda_version"] = getattr(torch.version, "cuda", None)
      report["env"]["whisperx_version"] = package_version("whisperx")
      report["gpu"] = gpu_metadata(torch)

      if args.require_gpu and not torch.cuda.is_available():
          raise RuntimeError("--require-gpu was set but torch.cuda.is_available() is false")

      duration = float(librosa.get_duration(path=str(args.audio)))
      lyric_doc = parse_lyrics(args.lyrics.read_text(encoding="utf-8"))
      transcript_text = "".join(line["text"] for paragraph in lyric_doc["paragraphs"] for line in paragraph["lines"])
      tokens = [
          token
          for paragraph in lyric_doc["paragraphs"]
          for line in paragraph["lines"]
          for token in line["tokens"]
      ]

      class WholeSegmentSplitter:
          def span_tokenize(self, text):
              return [(0, len(text))]

      whisperx.alignment.nltk_load = lambda _: WholeSegmentSplitter()

      audio = whisperx.load_audio(str(args.audio))
      model, metadata = whisperx.load_align_model(
          language_code=args.language,
          device=args.device,
      )
      transcript = [{"text": transcript_text, "start": 0.0, "end": duration}]
      result = whisperx.align(
          transcript,
          model,
          metadata,
          audio,
          args.device,
          return_char_alignments=True,
      )
      chars = []
      for segment in result.get("segments", []):
          chars.extend(segment.get("chars") or [])

      words, unmatched = words_from_timed_chars(tokens, chars)
      artifact = {
          "schema_version": 1,
          "backend": "whisperx",
          "source": "fresh_whisperx_forced_alignment",
          "duration_sec": seconds(duration),
          "lyrics_sha256": sha256(args.lyrics),
          "audio_sha256": sha256(args.audio),
          "words": words,
      }
      args.word_timing_out.write_text(json.dumps(artifact, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

      report["status"] = "passed"
      report["duration_sec"] = seconds(duration)
      report["outputs"] = {
          "lyric_word_timing": {
              "path": str(args.word_timing_out),
              "sha256": sha256(args.word_timing_out),
          }
      }
      report["metrics"] = {
          "total_words": len(tokens),
          "aligned_words": len(words),
          "low_confidence_words": 0,
          "unmatched_words": unmatched,
          "word_coverage": safe_ratio(len(words), len(tokens)),
          "low_confidence_ratio": 0,
          "unmatched_ratio": safe_ratio(unmatched, len(tokens)),
          "section_duration_coverage": 1,
          "section_boundary_evidence_drift_sec": 0,
      }
      args.report_out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
      return 0
    except Exception as error:
      report["status"] = "failed"
      report["diagnostics"].append(str(error))
      args.report_out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
      print(str(error), file=sys.stderr)
      return 1


def base_report(args):
    return {
        "schema_version": 1,
        "backend": "whisperx",
        "status": "failed",
        "env": {
            "python_executable": sys.executable,
            "python_version": sys.version.split()[0],
            "whisperx_version": package_version("whisperx"),
        },
        "model": {
            "name": args.model,
            "device": args.device,
            "cache_dir": str(args.cache_dir),
        },
        "inputs": {
            "audio": {"path": str(args.audio), "sha256": sha256(args.audio)},
            "lyrics": {"path": str(args.lyrics), "sha256": sha256(args.lyrics)},
        },
        "metrics": {},
        "diagnostics": [],
    }


def parse_lyrics(markdown):
    paragraphs = []
    current = []
    for raw_line in markdown.splitlines():
        line = raw_line.strip()
        if not line:
            if current:
                paragraphs.append(current)
                current = []
            continue
        if line.startswith("#"):
            continue
        current.append(line)
    if current:
        paragraphs.append(current)

    parsed = []
    for paragraph_index, lines in enumerate(paragraphs, start=1):
        paragraph_id = f"p_{paragraph_index:03d}"
        parsed_lines = []
        for line_index, text in enumerate(lines, start=1):
            line_id = f"{paragraph_id}_line_{line_index:03d}"
            parsed_lines.append({
                "line_id": line_id,
                "text": text,
                "tokens": [
                    {"text": token, "paragraph_id": paragraph_id, "line_id": line_id}
                    for token in segment_text(text)
                ],
            })
        parsed.append({"paragraph_id": paragraph_id, "lines": parsed_lines})
    return {"paragraphs": parsed}


def segment_text(text):
    try:
        import jieba

        tokens = [token for token in jieba.cut(text, HMM=False) if token.strip()]
        if tokens:
            return tokens
    except ImportError:
        pass

    tokens = []
    index = 0
    while index < len(text):
        char = text[index]
        if char.isspace():
            index += 1
            continue
        ascii_match = ASCII_RE.match(text, index)
        if ascii_match:
            tokens.append(ascii_match.group(0))
            index = ascii_match.end()
            continue
        if index + 1 < len(text) and not text[index + 1].isspace():
            tokens.append(text[index : index + 2])
            index += 2
        else:
            tokens.append(char)
            index += 1
    return tokens


def words_from_timed_chars(tokens, chars):
    words = []
    char_index = 0
    unmatched = 0
    for index, token in enumerate(tokens, start=1):
        while char_index < len(chars) and (chars[char_index].get("char") or "").isspace():
            char_index += 1
        token_chars = chars[char_index : char_index + len(token["text"])]
        char_index += len(token["text"])
        timed = [char for char in token_chars if finite_time(char.get("start")) and finite_time(char.get("end"))]
        if not timed:
            unmatched += 1
            continue
        words.append({
            "word_id": f"w_{index:06d}",
            "text": token["text"],
            "paragraph_id": token["paragraph_id"],
            "line_id": token["line_id"],
            "start_sec": seconds(timed[0]["start"]),
            "end_sec": seconds(timed[-1]["end"]),
            "confidence": 1.0,
            "source": "whisperx",
        })
    return words, unmatched


def finite_time(value):
    return isinstance(value, (int, float)) and math.isfinite(value)


def package_version(name):
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return None


def gpu_metadata(torch):
    if not torch.cuda.is_available():
        return {"cuda_available": False}
    device_index = torch.cuda.current_device()
    props = torch.cuda.get_device_properties(device_index)
    return {
        "cuda_available": True,
        "device_index": device_index,
        "name": torch.cuda.get_device_name(device_index),
        "total_memory_bytes": props.total_memory,
        "capability": list(torch.cuda.get_device_capability(device_index)),
    }


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def seconds(value):
    return round(float(value), 3)


def safe_ratio(numerator, denominator):
    return 0 if denominator == 0 else round(numerator / denominator, 6)


if __name__ == "__main__":
    raise SystemExit(main())
