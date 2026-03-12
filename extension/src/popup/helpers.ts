export function escapeHtml(value: unknown): string {
  const normalized = typeof value === "string" ? value : value == null ? "" : String(value);
  return normalized
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

export function parseInviteValue(value: string): { roomCode: string; joinToken: string } | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.replace(/\s+/g, "");
  const separators = [":", "|", ","];
  for (const separator of separators) {
    const [roomCode, joinToken, ...rest] = normalized.split(separator);
    if (!roomCode || !joinToken || rest.length > 0) {
      continue;
    }
    return {
      roomCode: roomCode.toUpperCase(),
      joinToken
    };
  }

  return null;
}
