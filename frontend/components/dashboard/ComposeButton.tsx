import Link from 'next/link';

import { ComposeIcon } from '@/components/ui/Icons';

export default function ComposeButton() {
  return (
    <Link href="/dashboard/compose" className="compose-btn">
      <ComposeIcon size={18} />
      <span>Compose</span>
    </Link>
  );
}