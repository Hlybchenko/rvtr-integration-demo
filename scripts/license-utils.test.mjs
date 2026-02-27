import { describe, it, expect } from 'vitest';
import {
  decodeFileBuffer,
  encodeToBuffer,
  extractVoiceAgentFromApiServer,
  normalizeVoiceAgent,
  AGENT_TO_PATH_SEGMENT,
  PATH_SEGMENT_TO_AGENT,
} from './license-utils.mjs';

// ═══════════════════════════════════════════════════════════════════════════
// decodeFileBuffer
// ═══════════════════════════════════════════════════════════════════════════

describe('decodeFileBuffer', () => {
  it('decodes plain UTF-8 (no BOM)', () => {
    const buf = Buffer.from('Hello World', 'utf8');
    const result = decodeFileBuffer(buf);
    expect(result.text).toBe('Hello World');
    expect(result.encoding).toBe('utf8');
  });

  it('decodes UTF-8 with BOM (EF BB BF)', () => {
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    const body = Buffer.from('Hello BOM', 'utf8');
    const buf = Buffer.concat([bom, body]);
    const result = decodeFileBuffer(buf);
    expect(result.text).toBe('Hello BOM');
    expect(result.encoding).toBe('utf8-bom');
  });

  it('decodes UTF-16LE with BOM (FF FE)', () => {
    const bom = Buffer.from([0xff, 0xfe]);
    const body = Buffer.from('Test', 'utf16le');
    const buf = Buffer.concat([bom, body]);
    const result = decodeFileBuffer(buf);
    expect(result.text).toBe('Test');
    expect(result.encoding).toBe('utf16le');
  });

  it('decodes UTF-16BE with BOM (FE FF)', () => {
    // Create UTF-16BE: BOM + big-endian bytes
    // "Hi" in UTF-16BE: 00 48 00 69
    const buf = Buffer.from([0xfe, 0xff, 0x00, 0x48, 0x00, 0x69]);
    const result = decodeFileBuffer(buf);
    expect(result.text).toBe('Hi');
    expect(result.encoding).toBe('utf16be');
  });

  it('handles empty buffer', () => {
    const result = decodeFileBuffer(Buffer.alloc(0));
    expect(result.text).toBe('');
    expect(result.encoding).toBe('utf8');
  });

  it('handles 1-byte buffer (too short for BOM)', () => {
    const result = decodeFileBuffer(Buffer.from([0xff]));
    expect(result.encoding).toBe('utf8');
  });

  it('handles odd-length UTF-16BE body gracefully', () => {
    // BOM (2 bytes) + 3 body bytes (odd) — should snap to 2 bytes
    const buf = Buffer.from([0xfe, 0xff, 0x00, 0x41, 0x00]);
    const result = decodeFileBuffer(buf);
    // Only first 2 body bytes (one char) should be decoded
    expect(result.text).toBe('A');
    expect(result.encoding).toBe('utf16be');
  });

  it('decodes JSON content in UTF-16LE', () => {
    const json = JSON.stringify({ ApiServer: '127.0.0.1:8080/gemini' });
    const bom = Buffer.from([0xff, 0xfe]);
    const body = Buffer.from(json, 'utf16le');
    const buf = Buffer.concat([bom, body]);

    const result = decodeFileBuffer(buf);
    const parsed = JSON.parse(result.text);
    expect(parsed.ApiServer).toBe('127.0.0.1:8080/gemini');
    expect(result.encoding).toBe('utf16le');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// encodeToBuffer
// ═══════════════════════════════════════════════════════════════════════════

describe('encodeToBuffer', () => {
  it('encodes plain UTF-8 (no BOM)', () => {
    const buf = encodeToBuffer('Hello', 'utf8');
    expect(buf.toString('utf8')).toBe('Hello');
    // No BOM
    expect(buf[0]).not.toBe(0xef);
  });

  it('encodes UTF-8 with BOM', () => {
    const buf = encodeToBuffer('Hello', 'utf8-bom');
    expect(buf[0]).toBe(0xef);
    expect(buf[1]).toBe(0xbb);
    expect(buf[2]).toBe(0xbf);
    expect(buf.slice(3).toString('utf8')).toBe('Hello');
  });

  it('encodes UTF-16LE with BOM', () => {
    const buf = encodeToBuffer('Hi', 'utf16le');
    expect(buf[0]).toBe(0xff);
    expect(buf[1]).toBe(0xfe);
    expect(buf.slice(2).toString('utf16le')).toBe('Hi');
  });

  it('encodes UTF-16BE with BOM', () => {
    const buf = encodeToBuffer('Hi', 'utf16be');
    expect(buf[0]).toBe(0xfe);
    expect(buf[1]).toBe(0xff);
    // "Hi" in UTF-16BE: 00 48 00 69
    expect(buf[2]).toBe(0x00);
    expect(buf[3]).toBe(0x48);
    expect(buf[4]).toBe(0x00);
    expect(buf[5]).toBe(0x69);
  });

  it('falls back to plain UTF-8 for unknown encoding', () => {
    const buf = encodeToBuffer('Test', 'unknown-encoding');
    expect(buf.toString('utf8')).toBe('Test');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Roundtrip: decode → encode → decode
// ═══════════════════════════════════════════════════════════════════════════

describe('encoding roundtrip', () => {
  const testText = '{"ApiServer":"127.0.0.1:8080/gemini","Key":"Value"}';

  for (const encoding of ['utf8', 'utf8-bom', 'utf16le', 'utf16be']) {
    it(`roundtrips ${encoding}`, () => {
      const encoded = encodeToBuffer(testText, encoding);
      const decoded = decodeFileBuffer(encoded);
      expect(decoded.text).toBe(testText);
      expect(decoded.encoding).toBe(encoding);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// extractVoiceAgentFromApiServer
// ═══════════════════════════════════════════════════════════════════════════

describe('extractVoiceAgentFromApiServer', () => {
  it('extracts gemini-live from /gemini', () => {
    expect(extractVoiceAgentFromApiServer('127.0.0.1:8080/gemini')).toBe('gemini-live');
  });

  it('extracts elevenlabs from /elevenlabs', () => {
    expect(extractVoiceAgentFromApiServer('127.0.0.1:8080/elevenlabs')).toBe('elevenlabs');
  });

  it('handles URLs with multiple slashes (takes last segment)', () => {
    expect(extractVoiceAgentFromApiServer('http://host/api/v1/gemini')).toBe('gemini-live');
  });

  it('returns null for unknown segment', () => {
    expect(extractVoiceAgentFromApiServer('127.0.0.1:8080/unknown')).toBeNull();
  });

  it('returns null for no slash', () => {
    expect(extractVoiceAgentFromApiServer('no-slash-here')).toBeNull();
  });

  it('returns null for non-string input', () => {
    expect(extractVoiceAgentFromApiServer(null)).toBeNull();
    expect(extractVoiceAgentFromApiServer(undefined)).toBeNull();
    expect(extractVoiceAgentFromApiServer(42)).toBeNull();
    expect(extractVoiceAgentFromApiServer({})).toBeNull();
  });

  it('normalizes uppercase', () => {
    expect(extractVoiceAgentFromApiServer('127.0.0.1/GEMINI')).toBe('gemini-live');
    expect(extractVoiceAgentFromApiServer('127.0.0.1/ElevenLabs')).toBe('elevenlabs');
  });

  it('handles trailing spaces', () => {
    expect(extractVoiceAgentFromApiServer('127.0.0.1/gemini  ')).toBe('gemini-live');
  });

  it('returns null for empty string after slash', () => {
    expect(extractVoiceAgentFromApiServer('127.0.0.1/')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// normalizeVoiceAgent
// ═══════════════════════════════════════════════════════════════════════════

describe('normalizeVoiceAgent', () => {
  it('returns elevenlabs for elevenlabs', () => {
    expect(normalizeVoiceAgent('elevenlabs')).toBe('elevenlabs');
  });

  it('returns gemini-live for gemini-live', () => {
    expect(normalizeVoiceAgent('gemini-live')).toBe('gemini-live');
  });

  it('maps legacy google-native-audio to gemini-live', () => {
    expect(normalizeVoiceAgent('google-native-audio')).toBe('gemini-live');
  });

  it('returns null for unknown string', () => {
    expect(normalizeVoiceAgent('unknown')).toBeNull();
    expect(normalizeVoiceAgent('')).toBeNull();
  });

  it('returns null for non-string input', () => {
    expect(normalizeVoiceAgent(null)).toBeNull();
    expect(normalizeVoiceAgent(undefined)).toBeNull();
    expect(normalizeVoiceAgent(42)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

describe('mapping constants', () => {
  it('AGENT_TO_PATH_SEGMENT and PATH_SEGMENT_TO_AGENT are inverse', () => {
    for (const [agent, segment] of Object.entries(AGENT_TO_PATH_SEGMENT)) {
      expect(PATH_SEGMENT_TO_AGENT[segment]).toBe(agent);
    }
    for (const [segment, agent] of Object.entries(PATH_SEGMENT_TO_AGENT)) {
      expect(AGENT_TO_PATH_SEGMENT[agent]).toBe(segment);
    }
  });
});
