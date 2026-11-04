import PageHeader from '../layout/PageHeader';
import { EmptyState } from '../components/States';
import Button from '../components/Button';

export default function NotFound() {
  return (
    <>
      <PageHeader title="Page not found" subtitle="This view doesn’t exist in the DK Operations workspace." />
      <div className="panel">
        <EmptyState title="Nothing here" text="Use the sidebar to return to a workspace view." />
        <Button to="/" variant="primary">
          Back to overview
        </Button>
      </div>
    </>
  );
}
