import type { Metadata, Viewport } from 'next';
import '../src/styles/tokens.css';
import '../src/styles/global.css';

const description = 'Inventory, customer orders, stock control, and packing estimates in one responsive demo.';
const siteUrl = 'https://smart-inventory-demo.huamengdiqidiguo.chatgpt.site';
const themeInitializer = `(function () {
  var theme = 'light';
  try {
    var storedTheme = window.localStorage.getItem('smart-inventory-theme:v1');
    theme = storedTheme === 'light' || storedTheme === 'dark'
      ? storedTheme
      : (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  } catch (error) {
    try {
      theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch (mediaError) {
      theme = 'light';
    }
  }
  var root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  var themeColor = theme === 'dark' ? '#08111f' : '#f6f8fb';
  document.querySelectorAll('meta[name="theme-color"]').forEach(function (meta) {
    meta.setAttribute('content', themeColor);
  });
}());`;

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
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f8fb' },
    { media: '(prefers-color-scheme: dark)', color: '#08111f' },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitializer }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
