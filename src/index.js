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
 * @param {boolean} [options.images] download pictures into the file; default true
 * @param {typeof fetch} [options.fetch] how pictures are downloaded; default the global fetch
 * @param {number} [options.maxTotalBytes] budget for all pictures together
 * @param {number} [options.maxSingleBytes] the largest single picture
 * @param {number} [options.maxPictures] how many posted pictures to save; avatars and emoji are not counted
 * @param {number} [options.maxImageWidth] wider pictures are scaled down to this by Discord
 * @param {{ name: string, url?: string }} [options.brand] credited in the footer
 */
export async function createTranscript(channel, options = {}) {
  const messages = options.messages ?? (await history(channel, options.limit === undefined ? 1000 : options.limit));
  const { payload, wanted, participants } = collectTranscript(messages, {
    channel,
    guild: channel?.guild,
    maxImageWidth: options.maxImageWidth,
    brand: options.brand,
  });

  const images =
    options.images === false
      ? { saved: 0, skipped: 0, bytes: 0 }
      : await embedAssets(payload, wanted, {
          fetch: options.fetch,
          maxTotalBytes: options.maxTotalBytes,
          maxSingleBytes: options.maxSingleBytes,
          maxPictures: options.maxPictures,
        });

  return {
    html: buildHtml(payload, { signingKey: options.signingKey, stats: images }),
    messageCount: payload.messages.length,
    participants,
    images,
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
