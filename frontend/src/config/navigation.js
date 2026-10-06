/**
 * The application's navigation — ONE definition, used by both the sidebar and
 * the Intelligence Brief (our client holds no office — the brief is written
 * for the party president, not a head of government).
 *
 * These lists had drifted apart: the brief built its own set from the API's
 * module list, which pointed several entries at the same page (Mentions and
 * Grievance Resolution both to /grievances; Overview, Leader Tracking and
 * Amplifier Analysis all to /dashboard) and included two pages the sidebar had
 * commented out. Keeping one array means a page added or removed here shows up
 * in both places, and cannot be listed twice.
 *
 * `colour` is used by the brief's pills. The sidebar ignores it.
 */
import {
  Globe, Gauge, Map, LayoutDashboard, MessageSquare, Newspaper,
  AlertTriangle, BarChart3, Sparkles, CalendarDays, Settings,
} from 'lucide-react';
import { BRAND } from './partyMedia';

export const APP_NAVIGATION = [
  { name: BRAND.stateName, href: '/state-map', icon: Globe, colour: '#0d9488' },
  { name: 'Intelligence Brief', href: '/cm-dashboard', icon: Gauge, colour: '#4f46e5' },
  { name: 'Geo Intel', href: '/geographic-intelligence', icon: Map, colour: '#0891b2' },
  { name: 'Overview', href: '/dashboard', icon: LayoutDashboard, colour: '#4f46e5' },
  { name: 'Mentions', href: '/grievances', icon: MessageSquare, colour: '#2563eb' },
  { name: 'Web Articles', href: '/public-web-articles', icon: Newspaper, colour: '#7c3aed' },
  { name: 'Alerts', href: '/alerts', icon: AlertTriangle, colour: '#dc2626' },
  { name: 'Reports', href: '/intelligence-dashboard', icon: BarChart3, colour: '#b45309' },
  { name: 'AI Campaigns', href: '/ai-suggestions', icon: Sparkles, colour: '#c026d3' },
  { name: 'Events', href: '/events', icon: CalendarDays, colour: '#ea580c' },
  { name: 'Search', href: '/global-search', icon: Globe, colour: '#475569' },
  { name: 'Settings', href: '/settings', icon: Settings, colour: '#475569' },
];

export default APP_NAVIGATION;
