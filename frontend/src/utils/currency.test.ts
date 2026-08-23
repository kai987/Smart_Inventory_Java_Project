import { describe, expect, it } from 'vitest'
import { multiplyYen } from './currency'

describe('yen utilities', () => {
  it('multiplies amounts through BigInt without precision loss', () => {
    const amount = multiplyYen('9007199254740993', 2)
    expect(amount).toBe(18_014_398_509_481_986n)
  })
})
