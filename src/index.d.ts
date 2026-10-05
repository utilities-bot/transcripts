/** What a signature check found. */
export type TranscriptStatus =
  /** Signed by a key the checker already trusted, and unchanged. */
  | "verified"
  /** Matches its signature, by a key nobody vouched for. */
  | "intact"
  /** Does not match its signature: the file was changed. */
  | "modified"
  /** Carries no signature, so a change cannot be detected. */
  | "unsigned";

export interface TranscriptParticipant {
  readonly userId: string;
  readonly username: string;
  readonly messageCount: number;
}

export interface ImageStats {
  /** Pictures written into the file. */
  readonly saved: number;
  /** Pictures left as links: over the budget, gone, or not Discord's. */
  readonly skipped: number;
  /** Bytes of pictures saved, before encoding. */
  readonly bytes: number;
}

export interface TranscriptBrand {
  readonly name: string;
  readonly url?: string;
}

export interface CreateTranscriptOptions {
  /** Newest messages to include. Default 1000; null for the whole channel. */
  readonly limit?: number | null;
  /** Messages already in hand, oldest first. Skips fetching. */
  readonly messages?: readonly unknown[];
  /** Ed25519 private key, base64 PKCS#8 (what `generateKeys` returns) or PEM. Unsigned without one. */
  readonly signingKey?: string;
  /** Download pictures into the file. Default true. */
  readonly images?: boolean;
  /** How pictures are downloaded. Default the global `fetch`. Only Discord's hosts are ever asked. */
  readonly fetch?: typeof fetch;
  /** Budget for all pictures together, in bytes. Default 6.5 MB, sized for a 10 MB upload. */
  readonly maxTotalBytes?: number;
  /** The largest single picture, in bytes. Default 4 MB. */
  readonly maxSingleBytes?: number;
  /** Wider pictures are scaled down to this by Discord before download. Default 1100. */
  readonly maxImageWidth?: number;
  /** Credited in the transcript's footer. */
  readonly brand?: TranscriptBrand;
}

export interface CreatedTranscript {
  /** The whole file: data, styles and viewer in one document. */
  readonly html: string;
  readonly messageCount: number;
  /** Busiest first. */
  readonly participants: readonly TranscriptParticipant[];
  readonly images: ImageStats;
}

/** The packed form a file carries. */
export interface TranscriptEnvelope {
  readonly v: number;
  readonly enc: "gzip+base64";
  readonly data: string;
  readonly alg?: "Ed25519";
  readonly sig?: string;
  readonly key?: string;
}

/** A transcript's data. Plain JSON; see README for the shape. */
export type TranscriptPayload = Record<string, unknown> & {
  readonly messages: readonly Record<string, unknown>[];
  readonly assets: Record<string, string>;
};

export interface WantedAsset {
  readonly url: string;
  readonly from: string;
  readonly tier: number;
}

/** Exports a discord.js text channel or thread as one self-contained HTML file. */
export function createTranscript(
  channel: unknown,
  options?: CreateTranscriptOptions,
): Promise<CreatedTranscript>;

/** Whether a transcript file is what its exporter signed. */
export function verifyTranscript(
  html: string,
  options?: { readonly trustedKeys?: readonly string[] },
): TranscriptStatus;

/** Reads a transcript file back. Throws when it is not one. */
export function readTranscript(html: string): {
  readonly envelope: TranscriptEnvelope;
  readonly payload: TranscriptPayload;
};

/** A new Ed25519 key pair, as base64. The private key is a secret; the public key is not. */
export function generateKeys(): { readonly privateKey: string; readonly publicKey: string };

export function collectTranscript(
  messages: readonly unknown[],
  context?: {
    readonly guild?: unknown;
    readonly channel?: unknown;
    readonly maxImageWidth?: number;
    readonly brand?: TranscriptBrand;
  },
): {
  readonly payload: TranscriptPayload;
  readonly wanted: readonly WantedAsset[];
  readonly participants: readonly TranscriptParticipant[];
};

export function embedAssets(
  payload: TranscriptPayload,
  wanted: readonly WantedAsset[],
  options?: {
    readonly fetch?: typeof fetch;
    readonly maxTotalBytes?: number;
    readonly maxSingleBytes?: number;
    readonly timeoutMs?: number;
    readonly concurrency?: number;
  },
): Promise<ImageStats>;

export function buildHtml(
  payload: TranscriptPayload,
  options?: { readonly signingKey?: string; readonly stats?: Pick<ImageStats, "saved" | "skipped"> },
): string;

export function pack(payload: unknown, options?: { readonly signingKey?: string }): TranscriptEnvelope;
export function unpack(envelope: TranscriptEnvelope): TranscriptPayload;
export function verify(
  envelope: TranscriptEnvelope,
  options?: { readonly trustedKeys?: readonly string[] },
): TranscriptStatus;

export const FORMAT_VERSION: number;
