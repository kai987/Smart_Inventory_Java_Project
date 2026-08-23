import type { Metadata, Viewport } from 'next';
import '../src/styles/tokens.css';
import '../src/styles/global.css';

const description = 'Inventory, customer orders, stock control, and packing estimates in one responsive demo.';

export const metadata: Metadata = {
  title: 'Smart Inventory',
  description,
  openGraph: { title: 'Smart Inventory', description, type: 'website' },
  twitter: { card: 'summary_large_image', title: 'Smart Inventory', description },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#ffffff',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
