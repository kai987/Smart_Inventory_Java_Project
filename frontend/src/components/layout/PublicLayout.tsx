import { LogOut, Menu, ShoppingCart, User, UserPlus, X } from 'lucide-react'
import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { useCart } from '../../cart/CartProvider'
import { useToast } from '../feedback/ToastProvider'
import { Brand } from '../navigation/Brand'
import styles from './layout.module.css'

function navClass({ isActive }: { isActive: boolean }) {
  return `${styles.navLink} ${isActive ? styles.active : ''}`
}

export function PublicLayout() {
  const [menuOpen, setMenuOpen] = useState(false)
  const { user, logout } = useAuth()
  const { itemCount } = useCart()
  const { showToast } = useToast()
  const navigate = useNavigate()

  const handleLogout = async () => {
    try {
      await logout()
      showToast('You have been logged out.', 'success')
      void navigate('/products')
    } catch {
      showToast('Logout failed. Please try again.', 'error')
    }
  }

  const closeMenu = () => setMenuOpen(false)

  return (
    <div className={styles.publicShell}>
      <header className={styles.publicHeader}>
        <div className={styles.headerInner}>
          <button
            className={styles.mobileMenuButton}
            type="button"
            aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
            aria-expanded={menuOpen}
            aria-controls="public-navigation"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X /> : <Menu />}
          </button>
          <Brand />
          <nav id="public-navigation" className={`${styles.publicNav} ${menuOpen ? styles.navOpen : ''}`} aria-label="Main navigation">
            <NavLink to="/products" className={navClass} onClick={closeMenu}>Products</NavLink>
            {user?.role === 'ADMIN' ? (
              <NavLink to="/admin" className={navClass} onClick={closeMenu}>Admin</NavLink>
            ) : (
              <NavLink to="/cart" className={navClass} onClick={closeMenu}>
                <ShoppingCart aria-hidden="true" /> Cart <span className={styles.cartCount}>{itemCount}</span>
              </NavLink>
            )}
            {user?.role === 'CUSTOMER' ? (
              <NavLink to="/orders" className={navClass} onClick={closeMenu}>My orders</NavLink>
            ) : null}
            {user === null ? (
              <>
                <NavLink to="/login" className={navClass} onClick={closeMenu}><User aria-hidden="true" /> Login</NavLink>
                <NavLink to="/register" className={navClass} onClick={closeMenu}><UserPlus aria-hidden="true" /> Register</NavLink>
              </>
            ) : (
              <button className={styles.navButton} type="button" onClick={() => { closeMenu(); void handleLogout() }}>
                <LogOut aria-hidden="true" /> Log out
              </button>
            )}
          </nav>
          {user?.role === 'ADMIN' ? null : (
            <NavLink to="/cart" className={styles.mobileCart} aria-label={`Cart with ${itemCount} items`}>
              <ShoppingCart aria-hidden="true" />
              <span>{itemCount}</span>
            </NavLink>
          )}
        </div>
      </header>
      <main className={styles.publicMain}>
        <Outlet />
      </main>
    </div>
  )
}
