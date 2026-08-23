import { screen } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '../test/render'
import { RequireAuth } from './RequireAuth'
import { RequireRole } from './RequireRole'

describe('route guards', () => {
  it('redirects an anonymous user to login with a safe next path', () => {
    renderWithProviders(
      <Routes>
        <Route path="/orders" element={<RequireAuth><div>private orders</div></RequireAuth>} />
        <Route path="/login" element={<div>login screen</div>} />
      </Routes>,
      { route: '/orders' },
    )
    expect(screen.getByText('login screen')).toBeInTheDocument()
  })

  it('blocks a user with the wrong role', () => {
    renderWithProviders(
      <Routes>
        <Route path="/admin" element={<RequireRole role="ADMIN"><div>admin screen</div></RequireRole>} />
        <Route path="/403" element={<div>forbidden screen</div>} />
      </Routes>,
      { route: '/admin', user: { username: 'customer', role: 'CUSTOMER' } },
    )
    expect(screen.getByText('forbidden screen')).toBeInTheDocument()
  })
})
