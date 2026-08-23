import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { RequireAuth } from '../auth/RequireAuth'
import { RequireRole } from '../auth/RequireRole'
import { AdminLayout } from '../components/layout/AdminLayout'
import { PublicLayout } from '../components/layout/PublicLayout'
import { PageLoading } from '../components/feedback/PageLoading'
import { CartPage } from '../pages/CartPage'
import { ForbiddenPage } from '../pages/ForbiddenPage'
import { LoginPage } from '../pages/LoginPage'
import { NotFoundPage } from '../pages/NotFoundPage'
import { OrdersPage } from '../pages/OrdersPage'
import { ProductsPage } from '../pages/ProductsPage'
import { RegisterPage } from '../pages/RegisterPage'

const AdminDashboardPage = lazy(() => import('../pages/AdminDashboardPage'))
const AdminProductsPage = lazy(() => import('../pages/AdminProductsPage'))
const AdminOrdersPage = lazy(() => import('../pages/AdminOrdersPage'))

function AdminRoutes() {
  return (
    <RequireAuth>
      <RequireRole role="ADMIN">
        <Suspense fallback={<PageLoading />}>
          <AdminLayout />
        </Suspense>
      </RequireRole>
    </RequireAuth>
  )
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route index element={<Navigate to="/products" replace />} />
        <Route path="products" element={<ProductsPage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="register" element={<RegisterPage />} />
        <Route path="cart" element={<CartPage />} />
        <Route path="orders" element={<RequireAuth><RequireRole role="CUSTOMER"><OrdersPage /></RequireRole></RequireAuth>} />
        <Route path="403" element={<ForbiddenPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
      <Route path="admin" element={<AdminRoutes />}>
        <Route index element={<AdminDashboardPage />} />
        <Route path="products" element={<AdminProductsPage />} />
        <Route path="orders" element={<AdminOrdersPage />} />
      </Route>
    </Routes>
  )
}
