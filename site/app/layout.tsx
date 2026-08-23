import type { Metadata, Viewport } from 'next';
import '../src/styles/tokens.css';
import '../src/styles/global.css';

const description = 'Inventory, customer orders, stock control, and packing estimates in one responsive demo.';
const siteUrl = 'https://smart-inventory-demo.huamengdiqidiguo.chatgpt.site';
const preferenceInitializer = `(function () {
  var language = 'en';
  var normalizeLanguage = function (value) {
    if (typeof value !== 'string') return null;
    var normalized = value.toLowerCase();
    if (normalized === 'en' || normalized.indexOf('en-') === 0) return 'en';
    if (normalized === 'ja' || normalized.indexOf('ja-') === 0) return 'ja';
    if (normalized === 'zh' || normalized.indexOf('zh-') === 0) return 'zh-CN';
    return null;
  };
  var storedLanguage = null;
  try {
    storedLanguage = window.localStorage.getItem('smart-inventory-language:v1');
  } catch (languageStorageError) {
    storedLanguage = null;
  }
  if (storedLanguage === 'en' || storedLanguage === 'ja' || storedLanguage === 'zh-CN') {
    language = storedLanguage;
  } else {
    try {
      var browserLanguages = Array.isArray(window.navigator.languages)
        ? window.navigator.languages
        : [];
      var languageCandidates = browserLanguages.concat(window.navigator.language || []);
      for (var index = 0; index < languageCandidates.length; index += 1) {
        var detectedLanguage = normalizeLanguage(languageCandidates[index]);
        if (detectedLanguage !== null) {
          language = detectedLanguage;
          break;
        }
      }
    } catch (languageDetectionError) {
      language = 'en';
    }
  }

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
  root.lang = language;
  root.dir = 'ltr';
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
        <script dangerouslySetInnerHTML={{ __html: preferenceInitializer }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
