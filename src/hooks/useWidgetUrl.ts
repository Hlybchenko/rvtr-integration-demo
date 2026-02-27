import { useSearchParams } from 'react-router-dom';
import { useCallback, useMemo } from 'react';

const PARAM_KEY = 'url';
const DEFAULT_WIDGET_URL = import.meta.env.VITE_DEFAULT_WIDGET_URL || '';
const DEFAULT_HOLOBOX_URL = import.meta.env.VITE_DEFAULT_HOLOBOX_URL || '';

/**
 * Sync iframe URL with ?url= query parameter.
 * Priority: query param > env default > empty string.
 */

export function useWidgetUrl() {
  const [searchParams, setSearchParams] = useSearchParams();

  const isHololink =
    window.location.pathname.includes('holobox') ||
    window.location.pathname.includes('kiosk');

  const widgetUrl = useMemo(() => {
    return (
      searchParams.get(PARAM_KEY) ||
      (isHololink ? DEFAULT_HOLOBOX_URL : DEFAULT_WIDGET_URL)
    );
  }, [searchParams, isHololink]);

  const setWidgetUrl = useCallback(
    (url: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (url) {
            next.set(PARAM_KEY, url);
          } else {
            next.delete(PARAM_KEY);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return { widgetUrl, setWidgetUrl } as const;
}
