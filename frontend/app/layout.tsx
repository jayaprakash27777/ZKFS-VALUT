/**
 * app/layout.tsx — Root layout for the ZK File Storage App
 */

import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
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
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen bg-slate-950 text-white antialiased">
        {children}
      </body>
    </html>
  );
}
