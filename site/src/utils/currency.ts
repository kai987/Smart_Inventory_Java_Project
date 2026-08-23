export function multiplyYen(amount: string, quantity: number): bigint {
  return BigInt(amount) * BigInt(quantity)
}
