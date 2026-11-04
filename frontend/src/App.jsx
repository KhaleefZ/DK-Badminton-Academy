import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { domAnimation, LazyMotion } from 'motion/react';
import Layout from './components/Layout';
import { BookingProvider } from './booking/BookingContext';
import Home from './pages/Home';
import Courts from './pages/Courts';
import Pricing from './pages/Pricing';
import About from './pages/About';
import Contact from './pages/Contact';
import ChooseSlot from './pages/booking/ChooseSlot';
import Details from './pages/booking/Details';
import Outcome from './pages/booking/Outcome';
import Pay from './pages/booking/Pay';
import Join from './pages/membership/Join';
import MembershipStatus from './pages/membership/Status';
import NotFound from './pages/NotFound';
import CustomPage from './pages/CustomPage';
import { SiteProvider } from './lib/site';

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <Home /> },
      { path: 'courts', element: <Courts /> },
      { path: 'pricing', element: <Pricing /> },
      { path: 'about', element: <About /> },
      { path: 'contact', element: <Contact /> },
      { path: 'p/:slug', element: <CustomPage /> },
      {
        path: 'booking',
        children: [
          { index: true, element: <ChooseSlot /> },
          { path: 'details', element: <Details /> },
          { path: 'pay/:token', element: <Pay /> },
          { path: 'status/:token', element: <Outcome /> },
        ],
      },
      {
        path: 'membership',
        children: [
          { index: true, element: <Join /> },
          { path: 'status/:token', element: <MembershipStatus /> },
        ],
      },
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
      <SiteProvider>
        <BookingProvider>
          <RouterProvider router={router} future={{ v7_startTransition: true }} />
        </BookingProvider>
      </SiteProvider>
    </LazyMotion>
  );
}
