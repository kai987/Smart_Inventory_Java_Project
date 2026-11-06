import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { authValue, renderWithProviders } from '../test/render'
import { AuthContext } from '../auth/AuthProvider'
import { CartProvider, useCart } from './CartProvider'
import { CART_STORAGE_KEY, SHARED_CART_STORAGE_KEY } from './cartTypes'
import { getCheckoutKey, getPendingCheckoutKey, getRestorableCheckoutItems } from './checkoutIntent'

function Probe() {
  const { state, dispatch, consumeOrder } = useCart()
  return <>
    <output>{state.items[0]?.quantity ?? 0}</output>
    <button onClick={() => consumeOrder('customer:order-1', [{ productId: 'P001', quantity: 1 }])}>Apply success</button>
    <button onClick={() => dispatch({ type: 'add', productId: 'P001' })}>Add new item</button>
    <button onClick={() => dispatch({ type: 'setQuantity', productId: 'P001', quantity: 3 })}>Update quantity</button>
    <button onClick={() => dispatch({ type: 'remove', productId: 'P001' })}>Remove item</button>
  </>
}

describe('CartProvider', () => {
  it('keeps an explicit pre-auth cart removal when the authenticated username resolves later', async () => {
    const items = [{ productId: 'P001', quantity: 1 }]
    const key = getCheckoutKey('preauth-customer', items)
    localStorage.setItem(SHARED_CART_STORAGE_KEY, JSON.stringify({ version: 2, revision: 0, items, consumedOrders: [] }))
    function AsyncSession() {
      const [ready, setReady] = useState(false)
      return <AuthContext value={ready ? authValue({ username: 'preauth-customer', role: 'CUSTOMER' }) : authValue(null, { isLoading: true })}>
        <button onClick={() => setReady(true)}>Finish authentication</button>
        <CartProvider><Probe /></CartProvider>
      </AuthContext>
    }
    renderWithProviders(<AsyncSession />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Remove item' }))
    await user.click(screen.getByRole('button', { name: 'Finish authentication' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('0'))
    expect(getRestorableCheckoutItems('preauth-customer')).toBeNull()
    expect(getPendingCheckoutKey('preauth-customer', items)).toBe(key)
  })
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

  it('keeps add, quantity updates, and removal usable when both localStorage methods throw', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage access denied', 'SecurityError')
    })
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage quota exceeded', 'QuotaExceededError')
    })
    const view = render(<CartProvider><Probe /></CartProvider>)
    try {
      const user = userEvent.setup()
      expect(screen.getByRole('status')).toHaveTextContent('0')
      await user.click(screen.getByRole('button', { name: 'Add new item' }))
      expect(screen.getByRole('status')).toHaveTextContent('1')
      await user.click(screen.getByRole('button', { name: 'Update quantity' }))
      expect(screen.getByRole('status')).toHaveTextContent('3')
      await user.click(screen.getByRole('button', { name: 'Remove item' }))
      expect(screen.getByRole('status')).toHaveTextContent('0')
      expect(getItem).toHaveBeenCalled()
      // Unreadable persistence is not overwritten; subsequent operations stay in memory.
      expect(setItem).not.toHaveBeenCalled()
    } finally {
      view.unmount()
      getItem.mockRestore()
      setItem.mockRestore()
    }
  })

  it('keeps the cart usable when accessing the localStorage getter throws', async () => {
    const getter = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Storage access denied', 'SecurityError')
    })
    const view = render(<CartProvider><Probe /></CartProvider>)
    try {
      const user = userEvent.setup()
      await user.click(screen.getByRole('button', { name: 'Add new item' }))
      expect(screen.getByRole('status')).toHaveTextContent('1')
      await user.click(screen.getByRole('button', { name: 'Update quantity' }))
      expect(screen.getByRole('status')).toHaveTextContent('3')
      await user.click(screen.getByRole('button', { name: 'Remove item' }))
      expect(screen.getByRole('status')).toHaveTextContent('0')
    } finally {
      view.unmount()
      getter.mockRestore()
    }
  })
})
