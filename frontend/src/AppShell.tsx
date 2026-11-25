// The dashboard shell, loaded only for app routes. Imported after the key vault is unlocked (see App.tsx),
// so every synchronous key read inside the app sees the decrypted key, as before.
import { Layout } from './components/Layout';
import { AccountProvider } from './lib/account';

export default function AppShell() {
  return (
    <AccountProvider>
      <Layout />
    </AccountProvider>
  );
}
