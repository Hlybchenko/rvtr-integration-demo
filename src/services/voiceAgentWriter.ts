import type { VoiceAgent } from '@/stores/settingsStore';

const WRITER_BASE_URL = 'http://127.0.0.1:3210';
const VALID_AGENTS: VoiceAgent[] = ['elevenlabs', 'gemini-live'];

function isVoiceAgent(value: unknown): value is VoiceAgent {
  return typeof value === 'string' && (VALID_AGENTS as string[]).includes(value);
}

export interface VoiceAgentFileState {
  voiceAgent: VoiceAgent | null;
  filePath?: string;
}

export async function readVoiceAgentFromFile(): Promise<VoiceAgentFileState> {
  const response = await fetch(`${WRITER_BASE_URL}/voice-agent`);
  const payload = await response.json();

  return {
    voiceAgent: isVoiceAgent(payload?.voiceAgent) ? payload.voiceAgent : null,
    filePath: typeof payload?.filePath === 'string' ? payload.filePath : undefined,
  };
}

export async function writeVoiceAgentToFile(voiceAgent: VoiceAgent): Promise<void> {
  await fetch(`${WRITER_BASE_URL}/voice-agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ voiceAgent }),
  });
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
