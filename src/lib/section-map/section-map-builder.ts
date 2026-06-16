type SceneInput = {
  scene_id: string;
  section_ids: string[];
  start_sec: number;
  end_sec: number;
};

type WordInput = {
  word_id: string;
  paragraph_id: string;
  start_sec: number;
  end_sec: number;
};

type BeatInput = {
  index: number;
  time_sec: number;
};

export function buildSectionMapFromEvidence(input: {
  durationSec: number;
  scenes: SceneInput[];
  words: WordInput[];
  beats: BeatInput[];
}) {
  return {
    schema_version: 1,
    duration_sec: input.durationSec,
    sections: input.scenes.map((scene) => {
      const sectionWords = input.words.filter((word) => word.start_sec >= scene.start_sec && word.end_sec <= scene.end_sec);
      const sectionBeats = input.beats.filter((beat) => beat.time_sec >= scene.start_sec && beat.time_sec <= scene.end_sec);

      return {
        section_id: scene.section_ids[0] ?? scene.scene_id,
        start_sec: scene.start_sec,
        end_sec: scene.end_sec,
        duration_sec: round(scene.end_sec - scene.start_sec),
        lyric_paragraph_ids: [...new Set(sectionWords.map((word) => word.paragraph_id))],
        word_range: {
          start_word_id: sectionWords[0]?.word_id ?? null,
          end_word_id: sectionWords.at(-1)?.word_id ?? null,
        },
        beat_range: {
          start_index: sectionBeats[0]?.index ?? null,
          end_index: sectionBeats.at(-1)?.index ?? null,
        },
        energy_summary: { mean: null, peak: null },
        alignment_confidence: 1,
        evidence: {
          nearest_beat_boundary_drift_sec: 0,
          nearest_onset_boundary_drift_sec: null,
          energy_boundary_hint: false,
        },
      };
    }),
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
