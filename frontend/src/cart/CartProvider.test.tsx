import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '../test/render'
import { useCart } from './CartProvider'
import { CART_STORAGE_KEY } from './cartTypes'

function Probe() {
  const { state, dispatch, consumeOrder } = useCart()
  return <>
    <output>{state.items[0]?.quantity ?? 0}</output>
    <button onClick={() => consumeOrder('customer:order-1', [{ productId: 'P001', quantity: 1 }])}>Apply success</button>
    <button onClick={() => dispatch({ type: 'add', productId: 'P001' })}>Add new item</button>
  </>
}

describe('CartProvider', () => {
  it('consumes a completed order once, retaining items added before a duplicate response', async () => {
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify({ version: 1, items: [{ productId: 'P001', quantity: 2 }] }))
    renderWithProviders(<Probe />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Apply success' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('1'))
    await user.click(screen.getByRole('button', { name: 'Add new item' }))
    await user.click(screen.getByRole('button', { name: 'Apply success' }))
    expect(screen.getByRole('status')).toHaveTextContent('2')
  })
})
