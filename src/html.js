// The file itself: one HTML document that carries its data and its own viewer.
//
// Nothing in it is fetched to draw the transcript. It opens the same way from
// a Discord download, from a website, or from a backup years later.
//
// It is laid out to be read as text too, and is nothing but three blocks:
//
//   <Server-Info>      where and when, in plain words
//   <User-Info>        who spoke, and how much
//   <Base-Transcript>  the transcript's data and the viewer, both gzipped and
//                      written as base64, and a loader a few lines long
//
// There is no doctype, head or body written out: the file starts at
// <Server-Info>. The loader takes the data out of the page, clears the plain
// text away, and unpacks the viewer in its place.

import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

import { pack, unpack } from "./pack.js";

const VIEWER_JS = readFileSync(new URL("./viewer/viewer.js", import.meta.url), "utf8");
const VIEWER_CSS = readFileSync(new URL("./viewer/viewer.css", import.meta.url), "utf8");

/** The stylesheet and the script, packed once: they are the same in every file. */
const VIEWER = gzipSync(Buffer.from(JSON.stringify({ css: VIEWER_CSS, js: VIEWER_JS }), "utf8"), {
  level: 9,
}).toString("base64");

/**
 * Clears the plain text off the page, unpacks the viewer and starts it.
 *
 * The file has no doctype or head of its own, so the browser opens it in its
 * compatibility mode and supplies an empty head and a body. The loader fills
 * in what a head would have said — how wide a phone should draw the page, and
 * that it is not to be indexed — and paints the page before anything is drawn.
 * (A doctype cannot be added afterwards: a browser decides the mode from the
 * first bytes. The viewer's stylesheet is written to lay out the same in both.)
 *
 * Everything it runs came out of this same file. A browser too old to unpack
 * it says so in words rather than showing an empty page.
 */
const LOADER = [
  "(async()=>{",
  "const d=document,g=i=>d.getElementById(i).textContent;",
  "try{",
  'const e=JSON.parse(g("transcript-data")),z=g("transcript-viewer");',
  'd.body.textContent="";d.body.style.cssText="margin:0;background:#1a1a1e";d.documentElement.lang="en";',
  'const m=(n,c)=>d.head.appendChild(Object.assign(d.createElement("meta"),{name:n,content:c}));',
  'm("viewport","width=device-width, initial-scale=1");m("robots","noindex, nofollow");m("referrer","no-referrer");m("color-scheme","dark");',
  'const el=d.body.appendChild(d.createElement("div"));',
  "const b=Uint8Array.from(atob(z),c=>c.charCodeAt(0));",
  'const v=JSON.parse(await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream("gzip"))).text());',
  'd.head.appendChild(Object.assign(d.createElement("style"),{textContent:v.css}));',
  "(0,eval)(v.js);",
  "const r=await UtilTranscript.mount(el,e),p=r&&r.payload;",
  'if(p)d.title="#"+((p.channel&&p.channel.name)||"transcript")+" \\u00b7 "+((p.guild&&p.guild.name)||"Transcript")',
  "}catch(x){",
  'd.body.textContent="This transcript needs an up-to-date browser to open.";d.body.style.cssText="margin:24px;background:#1a1a1e;color:#dfe0e2;font:16px sans-serif"',
  "}})()",
].join("");

/** Text that is safe as page content: it sits in the document itself, outside any script. */
const safe = (value) =>
  String(value ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

/**
 * The two plain-text blocks at the top of the file.
 *
 * For somebody who opens the file in a text editor, and for Discord's own file
 * preview, which shows its first lines: what this is, without decoding anything.
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

      return `    ${String(count)} - ${safe(user.name)} (${safe(user.id)})`;
    });
  const exported = new Date(payload.exportedAt).toISOString().replace("T", " ").slice(0, 16);

  return [
    "<Server-Info>",
    `    Server: ${safe(payload.guild.name)} (${safe(payload.guild.id)})`,
    `    Channel: ${safe(payload.channel.name)} (${safe(payload.channel.id)})`,
    `    Messages: ${String(payload.messages.length)}`,
    ...(payload.truncated ? [`    Messages Skipped: ${String(payload.truncated)} (oldest first, due to the file size limit.)`] : []),
    `    Images Saved: ${String(stats?.saved ?? 0)}`,
    `    Images Skipped: ${String(stats?.skipped ?? 0)} (due to the file size limit, or no longer on Discord.)`,
    `    Exported: ${exported} UTC`,
    "",
    "<User-Info>",
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

  return [
    summary(payload, options.stats),
    "",
    "<Base-Transcript>",
    // Base64 and a handful of fixed keys: nothing in either block can close its element.
    `    <script id="transcript-data" type="application/json">${JSON.stringify(envelope)}</script>` +
      `<script id="transcript-viewer" type="application/octet-stream">${VIEWER}</script>` +
      `<script>${LOADER}</script>`,
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
