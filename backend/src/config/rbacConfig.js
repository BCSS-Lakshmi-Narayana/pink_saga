const ALL_PAGES = [
  { path: '/cm-dashboard', name: 'Intelligence Brief', icon: 'Gauge' },
  { path: '/dashboard', name: 'Dashboard', icon: 'LayoutDashboard' },
  { path: '/state-map', name: 'Telangana Map', icon: 'Globe' },
  { path: '/alerts', name: 'Alerts', icon: 'AlertTriangle' },
  { path: '/monitors', name: 'Profiles Live Monitor', icon: 'Monitor' },
  { path: '/grievances', name: 'Grievances', icon: 'MessageSquare' },
  { path: '/public-web-articles', name: 'Web Articles', icon: 'Newspaper' },
  { path: '/global-search', name: 'Global Search', icon: 'Globe' },
  { path: '/events', name: 'Events', icon: 'CalendarDays' },
  { path: '/unified-reports', name: 'Unified Reports', icon: 'FileText' },
  { path: '/intelligence-dashboard', name: 'Reports', icon: 'BarChart3' },
  { path: '/ai-suggestions', name: 'AI Campaigns', icon: 'Sparkles' },
  { path: '/settings', name: 'Settings', icon: 'Settings' },
  // { path: '/help', name: 'Help Guide', icon: 'HelpCircle' },
  { path: '/announcements', name: 'Announcements', icon: 'Megaphone' },
  { path: '/sources', name: 'Sources', icon: 'Rss' },
  { path: '/person-of-interest', name: 'Profile', icon: 'UserSearch' },
  { path: '/geographic-intelligence', name: 'Geographic Intelligence', icon: 'Map' },
  { path: '/mla', name: 'MLA Profile', icon: 'UserSearch' },
  { path: '/unrest-predictor', name: 'Unrest Predictor', icon: 'AlertTriangle' },
  { path: '/access-management', name: 'Access Management', icon: 'ShieldCheck' }
];

const PAGE_FEATURES = {
  '/geographic-intelligence': [
    { id: 'district_view', label: 'District View' },
    { id: 'city_view', label: 'City View' },
    { id: 'risk_score', label: 'Risk Score' }
  ],
  '/alerts': [
    { id: 'active', label: 'Active' },
    { id: 'false_positive', label: 'False Positive' },
    { id: 'acknowledged', label: 'Acknowledged' },
    { id: 'escalated', label: 'Escalated' },
    { id: 'reports', label: 'Reports' }
  ],
  '/monitors': [
    { id: 'x', label: 'X Monitor' },
    { id: 'facebook', label: 'Facebook Monitor' },
    { id: 'instagram', label: 'Instagram Monitor' },
    { id: 'youtube', label: 'YouTube Monitor' }
  ],
  '/grievances': [
    { id: 'all', label: 'All' },
    { id: 'pending', label: 'Pending' },
    { id: 'closed', label: 'Closed' },
    { id: 'fir', label: 'FIR' },
    { id: 'reports', label: 'Reports' }
  ]
};

const GRIEVANCE_FEATURE_ALIASES = {
  escalated: 'pending'
};

module.exports = {
  ALL_PAGES,
  PAGE_FEATURES,
  GRIEVANCE_FEATURE_ALIASES
};
