'use client';

import { useSyncExternalStore } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { App } from '../../src/app/App';
import { AppProviders } from '../../src/app/providers';

export default function SmartInventoryPage() {
  const mounted = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );

  if (!mounted) {
    return <main aria-busy="true"><p className="srOnly">Loading Smart Inventory…</p></main>;
  }

  return (
    <BrowserRouter>
      <AppProviders>
        <App />
      </AppProviders>
    </BrowserRouter>
  );
}
