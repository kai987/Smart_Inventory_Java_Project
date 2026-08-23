import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/apiError'
import { authValue, renderWithProviders } from '../test/render'
import { LoginPage } from './LoginPage'

describe('LoginPage', () => {
  it('shows the generic invalid credentials API error', async () => {
    const login = vi.fn().mockRejectedValue(new ApiError({
      timestamp: '', status: 401, code: 'INVALID_CREDENTIALS', message: 'Invalid username or password.', path: '/api/auth/login', fieldErrors: [],
    }))
    renderWithProviders(<LoginPage />, { auth: authValue(null, { login }) })
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Username'), 'missing')
    await user.type(screen.getByLabelText('Password'), 'wrong')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid username or password.')
  })
})
