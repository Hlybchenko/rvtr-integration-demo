import { useState, useCallback, type FormEvent } from 'react';
import { useWidgetUrl } from '@/hooks/useWidgetUrl';
import styles from './TopBar.module.css';

interface TopBarProps {
  pageName?: string;
  iframeRef?: React.RefObject<HTMLIFrameElement | null>;
}

export function TopBar({ pageName, iframeRef }: TopBarProps) {
  const { widgetUrl, setWidgetUrl } = useWidgetUrl();
  const [inputValue, setInputValue] = useState(widgetUrl);

  // Sync input when widgetUrl changes externally
  // (kept simple — no useEffect to avoid loops)

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      setWidgetUrl(inputValue.trim());
    },
    [inputValue, setWidgetUrl],
  );

  const handleReload = useCallback(() => {
    if (iframeRef?.current) {
      // Force reload by resetting src
      const src = iframeRef.current.src;
      iframeRef.current.src = '';
      requestAnimationFrame(() => {
        if (iframeRef.current) iframeRef.current.src = src;
      });
    }
  }, [iframeRef]);

  const handleCopyLink = useCallback(() => {
    void navigator.clipboard.writeText(window.location.href);
  }, []);

  return (
    <form className={styles.topBar} onSubmit={handleSubmit} role="search">
      {pageName && <span className={styles.pageName}>{pageName}</span>}

      <input
        className={styles.urlInput}
        type="url"
        placeholder="Widget URL (https://…)"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        aria-label="Widget iframe URL"
      />

      <button type="submit" className={`${styles.btn} ${styles.btnAccent}`}>
        Load
      </button>

      <button
        type="button"
        className={styles.btn}
        onClick={handleReload}
        aria-label="Reload iframe"
      >
        ↻ Reload
      </button>

      <button
        type="button"
        className={styles.btn}
        onClick={handleCopyLink}
        aria-label="Copy shareable link"
      >
        🔗 Copy Link
      </button>
    </form>
  );
}
