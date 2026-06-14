export function validateFrameHtmlReferences(input: {
  html: string;
  allowedLocalImagePaths: string[];
  allowedLocalVideoPaths?: string[];
}): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  const allowedLocalVideoPaths = input.allowedLocalVideoPaths ?? [];

  for (const match of input.html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) {
    const src = match[1] ?? "";
    if (/^https?:\/\//i.test(src)) {
      issues.push(`external image reference is forbidden: ${src}`);
      continue;
    }
    if (!input.allowedLocalImagePaths.includes(src)) {
      issues.push(`unlocked local image reference is forbidden: ${src}`);
    }
  }

  for (const src of videoSources(input.html)) {
    if (/^https?:\/\//i.test(src)) {
      issues.push(`external video reference is forbidden: ${src}`);
      continue;
    }
    if (!allowedLocalVideoPaths.includes(src)) {
      issues.push(`unregistered local video reference is forbidden: ${src}`);
    }
  }

  return { ok: issues.length === 0, issues };
}

function videoSources(html: string): string[] {
  return [
    ...Array.from(html.matchAll(/<video[^>]+src=["']([^"']+)["']/gi), (match) => match[1] ?? ""),
    ...Array.from(html.matchAll(/<source[^>]+src=["']([^"']+)["']/gi), (match) => match[1] ?? ""),
  ].filter(Boolean);
}
