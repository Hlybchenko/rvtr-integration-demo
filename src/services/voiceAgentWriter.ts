import type { VoiceAgent } from '@/stores/settingsStore';

const WRITER_BASE_URL = 'http://127.0.0.1:3210';
const VALID_AGENTS: VoiceAgent[] = ['elevenlabs', 'gemini-live'];

function isVoiceAgent(value: unknown): value is VoiceAgent {
  return typeof value === 'string' && (VALID_AGENTS as string[]).includes(value);
}

function normalizeVoiceAgent(value: unknown): VoiceAgent | null {
  if (value === 'google-native-audio') return 'gemini-live';
  return isVoiceAgent(value) ? value : null;
}

async function parseJsonSafely(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function ensureOk(response: Response, fallbackMessage: string): Promise<unknown> {
  const payload = await parseJsonSafely(response);

  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error?: unknown }).error ?? fallbackMessage)
        : fallbackMessage;
    throw new Error(message);
  }

  return payload;
}

export interface VoiceAgentFileState {
  voiceAgent: VoiceAgent | null;
  filePath?: string;
}

export async function readVoiceAgentFromFile(): Promise<VoiceAgentFileState> {
  const response = await fetch(`${WRITER_BASE_URL}/voice-agent`);
  const payload = await ensureOk(response, 'Failed to read voice agent option file');
  const payloadRecord = payload && typeof payload === 'object' ? payload : null;

  return {
    voiceAgent: payloadRecord
      ? normalizeVoiceAgent((payloadRecord as { voiceAgent?: unknown }).voiceAgent)
      : null,
    filePath:
      payloadRecord &&
      typeof (payloadRecord as { filePath?: unknown }).filePath === 'string'
        ? ((payloadRecord as { filePath: string }).filePath as string)
        : undefined,
  };
}

export async function writeVoiceAgentToFile(voiceAgent: VoiceAgent): Promise<void> {
  const response = await fetch(`${WRITER_BASE_URL}/voice-agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ voiceAgent }),
  });

  await ensureOk(response, 'Failed to write voice agent option file');
}

export interface VoiceAgentSyncResult {
  matched: boolean;
  fileVoiceAgent: VoiceAgent | null;
  filePath?: string;
}

export interface VoiceAgentForceRewriteResult {
  matched: boolean;
  fileVoiceAgent: VoiceAgent | null;
  filePath?: string;
}

export async function ensureVoiceAgentFileSync(
  selectedVoiceAgent: VoiceAgent,
): Promise<VoiceAgentSyncResult> {
  const current = await readVoiceAgentFromFile();

  if (current.voiceAgent === selectedVoiceAgent) {
    return {
      matched: true,
      fileVoiceAgent: current.voiceAgent,
      filePath: current.filePath,
    };
  }

  await writeVoiceAgentToFile(selectedVoiceAgent);
  const updated = await readVoiceAgentFromFile();

  return {
    matched: updated.voiceAgent === selectedVoiceAgent,
    fileVoiceAgent: updated.voiceAgent,
    filePath: updated.filePath,
  };
}

export async function forceRewriteVoiceAgentFile(
  selectedVoiceAgent: VoiceAgent,
): Promise<VoiceAgentForceRewriteResult> {
  await writeVoiceAgentToFile(selectedVoiceAgent);
  const updated = await readVoiceAgentFromFile();

  return {
    matched: updated.voiceAgent === selectedVoiceAgent,
    fileVoiceAgent: updated.voiceAgent,
    filePath: updated.filePath,
  };
}
