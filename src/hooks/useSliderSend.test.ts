// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUeControlStore } from '@/stores/ueControlStore';
import { useSliderSend, SLIDER_DEBOUNCE_MS } from './useSliderSend';

// ── helpers ───────────────────────────────────────────────────────────────────

const DEVICE = 'test-device';

function seedStore(url = 'http://ue:8081') {
  const s = useUeControlStore.getState();
  s.setUeApiUrl(url);
  s.updateDeviceSettings(DEVICE, {
    zoom: 0,
    cameraVertical: 0,
    cameraHorizontal: 0,
    cameraPitch: 0,
  });
}

function setSliderInStore(key: string, value: number) {
  useUeControlStore.getState().updateDeviceSettings(DEVICE, { [key]: value });
}

// ── suite ─────────────────────────────────────────────────────────────────────

describe('useSliderSend', () => {
  let sendCommand: ReturnType<typeof vi.fn<(url: string, payload: Record<string, string>) => Promise<boolean>>>;
  /** Collected resolve/reject callbacks for the sendCommand promises */
  let pendingSends: Array<{ resolve: (ok: boolean) => void; reject: (e: Error) => void }>;

  beforeEach(() => {
    vi.useFakeTimers();
    pendingSends = [];
    sendCommand = vi.fn(() => {
      return new Promise<boolean>((resolve, reject) => {
        pendingSends.push({ resolve, reject });
      });
    });
    // Reset Zustand store to defaults
    useUeControlStore.setState({
      ueApiUrl: '',
      deviceSettings: {},
      ueReachable: null,
      ueCommittedCamera: { zoom: 0, cameraVertical: 0, cameraHorizontal: 0, cameraPitch: 0 },
    });
    seedStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function renderSliderHook() {
    return renderHook(() => useSliderSend({ deviceId: DEVICE, sendCommand }));
  }

  // ── 1. Single drag → one send after debounce ─────────────────────────────

  it('sends one command after debounce', async () => {
    const { result } = renderSliderHook();

    act(() => result.current.handleSlider('zoom', 50));

    // Not sent yet
    expect(sendCommand).not.toHaveBeenCalled();

    // Advance past debounce
    await act(async () => { vi.advanceTimersByTime(SLIDER_DEBOUNCE_MS); });

    expect(sendCommand).toHaveBeenCalledOnce();
    expect(sendCommand).toHaveBeenCalledWith('http://ue:8081', {
      command: 'zoom',
      offset: '50',
    });
  });

  // ── 2. Rapid drags → only last value sent ────────────────────────────────

  it('rapid drags on same key send only last value', async () => {
    const { result } = renderSliderHook();

    act(() => {
      result.current.handleSlider('zoom', 10);
      result.current.handleSlider('zoom', 20);
      result.current.handleSlider('zoom', 30);
    });

    await act(async () => { vi.advanceTimersByTime(SLIDER_DEBOUNCE_MS); });

    expect(sendCommand).toHaveBeenCalledOnce();
    expect(sendCommand).toHaveBeenCalledWith('http://ue:8081', {
      command: 'zoom',
      offset: '30',
    });
  });

  // ── 3. Two keys simultaneously → independent sends ───────────────────────

  it('two keys fire independently', async () => {
    const { result } = renderSliderHook();

    act(() => {
      result.current.handleSlider('zoom', 100);
      result.current.handleSlider('cameraPitch', 15);
    });

    await act(async () => { vi.advanceTimersByTime(SLIDER_DEBOUNCE_MS); });

    expect(sendCommand).toHaveBeenCalledTimes(2);

    const calls = sendCommand.mock.calls;
    const commands = calls.map((c: [string, Record<string, string>]) => c[1].command);
    expect(commands).toContain('zoom');
    expect(commands).toContain('cameraPitch');
  });

  // ── 4. Delta = latest store value − baseline ─────────────────────────────

  it('computes delta from store value at fire time, not drag time', async () => {
    const { result } = renderSliderHook();

    // Drag to 40
    act(() => result.current.handleSlider('zoom', 40));

    // Before debounce fires, something updates the store to 60
    setSliderInStore('zoom', 60);

    await act(async () => { vi.advanceTimersByTime(SLIDER_DEBOUNCE_MS); });

    // Delta should be 60 (latest store) − 0 (baseline) = 60
    expect(sendCommand).toHaveBeenCalledWith('http://ue:8081', {
      command: 'zoom',
      offset: '60',
    });
  });

  // ── 5. Success → baseline advances, committed patched ────────────────────

  it('on success, advances baseline and patches committed camera', async () => {
    const { result } = renderSliderHook();

    act(() => result.current.handleSlider('zoom', 50));
    await act(async () => { vi.advanceTimersByTime(SLIDER_DEBOUNCE_MS); });

    // Resolve the in-flight send
    await act(async () => { pendingSends[0]!.resolve(true); });

    expect(useUeControlStore.getState().ueCommittedCamera.zoom).toBe(50);

    // Second drag should compute delta from new baseline (50)
    act(() => result.current.handleSlider('zoom', 80));
    await act(async () => { vi.advanceTimersByTime(SLIDER_DEBOUNCE_MS); });

    expect(sendCommand).toHaveBeenCalledTimes(2);
    expect(sendCommand.mock.calls[1]![1]).toEqual({
      command: 'zoom',
      offset: '30', // 80 − 50
    });
  });

  // ── 6. Failure → baseline reverts ────────────────────────────────────────

  it('on failure, reverts baseline so next send re-includes missed delta', async () => {
    const { result } = renderSliderHook();

    act(() => result.current.handleSlider('zoom', 50));
    await act(async () => { vi.advanceTimersByTime(SLIDER_DEBOUNCE_MS); });

    // Fail the send
    await act(async () => { pendingSends[0]!.resolve(false); });

    // Committed camera should NOT have changed
    expect(useUeControlStore.getState().ueCommittedCamera.zoom).toBe(0);

    // Next drag — delta should still include the previously-missed 50
    act(() => result.current.handleSlider('zoom', 70));
    await act(async () => { vi.advanceTimersByTime(SLIDER_DEBOUNCE_MS); });

    expect(sendCommand.mock.calls[1]![1]).toEqual({
      command: 'zoom',
      offset: '70', // 70 − 0 (reverted baseline)
    });
  });

  // ── 7. In-flight blocks second send ──────────────────────────────────────

  it('blocks concurrent sends on same key', async () => {
    const { result } = renderSliderHook();

    // First drag + fire
    act(() => result.current.handleSlider('zoom', 50));
    await act(async () => { vi.advanceTimersByTime(SLIDER_DEBOUNCE_MS); });
    expect(sendCommand).toHaveBeenCalledOnce();

    // Second drag while first is in-flight
    act(() => result.current.handleSlider('zoom', 80));
    await act(async () => { vi.advanceTimersByTime(SLIDER_DEBOUNCE_MS); });

    // Still only 1 call — second was blocked by in-flight guard
    expect(sendCommand).toHaveBeenCalledOnce();
  });

  // ── 8. After success + slider moved → catch-up fires ─────────────────────

  it('fires catch-up send after success if slider moved during in-flight', async () => {
    const { result } = renderSliderHook();

    // First drag
    act(() => result.current.handleSlider('zoom', 50));
    await act(async () => { vi.advanceTimersByTime(SLIDER_DEBOUNCE_MS); });
    expect(sendCommand).toHaveBeenCalledOnce();

    // Slider moves while in-flight
    setSliderInStore('zoom', 80);

    // Resolve first send → catch-up should fire immediately
    await act(async () => { pendingSends[0]!.resolve(true); });

    expect(sendCommand).toHaveBeenCalledTimes(2);
    expect(sendCommand.mock.calls[1]![1]).toEqual({
      command: 'zoom',
      offset: '30', // 80 − 50
    });
  });

  // ── 9. After failure → NO catch-up ───────────────────────────────────────

  it('does NOT fire catch-up after failure (prevents infinite retry loop)', async () => {
    const { result } = renderSliderHook();

    act(() => result.current.handleSlider('zoom', 50));
    await act(async () => { vi.advanceTimersByTime(SLIDER_DEBOUNCE_MS); });

    // Slider moves while in-flight
    setSliderInStore('zoom', 80);

    // Fail the send
    await act(async () => { pendingSends[0]!.resolve(false); });

    // No catch-up — still only 1 call
    expect(sendCommand).toHaveBeenCalledOnce();
  });

  // ── 10. resetSliderState → seeds baselines, clears timers/in-flight ──────

  it('resetSliderState seeds baselines and clears pending state', async () => {
    const { result } = renderSliderHook();

    // Start a drag (creates a pending timer)
    act(() => result.current.handleSlider('zoom', 50));

    // Reset with a camera position
    act(() => {
      result.current.resetSliderState({
        zoom: 100,
        cameraVertical: 200,
        cameraHorizontal: 300,
        cameraPitch: 10,
      });
    });

    // The pending timer should have been cleared — advancing should NOT fire
    await act(async () => { vi.advanceTimersByTime(SLIDER_DEBOUNCE_MS); });
    expect(sendCommand).not.toHaveBeenCalled();

    // New drag should compute delta from the reset baseline (100)
    act(() => result.current.handleSlider('zoom', 130));
    await act(async () => { vi.advanceTimersByTime(SLIDER_DEBOUNCE_MS); });

    expect(sendCommand).toHaveBeenCalledOnce();
    expect(sendCommand).toHaveBeenCalledWith('http://ue:8081', {
      command: 'zoom',
      offset: '30', // 130 − 100
    });
  });
});
