/**
 * app/layout.tsx — Root layout for the ZK File Storage App
 */

import type { Metadata } from 'next';
import { Inter, Outfit } from 'next/font/google';
import './globals.css';
import { GlobalErrorBoundary } from '@/components/ui/GlobalErrorBoundary';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

const outfit = Outfit({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-outfit',
});

export const metadata: Metadata = {
  title: {
    default:  'ZKFS — Zero-Knowledge File Storage',
    template: '%s | ZKFS',
  },
  description:
    'End-to-end encrypted file storage. Your files are encrypted in your browser ' +
    'before they ever reach our servers. We can never see your data.',
  keywords: ['zero knowledge', 'encrypted storage', 'e2ee', 'privacy', 'secure files'],
  authors: [{ name: 'IIT Jammu' }],
  openGraph: {
    type:        'website',
    title:       'ZKFS — Zero-Knowledge File Storage',
    description: 'End-to-end encrypted file storage system built at IIT Jammu.',
    locale:      'en_US',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${outfit.variable}`}>
      <body className="min-h-screen bg-[#050505] text-white antialiased">
        <GlobalErrorBoundary>
          {children}
        </GlobalErrorBoundary>
      </body>
    </html>
  );
}
