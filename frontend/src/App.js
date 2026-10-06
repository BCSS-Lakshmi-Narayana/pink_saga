import React, { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from './components/ui/sonner';
import { TooltipProvider } from "./components/ui/tooltip";
import { AuthProvider } from './contexts/AuthContext';
import { DashboardProvider } from './contexts/DashboardContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import Login from './pages/Login';
import { BRAND, LOCAL_LOGO } from './config/partyMedia';

// Lazy load heavy pages
const Dashboard = lazy(() => import('./pages/DashboardNew'));
const CMDashboard = lazy(() => import('./pages/CMDashboard'));
const Sources = lazy(() => import('./pages/Sources'));
const ContentFeed = lazy(() => import('./pages/ContentFeed'));
const YouTubeMonitor = lazy(() => import('./pages/YouTubeMonitor'));
const XMonitor = lazy(() => import('./pages/XMonitor'));
const FacebookMonitor = lazy(() => import('./pages/FacebookMonitor'));
const InstagramMonitor = lazy(() => import('./pages/InstagramMonitor'));
const InstagramProfile = lazy(() => import('./pages/InstagramProfile'));
const Grievances = lazy(() => import('./pages/Grievances'));
const AiSuggestions = lazy(() => import('./pages/AiSuggestions'));
const Alerts = lazy(() => import('./pages/Alerts'));
const Analytics = lazy(() => import('./pages/Analytics'));
const Settings = lazy(() => import('./pages/Settings'));
const ActiveThreats = lazy(() => import('./pages/ActiveThreats'));
const Surveillance = lazy(() => import('./pages/Surveillance'));
const IntelProcessed = lazy(() => import('./pages/IntelProcessed'));
const CaseReports = lazy(() => import('./pages/CaseReports'));
const AuditLogs = lazy(() => import('./pages/AuditLogs'));
const HelpGuide = lazy(() => import('./pages/HelpGuide'));
const GlobalSearch = lazy(() => import('./pages/GlobalSearch'));
const Events = lazy(() => import('./pages/Events'));
const Announcements = lazy(() => import('./pages/Announcements'));
const Reports = lazy(() => import('./pages/Reports'));
const GenerateReport = lazy(() => import('./pages/GenerateReport'));
const Dial100IncidentReporting = lazy(() => import('./pages/Dial100IncidentReporting'));
const UnifiedMonitors = lazy(() => import('./pages/UnifiedMonitors'));
const UnifiedReports = lazy(() => import('./pages/UnifiedReports'));
const IntelligenceDashboard = lazy(() => import('./pages/IntelligenceDashboard'));
const PolicyManager = lazy(() => import('./components/PolicyManager'));
const PersonOfInterest = lazy(() => import('./pages/POI/PersonOfInterest'));
const POIDetail = lazy(() => import('./pages/POI/POIDetail'));
//const DeepfakeAnalysis = lazy(() => import('./pages/Deepfake/DeepfakeAnalysis'));
const AccessManagement = lazy(() => import('./pages/AccessManagement'));
const ConstituencyLogins = lazy(() => import('./pages/ConstituencyLogins'));
const DeepfakeAnalysis = lazy(() => import('./pages/Deepfake/DeepfakeAnalysis'));
const Telegram = lazy(() => import('./pages/Telegram'));
const StateMap = lazy(() => import('./pages/StateMap'));
const MlaProfile = lazy(() => import('./pages/MlaProfile'));
const UnrestPredictor = lazy(() => import('./pages/UnrestPredictor'));
const EventsReport = lazy(() => import('./pages/EventsReport'));
const SearchAnalytics = lazy(() => import('./pages/SearchAnalytics'));
const PublicWebArticles = lazy(() => import('./pages/PublicWebArticles'));
const GeographicIntelligence = lazy(() => import('./pages/GeographicIntelligence'));
const GeographicIntelligenceDistrict = lazy(() => import('./pages/GeographicIntelligenceDistrict'));

// Loading fallback
const PageLoader = () => (
  <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
    <div className="relative">
      <img
        src={LOCAL_LOGO}
        alt={`${BRAND.partyShort} logo`}
        className="h-16 w-16 rounded-full object-contain bg-white p-1.5 border-2 border-pink-500 shadow-lg"
      />
      <div className="absolute inset-0 rounded-full border-2 border-t-pink-500 border-r-transparent border-b-transparent border-l-transparent animate-spin" />
    </div>
    <div className="flex flex-col items-center gap-1">
      <span className="text-sm font-bold text-slate-700 tracking-wider uppercase">{BRAND.appName}</span>
      <span className="text-[11px] text-slate-400 tracking-widest uppercase">{BRAND.tagline}</span>
    </div>
  </div>
);

import { NotificationProvider } from './context/NotificationContext';
import { InstagramCacheProvider } from './contexts/InstagramCacheContext';
import { RbacProvider } from './contexts/RbacContext';
import './App.css';

function App() {
  return (
    <AuthProvider>
      <DashboardProvider>
        <NotificationProvider>
          <BrowserRouter>
            <RbacProvider>
            <InstagramCacheProvider>
              <Toaster position="top-right" expand={true} richColors />
              <Suspense fallback={<PageLoader />}>
                <Routes>
                  <Route path="/login" element={<Login />} />
                  <Route
                    path=""
                    element={
                      <ProtectedRoute>
                        <Layout />
                      </ProtectedRoute>
                    }
                  >
                    <Route index element={<Navigate to="/state-map" replace />} />
                    <Route path="cm-dashboard" element={<CMDashboard />} />
                    <Route path="dashboard" element={<Dashboard />} />
                    <Route path="sources" element={<Sources />} />
                    <Route path="content" element={<ContentFeed />} />
                    <Route path="youtube-monitor" element={<YouTubeMonitor />} />
                    <Route path="x-monitor" element={<XMonitor />} />
                    <Route path="facebook-monitor" element={<FacebookMonitor />} />
                    <Route path="instagram-monitor" element={<InstagramMonitor />} />
                    <Route path="instagram-monitor/:sourceId" element={<InstagramProfile />} />
                    <Route path="monitors" element={<UnifiedMonitors />} />
                    <Route path="grievances" element={<Grievances />} />
                    <Route path="ai-suggestions" element={<AiSuggestions />} />
                    <Route path="alerts" element={<Alerts />} />
                    <Route path="analytics" element={<Analytics />} />
                    <Route path="global-search" element={<GlobalSearch />} />
                    <Route path="events" element={<Events />} />
                    <Route path="announcements" element={<Announcements />} />
                    <Route path="unified-reports" element={<UnifiedReports />} />
                    <Route path="settings" element={<Settings />} />
                    <Route path="intelligence-dashboard" element={<IntelligenceDashboard />} />
                    <Route path="policies" element={<PolicyManager />} />
                    <Route path="active-threats" element={<ActiveThreats />} />
                    <Route path="surveillance" element={<Surveillance />} />
                    <Route path="intel-processed" element={<IntelProcessed />} />
                    <Route path="case-reports" element={<CaseReports />} />
                    <Route path="reports" element={<Reports />} />
                    <Route path="reports/generate/:id" element={<GenerateReport />} />
                    <Route path="dial-100-incident-reporting" element={<Dial100IncidentReporting />} />
                    <Route path="audit-logs" element={<AuditLogs />} />
                    <Route path="access-management" element={<AccessManagement />} />
                    <Route path="constituency-logins" element={<ConstituencyLogins />} />
                    <Route path="person-of-interest" element={<PersonOfInterest />} />
                    <Route path="person-of-interest/:id" element={<POIDetail />} />
                    <Route path="deepfake-analysis" element={<DeepfakeAnalysis />} />
                    <Route path="telegram" element={<Telegram />} />
                    <Route path="state-map" element={<StateMap />} />
                    <Route path="geographic-intelligence" element={<GeographicIntelligence />} />
                    <Route path="geographic-intelligence/:districtKey" element={<GeographicIntelligenceDistrict />} />
                    <Route path="public-web-articles" element={<PublicWebArticles />} />
                    <Route path="war-room" element={<Navigate to="/state-map" replace />} />
                    <Route path="mla/:constituency" element={<MlaProfile />} />
                    <Route path="unrest-predictor" element={<UnrestPredictor />} />
                    <Route path="events-report" element={<EventsReport />} />
                    <Route path="search-analytics" element={<SearchAnalytics />} />
                    <Route path="deepfake/forensics" element={<DeepfakeAnalysis />} />
                    <Route path="help" element={<HelpGuide />} />
                  </Route>
                </Routes>
              </Suspense>
            </InstagramCacheProvider>
            </RbacProvider>
          </BrowserRouter>
        </NotificationProvider>
      </DashboardProvider>
    </AuthProvider>
  );
}

export default App;
