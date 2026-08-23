const yenFormatter = new Intl.NumberFormat('ja-JP', {
  style: 'currency',
  currency: 'JPY',
  maximumFractionDigits: 0,
})

export function formatYen(amount: string | bigint): string {
  return yenFormatter.format(typeof amount === 'bigint' ? amount : BigInt(amount))
}

export function multiplyYen(amount: string, quantity: number): bigint {
  return BigInt(amount) * BigInt(quantity)
}
