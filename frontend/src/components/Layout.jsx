import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Header from './Header';
import Footer from './Footer';
import { PageFade } from '../motion';
import { useContent } from '../lib/site';

function pageTitle(pathname, seo, customPages) {
  const fixed = { '/': seo.homeTitle, '/courts': seo.courtsTitle, '/pricing': seo.pricingTitle, '/about': seo.aboutTitle, '/contact': seo.contactTitle, '/booking': seo.bookingTitle, '/booking/details': seo.detailsTitle, '/membership': seo.membershipTitle };
  if (fixed[pathname]) return fixed[pathname];
  if (pathname.startsWith('/booking/pay/')) return seo.paymentTitle;
  if (pathname.startsWith('/booking/status/')) return seo.bookingStatusTitle;
  if (pathname.startsWith('/membership/status/')) return seo.membershipStatusTitle;
  return customPages.find((p) => p.visible && pathname === `/p/${p.slug}`)?.title ?? seo.notFoundTitle;
}

export default function Layout() {
  const { pathname } = useLocation();
  const { seo, customPages } = useContent();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    document.title = [pageTitle(pathname, seo, customPages), seo.siteSuffix].filter(Boolean).join(' · ');
    document.querySelector('meta[name="description"]')?.setAttribute('content', seo.description);
  }, [pathname, seo, customPages]);

  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Header />
      {/* Route arrival: the new page fades and rises 8px; no exit, so it never waits on the old one */}
      <PageFade routeKey={pathname} as="main" id="main" tabIndex={-1}>
        <Outlet />
      </PageFade>
      <Footer />
    </>
  );
}
