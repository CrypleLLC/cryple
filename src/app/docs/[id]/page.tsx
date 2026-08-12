'use client';

import { use } from 'react';
import DocumentWorkspace from '@/components/documents/DocumentWorkspace';
import SessionGate from '@/components/SessionGate';

export default function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  return (
    <SessionGate>
      <DocumentWorkspace id={id} />
    </SessionGate>
  );
}
