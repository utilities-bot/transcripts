// Turning discord.js messages into a transcript's data.
//
// Everything here reads by shape rather than by class, so the package has no
// dependency on discord.js and a test can hand it plain objects. The output is
// plain JSON: what was said, who said it, and a list of the pictures worth
// downloading. Nothing is drawn here — the viewer does that, in the browser.

import { emojiUrl, isDiscordUrl } from "./urls.js";

/** discord.js's MessageType numbers, for the kinds the viewer draws specially. */
const KIND = {
  1: "add",
  2: "remove",
  4: "rename",
  6: "pin",
  7: "join",
  8: "boost",
  9: "boost",
  10: "boost",
  11: "boost",
  18: "thread",
  46: "poll-result",
};

/**
 * How wide each kind of picture is saved, at most: twice what it is drawn at,
 * so it stays sharp on a dense screen and no heavier than that. A picture
 * somebody uploaded has no entry — it may be opened full size to be read, so
 * its width is the exporter's to choose.
 */
const DRAWN = { embed: 880, still: 480, thumbnail: 160, icon: 48 };

/** The permissions worth showing on a profile, most telling first. */
const NOTABLE_PERMISSIONS = [
  "Administrator",
  "ManageGuild",
  "ManageRoles",
  "ManageChannels",
  "ManageMessages",
  "ManageThreads",
  "ManageWebhooks",
  "ManageNicknames",
  "ManageGuildExpressions",
  "KickMembers",
  "BanMembers",
  "ModerateMembers",
  "MentionEveryone",
  "ViewAuditLog",
];

/** How many of somebody's roles their profile card lists. */
const MAX_PROFILE_ROLES = 8;

const list = (value) => {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value;
  if (typeof value.values === "function") return [...value.values()];

  return [];
};
const raw = (value) => (value && typeof value.toJSON === "function" ? value.toJSON() : value);
const text = (value) => (typeof value === "string" ? value : "");
const call = (target, method, ...args) => {
  try {
    return typeof target?.[method] === "function" ? target[method](...args) : undefined;
  } catch {
    return undefined;
  }
};
/** Drops what is empty, so a thousand plain messages are not a thousand empty arrays. */
const lean = (record) => {
  for (const key of Object.keys(record)) {
    const value = record[key];
    if (value === undefined || value === null || value === "" || value === false) delete record[key];
    else if (Array.isArray(value) && value.length === 0) delete record[key];
  }

  return record;
};

function mediaKind(type, name) {
  const mime = text(type).toLowerCase();
  const file = text(name).toLowerCase();
  if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|avif)$/.test(file)) return "image";
  if (mime.startsWith("video/") || /\.(mp4|mov|webm|mkv)$/.test(file)) return "video";
  if (mime.startsWith("audio/") || /\.(mp3|ogg|wav|flac|m4a)$/.test(file)) return "audio";

  return "file";
}

/** `audio/ogg` out of `audio/ogg; codecs=opus`, and nothing that is not sound or video. */
function mediaType(type) {
  const mime = text(type).toLowerCase().split(";")[0].trim();

  return /^(audio|video)\/[a-z0-9.+-]{1,40}$/.test(mime) ? mime : undefined;
}

/** A voice message's waveform: base64 of up to 256 loudness samples, as Discord sends it. */
function waveform(value) {
  const wave = text(value);

  return /^[A-Za-z0-9+/]{4,400}={0,2}$/.test(wave) ? wave : undefined;
}

/**
 * @param {readonly object[]} messages oldest first
 * @param {{ guild?: object, channel?: object, brand?: { name: string, url?: string } }} [context]
 * @returns {{ payload: object, wanted: object[], participants: object[] }}
 */
export function collectTranscript(messages, context = {}) {
  const guild = context.guild ?? context.channel?.guild ?? null;
  const channel = context.channel ?? null;

  const users = {};
  const roles = {};
  const channels = {};
  const counts = new Map();
  /** url → what to download for it. Insertion order is download order within a tier. */
  const wanted = new Map();

  /**
   * Asks for a picture to be embedded. Returns the address the viewer will look it up by.
   *
   * `shape` is what lets the downloader ask Discord for a smaller copy: the
   * picture's own size, and how wide it is ever drawn.
   */
  function want(url, tier, from = url, shape = {}) {
    if (typeof url !== "string" || url === "") return undefined;
    if (!wanted.has(url) && isDiscordUrl(from)) wanted.set(url, lean({ url, from, tier, ...shape }));

    return url;
  }

  function scan(content) {
    const source = text(content);
    for (const match of source.matchAll(/<(a?):\w{2,32}:(\d{15,21})>/g)) {
      want(emojiUrl(match[2], match[1] === "a"), 1);
    }
    for (const match of source.matchAll(/<@!?(\d{15,21})>/g)) mentionUser(match[1]);
    for (const match of source.matchAll(/<@&(\d{15,21})>/g)) mentionRole(match[1]);
    for (const match of source.matchAll(/<#(\d{15,21})>/g)) mentionChannel(match[1]);

    return source;
  }

  function mentionUser(id) {
    if (users[id]) return;
    const member = call(guild?.members?.cache, "get", id);
    const user = member?.user ?? call(guild?.client?.users?.cache, "get", id);
    if (user) person(user, member);
  }

  function mentionRole(id) {
    if (roles[id]) return;
    const role = call(guild?.roles?.cache, "get", id);
    if (role) roles[id] = lean({ name: text(role.name), color: hex(role.color) });
  }

  function mentionChannel(id) {
    if (channels[id]) return;
    const found = call(guild?.channels?.cache, "get", id) ?? call(guild?.client?.channels?.cache, "get", id);
    if (found) channels[id] = { name: text(found.name) };
  }

  /** A member's highest few roles, for their profile card. Never @everyone, whose id is the guild's. */
  function topRoles(member) {
    return list(member?.roles?.cache)
      .filter((role) => String(role.id) !== String(guild?.id))
      .sort((a, b) => (Number(b.position) || 0) - (Number(a.position) || 0))
      .slice(0, MAX_PROFILE_ROLES)
      .map((role) => {
        roles[role.id] ??= lean({ name: text(role.name), color: hex(role.color) });

        return String(role.id);
      });
  }

  /**
   * What somebody may do in the server, for their profile card.
   *
   * An administrator may do everything, so that one word is the whole answer.
   */
  function permissionsOf(member) {
    const held = call(member?.permissions, "toArray");
    if (!Array.isArray(held)) return undefined;
    if (held.includes("Administrator")) return ["Administrator"];

    return NOTABLE_PERMISSIONS.filter((name) => held.includes(name));
  }

  /** Registers somebody and answers the key messages refer to them by. */
  function person(user, given, webhook = false) {
    if (!user) return undefined;
    // A message does not always carry its author's member; the guild usually still knows them.
    const member = given ?? (webhook ? undefined : call(guild?.members?.cache, "get", user.id));
    // A webhook posts under one id and any number of names, so the name is part of who it is.
    const key = webhook ? `${String(user.id)}:${text(user.username)}` : String(user.id);
    if (users[key]) return key;

    const options = { extension: "webp", size: 64, forceStatic: true };
    const avatar =
      call(member, "displayAvatarURL", options) ??
      call(user, "displayAvatarURL", options) ??
      text(user.avatarURL);

    users[key] = lean({
      id: String(user.id),
      name: text(user.username),
      display: text(member?.displayName) || text(user.globalName) || text(user.displayName),
      avatar: want(avatar, 0),
      color: hex(member?.displayColor),
      bot: Boolean(user.bot),
      verified: Boolean(call(user.flags, "has", "VerifiedBot")),
      webhook,
      joined: Number(member?.joinedTimestamp) || undefined,
      roles: topRoles(member),
      perms: permissionsOf(member),
    });
    if (users[key].display === users[key].name) delete users[key].display;

    return key;
  }

  function attachment(item) {
    const kind = mediaKind(item.contentType, item.name);
    const record = lean({
      name: text(item.name),
      size: Number(item.size) || 0,
      kind,
      url: text(item.url),
      w: Number(item.width) || undefined,
      h: Number(item.height) || undefined,
      spoiler: Boolean(item.spoiler) || text(item.name).startsWith("SPOILER_"),
      // Saved as a still, so the viewer marks it as the animation it was.
      gif: kind === "image" && (/gif/i.test(text(item.contentType)) || /\.gif$/i.test(text(item.name))),
      alt: text(item.description),
      // What a player needs: the real type (a saved file is kept as plain
      // bytes), and for a voice message its length and the shape of its sound.
      mime: kind === "audio" || kind === "video" ? mediaType(item.contentType) : undefined,
      secs: kind === "audio" ? Number(item.duration ?? item.duration_secs) || undefined : undefined,
      wave: kind === "audio" ? waveform(item.waveform) : undefined,
    });
    if (kind === "image") {
      want(record.url, 4, text(item.proxyURL) || text(item.url), {
        w: record.w,
        h: record.h,
        type: text(item.contentType),
      });
    } else {
      // Anything else somebody uploaded: saved as it is, after every picture.
      // Its size is already known, which is what lets the downloader leave a
      // file that cannot fit without asking Discord for a single byte of it.
      want(record.url, 5, record.url, { file: true, size: record.size });
    }

    return record;
  }

  function picture(media, tier, draw) {
    if (!media || typeof media.url !== "string") return undefined;
    const proxied = text(media.proxy_url) || text(media.proxyURL) || media.url;
    const width = Number(media.width) || 0;
    const height = Number(media.height) || 0;
    want(media.url, tier, proxied, { w: width, h: height, type: text(media.content_type), draw });

    return lean({ url: media.url, w: width || undefined, h: height || undefined });
  }

  function embed(item) {
    // discord.js hands back its own Embed, whose API-shaped fields are under `data`.
    const plain = raw(item) ?? {};
    const data = plain.data && typeof plain.data === "object" ? plain.data : plain;
    const type = text(data.type) || "rich";
    // A link's preview picture is kept small, beside its text. What a
    // transcript is for is what was said; a preview drawn the way Discord draws
    // it is most of a file's size for a picture nobody posted. A bare GIF or
    // picture link has nothing but its still, so that is saved a little larger.
    const preview = data.thumbnail;
    const bare = (type === "gifv" || type === "image") && !data.title && !data.description;

    return lean({
      type: type === "rich" ? undefined : type,
      title: scan(data.title),
      description: scan(data.description),
      url: text(data.url),
      color: hex(data.color),
      timestamp: data.timestamp ? Date.parse(data.timestamp) || undefined : undefined,
      author: data.author
        ? lean({
            name: text(data.author.name),
            url: text(data.author.url),
            icon: picture({ url: data.author.icon_url, proxy_url: data.author.proxy_icon_url }, 3, DRAWN.icon)?.url,
          })
        : undefined,
      footer: data.footer
        ? lean({
            text: text(data.footer.text),
            icon: picture({ url: data.footer.icon_url, proxy_url: data.footer.proxy_icon_url }, 3, DRAWN.icon)?.url,
          })
        : undefined,
      provider: text(data.provider?.name),
      fields: list(data.fields).map((field) =>
        lean({ name: scan(field.name), value: scan(field.value), inline: Boolean(field.inline) }),
      ),
      image: picture(data.image, 4, DRAWN.embed),
      thumbnail: bare ? picture(preview, 4, DRAWN.still) : picture(preview, 3, DRAWN.thumbnail),
      video: data.video?.url ? { url: text(data.video.url) } : undefined,
    });
  }

  function emoji(value) {
    if (!value) return undefined;
    if (value.id) {
      want(emojiUrl(String(value.id), Boolean(value.animated)), 1);

      return lean({ id: String(value.id), name: text(value.name), animated: Boolean(value.animated) });
    }

    return value.name ? { name: text(value.name) } : undefined;
  }

  /** A component in Discord's own JSON, with its pictures registered. */
  function component(item, files) {
    const data = raw(item) ?? {};
    const out = { type: Number(data.type) };
    const media = (value, draw = DRAWN.embed) => {
      const url = text(value?.url);
      // `attachment://name` points at a file on the same message.
      const named = url.startsWith("attachment://") ? files.get(url.slice(13)) : undefined;
      if (named) return lean({ url: named.url, w: named.w, h: named.h });

      return picture(value, 4, draw);
    };

    switch (out.type) {
      case 1:
        out.components = list(data.components).map((child) => component(child, files));
        break;
      case 2:
        Object.assign(out, {
          style: Number(data.style) || 2,
          label: text(data.label),
          emoji: emoji(data.emoji),
          url: text(data.url),
          disabled: Boolean(data.disabled),
        });
        break;
      case 3:
      case 5:
      case 6:
      case 7:
      case 8: {
        const chosen = list(data.options).find((option) => option.default);
        Object.assign(out, {
          placeholder: text(data.placeholder),
          chosen: chosen ? lean({ label: text(chosen.label), emoji: emoji(chosen.emoji) }) : undefined,
          disabled: Boolean(data.disabled),
        });
        break;
      }
      case 9:
        out.components = list(data.components).map((child) => component(child, files));
        out.accessory = data.accessory ? component(data.accessory, files) : undefined;
        break;
      case 10:
        out.content = scan(data.content);
        break;
      case 11:
        Object.assign(out, {
          // Drawn at 85px, beside a section's text.
          media: media(data.media, DRAWN.thumbnail + 10),
          alt: text(data.description),
          spoiler: Boolean(data.spoiler),
        });
        break;
      case 12:
        out.items = list(data.items).map((entry) =>
          lean({ media: media(entry.media), alt: text(entry.description), spoiler: Boolean(entry.spoiler) }),
        );
        break;
      case 13: {
        const url = text(data.file?.url);
        const named = url.startsWith("attachment://") ? files.get(url.slice(13)) : undefined;
        Object.assign(out, {
          name: named?.name ?? text(data.name) ?? url.split("/").pop(),
          size: named?.size ?? (Number(data.size) || 0),
          url: named?.url ?? url,
          spoiler: Boolean(data.spoiler),
        });
        break;
      }
      case 14:
        out.divider = data.divider !== false;
        out.spacing = Number(data.spacing) || 1;
        break;
      case 17:
        Object.assign(out, {
          color: hex(data.accent_color),
          spoiler: Boolean(data.spoiler),
          components: list(data.components).map((child) => component(child, files)),
        });
        break;
      default:
        out.components = list(data.components).map((child) => component(child, files));
    }

    return lean(out);
  }

  /** The parts a message and a forwarded copy of one have in common. */
  function body(message) {
    const attachments = list(message.attachments).map(attachment);
    const files = new Map(attachments.map((file) => [file.name, file]));

    return {
      content: scan(message.content),
      attachments,
      embeds: list(message.embeds).map(embed),
      components: list(message.components).map((row) => component(row, files)),
      stickers: list(message.stickers).map((sticker) =>
        lean({
          name: text(sticker.name),
          // Lottie stickers are animation data rather than a picture, and are named instead.
          url: Number(sticker.format) === 3 ? undefined : want(text(sticker.url), 2),
        }),
      ),
    };
  }

  const records = messages.map((message) => {
    const webhook = message.webhookId !== null && message.webhookId !== undefined && !message.interactionMetadata;
    const author = person(message.author, message.member, webhook && !message.applicationId);
    if (author) counts.set(author, (counts.get(author) ?? 0) + 1);

    const reference = message.reference;
    const snapshot = list(message.messageSnapshots)[0];
    const forwarded = snapshot
      ? lean({
          ...body(snapshot.message ?? snapshot),
          ts: Number((snapshot.message ?? snapshot).createdTimestamp) || undefined,
          from: reference?.channelId ? String(reference.channelId) : undefined,
        })
      : undefined;
    if (forwarded?.from) mentionChannel(forwarded.from);

    const interaction = message.interactionMetadata ?? message.interaction;
    const poll = message.poll
      ? lean({
          question: text(message.poll.question?.text),
          answers: list(message.poll.answers).map((answer) =>
            lean({
              text: text(answer.text),
              emoji: emoji(answer.emoji),
              votes: Number(answer.voteCount) || 0,
            }),
          ),
        })
      : undefined;

    for (const user of list(message.mentions?.users)) person(user, call(guild?.members?.cache, "get", user.id));

    return lean({
      id: String(message.id),
      kind: KIND[message.type],
      author,
      ts: Number(message.createdTimestamp) || 0,
      edited: Number(message.editedTimestamp) || undefined,
      ...(snapshot ? {} : body(message)),
      reply: !snapshot && reference?.messageId ? String(reference.messageId) : undefined,
      forwarded,
      command: interaction?.user
        ? lean({
            user: person(interaction.user, call(guild?.members?.cache, "get", interaction.user.id)),
            name: text(message.interaction?.commandName) || text(interaction.commandName) || text(interaction.name),
          })
        : undefined,
      reactions: list(message.reactions?.cache ?? message.reactions).map((reaction) =>
        lean({ emoji: emoji(reaction.emoji), count: Number(reaction.count) || 1 }),
      ),
      poll,
      // Who a system line is about: the person added to or removed from a thread.
      target: KIND[message.type] === "add" || KIND[message.type] === "remove"
        ? person(list(message.mentions?.users)[0])
        : undefined,
      pinned: Boolean(message.pinned),
    });
  });

  const icon = call(guild, "iconURL", { extension: "webp", size: 128, forceStatic: true });
  const payload = lean({
    guild: lean({ id: text(guild?.id), name: text(guild?.name), icon: want(text(icon), 0) }),
    channel: lean({ id: text(channel?.id), name: text(channel?.name) }),
    exportedAt: Date.now(),
    brand: context.brand,
    users,
    roles,
    channels,
    messages: records,
    assets: {},
  });

  const participants = [...counts.entries()]
    .sort(([, a], [, b]) => b - a)
    .map(([key, messageCount]) => ({
      userId: users[key].id,
      username: users[key].name,
      messageCount,
    }));

  return {
    payload,
    wanted: [...wanted.values()].sort((a, b) => a.tier - b.tier),
    participants,
  };
}

function hex(color) {
  if (typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase();
  const value = Number(color);
  if (!Number.isInteger(value) || value <= 0 || value > 0xffffff) return undefined;

  return `#${value.toString(16).padStart(6, "0")}`;
}
