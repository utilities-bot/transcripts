// Packing a transcript's data, and proving it has not been changed.
//
// The data is JSON, gzipped, then written as base64. That makes it small and
// keeps it out of the way of anybody idly editing the file, but it is not a
// lock: base64 can be decoded by anyone. What catches an edit is the
// signature — an Ed25519 signature over the exact compressed bytes, made with
// a private key that only the exporter holds.

import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as signBytes,
  verify as verifyBytes,
} from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

/** Bumped only when a viewer could not read an older file. */
export const FORMAT_VERSION = 1;

/** The first bytes of every Ed25519 public key in SPKI form; the key itself is the 32 after. */
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/**
 * A new key pair, as two base64 strings.
 *
 * The private key goes in the exporter's environment and nowhere else. The
 * public key is not a secret: it is written into every file, and whoever
 * checks a transcript compares it with the one they already trust.
 */
export function generateKeys() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");

  return {
    privateKey: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
    publicKey: rawPublicKey(publicKey),
  };
}

function rawPublicKey(publicKey) {
  return publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64");
}

/** A private key from base64 PKCS#8 (what `generateKeys` prints) or from PEM. */
function privateKeyFrom(value) {
  const text = String(value).trim();
  if (text.startsWith("-----BEGIN")) return createPrivateKey(text);

  return createPrivateKey({ key: Buffer.from(text, "base64"), type: "pkcs8", format: "der" });
}

function publicKeyFrom(base64) {
  const raw = Buffer.from(String(base64), "base64");
  if (raw.length !== 32) throw new Error("A transcript public key is 32 bytes.");

  return createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw]), type: "spki", format: "der" });
}

/**
 * The envelope a file carries: the packed data, and the signature when there
 * is a key to sign with.
 *
 * @param {object} payload the transcript's data
 * @param {{ signingKey?: string }} [options]
 */
export function pack(payload, options = {}) {
  const compressed = gzipSync(Buffer.from(JSON.stringify(payload), "utf8"), { level: 9 });
  const envelope = { v: FORMAT_VERSION, enc: "gzip+base64", data: compressed.toString("base64") };

  if (options.signingKey !== undefined && options.signingKey !== "") {
    const key = privateKeyFrom(options.signingKey);
    envelope.alg = "Ed25519";
    envelope.sig = signBytes(null, compressed, key).toString("base64");
    envelope.key = rawPublicKey(createPublicKey(key));
  }

  return envelope;
}

/** The data inside an envelope. Throws when it is not a transcript this version reads. */
export function unpack(envelope) {
  if (envelope === null || typeof envelope !== "object") throw new Error("Not a transcript.");
  if (envelope.v !== FORMAT_VERSION) {
    throw new Error(`Transcript format ${String(envelope.v)} is not one this version reads.`);
  }
  if (envelope.enc !== "gzip+base64" || typeof envelope.data !== "string") {
    throw new Error("Not a transcript.");
  }

  return JSON.parse(gunzipSync(Buffer.from(envelope.data, "base64")).toString("utf8"));
}

/**
 * Whether an envelope is exactly what its exporter signed.
 *
 * `trustedKeys` is the part that matters. A file carries its own public key,
 * so a forger can re-sign an edited file with a key of their own and it will
 * be internally consistent. It is only *verified* when the key it was signed
 * with is one the checker already knew.
 *
 * @param {object} envelope
 * @param {{ trustedKeys?: readonly string[] }} [options]
 * @returns {"verified" | "intact" | "modified" | "unsigned"}
 *   verified — signed by a trusted key and unchanged
 *   intact   — the signature matches, by a key nobody vouched for
 *   modified — the data does not match its signature
 *   unsigned — there is no signature to check
 */
export function verify(envelope, options = {}) {
  if (envelope === null || typeof envelope !== "object") return "modified";
  if (typeof envelope.sig !== "string" || typeof envelope.key !== "string") return "unsigned";
  if (typeof envelope.data !== "string") return "modified";

  let matches = false;
  try {
    matches = verifyBytes(
      null,
      Buffer.from(envelope.data, "base64"),
      publicKeyFrom(envelope.key),
      Buffer.from(envelope.sig, "base64"),
    );
  } catch {
    return "modified";
  }
  if (!matches) return "modified";

  return (options.trustedKeys ?? []).includes(envelope.key) ? "verified" : "intact";
}
