import { useEffect, useState } from 'react';
import { api } from '../lib/api';

/** Plans, batches and courts open for joining online. Loaded once and shared by the plan cards and the join form. */
export function useMembershipOptions() {
  const [options, setOptions] = useState(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    api('/memberships/options', { signal: controller.signal })
      .then(setOptions)
      .catch((err) => err.name !== 'AbortError' && setLoadError(err.message));
    return () => controller.abort();
  }, []);

  return { options, loadError };
}
