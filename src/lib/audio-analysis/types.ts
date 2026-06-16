export type BeatGrid = {
  schema_version: 1;
  duration_sec: number;
  tempo_bpm: number;
  tempo_candidates: number[];
  beats: Array<{ index: number; time_sec: number; confidence: number }>;
};

export type OnsetEvents = {
  schema_version: 1;
  duration_sec: number;
  events: Array<{ time_sec: number; strength: number }>;
};

export type EnergyCurve = {
  schema_version: 1;
  duration_sec: number;
  frame_hop_sec: number;
  points: Array<{ time_sec: number; rms: number; normalized_energy: number }>;
  low_energy_ranges: Array<{ start_sec: number; end_sec: number }>;
};
