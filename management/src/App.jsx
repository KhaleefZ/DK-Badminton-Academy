import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { domAnimation, LazyMotion } from 'motion/react';
import AppShell from './layout/AppShell';
import { AuthProvider } from './auth/AuthContext';
import RequireAuth from './auth/RequireAuth';
import RequirePermission from './auth/RequirePermission';
import Login from './pages/Login';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import ChangeTemporaryPassword from './pages/ChangeTemporaryPassword';
import Account from './pages/Account';
import Staff from './pages/Staff';
import Settings from './pages/Settings';
import WebsiteContent from './pages/WebsiteContent';
import { WorkspaceProvider } from './store/WorkspaceContext';
import { ErrorState } from './components/States';
import Overview from './pages/Overview';
import BookingsSchedule from './pages/BookingsSchedule';
import BookingsTable from './pages/BookingsTable';
import Customers from './pages/Customers';
import Enquiries from './pages/Enquiries';
import Messages from './pages/Messages';
import Memberships from './pages/Memberships';
import MembershipSetup from './pages/MembershipSetup';
import Payments from './pages/Payments';
import Reports from './pages/Reports';
import NotFound from './pages/NotFound';

const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  { path: '/forgot-password', element: <ForgotPassword /> },
  { path: '/reset-password', element: <ResetPassword /> },
  { path: '/change-password', element: <ChangeTemporaryPassword /> },
  {
    path: '/',
    // Every workspace route requires a signed-in user.
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    errorElement: (
      <div className="error-page">
        <ErrorState />
      </div>
    ),
    children: [
      { index: true, element: <Overview /> },
      {
        path: 'bookings',
        children: [
          { index: true, element: <Navigate to="schedule" replace /> },
          { path: 'schedule', element: <BookingsSchedule /> },
          { path: 'records', element: <BookingsTable /> },
          { path: 'records/:bookingId', element: <BookingsTable /> },
        ],
      },
      { path: 'customers', element: <Customers /> },
      { path: 'enquiries', element: <Enquiries /> },
      { path: 'messages', element: <Messages /> },
      { path: 'members', element: <Navigate to="/memberships" replace /> },
      { path: 'memberships', element: <Memberships /> },
      { path: 'memberships/setup', element: <MembershipSetup /> },
      { path: 'referrals', element: <Navigate to="/memberships" replace /> },
      {
        path: 'payments',
        element: (
          <RequirePermission permission="payments.view">
            <Payments />
          </RequirePermission>
        ),
      },
      {
        path: 'reports',
        element: (
          <RequirePermission permission="reports.view">
            <Reports />
          </RequirePermission>
        ),
      },
      {
        path: 'staff',
        element: (
          <RequirePermission permission="staff.manage">
            <Staff />
          </RequirePermission>
        ),
      },
      {
        path: 'website',
        element: (
          <RequirePermission permission="website.manage">
            <WebsiteContent />
          </RequirePermission>
        ),
      },
      {
        path: 'settings',
        element: (
          <RequirePermission permission="settings.manage">
            <Settings />
          </RequirePermission>
        ),
      },
      { path: 'account', element: <Account /> },
      { path: '*', element: <NotFound /> },
    ],
  },
], {
  // Opt in to React Router v7 behaviour now so upgrading is a no-op.
  future: { v7_relativeSplatPath: true, v7_fetcherPersist: true, v7_normalizeFormMethod: true, v7_partialHydration: true, v7_skipActionErrorRevalidation: true },
});

export default function App() {
  return (
    // LazyMotion + `m` components load only Motion's DOM animation features (no layout/drag).
    <LazyMotion features={domAnimation} strict>
      <AuthProvider>
        <WorkspaceProvider>
          <RouterProvider router={router} future={{ v7_startTransition: true }} />
        </WorkspaceProvider>
      </AuthProvider>
    </LazyMotion>
  );
}
