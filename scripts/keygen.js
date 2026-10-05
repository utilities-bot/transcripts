// Prints a new signing key pair.
//
//   npm run keygen
//
// The private key goes in the exporter's environment and nowhere else — never
// in a repository, a chat or a log. The public key is not a secret.

import { generateKeys } from "../src/index.js";

const { privateKey, publicKey } = generateKeys();

process.stdout.write(
  [
    "Private key — keep it secret, set it where the exporter runs:",
    privateKey,
    "",
    "Public key — safe to share; whoever checks a transcript trusts this:",
    publicKey,
    "",
  ].join("\n"),
);
