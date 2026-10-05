import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import vm from "node:vm";

import {
  buildHtml,
  collectTranscript,
  createTranscript,
  embedAssets,
  generateKeys,
  pack,
  readTranscript,
  unpack,
  verify,
  verifyTranscript,
} from "../src/index.js";
import { emojiUrl, isDiscordUrl, sizedUrl } from "../src/urls.js";

import { CHANNEL, fakeFetch, SAMPLE_IDS, sampleMessages } from "./fixtures.js";

/**
 * The viewer, loaded the way a browser loads it: as a plain script given a
 * global to hang itself on. Node has the same `atob`, `Blob`, `Response`,
 * `DecompressionStream` and WebCrypto a browser does, so the reading and the
 * signature check run here exactly as they do in a transcript file.
 */
function loadViewer() {
  const sandbox = { atob, Blob, Response, DecompressionStream, crypto: globalThis.crypto, Uint8Array, Date, JSON, Promise };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(readFileSync(new URL("../src/viewer/viewer.js", import.meta.url), "utf8"), sandbox);

  return sandbox.UtilTranscript;
}

const viewer = loadViewer();
const collected = () => collectTranscript(sampleMessages(), { channel: CHANNEL });

/** Flips one character in the middle of a base64 string, keeping it valid base64. */
function tamper(data) {
  const at = Math.floor(data.length / 2);

  return data.slice(0, at) + (data[at] === "A" ? "B" : "A") + data.slice(at + 1);
}

describe("packing and signing", () => {
  it("reads back exactly what was packed", () => {
    const payload = { messages: [{ id: "1", content: "héllo 🎉" }], assets: {} };

    assert.deepEqual(unpack(pack(payload)), payload);
  });

  it("is verified only when the key is one the checker already trusted", () => {
    const keys = generateKeys();
    const envelope = pack({ a: 1 }, { signingKey: keys.privateKey });

    assert.equal(verify(envelope, { trustedKeys: [keys.publicKey] }), "verified");
    assert.equal(verify(envelope), "intact");
    assert.equal(verify(envelope, { trustedKeys: [generateKeys().publicKey] }), "intact");
  });

  it("calls a changed file modified", () => {
    const keys = generateKeys();
    const envelope = pack({ said: "refund approved" }, { signingKey: keys.privateKey });

    assert.equal(verify({ ...envelope, data: tamper(envelope.data) }, { trustedKeys: [keys.publicKey] }), "modified");
  });

  /** The forgery base64 alone would allow: decode, edit, encode again. */
  it("calls a re-packed edit modified, however tidy the base64", () => {
    const keys = generateKeys();
    const envelope = pack({ said: "refund denied" }, { signingKey: keys.privateKey });
    const forged = pack({ said: "refund approved" });

    assert.equal(verify({ ...envelope, data: forged.data }, { trustedKeys: [keys.publicKey] }), "modified");
  });

  /** And the forgery a signature alone would allow: sign the edit with your own key. */
  it("does not verify an edit re-signed with somebody else's key", () => {
    const real = generateKeys();
    const forged = pack({ said: "refund approved" }, { signingKey: generateKeys().privateKey });

    assert.equal(verify(forged, { trustedKeys: [real.publicKey] }), "intact");
  });

  it("says unsigned when there is nothing to check", () => {
    assert.equal(verify(pack({ a: 1 })), "unsigned");
  });
});

describe("the file", () => {
  it("carries its data and reads back to the same transcript", () => {
    const { payload } = collected();
    const html = buildHtml(payload, { signingKey: generateKeys().privateKey });

    assert.deepEqual(readTranscript(html).payload, payload);
  });

  it("needs nothing from anywhere to draw itself", () => {
    const html = buildHtml(collected().payload);

    assert.equal(/<script[^>]+src=/i.test(html), false, "no script is loaded from outside the file");
    assert.equal(/<link[^>]+href=/i.test(html), false, "no stylesheet is loaded from outside the file");
  });

  /** The viewer is the same in every file, so it travels packed: a file is a summary and two blobs. */
  it("carries its viewer compressed rather than as pages of script", () => {
    const html = buildHtml(collected().payload);

    assert.equal(html.includes(".tr-bar"), false, "the stylesheet is not written out");
    assert.equal(html.includes("function render("), false, "the script is not written out");
    assert.match(html, /<script id="transcript-viewer" type="application\/octet-stream">[A-Za-z0-9+\/=]+<\/script>/);
    assert.ok(html.length < 50_000, `a transcript with no pictures is small (${String(html.length)} bytes)`);
  });

  /**
   * Read as text, a file is three blocks and nothing else, in the order
   * somebody skimming it wants: where, who, and the transcript. No doctype or
   * head is written out — the loader clears the text and sets up the page.
   */
  it("is three plain blocks: the server, the people, and the transcript", () => {
    const html = buildHtml(collected().payload, { stats: { saved: 3, skipped: 1 } });
    const lines = html.split("\n");

    assert.deepEqual(lines.slice(0, 4), [
      "<Transcript>",
      "    Server    Utilities Support (1374147741403320350)",
      "    Channel   #ticket-0007 (1489260905819541635)",
      lines[3],
    ]);
    assert.match(lines[3], /^    Exported  \d{4}-\d\d-\d\d \d\d:\d\d UTC$/);
    assert.deepEqual(lines.slice(4, 16), [
      "    Messages  12 saved",
      "    Images    3 saved, 1 skipped",
      "    Files     0 saved",
      "    Skipped   over the file size limit, or no longer on Discord",
      "",
      "<Participants>",
      "    6  mira.k     497562304498368513",
      "    3  Utilities  1359000000000000001",
      "    3  jonas      612345678901234567",
      "",
      "<Conversation>",
      lines[15],
    ]);
    assert.equal(lines.length, 17, "nothing else: the last block is one line, then the file ends");
    assert.equal(html.startsWith("<Transcript>"), true);
    assert.match(lines[15], /d\.body\.textContent="";/, "the loader clears the plain text before the transcript is drawn");
  });

  it("says nothing about skipping when nothing was skipped", () => {
    const html = buildHtml(collected().payload, { stats: { saved: 10, skipped: 0 } });

    assert.match(html, /^    Images    10 saved\n    Files     0 saved\n\n<Participants>$/m);
    assert.equal(html.split("<Conversation>")[0].includes("kipped"), false);
  });

  /** Those blocks are page content now, so a server or a person named in markup must not become any. */
  it("writes names into the plain blocks as text, never as markup", () => {
    const { payload } = collected();
    payload.guild.name = '<script>alert(1)</script>';
    payload.users[SAMPLE_IDS.mira].name = "</Transcript><img src=x onerror=alert(2)>";
    const head = buildHtml(payload).split("<Conversation>")[0];

    assert.equal(/<script|<img/i.test(head), false);
    assert.match(head, /Server    &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  });

  it("is reported modified when its data is edited", () => {
    const keys = generateKeys();
    const html = buildHtml(collected().payload, { signingKey: keys.privateKey });
    const { envelope } = readTranscript(html);

    assert.equal(verifyTranscript(html, { trustedKeys: [keys.publicKey] }), "verified");
    assert.equal(
      verifyTranscript(html.replace(envelope.data, tamper(envelope.data)), { trustedKeys: [keys.publicKey] }),
      "modified",
    );
  });

  it("refuses something that is not a transcript", () => {
    assert.throws(() => readTranscript("<html><body>hello</body></html>"), /Not a transcript file/);
  });
});

describe("collecting messages", () => {
  it("names everybody a message mentions, so nothing draws as a raw id", () => {
    const { payload } = collected();

    assert.equal(payload.users[SAMPLE_IDS.mira].name, "mira.k");
    assert.equal(payload.users[SAMPLE_IDS.mira].display, "Mira");
    assert.equal(payload.roles[SAMPLE_IDS.staffRole].name, "Support Team");
    assert.equal(payload.channels[SAMPLE_IDS.rules].name, "rules");
  });

  it("keeps what a profile card shows: when somebody joined and their top roles", () => {
    const { payload } = collected();
    const jonas = payload.users[SAMPLE_IDS.jonas];

    assert.equal(jonas.joined, Date.UTC(2025, 3, 9));
    assert.deepEqual(jonas.roles, [SAMPLE_IDS.staffRole, "1374150000000000009"], "highest first, without @everyone");
    assert.equal(payload.roles["1374150000000000009"].name, "Billing");
  });

  it("keeps what somebody may do in the server, and one word for an administrator", () => {
    const { payload } = collected();

    assert.deepEqual(payload.users[SAMPLE_IDS.jonas].perms, ["ManageMessages", "KickMembers"], "the telling ones, in a fixed order");
    assert.equal(payload.users[SAMPLE_IDS.mira].perms, undefined);
  });

  /**
   * What was said is the transcript; a preview is decoration. Drawn the way
   * Discord draws it, one link's picture was most of a file's size.
   */
  it("keeps a link's preview picture small, and a bare GIF link's still only a little larger", () => {
    const preview = { url: "https://images-ext-1.discordapp.net/external/a/og.png", proxy_url: "https://images-ext-1.discordapp.net/external/a/og.png", width: 1200, height: 630 };
    const message = (embed) => ({ ...sampleMessages()[1], embeds: [embed] });
    const { payload, wanted } = collectTranscript(
      [
        message({ type: "link", title: "Utilities", url: "https://utilities.best", thumbnail: preview }),
        message({ type: "gifv", url: "https://klipy.com/gifs/x", thumbnail: { ...preview, url: preview.url + "?gif" }, video: { url: "https://klipy.com/x.mp4" } }),
      ],
      { channel: CHANNEL },
    );
    const html = viewer.render(payload, {});

    assert.equal(wanted.find((item) => item.url === preview.url).draw, 160, "fetched at the size it is drawn");
    assert.equal(wanted.find((item) => item.url === preview.url + "?gif").draw, 480);
    assert.match(html, /class="embed__thumb"/, "the link's picture sits beside its text");
    assert.match(html, /<a class="pic" href="https:\/\/klipy\.com\/gifs\/x" target="_blank"/, "the still opens what was posted");
  });

  it("keeps a forwarded message's own content, attachments and origin", () => {
    const forwarded = collected().payload.messages.find((message) => message.forwarded).forwarded;

    assert.match(forwarded.content, /Duplicate charges/);
    assert.equal(forwarded.attachments[0].name, "banner.png");
    assert.equal(forwarded.from, SAMPLE_IDS.rules);
  });

  it("keeps a container's layout and registers the pictures inside it", () => {
    const { payload, wanted } = collected();
    const container = payload.messages[0].components[0];

    assert.equal(container.type, 17);
    assert.equal(container.color, "#a6e4f5");
    assert.equal(container.components[0].accessory.type, 11);
    assert.ok(wanted.some((item) => item.url.endsWith("/external/thumb/premium.png")));
  });

  it("counts who did the talking, busiest first, by username", () => {
    assert.deepEqual(collected().participants, [
      { userId: SAMPLE_IDS.mira, username: "mira.k", messageCount: 6 },
      { userId: SAMPLE_IDS.bot, username: "Utilities", messageCount: 3 },
      { userId: SAMPLE_IDS.jonas, username: "jonas", messageCount: 3 },
    ]);
  });

  it("asks for small things everybody sees before the pictures", () => {
    const tiers = collected().wanted.map((item) => item.tier);

    assert.deepEqual(tiers, [...tiers].sort((a, b) => a - b));
    assert.equal(tiers[0], 0);
  });
});

describe("saving pictures into the file", () => {
  it("embeds them as data, so the file no longer depends on Discord's links", async () => {
    const { payload, wanted } = collected();
    const stats = await embedAssets(payload, wanted, { fetch: fakeFetch() });
    const pictures = wanted.filter((item) => !item.file);

    assert.equal(stats.skipped, 0);
    assert.equal(stats.saved, pictures.length);
    for (const item of pictures) assert.match(payload.assets[item.url], /^data:image\/png;base64,/);
  });

  /** Messages first, then pictures, then files: a file is the last thing asked for. */
  it("saves a file that is not a picture too, after every picture, as plain bytes", async () => {
    const calls = [];
    const { payload, wanted } = collected();
    const stats = await embedAssets(payload, wanted, { fetch: fakeFetch(calls), concurrency: 1 });
    const csv = wanted.find((item) => item.url.includes("orders-export.csv"));

    assert.deepEqual(wanted.map((item) => Boolean(item.file)), [...wanted.map((item) => Boolean(item.file))].sort(), "files are last in line");
    assert.ok(calls.findIndex((url) => url.includes(".csv")) > calls.findIndex((url) => url.includes("banner.png")), "asked for after the last picture");
    // Whatever Discord called it, it is stored as bytes: nothing saved can be opened as a page.
    assert.match(payload.assets[csv.url], /^data:application\/octet-stream;base64,/);
    assert.equal(Buffer.from(payload.assets[csv.url].split(",")[1], "base64").toString(), "order,amount\nUT-48213,4.99\nUT-48213,4.99\n");
    assert.deepEqual(stats.files, { saved: 1, skipped: 1, bytes: 41 }, "the video is gone from Discord, and is counted as not saved");
  });

  /**
   * The point of a size limit is bandwidth as much as storage. A file's size
   * comes with the message, so one that cannot fit is never requested at all.
   */
  it("never asks Discord for a file that is too big for the room left", async () => {
    const calls = [];
    const fetcher = (input) => {
      calls.push(String(input));

      return Promise.resolve(new Response(Buffer.alloc(10), { headers: { "content-type": "application/pdf" } }));
    };
    const payload = { assets: {} };
    const stats = await embedAssets(
      payload,
      [
        { url: "https://cdn.discordapp.com/attachments/1/2/manual.pdf", from: "https://cdn.discordapp.com/attachments/1/2/manual.pdf", tier: 5, file: true, size: 900_000 },
        { url: "https://cdn.discordapp.com/attachments/1/3/note.txt", from: "https://cdn.discordapp.com/attachments/1/3/note.txt", tier: 5, file: true, size: 10 },
      ],
      { fetch: fetcher, maxTotalBytes: 50_000 },
    );

    assert.deepEqual(calls, ["https://cdn.discordapp.com/attachments/1/3/note.txt"]);
    assert.deepEqual(stats.files, { saved: 1, skipped: 1, bytes: 10 });
  });

  /** A picture Discord says is too large is dropped at the headers; its body is never read. */
  it("lets go of a picture's body when its announced size is already too large", async () => {
    let read = false;
    const body = new ReadableStream({ pull() { read = true; }, cancel() {} }, { highWaterMark: 0 });
    const fetcher = () => Promise.resolve(new Response(body, { headers: { "content-type": "image/png", "content-length": "9000000" } }));
    const stats = await embedAssets(
      { assets: {} },
      [{ url: "https://cdn.discordapp.com/attachments/1/2/big.png", from: "https://cdn.discordapp.com/attachments/1/2/big.png", tier: 4 }],
      { fetch: fetcher, maxTotalBytes: 100_000 },
    );

    assert.equal(stats.saved, 0);
    assert.equal(read, false, "not one byte of the body was pulled");
  });

  it("asks Discord for a smaller copy of a picture wider than it is ever drawn", async () => {
    const calls = [];
    const { payload, wanted } = collected();
    await embedAssets(payload, wanted, { fetch: fakeFetch(calls) });

    const big = new URL(calls.find((url) => url.includes("checkout-error.png")));
    assert.equal(big.hostname, "media.discordapp.net");
    assert.equal(big.searchParams.get("width"), "1100");
    assert.equal(big.searchParams.get("height"), "650");
  });

  /** A full transcript keeps its earliest pictures, not whichever downloaded first. */
  it("stops at the budget, in order, and counts what it left out", async () => {
    const { payload, wanted } = collected();
    const stats = await embedAssets(payload, wanted, { fetch: fakeFetch(), maxTotalBytes: 6_000 });

    assert.ok(stats.saved > 0 && stats.skipped > 0);
    assert.ok(stats.bytes <= 6_000);
    assert.ok(payload.assets[wanted[0].url], "the first thing asked for is the first thing kept");
  });

  /** What a plan buys: the first few pictures somebody posted, and everybody's face regardless. */
  it("saves only as many posted pictures as it is allowed, and every avatar and emoji", async () => {
    const calls = [];
    const { payload, wanted } = collected();
    const posted = wanted.filter((item) => item.tier >= 4 && !item.file);
    const stats = await embedAssets(payload, wanted, { fetch: fakeFetch(calls), maxPictures: 2 });

    assert.ok(posted.length > 2, "the sample has more pictures than the cap");
    assert.deepEqual(posted.map((item) => item.url in payload.assets), posted.map((_, index) => index < 2), "the earliest two, in order");
    assert.equal(stats.skipped, posted.length - 2);
    for (const item of wanted.filter((one) => one.tier < 4)) assert.ok(payload.assets[item.url], `${item.url} is not a posted picture`);
    assert.equal(calls.some((url) => url.includes("banner.png")), false, "a picture past the cap is never downloaded");
  });

  /**
   * One 4K screenshot must not be the whole transcript. A picture over its
   * share is asked for again at half the width until it fits.
   */
  it("asks for a narrower copy of a picture that is too heavy, rather than dropping it", async () => {
    const calls = [];
    const fetcher = (input) => {
      const url = new URL(String(input));
      calls.push(Number(url.searchParams.get("width")));
      const bytes = Number(url.searchParams.get("width")) <= 300 ? 20_000 : 900_000;

      return Promise.resolve(new Response(Buffer.alloc(bytes, 1), { headers: { "content-type": "image/webp" } }));
    };
    const payload = { assets: {} };
    const picture = { url: "https://cdn.discordapp.com/attachments/1/2/huge.png", from: "https://media.discordapp.net/attachments/1/2/huge.png", tier: 4, w: 3840, h: 2160, type: "image/png" };
    const stats = await embedAssets(payload, [picture], { fetch: fetcher, maxTotalBytes: 200_000 });

    assert.deepEqual(calls, [1100, 550, 275], "the widest allowed first, then half, then half again");
    assert.equal(stats.saved, 1);
    assert.equal(stats.bytes, 20_000);
  });

  it("caps a tall picture by its height as well as a wide one by its width", () => {
    const tall = new URL(sizedUrl("https://media.discordapp.net/attachments/1/2/phone.png", { width: 1170, height: 9000, maxWidth: 1000, type: "image/png" }));

    assert.equal(tall.searchParams.get("height"), "1500");
    assert.equal(tall.searchParams.get("width"), "195");
  });

  it("stops asking once the budget is spent", async () => {
    const calls = [];
    const { payload, wanted } = collected();
    await embedAssets(payload, wanted, { fetch: fakeFetch(calls), maxTotalBytes: 1_000, concurrency: 2 });

    assert.ok(calls.length <= 2, `asked for ${String(calls.length)} of ${String(wanted.length)}`);
  });

  /** An embed can point anywhere; a bot that fetched it could be aimed at its own network. */
  it("downloads nothing that is not Discord's", async () => {
    const calls = [];
    const payload = { assets: {} };
    const stats = await embedAssets(
      payload,
      [
        { url: "http://169.254.169.254/latest/meta-data", from: "http://169.254.169.254/latest/meta-data", tier: 0 },
        { url: "https://evil.example/cdn.discordapp.com/a.png", from: "https://evil.example/cdn.discordapp.com/a.png", tier: 0 },
        { url: "https://cdn.discordapp.com.evil.example/a.png", from: "https://cdn.discordapp.com.evil.example/a.png", tier: 0 },
      ],
      { fetch: fakeFetch(calls) },
    );

    assert.deepEqual(calls, []);
    assert.deepEqual(payload.assets, {});
    assert.equal(stats.skipped, 3);
  });

  it("refuses anything that is not a raster picture", async () => {
    const payload = { assets: {} };
    const svg = () => Promise.resolve(new Response("<svg/>", { headers: { "content-type": "image/svg+xml" } }));
    const stats = await embedAssets(
      payload,
      [{ url: "https://cdn.discordapp.com/a.svg", from: "https://cdn.discordapp.com/a.svg", tier: 0 }],
      { fetch: svg },
    );

    assert.equal(stats.saved, 0);
  });

  /** One animation can outweigh the rest of a transcript; what matters is that it was there. */
  it("saves an uploaded GIF as a small still, and leaves a custom emoji moving", () => {
    const gif = new URL(sizedUrl("https://media.discordapp.net/attachments/1/2/party.gif?ex=1", { width: 4000, height: 3000, maxWidth: 1100 }));
    const emoji = emojiUrl("123456789012345678", true);

    assert.equal(gif.searchParams.get("format"), "webp");
    assert.equal(gif.searchParams.get("width"), "1100");
    assert.equal(sizedUrl(emoji, { width: 0, height: 0, maxWidth: 1100 }), emoji);
    assert.equal(isDiscordUrl(emoji), true);
  });
});

describe("the viewer", () => {
  const drawn = () => viewer.render(collected().payload, { status: "verified" });

  it("looks up a custom emoji at the address the collector asked for", () => {
    assert.equal(viewer.emojiUrl("123456789012345678", false), emojiUrl("123456789012345678", false));
    assert.equal(viewer.emojiUrl("123456789012345678", true), emojiUrl("123456789012345678", true));
  });

  it("marks every name, avatar and mention with whose it is, so a click can open their profile", () => {
    const html = drawn();

    assert.match(html, new RegExp(`class="name msg__name"[^>]*data-user="${SAMPLE_IDS.jonas}"`));
    assert.match(html, new RegExp(`<img class="av"[^>]*data-user="${SAMPLE_IDS.mira}"`));
    assert.match(html, new RegExp(`class="mention" data-user="${SAMPLE_IDS.mira}"`));
  });

  /** Nobody asked whether a ticket file was "verified"; a changed one is the only thing worth saying. */
  it("says nothing about a file that is fine, and warns about one that was changed", () => {
    const payload = collected().payload;

    assert.equal(/Verified|Unchanged|Unsigned/.test(viewer.render(payload, { status: "verified" })), false);
    assert.equal(/Verified|Unchanged|Unsigned/.test(viewer.render(payload, { status: "unsigned" })), false);
    assert.match(viewer.render(payload, { status: "modified" }), /This transcript was modified/);
  });

  it("draws mentions as names", () => {
    const html = drawn();

    assert.match(html, />@Mira</);
    assert.match(html, />@Support Team</);
    assert.match(html, />#rules</);
    assert.equal(html.includes(`&lt;@${SAMPLE_IDS.mira}&gt;`), false);
  });

  it("draws the pieces of a ticket: container, embed, reply, forward, buttons, menu, system line", () => {
    const html = drawn();

    for (const piece of ['class="box has-bar"', 'class="embed"', "data-jump=", 'class="fwd"', "btn btn--danger", 'class="select"', "sys sys--pin", "Forwarded", "(edited)", "SPOILER"]) {
      assert.ok(html.includes(piece), `missing ${piece}`);
    }
  });

  it("offers a saved file as a download from the transcript itself, and says when one was not saved", async () => {
    const { payload, wanted } = collected();
    await embedAssets(payload, wanted, { fetch: fakeFetch() });
    const html = viewer.render(payload, {});

    assert.match(html, /<a class="file__name" href="data:application\/octet-stream;base64,[A-Za-z0-9+\/=]+" download="orders-export\.csv">/);
    assert.match(html, /Saved in this transcript/);
    assert.match(html, /screen-recording\.mp4<\/a><span class="file__size">[^<]*Not saved, the link may have expired/);
  });

  /** Only plain bytes may sit behind a download link: a page smuggled in as a "file" is refused. */
  it("refuses a saved file that is not plain bytes", () => {
    const { payload } = collected();
    const csv = payload.messages.flatMap((message) => message.attachments ?? []).find((file) => file.name === "orders-export.csv");
    payload.assets[csv.url] = "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==";

    assert.equal(viewer.render(payload, {}).includes("data:text/html"), false);
  });

  /**
   * Everything about the export in one place, and the one time that does not
   * depend on where the reader is: every other time on the page is local.
   */
  it("opens with a summary: where it is from, how long it ran, what was saved, and the time zone", async () => {
    const { payload, wanted } = collected();
    const got = await embedAssets(payload, wanted, { fetch: fakeFetch() });
    payload.stats = { images: { saved: got.saved, skipped: got.skipped }, files: got.files };
    const html = viewer.render(payload, {});

    for (const piece of [
      'data-copy="1374147741403320350"',
      'data-copy="1489260905819541635"',
      "<span>Messages</span><b>12 from 3 people</b>",
      "<span>Lasted</span><b>1d",
      "<span>Images</span><b>10 saved</b>",
      "<span>Files</span><b>1 saved, 1 skipped</b>",
      "<span>Times shown in</span>",
    ]) {
      assert.ok(html.includes(piece), `missing ${piece}`);
    }
    assert.match(html, /<em>\d{4}-\d\d-\d\d \d\d:\d\d UTC<\/em>/);
  });

  it("shows a saved picture from the file, not from Discord", async () => {
    const { payload, wanted } = collected();
    await embedAssets(payload, wanted, { fetch: fakeFetch() });
    const html = viewer.render(payload, {});

    assert.equal(html.includes("checkout-error.png?ex="), false, "the expiring link is not what is drawn");
    assert.match(html, /src="data:image\/png;base64,/);
  });

  /** Everything in a message is somebody else's text. None of it may become markup. */
  it("never lets a message become markup or a script link", () => {
    const hostile = {
      guild: { name: '<img src=x onerror="alert(1)">' },
      channel: { name: "</title><script>alert(2)</script>" },
      users: { 1: { id: "1", name: '"><script>alert(3)</script>', avatar: "javascript:alert(4)" } },
      roles: {},
      channels: {},
      assets: { "https://cdn.discordapp.com/x.png": "data:text/html;base64,PHNjcmlwdD4=" },
      messages: [
        {
          id: '1" onmouseover="alert(5)',
          author: "1",
          ts: 1,
          content: '<script>alert(6)</script> [click](javascript:alert(7)) <img src=x onerror=alert(8)>',
          embeds: [{ title: "<b>x</b>", url: "javascript:alert(9)", color: 'red;background:url("javascript:alert(10)")', image: { url: "https://cdn.discordapp.com/x.png" } }],
          components: [{ type: 1, components: [{ type: 2, style: 5, label: "<i>go</i>", url: "javascript:alert(11)" }] }],
          attachments: [{ name: "<svg onload=alert(12)>", kind: "file", url: "data:text/html,<script>alert(13)</script>" }],
        },
      ],
    };
    const html = viewer.render(hostile, {});

    assert.equal(/<script/i.test(html), false);
    assert.equal(/href="\s*(javascript|data):/i.test(html), false);
    assert.equal(/src="\s*(javascript|data:text)/i.test(html), false);
    // With every quoted attribute value emptied, what is left of each tag is its attribute
    // *names* — and none of them may be an event handler. (Hostile text sitting escaped
    // inside a quoted value is inert, and is checked by the escapes above.)
    assert.equal(html.includes('alt="&lt;svg onload=alert(12)&gt;"') || html.includes("&lt;svg onload=alert(12)&gt;"), true);
    assert.equal(/<[^>]*\son\w+\s*=/i.test(html.replace(/"[^"]*"/g, '""')), false);
    assert.match(html, /&lt;script&gt;alert\(6\)&lt;\/script&gt;/);
  });

  it("reads a real file's data and finds it unchanged", async () => {
    const keys = generateKeys();
    const { envelope } = readTranscript(buildHtml(collected().payload, { signingKey: keys.privateKey }));

    assert.equal((await viewer.decode(envelope)).messages.length, 12);
    assert.equal(await viewer.check(envelope, [keys.publicKey]), "verified");
    assert.equal(await viewer.check(envelope, []), "intact");
  });

  it("finds an edited file modified, in the browser's own check", async () => {
    const { envelope } = readTranscript(buildHtml(collected().payload, { signingKey: generateKeys().privateKey }));
    const forged = pack({ ...collected().payload, messages: [] });

    assert.equal(await viewer.check({ ...envelope, data: forged.data }, []), "modified");
    assert.equal(await viewer.check(pack({ a: 1 }), []), "unsigned");
  });
});

describe("createTranscript", () => {
  it("exports a channel in one call", async () => {
    const result = await createTranscript(CHANNEL, {
      messages: sampleMessages(),
      signingKey: generateKeys().privateKey,
      fetch: fakeFetch(),
    });

    assert.equal(result.messageCount, 12);
    assert.equal(result.images.skipped, 0);
    assert.deepEqual(result.files, { saved: 1, skipped: 1, bytes: 41 });
    assert.match(result.html, /^    Images    10 saved\n    Files     1 saved, 1 skipped\n    Skipped   over the file size limit, or no longer on Discord$/m);
    assert.deepEqual(readTranscript(result.html).payload.stats, { images: { saved: 10, skipped: 0 }, files: { saved: 1, skipped: 1 } });
    assert.equal(result.participants[0].username, "mira.k");
    assert.equal(verifyTranscript(result.html), "intact");
  });

  /**
   * The limit is on the whole file — words, pictures and viewer together —
   * because that is what a plan is sold as and what an upload is measured by.
   */
  it("keeps the whole file under a size limit, leaving pictures out to do it", async () => {
    const free = await createTranscript(CHANNEL, { messages: sampleMessages(), fetch: fakeFetch(), maxFileBytes: 60_000 });
    const roomy = await createTranscript(CHANNEL, { messages: sampleMessages(), fetch: fakeFetch(), maxFileBytes: 2_500_000 });

    assert.ok(free.bytes <= 60_000, `${String(free.bytes)} bytes`);
    assert.equal(free.bytes, Buffer.byteLength(free.html));
    assert.ok(free.images.skipped > 0 && free.images.saved > 0, "some pictures fit and some did not");
    assert.equal(free.messageCount, 12, "every message is still there");
    assert.equal(roomy.images.skipped, 0);
    assert.ok(roomy.bytes > free.bytes);
  });

  it("drops the oldest messages when the words alone are over the limit, and says so", async () => {
    const long = Array.from({ length: 60 }, () => sampleMessages()).flat().map((message, index) => ({
      ...message,
      id: String(1489260905819600000n + BigInt(index)),
      createdTimestamp: 1_790_000_000_000 + index * 1000,
      content: `Line ${String(index)} ${Math.random().toString(36).repeat(12)}`,
    }));
    const result = await createTranscript(CHANNEL, { messages: long, images: false, maxFileBytes: 42_000 });
    const { payload } = readTranscript(result.html);

    assert.ok(result.bytes <= 42_000, `${String(result.bytes)} bytes`);
    assert.ok(result.truncated > 0 && result.messageCount < long.length);
    assert.equal(result.messageCount + result.truncated, long.length);
    assert.equal(payload.messages.at(-1).id, long.at(-1).id, "the newest message is the one that is kept");
    assert.equal(payload.truncated, result.truncated);
    assert.match(result.html, /^    Messages  \d+ saved, \d+ skipped$/m);
    assert.match(viewer.render(payload, {}), /left out to keep this file within its size limit/);
  });

  it("pages through a channel's history, newest first, and returns it oldest first", async () => {
    const all = sampleMessages();
    const asked = [];
    const channel = {
      ...CHANNEL,
      messages: {
        fetch: ({ limit, before }) => {
          asked.push({ limit, before });
          const newest = [...all].reverse();
          const from = before === undefined ? 0 : newest.findIndex((message) => message.id === before) + 1;

          return Promise.resolve(new Map(newest.slice(from, from + Math.min(limit, 5)).map((message) => [message.id, message])));
        },
      },
    };

    const result = await createTranscript(channel, { limit: 8, images: false });
    const { payload } = readTranscript(result.html);

    assert.equal(payload.messages.length, 5, "a short page means the history ended");
    assert.deepEqual(payload.messages.map((message) => message.id), all.slice(-5).map((message) => message.id));
    assert.equal(asked[0].limit, 8);
  });
});
