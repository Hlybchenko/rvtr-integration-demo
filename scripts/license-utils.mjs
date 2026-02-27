// ---------------------------------------------------------------------------
// Pure utility functions extracted from agent-option-writer.mjs for testability.
// ---------------------------------------------------------------------------

/** Map voice agent id → ApiServer path segment in the license file */
export const AGENT_TO_PATH_SEGMENT = {
  elevenlabs: 'elevenlabs',
  'gemini-live': 'gemini',
};

/** Reverse: path segment → voice agent id */
export const PATH_SEGMENT_TO_AGENT = {
  elevenlabs: 'elevenlabs',
  gemini: 'gemini-live',
};

export const ALLOWED_AGENTS = new Set(['elevenlabs', 'gemini-live']);

export const LEGACY_ALIASES = new Map([['google-native-audio', 'gemini-live']]);

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

/**
 * Detect encoding from BOM and return decoded string.
 * Supports UTF-16LE (FF FE), UTF-16BE (FE FF), UTF-8 BOM (EF BB BF), plain UTF-8.
 */
export function decodeFileBuffer(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    // UTF-16LE BOM
    return { text: buf.slice(2).toString('utf16le'), encoding: 'utf16le' };
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    // UTF-16BE — swap byte pairs then decode as LE
    const bodyLen = buf.length - 2;
    const evenLen = bodyLen - (bodyLen % 2); // ensure even byte count
    const swapped = Buffer.alloc(evenLen);
    for (let i = 0; i < evenLen; i += 2) {
      swapped[i] = buf[i + 3]; // low byte
      swapped[i + 1] = buf[i + 2]; // high byte
    }
    return { text: swapped.toString('utf16le'), encoding: 'utf16be' };
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { text: buf.slice(3).toString('utf8'), encoding: 'utf8-bom' };
  }
  return { text: buf.toString('utf8'), encoding: 'utf8' };
}

/** Encode string back to original encoding with BOM */
export function encodeToBuffer(text, encoding) {
  if (encoding === 'utf16le') {
    const bom = Buffer.from([0xff, 0xfe]);
    const body = Buffer.from(text, 'utf16le');
    return Buffer.concat([bom, body]);
  }
  if (encoding === 'utf16be') {
    const bom = Buffer.from([0xfe, 0xff]);
    const le = Buffer.from(text, 'utf16le');
    const evenLen = le.length - (le.length % 2);
    const swapped = Buffer.alloc(evenLen);
    for (let i = 0; i < evenLen; i += 2) {
      swapped[i] = le[i + 1];
      swapped[i + 1] = le[i];
    }
    return Buffer.concat([bom, swapped]);
  }
  if (encoding === 'utf8-bom') {
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    return Buffer.concat([bom, Buffer.from(text, 'utf8')]);
  }
  return Buffer.from(text, 'utf8');
}

// ---------------------------------------------------------------------------
// Voice agent helpers
// ---------------------------------------------------------------------------

/** Extract voice agent from ApiServer value like "127.0.0.1:8080/gemini" */
export function extractVoiceAgentFromApiServer(apiServer) {
  if (typeof apiServer !== 'string') return null;

  // Take the last path segment
  const lastSlash = apiServer.lastIndexOf('/');
  if (lastSlash === -1) return null;

  const segment = apiServer.substring(lastSlash + 1).toLowerCase().trim();
  return PATH_SEGMENT_TO_AGENT[segment] ?? null;
}

export function normalizeVoiceAgent(value) {
  if (typeof value !== 'string') return null;
  if (LEGACY_ALIASES.has(value)) return LEGACY_ALIASES.get(value);
  return ALLOWED_AGENTS.has(value) ? value : null;
}
