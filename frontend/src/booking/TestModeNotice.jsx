import Notice from '../components/Notice';
import { useContent } from '../lib/site';

/** Shown throughout the flow until a real payment gateway is connected. */
export default function TestModeNotice({ className }) {
  return <Notice className={className}>{useContent().booking.testModeNotice}</Notice>;
}
