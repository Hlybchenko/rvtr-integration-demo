import { describe, it, expect } from 'vitest';
import { isStreamingDevice, STREAMING_DEVICE_IDS, migrateSettingsState } from './settingsStore';

// ═══════════════════════════════════════════════════════════════════════════
// isStreamingDevice
// ═══════════════════════════════════════════════════════════════════════════

describe('isStreamingDevice', () => {
  it.each<[string, boolean]>([
    ['holobox', true],
    ['keba-kiosk', true],
    ['kiosk', true],
    ['phone', false],
    ['laptop', false],
    ['', false],
    ['unknown-device', false],
    ['HOLOBOX', false], // case-sensitive
  ])('isStreamingDevice(%j) → %s', (input, expected) => {
    expect(isStreamingDevice(input)).toBe(expected);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// STREAMING_DEVICE_IDS
// ═══════════════════════════════════════════════════════════════════════════

describe('STREAMING_DEVICE_IDS', () => {
  it('contains exactly 3 device IDs', () => {
    expect(STREAMING_DEVICE_IDS).toHaveLength(3);
    expect(STREAMING_DEVICE_IDS).toContain('holobox');
    expect(STREAMING_DEVICE_IDS).toContain('keba-kiosk');
    expect(STREAMING_DEVICE_IDS).toContain('kiosk');
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
      pixelStreamingUrl: '',
      voiceAgent: 'elevenlabs',
      licenseFilePath: '',
      exePath: '',
    });
  });

  describe('v8 → v9 (per-device streaming URLs → pixelStreamingUrl)', () => {
    it('consolidates per-device URLs into single pixelStreamingUrl (holoboxUrl priority)', () => {
      const v8State = {
        phoneUrl: '',
        laptopUrl: '',
        kioskUrl: 'https://kiosk.example.com',
        holoboxUrl: 'https://holobox.example.com',
        kebaKioskUrl: 'https://keba-kiosk.example.com',
        voiceAgent: 'elevenlabs' as const,
        licenseFilePath: '/lic.lic',
      };

      const result = migrate(v8State, 8);

      // holoboxUrl has priority after pixelStreamingUrl
      expect(result.pixelStreamingUrl).toBe('https://holobox.example.com');
    });

    it('prefers pixelStreamingUrl over per-device URLs when present', () => {
      const v8State = {
        phoneUrl: '',
        laptopUrl: '',
        kioskUrl: 'https://kiosk.example.com',
        holoboxUrl: 'https://holobox.example.com',
        kebaKioskUrl: 'https://keba-kiosk.example.com',
        pixelStreamingUrl: 'https://preferred.example.com',
        voiceAgent: 'elevenlabs' as const,
        licenseFilePath: '/lic.lic',
      };

      const result = migrate(v8State, 8);

      expect(result.pixelStreamingUrl).toBe('https://preferred.example.com');
    });

    it('falls back to holoboxUrl when other streaming URLs missing', () => {
      const v8State = {
        phoneUrl: '',
        laptopUrl: '',
        holoboxUrl: 'https://holobox.example.com',
        voiceAgent: 'elevenlabs' as const,
        licenseFilePath: '/lic.lic',
      };

      const result = migrate(v8State, 7);

      expect(result.pixelStreamingUrl).toBe('https://holobox.example.com');
    });

    it('uses empty string when no streaming URLs present', () => {
      const v8State = {
        phoneUrl: '',
        laptopUrl: '',
        voiceAgent: 'elevenlabs' as const,
        licenseFilePath: '/lic.lic',
      };

      const result = migrate(v8State, 8);

      expect(result.pixelStreamingUrl).toBe('');
    });
  });

  describe('v9 → v10 (add exePath)', () => {
    it('resolves exePath from start2streamPath', () => {
      const v9State = {
        phoneUrl: '',
        laptopUrl: '',
        pixelStreamingUrl: 'https://streaming.example.com',
        voiceAgent: 'elevenlabs' as const,
        licenseFilePath: '/lic.lic',
        start2streamPath: '/path/to/start2stream.bat',
      };

      const result = migrate(v9State, 9);
      expect(result.exePath).toBe('/path/to/start2stream.bat');
    });

    it('resolves exePath from deviceExePaths', () => {
      const v9State = {
        phoneUrl: '',
        laptopUrl: '',
        pixelStreamingUrl: '',
        voiceAgent: 'elevenlabs' as const,
        licenseFilePath: '',
        deviceExePaths: { holobox: '/exe/holobox.bat', kiosk: '' },
      };

      const result = migrate(v9State, 9);
      expect(result.exePath).toBe('/exe/holobox.bat');
    });

    it('defaults exePath to empty string when no legacy sources', () => {
      const v9State = {
        phoneUrl: '',
        laptopUrl: '',
        pixelStreamingUrl: '',
        voiceAgent: 'elevenlabs' as const,
        licenseFilePath: '',
      };

      const result = migrate(v9State, 9);
      expect(result.exePath).toBe('');
    });
  });

  describe('v10+ (already migrated)', () => {
    it('preserves all fields when state is v10+', () => {
      const v10State = {
        phoneUrl: 'https://phone.example.com',
        laptopUrl: 'https://laptop.example.com',
        pixelStreamingUrl: 'https://streaming.example.com',
        voiceAgent: 'elevenlabs' as const,
        licenseFilePath: '/lic.lic',
        exePath: '/path/to/exe.bat',
      };

      const result = migrate(v10State, 10);

      expect(result.pixelStreamingUrl).toBe('https://streaming.example.com');
      expect(result.phoneUrl).toBe('https://phone.example.com');
      expect(result.laptopUrl).toBe('https://laptop.example.com');
      expect(result.exePath).toBe('/path/to/exe.bat');
    });

    it('uses defaults for missing v10+ fields', () => {
      const v10State = {
        phoneUrl: 'https://phone.example.com',
        laptopUrl: 'https://laptop.example.com',
        voiceAgent: 'elevenlabs' as const,
      };

      const result = migrate(v10State, 10);

      expect(result.pixelStreamingUrl).toBe('');
      expect(result.licenseFilePath).toBe('');
      expect(result.exePath).toBe('');
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
      // holoboxUrl is consolidated into pixelStreamingUrl
      expect(result.pixelStreamingUrl).toBe('https://holobox.example.com');
    });
  });
});
