import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

/** Loads an API path and reloads when it changes. A null path loads nothing. */
export function useResource(path) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loadedPath, setLoadedPath] = useState(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!path) return undefined;
    const controller = new AbortController();
    api(path, { signal: controller.signal })
      .then((result) => {
        setData(result);
        setLoadedPath(path);
        setError('');
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.message);
      });
    return () => controller.abort();
  }, [path, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { data, error, loading: path !== loadedPath && !error, reload };
}
