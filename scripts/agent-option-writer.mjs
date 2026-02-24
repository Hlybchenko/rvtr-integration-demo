import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 3210;
const ALLOWED_AGENTS = new Set(['elevenlabs', 'gemini-live']);
const desktopFilePath = path.join(os.homedir(), 'Desktop', 'rvtr-agent-option.txt');

function parseVoiceAgentFromContent(content) {
  const match = content.match(/^voice_agent=(.+)$/m);
  if (!match || !match[1]) return null;
  const value = match[1].trim();
  return ALLOWED_AGENTS.has(value) ? value : null;
}

async function readVoiceAgentOption() {
  try {
    const content = await fs.readFile(desktopFilePath, 'utf8');
    return parseVoiceAgentFromContent(content);
  } catch {
    return null;
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(payload));
}

async function writeAgentOption(agent) {
  const content = `voice_agent=${agent}\nupdated_at=${new Date().toISOString()}\n`;
  await fs.writeFile(desktopFilePath, content, 'utf8');
}

const server = createServer(async (req, res) => {
  if (!req.url) {
    sendJson(res, 400, { ok: false, error: 'Invalid request URL' });
    return;
  }

  if (req.method === 'OPTIONS') {
    sendJson(res, 204, { ok: true });
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    sendJson(res, 200, { ok: true, filePath: desktopFilePath });
    return;
  }

  if (req.method === 'GET' && req.url === '/voice-agent') {
    const voiceAgent = await readVoiceAgentOption();
    sendJson(res, 200, {
      ok: true,
      filePath: desktopFilePath,
      voiceAgent,
      matchesKnownOption: Boolean(voiceAgent),
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/voice-agent') {
    let rawBody = '';

    req.on('data', (chunk) => {
      rawBody += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const body = JSON.parse(rawBody || '{}');
        const voiceAgent = typeof body.voiceAgent === 'string' ? body.voiceAgent : '';

        if (!ALLOWED_AGENTS.has(voiceAgent)) {
          sendJson(res, 400, { ok: false, error: 'Unsupported voiceAgent value' });
          return;
        }

        await writeAgentOption(voiceAgent);
        sendJson(res, 200, { ok: true, filePath: desktopFilePath, voiceAgent });
      } catch (error) {
        sendJson(res, 500, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    return;
  }

  sendJson(res, 404, { ok: false, error: 'Not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[agent-option-writer] listening on http://127.0.0.1:${PORT}`);
  console.log(`[agent-option-writer] target file: ${desktopFilePath}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
