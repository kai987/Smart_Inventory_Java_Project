import { Boxes, ClipboardList, Home, LogOut, Menu, Package, UserRound, X } from 'lucide-react'
import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { useToast } from '../feedback/ToastProvider'
import { Brand } from '../navigation/Brand'
import styles from './layout.module.css'

function adminLinkClass({ isActive }: { isActive: boolean }) {
  return `${styles.adminLink} ${isActive ? styles.adminActive : ''}`
}

export function AdminLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const { user, logout } = useAuth()
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

  const closeDrawer = () => setDrawerOpen(false)

  const navigation = (
    <>
      <div className={styles.adminBrand}><Brand /></div>
      <nav className={styles.adminNav} aria-label="Admin navigation">
        <NavLink to="/admin" end className={adminLinkClass} onClick={closeDrawer}><Home /> Overview</NavLink>
        <NavLink to="/admin/products" className={adminLinkClass} onClick={closeDrawer}><Boxes /> Products</NavLink>
        <NavLink to="/admin/orders" className={adminLinkClass} onClick={closeDrawer}><ClipboardList /> Orders</NavLink>
        <NavLink to="/products" className={adminLinkClass} onClick={closeDrawer}><Package /> Public catalog</NavLink>
      </nav>
      <div className={styles.adminUser}>
        <span className={styles.avatar}><UserRound /></span>
        <div><strong>{user?.username}</strong><span>Administrator</span></div>
        <button type="button" onClick={() => void handleLogout()} aria-label="Log out"><LogOut /></button>
      </div>
    </>
  )

  return (
    <div className={styles.adminShell}>
      <aside className={styles.adminSidebar}>{navigation}</aside>
      <header className={styles.adminMobileHeader}>
        <button type="button" onClick={() => setDrawerOpen(true)} aria-label="Open admin navigation"><Menu /></button>
        <Brand />
      </header>
      {drawerOpen ? (
        <div className={styles.drawerBackdrop} role="presentation" onMouseDown={closeDrawer}>
          <aside className={styles.adminDrawer} aria-label="Admin navigation drawer" onMouseDown={(event) => event.stopPropagation()}>
            <button className={styles.drawerClose} type="button" onClick={closeDrawer} aria-label="Close admin navigation"><X /></button>
            {navigation}
          </aside>
        </div>
      ) : null}
      <main className={styles.adminMain}>
        <Outlet />
      </main>
    </div>
  )
}
