import { embedAssets } from "./assets.js";
import { collectTranscript } from "./collect.js";
import { buildHtml, readTranscript } from "./html.js";
import { verify } from "./pack.js";

export { embedAssets } from "./assets.js";
export { collectTranscript } from "./collect.js";
export { buildHtml, readTranscript } from "./html.js";
export { FORMAT_VERSION, generateKeys, pack, unpack, verify } from "./pack.js";

/** Discord hands history back a hundred messages at a time. */
const PAGE = 100;

/**
 * What a saved picture costs in the finished file, per byte on disk: it is
 * base64 inside gzip inside base64. Measured at about 1.35; a little is added
 * so the first build usually lands under the limit rather than just over it.
 */
const PICTURE_COST = 1.37;

/** Left spare when sizing the picture budget, for the same reason. */
const HEADROOM_BYTES = 2_048;

/** How much of a too-long conversation is dropped at a time, oldest first, until the text fits. */
const TRIM_STEP = 0.15;

/**
 * How wide pictures are saved, by how big the file may be. A small file is
 * better spent on several readable pictures than on one sharp one.
 */
function widthFor(maxFileBytes) {
  if (maxFileBytes <= 400_000) return 640;
  if (maxFileBytes <= 3_000_000) return 960;

  return 1280;
}

const sizeOf = (html) => Buffer.byteLength(html, "utf8");

/**
 * A channel's history, oldest first.
 *
 * @param {object} channel a discord.js text channel or thread
 * @param {number | null} limit how many of the newest messages to keep; null for all
 */
async function history(channel, limit) {
  const collected = [];
  let before;

  while (limit === null || collected.length < limit) {
    const size = limit === null ? PAGE : Math.min(PAGE, limit - collected.length);
    const page = [...(await channel.messages.fetch({ limit: size, before })).values()];
    if (page.length === 0) break;

    collected.push(...page);
    before = page[page.length - 1].id;
    if (page.length < size) break;
  }

  return collected.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

/**
 * Exports a channel as one self-contained HTML file.
 *
 * @param {object} channel a discord.js text channel or thread
 * @param {object} [options]
 * @param {number | null} [options.limit] newest messages to include; default 1000, null for all
 * @param {readonly object[]} [options.messages] messages already in hand, oldest first; skips fetching
 * @param {string} [options.signingKey] Ed25519 private key (base64 PKCS#8 or PEM); unsigned without one
 * @param {number} [options.maxFileBytes] the largest the whole file may be; pictures, then the oldest messages, give way to fit
 * @param {boolean} [options.images] download pictures and files into the file; default true
 * @param {typeof fetch} [options.fetch] how pictures are downloaded; default the global fetch
 * @param {number} [options.maxTotalBytes] budget for all pictures together
 * @param {number} [options.maxSingleBytes] the largest single picture
 * @param {number} [options.maxPictures] how many posted pictures to save; avatars and emoji are not counted
 * @param {number} [options.maxImageWidth] wider pictures are scaled down to this by Discord
 * @param {{ name: string, url?: string }} [options.brand] credited in the footer
 */
export async function createTranscript(channel, options = {}) {
  const all = options.messages ?? (await history(channel, options.limit === undefined ? 1000 : options.limit));
  const maxFile = options.maxFileBytes;
  const none = () => ({ saved: 0, skipped: 0, bytes: 0, files: { saved: 0, skipped: 0, bytes: 0 } });
  /** What the summary at the top of the file and the page's own summary both say. */
  const record = (payload, got) => {
    payload.stats = {
      images: { saved: got.saved, skipped: got.skipped },
      files: { saved: got.files.saved, skipped: got.files.skipped },
    };
  };
  const collect = (messages, truncated) => {
    const made = collectTranscript(messages, { channel, guild: channel?.guild, brand: options.brand });
    if (truncated > 0) made.payload.truncated = truncated;

    return made;
  };

  // The words come first. A conversation too long for the limit loses its
  // oldest messages, a slice at a time, until what is left fits with no
  // pictures at all — the recent end of a ticket is the part somebody needs.
  let dropped = 0;
  let made = collect(all, 0);
  record(made.payload, none());
  let bare = sizeOf(buildHtml(made.payload, { signingKey: options.signingKey }));
  while (maxFile !== undefined && bare > maxFile && all.length - dropped > 1) {
    dropped = Math.min(all.length - 1, dropped + Math.max(1, Math.ceil((all.length - dropped) * TRIM_STEP)));
    made = collect(all.slice(dropped), dropped);
    record(made.payload, none());
    bare = sizeOf(buildHtml(made.payload, { signingKey: options.signingKey }));
  }
  const { payload, wanted, participants } = made;

  // Then the pictures, and after them the files, with whatever room the words left.
  const room =
    maxFile === undefined
      ? options.maxTotalBytes
      : Math.min(
          options.maxTotalBytes ?? Number.POSITIVE_INFINITY,
          Math.max(0, Math.floor((maxFile - bare - HEADROOM_BYTES) / PICTURE_COST)),
        );
  const images =
    options.images === false
      ? none()
      : await embedAssets(payload, wanted, {
          fetch: options.fetch,
          maxTotalBytes: room,
          maxSingleBytes: options.maxSingleBytes,
          maxPictures: options.maxPictures,
          maxImageWidth: options.maxImageWidth ?? (maxFile === undefined ? undefined : widthFor(maxFile)),
        });

  // The estimate above is close, not exact. If the file still came out over,
  // what was added last is taken back out until it is under — files before
  // pictures, since that is the order they give way in.
  record(payload, images);
  let html = buildHtml(payload, { signingKey: options.signingKey });
  const kept = Object.keys(payload.assets);
  while (maxFile !== undefined && sizeOf(html) > maxFile && kept.length > 0) {
    const last = kept.pop();
    const into = payload.assets[last].startsWith("data:application/octet-stream") ? images.files : images;
    into.bytes -= Math.floor((payload.assets[last].length * 3) / 4);
    into.saved -= 1;
    into.skipped += 1;
    delete payload.assets[last];
    record(payload, images);
    html = buildHtml(payload, { signingKey: options.signingKey });
  }

  return {
    html,
    bytes: sizeOf(html),
    messageCount: payload.messages.length,
    /** Older messages left out to fit `maxFileBytes`. */
    truncated: dropped,
    participants,
    /** Pictures saved and left out. */
    images: { saved: images.saved, skipped: images.skipped, bytes: images.bytes },
    /** Other files saved and left out. */
    files: images.files,
  };
}

/**
 * Whether a transcript file is what its exporter signed.
 *
 * @param {string} html
 * @param {{ trustedKeys?: readonly string[] }} [options]
 * @returns {"verified" | "intact" | "modified" | "unsigned"}
 */
export function verifyTranscript(html, options = {}) {
  try {
    return verify(readTranscript(html).envelope, options);
  } catch {
    return "modified";
  }
}
