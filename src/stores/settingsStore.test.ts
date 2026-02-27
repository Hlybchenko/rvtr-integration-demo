import { describe, it, expect } from 'vitest';
import { isStreamDevice, STREAM_DEVICE_IDS, migrateSettingsState } from './settingsStore';
import type { StreamDeviceId } from './settingsStore';

// ═══════════════════════════════════════════════════════════════════════════
// isStreamDevice
// ═══════════════════════════════════════════════════════════════════════════

describe('isStreamDevice', () => {
  it.each<[string, boolean]>([
    ['holobox', true],
    ['keba-kiosk', true],
    ['kiosk', true],
    ['phone', false],
    ['laptop', false],
    ['', false],
    ['unknown-device', false],
    ['HOLOBOX', false], // case-sensitive
  ])('isStreamDevice(%j) → %s', (input, expected) => {
    expect(isStreamDevice(input)).toBe(expected);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// STREAM_DEVICE_IDS
// ═══════════════════════════════════════════════════════════════════════════

describe('STREAM_DEVICE_IDS', () => {
  it('contains exactly 3 device IDs', () => {
    expect(STREAM_DEVICE_IDS).toHaveLength(3);
    expect(STREAM_DEVICE_IDS).toContain('holobox');
    expect(STREAM_DEVICE_IDS).toContain('keba-kiosk');
    expect(STREAM_DEVICE_IDS).toContain('kiosk');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// persist migration
// ═══════════════════════════════════════════════════════════════════════════

const migrate = migrateSettingsState;

describe('persist migration', () => {
  it('returns defaults when state is null/undefined', () => {
    const result = migrate(undefined, 7);
    expect(result).toMatchObject({
      phoneUrl: '',
      laptopUrl: '',
      kioskUrl: '',
      holoboxUrl: '',
      kebaKioskUrl: '',
      voiceAgent: 'elevenlabs',
      licenseFilePath: '',
      deviceExePaths: { holobox: '', 'keba-kiosk': '', kiosk: '' },
    });
  });

  describe('v7 → v8 (start2streamPath → deviceExePaths)', () => {
    it('replicates single start2streamPath to all 3 devices', () => {
      const oldState = {
        phoneUrl: '',
        laptopUrl: '',
        kioskUrl: '',
        holoboxUrl: '',
        kebaKioskUrl: '',
        voiceAgent: 'elevenlabs' as const,
        licenseFilePath: '/lic.lic',
        start2streamPath: '/legacy/stream.exe',
      };

      const result = migrate(oldState, 7);
      const exePaths = (result as { deviceExePaths: Record<StreamDeviceId, string> }).deviceExePaths;

      expect(exePaths.holobox).toBe('/legacy/stream.exe');
      expect(exePaths['keba-kiosk']).toBe('/legacy/stream.exe');
      expect(exePaths.kiosk).toBe('/legacy/stream.exe');
    });

    it('uses empty strings when no legacy path exists', () => {
      const oldState = {
        phoneUrl: '',
        laptopUrl: '',
        kioskUrl: '',
        holoboxUrl: '',
        kebaKioskUrl: '',
        voiceAgent: 'elevenlabs' as const,
        licenseFilePath: '',
      };

      const result = migrate(oldState, 7);
      const exePaths = (result as { deviceExePaths: Record<StreamDeviceId, string> }).deviceExePaths;

      expect(exePaths.holobox).toBe('');
      expect(exePaths['keba-kiosk']).toBe('');
      expect(exePaths.kiosk).toBe('');
    });

    it('preserves existing deviceExePaths when already present', () => {
      const stateWithPaths = {
        phoneUrl: '',
        laptopUrl: '',
        kioskUrl: '',
        holoboxUrl: '',
        kebaKioskUrl: '',
        voiceAgent: 'elevenlabs' as const,
        licenseFilePath: '',
        deviceExePaths: {
          holobox: '/a.bat',
          'keba-kiosk': '/b.bat',
          kiosk: '/c.bat',
        },
      };

      const result = migrate(stateWithPaths, 8);
      const exePaths = (result as { deviceExePaths: Record<StreamDeviceId, string> }).deviceExePaths;

      expect(exePaths.holobox).toBe('/a.bat');
      expect(exePaths['keba-kiosk']).toBe('/b.bat');
      expect(exePaths.kiosk).toBe('/c.bat');
    });

    it('handles partial deviceExePaths (fills missing with empty)', () => {
      const partial = {
        phoneUrl: '',
        laptopUrl: '',
        kioskUrl: '',
        holoboxUrl: '',
        kebaKioskUrl: '',
        voiceAgent: 'elevenlabs' as const,
        licenseFilePath: '',
        deviceExePaths: { holobox: '/a.bat' },
      };

      const result = migrate(partial, 7);
      const exePaths = (result as { deviceExePaths: Record<StreamDeviceId, string> }).deviceExePaths;

      expect(exePaths.holobox).toBe('/a.bat');
      expect(exePaths['keba-kiosk']).toBe('');
      expect(exePaths.kiosk).toBe('');
    });
  });

  describe('voice agent normalization', () => {
    it('normalizes google-native-audio to gemini-live', () => {
      const state = {
        phoneUrl: '',
        laptopUrl: '',
        kioskUrl: '',
        holoboxUrl: '',
        kebaKioskUrl: '',
        voiceAgent: 'google-native-audio',
        licenseFilePath: '',
      };

      const result = migrate(state, 7);
      expect((result as { voiceAgent: string }).voiceAgent).toBe('gemini-live');
    });

    it('defaults to elevenlabs for unknown agent', () => {
      const state = {
        phoneUrl: '',
        laptopUrl: '',
        kioskUrl: '',
        holoboxUrl: '',
        kebaKioskUrl: '',
        voiceAgent: 'unknown-agent',
        licenseFilePath: '',
      };

      const result = migrate(state, 7);
      expect((result as { voiceAgent: string }).voiceAgent).toBe('elevenlabs');
    });

    it('preserves valid voice agents', () => {
      for (const agent of ['elevenlabs', 'gemini-live']) {
        const state = {
          phoneUrl: '',
          laptopUrl: '',
          kioskUrl: '',
          holoboxUrl: '',
          kebaKioskUrl: '',
          voiceAgent: agent,
          licenseFilePath: '',
        };
        const result = migrate(state, 7);
        expect((result as { voiceAgent: string }).voiceAgent).toBe(agent);
      }
    });
  });

  describe('v1 legacy migration', () => {
    it('maps widgetUrl to phone and laptop URLs', () => {
      const v1State = {
        widgetUrl: 'https://widget.example.com',
        holoboxUrl: 'https://holobox.example.com',
      };

      const result = migrate(v1State, 1) as Record<string, unknown>;

      expect(result.phoneUrl).toBe('https://widget.example.com');
      expect(result.laptopUrl).toBe('https://widget.example.com');
      expect(result.kioskUrl).toBe('https://holobox.example.com');
      expect(result.holoboxUrl).toBe('https://holobox.example.com');
    });
  });
});
