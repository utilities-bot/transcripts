// Downloading a transcript's pictures into the file.
//
// Discord's attachment links stop working about a day after they are issued,
// so a transcript that only links its pictures loses them. Here they are
// fetched once, at export time, and written into the data as `data:` URIs —
// after which the file needs nothing from anywhere.
//
// A file a bot can upload has a size limit, so there is a budget. Small things
// everybody sees go first (avatars, emoji), then pictures in the order they
// were posted. What does not fit is counted and left as a link.

import { isDiscordUrl } from "./urls.js";

/** Raster formats only. An SVG can carry script, and nothing here needs one. */
const EMBEDDABLE = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]);

/**
 * Sized for Discord's 10 MB upload limit: pictures are base64 inside gzip
 * inside base64, which comes out about 1.35× their size on disk.
 */
const DEFAULT_MAX_TOTAL_BYTES = 6_500_000;
const DEFAULT_MAX_SINGLE_BYTES = 4_000_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_CONCURRENCY = 6;

/**
 * @param {object} payload the collected transcript; its `assets` map is filled in
 * @param {readonly { url: string, from: string, tier: number }[]} wanted in download order
 * @param {{ fetch?: typeof fetch, maxTotalBytes?: number, maxSingleBytes?: number, timeoutMs?: number, concurrency?: number }} [options]
 * @returns {Promise<{ saved: number, skipped: number, bytes: number }>}
 */
export async function embedAssets(payload, wanted, options = {}) {
  const fetcher = options.fetch ?? globalThis.fetch;
  const maxTotal = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  const maxSingle = options.maxSingleBytes ?? DEFAULT_MAX_SINGLE_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const stats = { saved: 0, skipped: 0, bytes: 0 };

  /** One picture's bytes, or null. Never throws: a missing picture is not a failed transcript. */
  async function download(from) {
    if (!isDiscordUrl(from)) return null;

    try {
      const response = await fetcher(from, { signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) return null;
      // A redirect is followed, but only to somewhere that is still Discord's.
      if (typeof response.url === "string" && response.url !== "" && !isDiscordUrl(response.url)) {
        return null;
      }

      const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      if (!EMBEDDABLE.has(type)) return null;
      if (Number(response.headers.get("content-length") ?? 0) > maxSingle) return null;

      const bytes = Buffer.from(await response.arrayBuffer());

      return bytes.length === 0 || bytes.length > maxSingle ? null : { type, bytes };
    } catch {
      return null;
    }
  }

  // Downloaded a few at a time, but *admitted* strictly in order: which
  // pictures make it into a full transcript must not depend on which request
  // happened to finish first.
  const size = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
  for (let start = 0; start < wanted.length; start += size) {
    const batch = wanted.slice(start, start + size);
    const results = await Promise.all(
      batch.map(async (item) => {
        // The resized copy first; the original when Discord would not resize it.
        const sized = await download(item.from);

        return sized ?? (item.from === item.url ? null : download(item.url));
      }),
    );

    results.forEach((result, index) => {
      if (result === null || stats.bytes + result.bytes.length > maxTotal) {
        stats.skipped += 1;

        return;
      }

      payload.assets[batch[index].url] = `data:${result.type};base64,${result.bytes.toString("base64")}`;
      stats.saved += 1;
      stats.bytes += result.bytes.length;
    });
  }

  return stats;
}
