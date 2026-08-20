import type { Metadata, Viewport } from 'next';

import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Gigachad',
  description: 'Customer communication platform: live chat, email, knowledge base.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The widget and dashboard both have to stay usable with mobile browser chrome
  // visible, so the viewport covers the safe areas rather than fighting them.
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
