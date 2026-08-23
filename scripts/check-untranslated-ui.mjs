import { readFile, readdir } from 'node:fs/promises'
import { dirname, extname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = resolve(repositoryRoot, 'frontend/src')
const scanRoots = ['app', 'auth', 'components', 'features', 'pages', 'theme']
const sourceExtensions = new Set(['.ts', '.tsx'])

const allowedVisibleText = [
  /^Smart Inventory$/,
  /^(ADMIN|CUSTOMER)$/,
  /^(Product|Order) ID$/,
  /^(Laptop|Mouse|Keyboard|Monitor)$/,
  /^(admin|customer|admin123|user123)$/,
  /^[A-Z][0-9]{3,}$/,
]

function isAllowed(value) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length === 0 || !/[A-Za-z]/.test(normalized)) return true
  return allowedVisibleText.some((pattern) => pattern.test(normalized))
}

async function listSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) return listSourceFiles(path)
    if (!entry.isFile() || !sourceExtensions.has(extname(entry.name))) return []
    if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) return []
    return [path]
  }))
  return nested.flat()
}

function lineNumberAt(contents, index) {
  return contents.slice(0, index).split('\n').length
}

function collectMatches(file, contents) {
  const matches = []
  const seen = new Set()
  const patterns = [
    {
      kind: 'JSX text',
      expression: />\s*([^<>{}\n]*[A-Za-z][^<>{}\n]*)\s*</g,
      valueGroup: 1,
    },
    {
      kind: 'visible attribute',
      expression: /\b(?:aria-label|aria-description|title|placeholder|alt|label|description)\s*=\s*["']([^"']*[A-Za-z][^"']*)["']/g,
      valueGroup: 1,
    },
    {
      kind: 'notification',
      expression: /\b(?:showToast|alert|confirm)\s*\(\s*["'`]([^"'`]*[A-Za-z][^"'`]*)["'`]/g,
      valueGroup: 1,
    },
  ]

  for (const { kind, expression, valueGroup } of patterns) {
    for (const match of contents.matchAll(expression)) {
      const value = match[valueGroup].replace(/\s+/g, ' ').trim()
      if (kind === 'JSX text') {
        const start = match.index ?? 0
        if (contents[start - 1] === '=') continue
        if (/^(?:type|const|let|var|return|if|for|while|switch|case|function|export|import)\b/.test(value)) continue
        if (/^[A-Za-z_$][\w$]*(?:\.[\w$]+)+$/.test(value)) continue
        if (/^[A-Za-z_$][\w$]*\([^)]*\)$/.test(value)) continue
      }
      if (isAllowed(value)) continue
      const line = lineNumberAt(contents, match.index ?? 0)
      const identity = `${line}:${value}`
      if (seen.has(identity)) continue
      seen.add(identity)
      matches.push({ file, kind, line, value })
    }
  }
  return matches
}

const files = (await Promise.all(scanRoots.map((directory) => listSourceFiles(resolve(sourceRoot, directory))))).flat()
const findings = []
for (const file of files) {
  findings.push(...collectMatches(file, await readFile(file, 'utf8')))
}

if (findings.length > 0) {
  console.error('Untranslated UI check failed:')
  for (const finding of findings) {
    console.error(`- ${relative(repositoryRoot, finding.file)}:${finding.line} [${finding.kind}] ${finding.value}`)
  }
  process.exitCode = 1
} else {
  console.log(`Untranslated UI check passed (${files.length} source files scanned).`)
}
