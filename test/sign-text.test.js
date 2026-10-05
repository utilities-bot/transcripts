import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { generateKeys, signText, verifyText } from "../src/index.js";

/**
 * A signature on a link. The site that shows transcripts checks it with
 * WebCrypto rather than with this package, so the last test checks it the
 * same way: a raw 32-byte key, a base64url signature, the text's UTF-8 bytes.
 */
describe("signing a piece of text", () => {
  const keys = generateKeys();
  const text = "transcript-link/v1/333333333333333333/1490000000000000001";

  it("is verified by the matching public key", () => {
    assert.equal(verifyText(text, signText(text, keys.privateKey), keys.publicKey), true);
  });

  it("is safe to put in a link", () => {
    assert.match(signText(text, keys.privateKey), /^[A-Za-z0-9_-]{86}$/);
  });

  it("does not verify for different text", () => {
    const signature = signText(text, keys.privateKey);

    assert.equal(verifyText(text.replace("1490", "1491"), signature, keys.publicKey), false);
  });

  it("does not verify under somebody else's key", () => {
    const signature = signText(text, generateKeys().privateKey);

    assert.equal(verifyText(text, signature, keys.publicKey), false);
  });

  it("answers false, rather than throwing, for a signature that is not one", () => {
    assert.equal(verifyText(text, "../../x", keys.publicKey), false);
    assert.equal(verifyText(text, "", keys.publicKey), false);
  });

  it("is verified by WebCrypto, which is what the site uses", async () => {
    const signature = signText(text, keys.privateKey);
    const key = await crypto.subtle.importKey(
      "raw",
      Buffer.from(keys.publicKey, "base64"),
      { name: "Ed25519" },
      false,
      ["verify"],
    );

    const ok = await crypto.subtle.verify(
      "Ed25519",
      key,
      Buffer.from(signature, "base64url"),
      new TextEncoder().encode(text),
    );

    assert.equal(ok, true);
  });
});
