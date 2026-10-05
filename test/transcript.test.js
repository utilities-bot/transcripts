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
    assert.ok(html.length < 60_000, `a transcript with no pictures is small (${String(html.length)} bytes)`);
  });

  it("says what it is in plain text at the top", () => {
    const html = buildHtml(collected().payload, { stats: { saved: 3, skipped: 1 } });
    const head = html.slice(0, 600);

    assert.match(head, /Server: Utilities Support \(1374147741403320350\)/);
    assert.match(head, /Channel: ticket-0007/);
    assert.match(head, /Messages: 12/);
    assert.match(head, /Images saved: 3/);
    assert.match(head, /6 - mira\.k/);
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

    assert.equal(stats.skipped, 0);
    assert.equal(stats.saved, wanted.length);
    for (const item of wanted) assert.match(payload.assets[item.url], /^data:image\/png;base64,/);
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
    const posted = wanted.filter((item) => item.tier >= 4);
    const stats = await embedAssets(payload, wanted, { fetch: fakeFetch(calls), maxPictures: 2 });

    assert.ok(posted.length > 2, "the sample has more pictures than the cap");
    assert.deepEqual(posted.map((item) => item.url in payload.assets), posted.map((_, index) => index < 2), "the earliest two, in order");
    assert.equal(stats.skipped, posted.length - 2);
    for (const item of wanted.filter((one) => one.tier < 4)) assert.ok(payload.assets[item.url], `${item.url} is not a posted picture`);
    assert.equal(calls.some((url) => url.includes("banner.png")), false, "a picture past the cap is never downloaded");
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

  it("leaves a GIF as it is, so it stays animated", () => {
    const gif = "https://media.discordapp.net/attachments/1/2/party.gif?ex=1";

    assert.equal(sizedUrl(gif, { width: 4000, height: 3000, maxWidth: 1100, type: "image/gif" }), gif);
    assert.equal(isDiscordUrl(gif), true);
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
    assert.equal(result.participants[0].username, "mira.k");
    assert.equal(verifyTranscript(result.html), "intact");
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
