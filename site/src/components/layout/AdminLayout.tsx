import { Boxes, ClipboardList, Home, LogOut, Menu, Package, UserRound, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { translateApiError } from '../../i18n/apiErrorLocalization'
import { LanguageSelect } from '../../i18n/LanguageSelect'
import { ThemeToggle } from '../../theme/ThemeToggle'
import { useToast } from '../feedback/ToastProvider'
import { Brand } from '../navigation/Brand'
import styles from './layout.module.css'

function adminLinkClass({ isActive }: { isActive: boolean }) {
  return `${styles.adminLink} ${isActive ? styles.adminActive : ''}`
}

export function AdminLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const { t } = useTranslation()
  const { user, logout, isChangingSession, getSessionVersion } = useAuth()
  const { showToast } = useToast()
  const location = useLocation()
  const navigate = useNavigate()

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

  const closeDrawer = () => setDrawerOpen(false)

  const navigation = (
    <>
      <div className={styles.adminBrand}><Brand /></div>
      <nav className={styles.adminNav} aria-label={t('accessibility.adminNavigation')}>
        <NavLink to="/admin" end className={adminLinkClass} onClick={closeDrawer}><Home /> {t('navigation.overview')}</NavLink>
        <NavLink to="/admin/products" className={adminLinkClass} onClick={closeDrawer}><Boxes /> {t('navigation.adminProducts')}</NavLink>
        <NavLink to="/admin/orders" className={adminLinkClass} onClick={closeDrawer}><ClipboardList /> {t('navigation.adminOrders')}</NavLink>
        <NavLink to="/products" className={adminLinkClass} onClick={closeDrawer}><Package /> {t('navigation.publicCatalog')}</NavLink>
      </nav>
      <div className={styles.adminUser}>
        <span className={styles.avatar}><UserRound /></span>
        <div><strong>{user?.username}</strong><span>{t('auth.administrator')}</span></div>
        <button type="button" disabled={isChangingSession} onClick={() => void handleLogout()} aria-label={t('navigation.logout')}><LogOut /></button>
      </div>
    </>
  )

  return (
    <div className={styles.adminShell}>
      <aside className={styles.adminSidebar}>{navigation}</aside>
      <header className={styles.adminMobileHeader}>
        <button type="button" onClick={() => setDrawerOpen(true)} aria-label={t('accessibility.openAdminNavigation')}><Menu /></button>
        <Brand />
        <div className={styles.adminMobileActions}>
          <LanguageSelect />
          <ThemeToggle />
        </div>
      </header>
      {drawerOpen ? (
        <div className={styles.drawerBackdrop} role="presentation" onMouseDown={closeDrawer}>
          <aside className={styles.adminDrawer} aria-label={t('accessibility.adminNavigationDrawer')} onMouseDown={(event) => event.stopPropagation()}>
            <button className={styles.drawerClose} type="button" onClick={closeDrawer} aria-label={t('accessibility.closeAdminNavigation')}><X /></button>
            {navigation}
          </aside>
        </div>
      ) : null}
      <div className={styles.adminContent}>
        <div className={styles.adminTopBar}>
          <div className={styles.adminTopActions}>
            <LanguageSelect />
            <ThemeToggle />
          </div>
        </div>
        <main className={styles.adminMain}>
          <div key={location.pathname} className={styles.routeTransition}>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
