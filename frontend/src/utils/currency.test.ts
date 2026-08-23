import { describe, expect, it } from 'vitest'
import { formatYen, multiplyYen } from './currency'

describe('yen utilities', () => {
  it('formats amounts through BigInt without precision loss', () => {
    const amount = multiplyYen('9007199254740993', 2)
    expect(amount).toBe(18_014_398_509_481_986n)
    expect(formatYen(amount)).toContain('18,014,398,509,481,986')
  })
})
