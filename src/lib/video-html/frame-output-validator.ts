export function validateFrameHtmlReferences(input: {
  html: string;
  allowedLocalImagePaths: string[];
}): { ok: boolean; issues: string[] } {
  const issues: string[] = [];

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

  return { ok: issues.length === 0, issues };
}
