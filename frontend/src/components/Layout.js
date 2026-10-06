import React, { useState, useEffect } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useNotification } from '../context/NotificationContext';
import { useRbac } from '../contexts/RbacContext';
import AccessDenied from './AccessDenied';
import {
  LogOut,
  Menu,
  BellOff,
} from 'lucide-react';
import { Button } from './ui/button';
import { toast } from 'sonner';
import { PARTY_HERO, LOCAL_FALLBACK, BRAND } from '../config/partyMedia';
import { APP_NAVIGATION } from '../config/navigation';
import { roleLabel } from '../lib/roleLabels';

const Layout = () => {
  const { user, logout } = useAuth();
  const { hasAccess, normalizeRoutePath, loading: rbacLoading } = useRbac();
  const { unreadCount, markAllRead } = useNotification();
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 1024;
      setIsMobile(mobile);
      if (!mobile) {
        setSidebarOpen(true);
      }
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    if (isMobile) {
      setSidebarOpen(false);
    }
  }, [location.pathname, isMobile]);

  useEffect(() => {
    if (isMobile && sidebarOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isMobile, sidebarOpen]);


  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  // Defined once in config/navigation.js so the sidebar and the Chief
  // Minister's brief cannot drift apart or list the same page twice.
  const allNavigation = APP_NAVIGATION;

  const roleFilteredNavigation = user?.role === 'dial100'
    ? allNavigation.filter((item) => item.href === '/dial-100-incident-reporting')
    : allNavigation.filter((item) => !item.roles || item.roles.includes(user?.role));
  const navigation = roleFilteredNavigation.filter((item) => hasAccess(item.href));

  const normalizedPath = normalizeRoutePath(location.pathname);
  const isRouteAllowed = location.pathname === '/' || hasAccess(normalizedPath);
  const showAccessDenied = !rbacLoading && !isRouteAllowed;
  const isFullWidthPage = (location.pathname.includes('/person-of-interest/') && location.pathname.split('/').length > 2) ||
    location.pathname.startsWith('/reports/generate/') ||
    location.pathname === '/sources' ||
    location.pathname === '/telegram' ||
    location.pathname === '/settings' ||
    location.pathname === '/cm-dashboard';

  return (
    <div className="h-screen w-full flex flex-col bg-background overflow-hidden relative print:h-auto print:overflow-visible">
      {isMobile && sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 transition-opacity duration-300"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <header className="fixed top-0 left-0 right-0 h-16 lg:h-20 bg-gradient-to-r from-pink-700 via-pink-600 to-pink-500 z-50 shadow-lg select-none overflow-hidden">
        {/* Party accent ribbon (BRS pink) — top edge */}
        <div className="absolute top-0 left-0 right-0 h-1 flex">
          <div className="flex-1 bg-[#EC4899]" />
          <div className="flex-1 bg-white" />
          <div className="flex-1 bg-[#BE185D]" />
        </div>
        <div className="flex items-center justify-between h-full px-4 lg:px-6 relative">
          <div className="flex items-center gap-3 lg:gap-4 relative z-10">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSidebarOpen((prev) => !prev)}
              data-testid="sidebar-toggle-btn"
              className="text-white hover:bg-white/15 h-10 w-10 lg:h-11 lg:w-11"
              aria-label={sidebarOpen ? 'Close menu' : 'Open menu'}
            >
              <Menu className="h-5 w-5 lg:h-6 lg:w-6" />
            </Button>

            <div className="flex items-center gap-3 lg:gap-4">
              <div className="relative h-10 w-10 lg:h-14 lg:w-14 rounded-full ring-2 ring-pink-700/40 shadow-lg overflow-hidden bg-white/10">
                <img
                  src={PARTY_HERO.src}
                  alt={PARTY_HERO.alt}
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover"
                  onError={(e) => {
                    if (e.currentTarget.dataset.fallbackUsed) return;
                    e.currentTarget.dataset.fallbackUsed = '1';
                    e.currentTarget.src = LOCAL_FALLBACK;
                  }}
                />
                <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-400 border-2 border-white" />
              </div>

              <div className="flex flex-col items-start justify-start text-left leading-tight">
                <h1 className="text-base lg:text-2xl font-heading font-bold text-white tracking-wider uppercase drop-shadow-sm">
                  {BRAND.appName}
                </h1>
                <span className="hidden sm:block text-[9px] lg:text-[10px] text-pink-50 font-semibold tracking-widest uppercase">
                  {BRAND.partyUnit} Leadership Monitoring · {BRAND.stateName}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 lg:gap-4">
            {/* Live monitoring indicator */}
            <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/15 border border-white/25 backdrop-blur-sm">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-300 opacity-75 animate-ping" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              <span className="text-[10px] font-bold uppercase tracking-widest text-white">Live · {BRAND.stateName}</span>
            </div>

            <div className="hidden sm:block h-6 lg:h-8 w-px bg-white/25"></div>

            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="icon"
                onClick={async () => {
                  try {
                    await markAllRead();
                    toast.success('Notifications cleared');
                  } catch {
                    toast.error('Failed to clear notifications');
                  }
                }}
                data-testid="clear-all-notifications-btn"
                className="text-white hover:bg-white/15 h-9 w-9 lg:h-10 lg:w-10"
                aria-label="Clear all notifications"
              >
                <BellOff className="h-4 w-4 lg:h-5 lg:w-5" />
              </Button>
            )}

            <div className="hidden sm:block h-6 lg:h-8 w-px bg-white/25"></div>

            <div className="flex items-center gap-2 lg:gap-3">
              <div className="text-right hidden sm:block">
                <div className="text-xs lg:text-sm font-semibold text-white truncate max-w-[120px] lg:max-w-none">
                  {user?.full_name}
                </div>
                <div className="text-[10px] lg:text-xs text-pink-50 font-semibold uppercase tracking-wide">
                  {roleLabel(user?.role)}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleLogout}
                data-testid="logout-btn"
                className="text-white hover:bg-red-500/20 hover:text-red-700 h-9 w-9 lg:h-10 lg:w-10"
                aria-label="Logout"
              >
                <LogOut className="h-4 w-4 lg:h-5 lg:w-5" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      <aside
        className={`fixed top-16 lg:top-20 left-0 bottom-0 w-[82px] bg-gradient-to-b from-pink-700 via-pink-600 to-pink-500 shadow-xl z-40 transform transition-transform duration-300 ease-in-out select-none ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
        data-testid="sidebar"
        role="navigation"
        aria-label="Main navigation"
      >
        <nav
          className="flex flex-col items-center gap-0.5 py-3 overflow-y-auto max-h-[calc(100vh-10rem)]"
          style={{ scrollbarWidth: 'none' }}
        >
          {navigation.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.href;
            return (
              <Link
                key={item.name}
                to={item.href}
                data-testid={`nav-${item.name.toLowerCase().replace(' ', '-')}`}
                className={`relative flex flex-col items-center justify-center w-[70px] py-2.5 rounded-xl text-center transition-all duration-200 group ${isActive ? 'bg-white/25 text-white' : 'text-white/70 hover:bg-white/15 hover:text-white'}`}
              >
                <div className="relative">
                  <Icon className={`h-[22px] w-[22px] mb-1 ${isActive ? 'text-white' : 'text-white/70 group-hover:text-white'}`} />
                  {item.name === 'Alerts' && unreadCount > 0 && (
                    <span className="absolute -top-1.5 -right-2.5 bg-red-600 text-white text-[9px] font-bold min-w-[18px] h-[18px] flex items-center justify-center rounded-full shadow-lg shadow-red-500/30">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </div>
                <span className={`text-[10px] leading-tight font-semibold ${isActive ? 'text-white' : 'text-white/70 group-hover:text-white'}`}>
                  {item.name}
                </span>
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* `--side-panel-width` is set by right-hand slide-in panels (e.g. the
          booth-level data panel) so the main content shrinks to make room
          instead of being covered by an overlay. Defaults to 0px. */}
      <div
        className={`flex-1 flex flex-col min-h-0 pt-16 lg:pt-20 transition-all duration-300 print:pt-0 print:pl-0 print:pr-0 print:h-auto print:overflow-visible ${sidebarOpen && !isMobile ? 'lg:pl-[82px]' : 'pl-0'}`}
        style={{ paddingRight: 'var(--side-panel-width, 0px)' }}
      >
        <main className={`flex-1 min-h-0 ${isFullWidthPage ? 'p-0' : 'p-4 lg:p-8'} overflow-auto scroll-smooth print:h-auto print:overflow-visible`}>
          {showAccessDenied ? <AccessDenied /> : <Outlet />}
        </main>
      </div>
    </div>
  );
};

export default Layout;
