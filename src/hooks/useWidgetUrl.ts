import { useSearchParams } from 'react-router-dom';
import { useCallback, useMemo } from 'react';

const PARAM_KEY = 'url';
const DEFAULT_WIDGET_URL = import.meta.env.VITE_DEFAULT_WIDGET_URL || '';
const DEFAULT_HOLOBOX_URL =
  import.meta.env.VITE_DEFAULT_HOLOBOX_URL ||
  'https://box.rvtr.ai/?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX25hbWUiOiJ0ZXN0X3VzZXIiLCJ1c2VyX2lkIjoiMWY5YmJjZTEtMzE3NS00MDA1LTljNzAtNDE1MzYwODBjZWU0IiwicHJvamVjdF9pZCI6IjY3ZDY5ZjZjNmYxNmU5ZGYwMTAwMDBhMyIsImV4cCI6MTc3MjQ2NzA2MSwiaWF0IjoxNzcxODY3MDYxfQ.HE7LPiG7t8Akpd3aIaNQzULP_qnrePpVmq78eFAxVUA';

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
