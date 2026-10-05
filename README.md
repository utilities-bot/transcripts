# Transcripts

Exports a Discord channel as **one HTML file** that looks like Discord and needs
nothing else to open: the messages, the pictures and the viewer are all inside
it. Built for the [Utilities](https://utilities.best) ticket bot.

- **Self-contained.** No script, stylesheet or font is loaded to draw it. It
  opens from a Discord download, from a website, or from a backup years later.
- **Pictures are saved.** Images, GIFs, avatars, custom emoji and stickers are
  written into the file, so they outlive Discord's expiring links. Videos, audio
  and other files are listed with their name and size, and are not saved.
- **Draws what Discord draws.** Replies, forwarded messages, slash-command
  lines, embeds, buttons, select menus, containers and the other layout
  components, reactions, polls, system lines, and Discord's markdown.
- **Signed.** Each file can carry an Ed25519 signature, so a changed file says
  "Modified" instead of passing as the original.
- **No dependencies**, and no discord.js import: messages are read by shape.

## Install

```bash
npm install github:utilities-bot/transcripts
```

Node 20 or newer.

## Use

```js
import { createTranscript } from "utilities-transcripts";

const { html, messageCount, participants, images } = await createTranscript(channel, {
  limit: 1000,                                  // newest messages; null for all
  signingKey: process.env.TRANSCRIPT_SIGNING_KEY,
  brand: { name: "Utilities", url: "https://utilities.best" },
});

await logChannel.send({
  files: [{ attachment: Buffer.from(html, "utf8"), name: `transcript-${channel.name}.html` }],
});
```

`images` reports `{ saved, skipped, bytes }`. Pictures are skipped when the
budget is full, when Discord no longer has them, or when they are not hosted by
Discord.

### Size

A bot can upload 10 MB to an ordinary server, so pictures have a budget:
6.5 MB in total and 4 MB each by default (`maxTotalBytes`, `maxSingleBytes`).
Small things everybody sees are saved first (avatars, emoji), then pictures in
the order they were posted. Pictures wider than 1100 px are scaled down by
Discord's own media proxy before download (`maxImageWidth`), which is why no
image library is needed. GIFs are left alone so they stay animated.

### Signing

```bash
npm run keygen
```

prints a private key and a public key. Put the private key in the exporter's
environment (never in a repository). The public key is not a secret.

```js
import { verifyTranscript } from "utilities-transcripts";

verifyTranscript(html, { trustedKeys: [PUBLIC_KEY] });
// "verified" | "intact" | "modified" | "unsigned"
```

What the signature does and does not promise:

- The data is gzipped and base64-encoded. That keeps it compact and out of the
  way, but **base64 is not a lock** — anyone can decode it. The signature is
  what detects a change.
- A file carries its own public key, so opened on its own it can only say
  **Unchanged** ("matches the signature it came with"). Somebody determined
  could edit a file and re-sign it with a key of their own.
- **Verified** means the signing key is one the checker already trusted. That
  check belongs on a server you control: pass your public key as `trustedKeys`
  and treat only `"verified"` as genuine.

### Showing a transcript on a website

Serve the file as it is, or draw it inside a page of your own with the same
viewer the files use:

```html
<link rel="stylesheet" href="/viewer.css">
<div id="transcript"></div>
<script src="/viewer.js"></script>
<script>
  // `envelope` is the JSON inside the file's <script id="transcript-data"> block;
  // readTranscript(html).envelope returns it on a server.
  UtilTranscript.mount(document.getElementById("transcript"), envelope, { trustedKeys: [PUBLIC_KEY] });
</script>
```

`src/viewer/viewer.js` and `src/viewer/viewer.css` are plain files with no
build step. Everything from a message is escaped before it reaches the page, and
every address is checked before it becomes a link or a picture.

## Development

```bash
npm test          # node's own test runner; no network
npm run sample    # writes sample/transcript-sample.html — open it in a browser
```

## Licence

MIT.
