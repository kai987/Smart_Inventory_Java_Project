import type { Metadata, Viewport } from 'next';
import '../src/styles/tokens.css';
import '../src/styles/global.css';

const description = 'Inventory, customer orders, stock control, and packing estimates in one responsive demo.';
const siteUrl = 'https://smart-inventory-demo.huamengdiqidiguo.chatgpt.site';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: 'Smart Inventory',
  description,
  openGraph: {
    title: 'Smart Inventory',
    description,
    type: 'website',
    url: siteUrl,
    images: [{ url: '/og.png', width: 1586, height: 992, alt: 'Smart Inventory product catalog' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Smart Inventory',
    description,
    images: ['/og.png'],
  },
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
