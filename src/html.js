// The file itself: one HTML document that carries its data and its own viewer.
//
// Nothing in it is fetched to draw the transcript. The stylesheet and the
// viewer travel inside it, so the file opens the same way from a Discord
// download, from a website, or from a backup years later.
//
// To keep it small and tidy the file is three things: a plain-text summary,
// the transcript's data, and the viewer — the last two gzipped and written as
// base64 — plus a loader a few lines long that unpacks the viewer and runs it.

import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

import { pack, unpack } from "./pack.js";

const VIEWER_JS = readFileSync(new URL("./viewer/viewer.js", import.meta.url), "utf8");
const VIEWER_CSS = readFileSync(new URL("./viewer/viewer.css", import.meta.url), "utf8");

/** The stylesheet and the script, packed once: they are the same in every file. */
const VIEWER = gzipSync(Buffer.from(JSON.stringify({ css: VIEWER_CSS, js: VIEWER_JS }), "utf8"), { level: 9 }).toString("base64");

/**
 * Unpacks the viewer and starts it.
 *
 * Everything it runs came out of this same file. A browser too old to unpack
 * it says so in words rather than showing an empty page.
 */
const LOADER = [
  "(async()=>{try{",
  'const b=Uint8Array.from(atob(document.getElementById("transcript-viewer").textContent),c=>c.charCodeAt(0));',
  'const v=JSON.parse(await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream("gzip"))).text());',
  'document.head.appendChild(Object.assign(document.createElement("style"),{textContent:v.css}));',
  "(0,eval)(v.js)",
  '}catch(e){document.getElementById("transcript").textContent="This transcript needs an up-to-date browser to open."}})()',
].join("");

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Text that is safe inside an HTML comment, which may not contain `--`. */
const commentSafe = (value) => String(value ?? "").replace(/--+/g, "-").replace(/[<>]/g, "");

/**
 * The plain-text summary at the top of the file.
 *
 * For somebody who opens the file in a text editor, or a log that shows its
 * first lines: what this is, without decoding anything.
 */
function summary(payload, stats) {
  const counts = new Map();
  for (const message of payload.messages) {
    if (message.author) counts.set(message.author, (counts.get(message.author) ?? 0) + 1);
  }
  const people = [...counts.entries()]
    .sort(([, a], [, b]) => b - a)
    .map(([key, count]) => {
      const user = payload.users[key] ?? {};

      return `    ${String(count)} - ${commentSafe(user.name)} (${commentSafe(user.id)})`;
    });

  return [
    "Transcript",
    `    Server: ${commentSafe(payload.guild.name)} (${commentSafe(payload.guild.id)})`,
    `    Channel: ${commentSafe(payload.channel.name)} (${commentSafe(payload.channel.id)})`,
    `    Messages: ${String(payload.messages.length)}`,
    `    Images saved: ${String(stats?.saved ?? 0)}`,
    `    Images not saved: ${String(stats?.skipped ?? 0)}`,
    `    Exported: ${new Date(payload.exportedAt).toISOString()}`,
    "",
    "Participants",
    ...people,
  ].join("\n");
}

/**
 * @param {object} payload
 * @param {{ signingKey?: string, stats?: { saved: number, skipped: number } }} [options]
 * @returns {string} the whole file
 */
export function buildHtml(payload, options = {}) {
  const envelope = pack(payload, { signingKey: options.signingKey });
  const title = `#${payload.channel.name || "transcript"} · ${payload.guild.name || "Transcript"}`;

  return [
    "<!DOCTYPE html>",
    `<!--\n${summary(payload, options.stats)}\n-->`,
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex, nofollow">',
    '<meta name="referrer" content="no-referrer">',
    '<meta name="color-scheme" content="dark">',
    `<title>${escapeHtml(title)}</title>`,
    "</head>",
    '<body style="margin:0;background:#1a1a1e;color:#dfe0e2;font-family:sans-serif">',
    '<div id="transcript"><noscript>This transcript needs JavaScript to be displayed.</noscript></div>',
    // Base64 and a handful of fixed keys: nothing in either block can close its element.
    `<script id="transcript-data" type="application/json">${JSON.stringify(envelope)}</script>`,
    `<script id="transcript-viewer" type="application/octet-stream">${VIEWER}</script>`,
    `<script>${LOADER}</script>`,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

const DATA_BLOCK = /<script id="transcript-data" type="application\/json">([^<]*)<\/script>/;

/**
 * Reads a transcript file back.
 *
 * What a website needs to show one, and what an exporter needs to issue a new
 * link for a file that is already sitting in a channel.
 *
 * @param {string} html
 * @returns {{ envelope: object, payload: object }}
 */
export function readTranscript(html) {
  const match = DATA_BLOCK.exec(String(html));
  if (match === null) throw new Error("Not a transcript file.");

  let envelope;
  try {
    envelope = JSON.parse(match[1]);
  } catch {
    throw new Error("Not a transcript file.");
  }

  return { envelope, payload: unpack(envelope) };
}
