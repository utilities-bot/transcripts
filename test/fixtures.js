// A made-up ticket, shaped like the discord.js objects the collector reads.
//
// Used by the tests and by `npm run sample`. Every picture address is a
// Discord one, because those are the only ones the exporter will download, and
// `fakeFetch` answers them with pictures drawn here — so neither the tests nor
// the sample touch the network.

import { deflateSync } from "node:zlib";

const CRC = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }

  return (bytes) => {
    let c = 0xffffffff;
    for (const byte of bytes) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);

    return (c ^ 0xffffffff) >>> 0;
  };
})();

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(CRC(Buffer.concat([head.subarray(4), data])), 0);

  return Buffer.concat([head, data, crc]);
}

/** A PNG with a diagonal gradient between two colours. Enough to look like a picture. */
export function png(width, height, [r1, g1, b1], [r2, g2, b2]) {
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x += 1) {
      const t = (x / width + y / height) / 2;
      const ring = Math.hypot(x - width * 0.7, y - height * 0.35) < Math.min(width, height) * 0.18 ? 38 : 0;
      rows[row + 1 + x * 3] = Math.min(255, Math.round(r1 + (r2 - r1) * t) + ring);
      rows[row + 2 + x * 3] = Math.min(255, Math.round(g1 + (g2 - g1) * t) + ring);
      rows[row + 3 + x * 3] = Math.min(255, Math.round(b1 + (b2 - b1) * t) + ring);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const CDN = "https://cdn.discordapp.com";
const MEDIA = "https://media.discordapp.net";

const IDS = {
  guild: "1374147741403320350",
  channel: "1489260905819541635",
  bot: "1359000000000000001",
  mira: "497562304498368513",
  jonas: "612345678901234567",
  staffRole: "1374150000000000001",
  rules: "1374150000000000002",
  emoji: "1374160000000000001",
};

/** Every picture the fixture mentions, and what it looks like. */
const PICTURES = new Map([
  [`${CDN}/icons/${IDS.guild}/icon.webp`, () => png(128, 128, [88, 101, 242], [166, 228, 245])],
  [`${CDN}/avatars/${IDS.bot}/a.webp`, () => png(64, 64, [20, 24, 32], [166, 228, 245])],
  [`${CDN}/avatars/${IDS.mira}/a.webp`, () => png(64, 64, [240, 120, 90], [250, 200, 120])],
  [`${CDN}/avatars/${IDS.jonas}/a.webp`, () => png(64, 64, [60, 170, 120], [30, 90, 160])],
  [`${CDN}/emojis/${IDS.emoji}.webp`, () => png(48, 48, [87, 211, 140], [35, 165, 90])],
  [`${MEDIA}/attachments/1/10/checkout-error.png`, () => png(880, 520, [38, 42, 54], [92, 70, 140])],
  [`${MEDIA}/attachments/1/11/order-page.png`, () => png(640, 440, [28, 60, 90], [80, 150, 190])],
  [`${MEDIA}/attachments/1/12/receipt.png`, () => png(640, 440, [70, 50, 40], [200, 150, 90])],
  [`${MEDIA}/attachments/1/13/banner.png`, () => png(800, 260, [24, 26, 34], [88, 101, 242])],
  [`${MEDIA}/external/thumb/premium.png`, () => png(160, 160, [241, 196, 15], [200, 120, 20])],
  // A file that is not a picture. The video beside it in the sample is not here: Discord no
  // longer has it, which is what a file that cannot be saved looks like.
  [`${CDN}/attachments/1/20/orders-export.csv`, () => Buffer.from("order,amount\nUT-48213,4.99\nUT-48213,4.99\n")],
]);

/** A `fetch` that knows only the fixture's pictures. */
export function fakeFetch(calls = []) {
  return (input) => {
    const url = new URL(String(input));
    calls.push(url.toString());
    const draw = PICTURES.get(`${url.origin}${url.pathname}`);
    if (draw === undefined) return Promise.resolve(new Response("gone", { status: 404 }));

    const type = url.pathname.endsWith(".csv") ? "text/csv" : "image/png";

    return Promise.resolve(new Response(draw(), { status: 200, headers: { "content-type": type } }));
  };
}

function user(id, username, extra = {}) {
  return {
    id,
    username,
    bot: false,
    flags: { has: (flag) => flag === "VerifiedBot" && extra.verified === true },
    displayAvatarURL: () => `${CDN}/avatars/${id}/a.webp`,
    ...extra,
  };
}

const BOT = user(IDS.bot, "Utilities", { bot: true, verified: true, globalName: "Utilities" });
const MIRA = user(IDS.mira, "mira.k", { globalName: "Mira" });
const JONAS = user(IDS.jonas, "jonas", { globalName: "Jonas" });

/** Every member holds @everyone, whose id is the guild's. It is never listed on a profile. */
const EVERYONE = { id: IDS.guild, name: "@everyone", color: 0, position: 0 };

const MEMBERS = new Map([
  [IDS.bot, { user: BOT, displayName: "Utilities", displayColor: 0xa6e4f5, joinedTimestamp: Date.UTC(2025, 2, 14), roles: { cache: [] } }],
  [IDS.mira, { user: MIRA, displayName: "Mira", displayColor: 0, joinedTimestamp: Date.UTC(2026, 6, 2), roles: { cache: [EVERYONE] } }],
  [
    IDS.jonas,
    {
      user: JONAS,
      displayName: "Jonas",
      displayColor: 0xf1c40f,
      joinedTimestamp: Date.UTC(2025, 3, 9),
      permissions: { toArray: () => ["SendMessages", "KickMembers", "ManageMessages", "ViewChannel"] },
      roles: { cache: [EVERYONE, { id: IDS.staffRole, name: "Support Team", color: 0xf1c40f, position: 5 }, { id: "1374150000000000009", name: "Billing", color: 0x57d38c, position: 3 }] },
    },
  ],
]);

export const GUILD = {
  id: IDS.guild,
  name: "Utilities Support",
  iconURL: () => `${CDN}/icons/${IDS.guild}/icon.webp`,
  members: { cache: MEMBERS },
  roles: { cache: new Map([[IDS.staffRole, { name: "Support Team", color: 0xf1c40f }]]) },
  channels: { cache: new Map([[IDS.rules, { name: "rules" }]]) },
};

export const CHANNEL = { id: IDS.channel, name: "ticket-0007", guild: GUILD };

const START = Date.UTC(2026, 9, 5, 14, 2, 0);
let clock = START;
let serial = 1489260905819541700n;

function message(author, fields = {}) {
  clock += fields.gap ?? 45_000;
  serial += 1n;

  return {
    id: String(serial),
    type: 0,
    author,
    member: MEMBERS.get(author.id),
    content: "",
    createdTimestamp: clock,
    editedTimestamp: null,
    attachments: [],
    embeds: [],
    components: [],
    stickers: [],
    reactions: { cache: [] },
    mentions: { users: [] },
    webhookId: null,
    ...fields,
  };
}

function image(name, width, height, extra = {}) {
  const folder = { "checkout-error.png": 10, "order-page.png": 11, "receipt.png": 12, "banner.png": 13 }[name];

  return {
    name,
    size: width * height,
    contentType: "image/png",
    width,
    height,
    url: `${CDN}/attachments/1/${String(folder)}/${name}?ex=1&is=2&hm=3`,
    proxyURL: `${MEDIA}/attachments/1/${String(folder)}/${name}?ex=1&is=2&hm=3`,
    ...extra,
  };
}

/** The ticket, oldest first. */
export function sampleMessages() {
  clock = START;
  serial = 1489260905819541700n;

  const opened = message(BOT, {
    gap: 0,
    flags: { has: () => true },
    components: [
      {
        type: 17,
        accent_color: 0xa6e4f5,
        components: [
          {
            type: 9,
            components: [
              { type: 10, content: `## Billing support\nHey <@${IDS.mira}>, thanks for opening a ticket. Somebody from <@&${IDS.staffRole}> will be with you shortly.` },
              { type: 10, content: "-# Please describe the problem and include screenshots if you have any." },
            ],
            accessory: { type: 11, media: { url: `${MEDIA}/external/thumb/premium.png`, width: 160, height: 160 } },
          },
          { type: 14, divider: true, spacing: 1 },
          { type: 10, content: `**Topic:** Premium was charged twice\n**Opened:** <t:${String(Math.floor(START / 1000))}:f>` },
          {
            type: 1,
            components: [
              { type: 2, style: 4, label: "Close", emoji: { name: "🔒" }, custom_id: "close" },
              { type: 2, style: 2, label: "Claim", custom_id: "claim" },
              { type: 2, style: 5, label: "Refund policy", url: "https://utilities.best/refunds" },
            ],
          },
        ],
      },
    ],
  });

  const problem = message(MIRA, {
    content:
      "Hi! I bought **Tier 1** yesterday and my card was charged *twice* <:verified:" +
      IDS.emoji +
      ">\nThe second charge shows as `pending`. I read <#" +
      IDS.rules +
      "> first, I promise 😅\n> Order `UT-48213`, both at 14:02\n\nWhat I tried:\n- Refreshing the order page\n- Waiting a day\n  - still pending",
    reactions: { cache: [{ emoji: { name: "👀" }, count: 2 }, { emoji: { id: IDS.emoji, name: "verified" }, count: 1 }] },
  });

  const screenshot = message(MIRA, {
    gap: 20_000,
    content: "Here is what I see at checkout:",
    attachments: [image("checkout-error.png", 1760, 1040)],
  });

  const claimed = message(BOT, {
    interactionMetadata: { user: JONAS },
    interaction: { commandName: "ticket claim", user: JONAS },
    embeds: [
      {
        data: {
          type: "rich",
          color: 0x57d38c,
          author: { name: "Ticket claimed", icon_url: `${CDN}/avatars/${IDS.jonas}/a.webp` },
          description: `<@${IDS.jonas}> is now handling this ticket.`,
          fields: [
            { name: "Priority", value: "Normal", inline: true },
            { name: "Category", value: "Billing", inline: true },
            { name: "Status", value: "`Open`", inline: true },
          ],
          thumbnail: { url: `${MEDIA}/external/thumb/premium.png`, width: 160, height: 160 },
          footer: { text: "Utilities" },
          timestamp: new Date(clock).toISOString(),
        },
      },
    ],
  });

  const reply = message(JONAS, {
    type: 19,
    reference: { messageId: problem.id, channelId: IDS.channel, type: 0 },
    content: "Thanks Mira, I can see both charges. The pending one will **never settle**, it drops off by itself in a few days.\nCould you send the order page and your receipt so I can attach them to the case?",
    editedTimestamp: clock + 30_000,
  });

  const pictures = message(MIRA, {
    content: "Sure, here you go",
    attachments: [image("order-page.png", 1280, 880), image("receipt.png", 1280, 880, { spoiler: true, name: "SPOILER_receipt.png" })],
  });
  pictures.attachments[1].url = pictures.attachments[1].url.replace("SPOILER_receipt.png", "receipt.png");
  pictures.attachments[1].proxyURL = pictures.attachments[1].proxyURL.replace("SPOILER_receipt.png", "receipt.png");

  const extras = message(MIRA, {
    gap: 15_000,
    content: "And the full export, in case it helps. The card ends in ||4421||.",
    attachments: [
      { name: "orders-export.csv", size: 41, contentType: "text/csv", url: `${CDN}/attachments/1/20/orders-export.csv?ex=1` },
      { name: "screen-recording.mp4", size: 4_812_330, contentType: "video/mp4", url: `${CDN}/attachments/1/21/screen-recording.mp4?ex=1` },
    ],
  });

  const forwarded = message(JONAS, {
    reference: { messageId: "1489000000000000001", channelId: IDS.rules, type: 1 },
    messageSnapshots: [
      {
        message: {
          content: "**Duplicate charges:** a pending charge that never settles is released by the bank within 3 to 5 working days. No refund is needed.",
          createdTimestamp: START - 86_400_000 * 12,
          attachments: [image("banner.png", 800, 260)],
          embeds: [],
          components: [],
          stickers: [],
        },
      },
    ],
  });

  const menu = message(BOT, {
    content: "How would you rate the help you got?",
    components: [
      {
        type: 1,
        components: [
          {
            type: 3,
            custom_id: "rate",
            placeholder: "Choose a rating",
            options: [{ label: "Great", value: "5", emoji: { name: "⭐" } }],
          },
        ],
      },
      {
        type: 1,
        components: [
          { type: 2, style: 3, label: "Solved", custom_id: "ok" },
          { type: 2, style: 1, label: "I still need help", custom_id: "more" },
          { type: 2, style: 2, label: "Transcript", custom_id: "t", disabled: true },
        ],
      },
    ],
  });

  const pinned = message(JONAS, { type: 6, reference: { messageId: reply.id } });
  const thanks = message(MIRA, { gap: 86_400_000, content: "It dropped off this morning. Thank you!" });
  const jumbo = message(MIRA, { gap: 4_000, content: "🎉" });

  return [opened, problem, screenshot, claimed, reply, pictures, extras, forwarded, menu, pinned, thanks, jumbo];
}

export const SAMPLE_IDS = IDS;
