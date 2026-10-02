import { lstat, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, sep } from 'node:path'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const frontendDirectory = resolve(scriptDirectory, '..')
const backend = process.env.SMART_INVENTORY_BACKEND ?? 'java'
if (backend !== 'java' && backend !== 'rust') {
  throw new Error('SMART_INVENTORY_BACKEND must be java or rust.')
}
// Only these two generated directories can be reset. Never delete an arbitrary
// SMART_INVENTORY_DATA_DIR inherited from a developer's shell.
const dataDirectory = resolve(frontendDirectory, backend === 'rust' ? '.playwright-data-rust' : '.playwright-data')

if (!dataDirectory.startsWith(`${frontendDirectory}${sep}`) || dataDirectory === frontendDirectory) {
  throw new Error('Refusing to reset data outside the frontend directory.')
}

if (process.env.SMART_INVENTORY_DATA_DIR !== undefined
    && resolve(process.env.SMART_INVENTORY_DATA_DIR) !== dataDirectory) {
  throw new Error('Refusing to reset data: configured directory is not the isolated E2E directory.')
}

const existing = await lstat(dataDirectory).catch((error) => {
  if (error.code === 'ENOENT') return undefined
  throw error
})
if (existing?.isSymbolicLink()) {
  throw new Error('Refusing to reset a symlinked E2E data directory.')
}

await rm(dataDirectory, { recursive: true, force: true })
