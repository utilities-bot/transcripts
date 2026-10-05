// Writes sample/transcript-sample.html: a made-up ticket showing every kind of
// message the viewer draws. Open the file in a browser to see it.
//
//   npm run sample

import { mkdirSync, writeFileSync } from "node:fs";

import { createTranscript, generateKeys } from "../src/index.js";
import { CHANNEL, fakeFetch, sampleMessages } from "../test/fixtures.js";

const out = new URL("../sample/", import.meta.url);
mkdirSync(out, { recursive: true });

const result = await createTranscript(CHANNEL, {
  messages: sampleMessages(),
  // A throwaway key: the sample only has to show what a signed file looks like.
  signingKey: generateKeys().privateKey,
  fetch: fakeFetch(),
  brand: { name: "Utilities", url: "https://utilities.best" },
});

const file = new URL("transcript-sample.html", out);
writeFileSync(file, result.html);

process.stdout.write(
  `Wrote ${decodeURIComponent(file.pathname)}\n` +
    `  ${String(result.messageCount)} messages, ${String(result.images.saved)} images saved, ` +
    `${String(result.images.skipped)} not saved, ${String(Math.round(result.html.length / 1024))} KB\n`,
);
