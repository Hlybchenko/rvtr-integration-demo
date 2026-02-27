import { useRouteError, isRouteErrorResponse, useNavigate } from 'react-router-dom';
import styles from './ErrorFallback.module.css';

export function ErrorFallback() {
  const error = useRouteError();
  const navigate = useNavigate();

  const title = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : 'Something went wrong';

  const detail = isRouteErrorResponse(error)
    ? error.data?.message ?? 'Page not found'
    : error instanceof Error
      ? error.message
      : String(error);

  const handleReload = () => {
    window.location.reload();
  };

  const handleGoHome = () => {
    navigate('/', { replace: true });
  };

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.detail}>{detail}</p>

        {error instanceof Error && error.stack && (
          <details className={styles.stackDetails}>
            <summary className={styles.stackSummary}>Stack trace</summary>
            <pre className={styles.stack}>{error.stack}</pre>
          </details>
        )}

        <div className={styles.actions}>
          <button type="button" className={styles.button} onClick={handleReload}>
            Reload page
          </button>
          <button
            type="button"
            className={`${styles.button} ${styles.buttonSecondary}`}
            onClick={handleGoHome}
          >
            Go to settings
          </button>
        </div>
      </div>
    </div>
  );
}
