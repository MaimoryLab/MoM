// Turn raw provider endpoints (e.g. "zai-org/glm-5.2",
// "xiaomimimo/mimo-v2.5-pro", "moonshotai/kimi-k2.6") into
// display names that keep the version but drop the vendor slug,
// so the demo audience doesn't see internal routing details.
// Result uses a space between family and version: "GLM 5.2",
// "MIMO v2.5-pro", "KIMI k2.6".

export function humanizeModelName(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '') return trimmed;
  const tail = trimmed.includes('/') ? trimmed.slice(trimmed.lastIndexOf('/') + 1) : trimmed;
  const dashIdx = tail.indexOf('-');
  if (dashIdx <= 0) return tail.toUpperCase();
  return tail.slice(0, dashIdx).toUpperCase() + ' ' + tail.slice(dashIdx + 1);
}
