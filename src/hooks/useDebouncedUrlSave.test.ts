// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDebouncedUrlSave } from './useDebouncedUrlSave';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useDebouncedUrlSave', () => {
  it('debounce fires after 400ms', async () => {
    const saveFn = vi.fn();
    const { result } = renderHook(() =>
      useDebouncedUrlSave({ storeValue: '', saveFn }),
    );

    act(() => result.current.setInput('http://example.com'));
    expect(saveFn).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(saveFn).toHaveBeenCalledWith('http://example.com');
  });

  it('rapid typing debounces — only last value saved', async () => {
    const saveFn = vi.fn();
    const { result } = renderHook(() =>
      useDebouncedUrlSave({ storeValue: '', saveFn }),
    );

    act(() => result.current.setInput('http://a.com'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    act(() => result.current.setInput('http://b.com'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    act(() => result.current.setInput('http://c.com'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });

    expect(saveFn).toHaveBeenCalledTimes(1);
    expect(saveFn).toHaveBeenCalledWith('http://c.com');
  });

  it('invalid URL not saved', async () => {
    const saveFn = vi.fn();
    const { result } = renderHook(() =>
      useDebouncedUrlSave({ storeValue: '', saveFn }),
    );

    act(() => result.current.setInput('not-a-url'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(saveFn).not.toHaveBeenCalled();
  });

  it('empty input not saved on mount when not dirty', async () => {
    const saveFn = vi.fn();
    renderHook(() => useDebouncedUrlSave({ storeValue: '', saveFn }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(saveFn).not.toHaveBeenCalled();
  });

  it('empty input saved when dirty (user cleared field)', async () => {
    const saveFn = vi.fn();
    const { result } = renderHook(() =>
      useDebouncedUrlSave({ storeValue: 'http://old.com', saveFn }),
    );

    // Type something then clear
    act(() => result.current.setInput('http://temp.com'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    saveFn.mockClear();

    act(() => result.current.setInput(''));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(saveFn).toHaveBeenCalledWith('');
  });

  it('store value match skips save', async () => {
    const saveFn = vi.fn();
    const { result } = renderHook(() =>
      useDebouncedUrlSave({ storeValue: 'http://same.com', saveFn }),
    );

    act(() => result.current.setInput('http://same.com'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(saveFn).not.toHaveBeenCalled();
  });

  it('isSaving is true during debounce window', async () => {
    const saveFn = vi.fn();
    const { result } = renderHook(() =>
      useDebouncedUrlSave({ storeValue: '', saveFn }),
    );

    expect(result.current.isSaving).toBe(false);

    act(() => result.current.setInput('http://example.com'));
    // After state update, isSaving should be true
    expect(result.current.isSaving).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(result.current.isSaving).toBe(false);
  });

  it('saveFn ref stability — changing saveFn does not reset debounce (REGRESSION)', async () => {
    const saveFn1 = vi.fn();
    const saveFn2 = vi.fn();

    const { result, rerender } = renderHook(
      ({ saveFn }) => useDebouncedUrlSave({ storeValue: '', saveFn }),
      { initialProps: { saveFn: saveFn1 } },
    );

    act(() => result.current.setInput('http://example.com'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    // Swap saveFn mid-debounce — should NOT reset timer
    rerender({ saveFn: saveFn2 });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    // Timer fires with the latest saveFn (saveFn2)
    expect(saveFn1).not.toHaveBeenCalled();
    expect(saveFn2).toHaveBeenCalledWith('http://example.com');
  });

  it('cleanup clears timer on unmount', async () => {
    const saveFn = vi.fn();
    const { result, unmount } = renderHook(() =>
      useDebouncedUrlSave({ storeValue: '', saveFn }),
    );

    act(() => result.current.setInput('http://example.com'));
    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(saveFn).not.toHaveBeenCalled();
  });

  it('custom debounceMs fires at custom delay', async () => {
    const saveFn = vi.fn();
    const { result } = renderHook(() =>
      useDebouncedUrlSave({ storeValue: '', saveFn, debounceMs: 100 }),
    );

    act(() => result.current.setInput('http://fast.com'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(saveFn).toHaveBeenCalledWith('http://fast.com');
  });
});
