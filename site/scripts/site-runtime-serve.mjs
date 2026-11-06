import { createLocalSiteRuntime } from './site-runtime.mjs';

const args = process.argv.slice(2);
if (args.length !== 1 || !/^--port=\d+$/.test(args[0])) throw new Error('Use --port=<unprivileged loopback port>.');
const runtime = await createLocalSiteRuntime({ port: Number(args[0].slice('--port='.length)) });
try {
  // Match the shared Java/Rust browser fixture only in this new local database.
  // The separate API integration command covers the normal expanded catalog.
  await runtime.execute("DELETE FROM products WHERE id NOT IN ('P001','P002','P003','P004')");
  console.log(`Isolated Site runtime ready at ${runtime.baseURL}; D1/R2 state is temporary.`);
} catch (error) { await runtime.close(); throw error; }
