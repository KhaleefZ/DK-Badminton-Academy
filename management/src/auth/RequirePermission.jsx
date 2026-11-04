import { useCan } from './AuthContext';
import PageHeader from '../layout/PageHeader';
import Notice from '../components/Notice';

/** Explains a page this role can't open. The server refuses the data either way. */
export default function RequirePermission({ permission, children }) {
  const can = useCan();
  if (can(permission)) return children;
  return (
    <>
      <PageHeader title="No access" subtitle="Your role doesn’t include this page." />
      <Notice tone="warning">Ask the academy owner if you need access.</Notice>
    </>
  );
}
