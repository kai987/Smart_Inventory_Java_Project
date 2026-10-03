import { LogOut, Menu, ShoppingCart, User, UserPlus, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { useCart } from '../../cart/CartProvider'
import { translateApiError } from '../../i18n/apiErrorLocalization'
import { useLocaleFormatters } from '../../i18n/formatters'
import { LanguageSelect } from '../../i18n/LanguageSelect'
import { ThemeToggle } from '../../theme/ThemeToggle'
import { useToast } from '../feedback/ToastProvider'
import { Brand } from '../navigation/Brand'
import styles from './layout.module.css'

function navClass({ isActive }: { isActive: boolean }) {
  return `${styles.navLink} ${isActive ? styles.active : ''}`
}

export function PublicLayout() {
  const [menuOpen, setMenuOpen] = useState(false)
  const { t } = useTranslation()
  const { user, logout, isChangingSession, getSessionVersion } = useAuth()
  const { itemCount } = useCart()
  const { formatNumber } = useLocaleFormatters()
  const { showToast } = useToast()
  const location = useLocation()
  const navigate = useNavigate()
  const formattedItemCount = formatNumber(itemCount)

  const handleLogout = async () => {
    let version = getSessionVersion()
    try {
      const pending = logout()
      version = getSessionVersion()
      await pending
      if (getSessionVersion() !== version) return
      showToast(t('auth.logoutSuccess'), 'success')
      void navigate('/products')
    } catch (error) {
      if (getSessionVersion() !== version) return
      showToast(translateApiError(error, t), 'error')
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
            aria-label={menuOpen ? t('accessibility.closeNavigation') : t('accessibility.openNavigation')}
            aria-expanded={menuOpen}
            aria-controls="public-navigation"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X /> : <Menu />}
          </button>
          <Brand />
          <nav id="public-navigation" className={`${styles.publicNav} ${menuOpen ? styles.navOpen : ''}`} aria-label={t('accessibility.mainNavigation')}>
            <NavLink to="/products" className={navClass} onClick={closeMenu}>{t('navigation.products')}</NavLink>
            {user?.role === 'ADMIN' ? (
              <NavLink to="/admin" className={navClass} onClick={closeMenu}>{t('navigation.admin')}</NavLink>
            ) : (
              <NavLink to="/cart" className={navClass} onClick={closeMenu}>
                <ShoppingCart aria-hidden="true" /> {t('navigation.cart')} <span key={itemCount} className={styles.cartCount}>{formattedItemCount}</span>
              </NavLink>
            )}
            {user?.role === 'CUSTOMER' ? (
              <NavLink to="/orders" className={navClass} onClick={closeMenu}>{t('navigation.myOrders')}</NavLink>
            ) : null}
            {user === null ? (
              <>
                <NavLink to="/login" className={navClass} onClick={closeMenu}><User aria-hidden="true" /> {t('navigation.login')}</NavLink>
                <NavLink to="/register" className={navClass} onClick={closeMenu}><UserPlus aria-hidden="true" /> {t('navigation.register')}</NavLink>
              </>
            ) : (
              <button className={styles.navButton} type="button" disabled={isChangingSession} onClick={() => { closeMenu(); void handleLogout() }}>
                <LogOut aria-hidden="true" /> {t('navigation.logout')}
              </button>
            )}
          </nav>
          <div className={styles.headerActions}>
            {user?.role === 'ADMIN' ? null : (
              <NavLink
                to="/cart"
                className={styles.mobileCart}
                aria-label={t('accessibility.cartWithItems', { count: itemCount, formattedCount: formattedItemCount })}
              >
                <ShoppingCart aria-hidden="true" />
                <span key={itemCount}>{formattedItemCount}</span>
              </NavLink>
            )}
            <LanguageSelect />
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className={styles.publicMain}>
        <div key={location.pathname} className={styles.routeTransition}>
          <Outlet />
        </div>
      </main>
    </div>
  )
}
