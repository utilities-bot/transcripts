// Downloading a transcript's pictures into the file.
//
// Discord's attachment links stop working about a day after they are issued,
// so a transcript that only links its pictures loses them. Here they are
// fetched once, at export time, and written into the data as `data:` URIs —
// after which the file needs nothing from anywhere.
//
// There is a budget, because a file has a size limit. Small things everybody
// sees go first (avatars, emoji), then pictures in the order they were posted.
// No single picture may take most of the budget: one that is too heavy is
// asked for again at half the width, and half again, before it is given up on.
// What does not fit is counted and left as a link.

import { isDiscordUrl, sizedUrl } from "./urls.js";

/** Raster formats only. An SVG can carry script, and nothing here needs one. */
const EMBEDDABLE = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]);

/**
 * Sized for Discord's 10 MB upload limit: pictures are base64 inside gzip
 * inside base64, which comes out about 1.37× their size on disk.
 */
const DEFAULT_MAX_TOTAL_BYTES = 6_500_000;
const DEFAULT_MAX_SINGLE_BYTES = 4_000_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_CONCURRENCY = 8;

/** How wide a posted picture is saved at most. Wider ones are scaled down by Discord. */
const DEFAULT_MAX_IMAGE_WIDTH = 1100;

/** The narrowest a too-heavy picture is retried at before it is given up on. */
const MIN_IMAGE_WIDTH = 240;

/** The most of the whole budget one picture may take. */
const SINGLE_SHARE = 0.3;

/** However small the budget, a picture this light is never refused for its size alone. */
const SINGLE_FLOOR = 24_000;

/** With less room than this left, nothing more is worth asking for. */
const FULL_BELOW = 1_500;

/** The collector's tiers from here up are pictures somebody posted; below are faces and icons. */
const PICTURE_TIER = 4;

function picturesBefore(batch, index) {
  return batch.slice(0, index).filter((item) => item.tier >= PICTURE_TIER).length;
}

/**
 * @param {object} payload the collected transcript; its `assets` map is filled in
 * @param {readonly { url: string, from: string, tier: number, w?: number, h?: number, type?: string, draw?: number }[]} wanted in download order
 * @param {{ fetch?: typeof fetch, maxTotalBytes?: number, maxSingleBytes?: number, maxPictures?: number, maxImageWidth?: number, timeoutMs?: number, concurrency?: number }} [options]
 * @returns {Promise<{ saved: number, skipped: number, bytes: number }>}
 */
export async function embedAssets(payload, wanted, options = {}) {
  const fetcher = options.fetch ?? globalThis.fetch;
  const maxTotal = Math.max(0, options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES);
  const maxSingle = Math.min(
    options.maxSingleBytes ?? DEFAULT_MAX_SINGLE_BYTES,
    Math.max(SINGLE_FLOOR, Math.floor(maxTotal * SINGLE_SHARE)),
  );
  const maxWidth = options.maxImageWidth ?? DEFAULT_MAX_IMAGE_WIDTH;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // How many *pictures* may be saved: attachments and the images inside embeds and containers.
  // Avatars, emoji, stickers and small icons are not counted — a transcript with faces missing
  // reads as broken, and together they weigh less than one screenshot.
  const maxPictures = options.maxPictures ?? Number.POSITIVE_INFINITY;
  const stats = { saved: 0, skipped: 0, bytes: 0 };
  let pictures = 0;

  /**
   * One address's bytes. `null` when it cannot be had, `"heavy"` when it is a
   * picture but over `limit` — which is worth knowing apart, because a heavy
   * picture may fit at a smaller size and a missing one will not.
   * Never throws: a missing picture is not a failed transcript.
   */
  async function download(from, limit) {
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
      if (Number(response.headers.get("content-length") ?? 0) > limit) return "heavy";

      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length === 0) return null;

      return bytes.length > limit ? "heavy" : { type, bytes };
    } catch {
      return null;
    }
  }

  /** A picture at the largest size that fits `limit`, trying narrower copies of a heavy one. */
  async function fetchOne(item, limit) {
    const resizable = Number(item.w) > 0 && Number(item.h) > 0;
    const widest = Math.min(maxWidth, item.draw ?? Number.POSITIVE_INFINITY);
    let asked = null;

    for (let width = widest; width >= MIN_IMAGE_WIDTH || asked === null; width = Math.floor(width / 2)) {
      const from = resizable
        ? sizedUrl(item.from, { width: item.w, height: item.h, maxWidth: width, type: item.type })
        : item.from;
      // The same address twice means Discord has nothing smaller to offer.
      if (from === asked) break;
      asked = from;

      const got = await download(from, limit);
      if (got !== "heavy") {
        // The resized copy failed outright: the original, when it is a different address.
        if (got === null && from !== item.url && item.url !== item.from) {
          const original = await download(item.url, limit);

          return original === "heavy" ? null : original;
        }

        return got;
      }
      if (!resizable) break;
    }

    return null;
  }

  // Downloaded a few at a time, but *admitted* strictly in order: which
  // pictures make it into a full transcript must not depend on which request
  // happened to finish first.
  const size = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
  for (let start = 0; start < wanted.length; start += size) {
    const room = maxTotal - stats.bytes;
    // Full: everything still waiting is left out without being asked for.
    if (room < FULL_BELOW) {
      stats.skipped += wanted.length - start;
      break;
    }

    const batch = wanted.slice(start, start + size);
    const limit = Math.min(maxSingle, room);
    const results = await Promise.all(
      batch.map((item, index) => {
        // Past the cap nothing is even downloaded. Counted by position, so it is the earliest
        // pictures that are kept whatever order the downloads finish in.
        if (item.tier >= PICTURE_TIER && pictures + picturesBefore(batch, index) >= maxPictures) return null;

        return fetchOne(item, limit);
      }),
    );

    results.forEach((result, index) => {
      if (result === null || stats.bytes + result.bytes.length > maxTotal) {
        stats.skipped += 1;

        return;
      }

      payload.assets[batch[index].url] = `data:${result.type};base64,${result.bytes.toString("base64")}`;
      if (batch[index].tier >= PICTURE_TIER) pictures += 1;
      stats.saved += 1;
      stats.bytes += result.bytes.length;
    });
  }

  return stats;
}
