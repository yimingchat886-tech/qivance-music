export type VideoSize = {
  id: string;
  width: number;
  height: number;
  aspectRatio: string;
};

export const defaultMainComposition = "qivance-preview";

export const videoSizes = [
  { id: "1080x1920", width: 1080, height: 1920, aspectRatio: "9:16" },
  { id: "1920x1080", width: 1920, height: 1080, aspectRatio: "16:9" },
  { id: "1080x1080", width: 1080, height: 1080, aspectRatio: "1:1" },
] as const satisfies readonly VideoSize[];

export function resolveMainComposition(value?: string): string {
  const composition = (value ?? defaultMainComposition).trim() || defaultMainComposition;
  if (!/^[A-Za-z0-9_-]+$/.test(composition)) {
    throw new Error("Main composition may only contain letters, numbers, underscores, and hyphens.");
  }
  return composition;
}

export function resolveVideoSize(value?: string): VideoSize {
  const size = videoSizes.find((candidate) => candidate.id === (value ?? "1080x1920"));
  if (!size) {
    throw new Error(`Unsupported video size ${value}`);
  }
  return { ...size };
}
