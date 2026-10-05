// The addresses of Discord's own images, spelled once.
//
// The collector asks for a custom emoji's picture and the viewer looks it up
// again later, from nothing but the id written in the message text. Both have
// to arrive at the same string, so both use these — the viewer carries its own
// copy of `emojiUrl`, and a test holds the two together.

/** A custom emoji's picture. Animated ones are GIFs, so they keep moving once embedded. */
export function emojiUrl(id, animated) {
  return `https://cdn.discordapp.com/emojis/${id}.${animated ? "gif" : "webp"}?size=48`;
}

/** Hosts that are Discord's. Nothing is downloaded from anywhere else. */
const DISCORD_HOST = /(^|\.)(discordapp\.com|discordapp\.net|discord\.com)$/i;

/**
 * Whether a picture may be downloaded into the file.
 *
 * Only from Discord. An embed's image can point at any address on the
 * internet, and a bot that fetches whatever a message links to can be aimed at
 * its own private network. Discord already proxies every such image, so the
 * proxy's copy is the one that is fetched.
 */
export function isDiscordUrl(url) {
  try {
    const parsed = new URL(url);

    return parsed.protocol === "https:" && DISCORD_HOST.test(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * The address to download a picture from, scaled down by Discord when it is
 * larger than it will ever be drawn.
 *
 * Discord's media proxy resizes and re-encodes on request, which is what lets
 * a transcript hold many times more pictures inside the same file size — with
 * no image library in the exporter. GIFs are left alone so they stay animated.
 */
export function sizedUrl(url, { width, height, maxWidth, type }) {
  if (!isDiscordUrl(url)) return url;

  const parsed = new URL(url);
  const isGif = /gif/i.test(type ?? "") || /\.gif$/i.test(parsed.pathname);
  if (isGif || parsed.hostname === "cdn.discordapp.com") return url;

  parsed.searchParams.set("format", "webp");
  if (width > maxWidth && height > 0) {
    parsed.searchParams.set("width", String(maxWidth));
    parsed.searchParams.set("height", String(Math.round((height * maxWidth) / width)));
  }

  return parsed.toString();
}
