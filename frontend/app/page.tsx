/**
 * app/page.tsx
 *
 * Root landing page redirects to /login.
 */

'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function RootPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/login');
  }, [router]);

  return (
    <div className="min-h-screen bg-[#09090b] flex items-center justify-center">
      <div className="animate-pulse flex flex-col items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-violet-600 animate-spin" />
        <span className="text-sm text-zinc-500 font-medium">Entering Vault System...</span>
      </div>
    </div>
  );
}
