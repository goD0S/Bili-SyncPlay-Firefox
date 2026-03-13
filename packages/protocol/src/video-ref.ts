export interface BilibiliVideoRef {
  videoId: string;
  normalizedUrl: string;
}

export function parseBilibiliVideoRef(url: string | undefined | null): BilibiliVideoRef | null {
  if (!url) {
    return null;
  }

  try {
    const parsed = new URL(url);
    const bvid = parsed.searchParams.get("bvid");
    if (bvid) {
      const cid = parsed.searchParams.get("cid");
      const p = parsed.searchParams.get("p");
      return {
        videoId: cid ? `${bvid}:${cid}` : p ? `${bvid}:p${p}` : bvid,
        normalizedUrl: cid
          ? `https://www.bilibili.com/video/${bvid}?cid=${cid}`
          : p
            ? `https://www.bilibili.com/video/${bvid}?p=${p}`
            : `https://www.bilibili.com/video/${bvid}`
      };
    }

    const pathname = parsed.pathname.replace(/\/+$/, "");
    const match = pathname.match(/^\/(?:video|bangumi\/play)\/([^/?]+)$/);
    if (!match) {
      return null;
    }

    const p = parsed.searchParams.get("p");
    return {
      videoId: p ? `${match[1]}:p${p}` : match[1],
      normalizedUrl: p ? `${parsed.origin}${pathname}?p=${p}` : `${parsed.origin}${pathname}`
    };
  } catch {
    return null;
  }
}

export function normalizeBilibiliUrl(url: string | undefined | null): string | null {
  return parseBilibiliVideoRef(url)?.normalizedUrl ?? null;
}
