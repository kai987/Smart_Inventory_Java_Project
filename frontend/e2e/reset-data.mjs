import { rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, sep } from 'node:path'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const frontendDirectory = resolve(scriptDirectory, '..')
const dataDirectory = resolve(frontendDirectory, '.playwright-data')

if (!dataDirectory.startsWith(`${frontendDirectory}${sep}`) || dataDirectory === frontendDirectory) {
  throw new Error('Refusing to reset data outside the frontend directory.')
}

await rm(dataDirectory, { recursive: true, force: true })
