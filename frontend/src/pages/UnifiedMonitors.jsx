import React, { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Monitor, Twitter, Youtube, Facebook, Instagram } from 'lucide-react';
import { Button } from '../components/ui/button';
import { useRbac } from '../contexts/RbacContext';

const XMonitor = lazy(() => import('./XMonitor'));
const FacebookMonitor = lazy(() => import('./FacebookMonitor'));
const YouTubeMonitor = lazy(() => import('./YouTubeMonitor'));
const InstagramMonitor = lazy(() => import('./InstagramMonitor'));

const MONITORS = [
  { id: 'x', label: 'X Monitor', icon: Twitter },
  { id: 'facebook', label: 'Facebook Monitor', icon: Facebook },
  { id: 'instagram', label: 'Instagram Monitor', icon: Instagram },
  { id: 'youtube', label: 'YouTube Monitor', icon: Youtube }
];

const UnifiedMonitors = ({ embedded = false }) => {
  const { hasFeatureAccess } = useRbac();
  const allowedMonitors = useMemo(
    () => MONITORS.filter((monitor) => hasFeatureAccess('/monitors', monitor.id)),
    [hasFeatureAccess]
  );

  const [activeTab, setActiveTab] = useState(allowedMonitors[0]?.id || 'x');
  const effectiveActiveTab = useMemo(() => {
    if (!allowedMonitors.length) return null;
    if (allowedMonitors.some((monitor) => monitor.id === activeTab)) return activeTab;
    return allowedMonitors[0].id;
  }, [activeTab, allowedMonitors]);

  useEffect(() => {
    if (!effectiveActiveTab) return;
    if (activeTab !== effectiveActiveTab) {
      setActiveTab(effectiveActiveTab);
    }
  }, [activeTab, effectiveActiveTab]);

  return (
    <div className={embedded ? 'space-y-5' : 'min-h-screen bg-background p-6 md:p-8'}>
      <div className={embedded ? 'space-y-5' : 'max-w-[1700px] mx-auto space-y-5'}>
        {!embedded && (
          <div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
              <Link to="/dashboard" className="hover:text-foreground transition-colors">Dashboard</Link>
              <ChevronRight className="h-4 w-4" />
              <span className="text-foreground font-medium">Profiles Live Monitor Monitoring</span>
            </div>

            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-police-navy/10 text-police-navy">
                  <Monitor className="h-6 w-6" />
                </div>
                <div>
                  <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Profiles Live Monitor Monitoring Console</h1>
                  <p className="text-muted-foreground">Switch between platform monitors without leaving the page.</p>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {allowedMonitors.map(({ id, label, icon: Icon }) => (
            <Button
              key={id}
              variant={activeTab === id ? 'default' : 'outline'}
              onClick={() => setActiveTab(id)}
              className="gap-2"
            >
              <Icon className="h-4 w-4" />
              {label}
            </Button>
          ))}
          {allowedMonitors.length === 0 && (
            <div className="text-sm text-muted-foreground">
              No monitor features are assigned to your account.
            </div>
          )}
        </div>

        <div className="rounded-3xl border border-border/60 bg-card/50 shadow-sm overflow-hidden">
          <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Loading monitor...</div>}>
            {!effectiveActiveTab && (
              <div className="p-8 text-sm text-muted-foreground">
                No monitor features are assigned to your account.
              </div>
            )}
            {effectiveActiveTab === 'x' && <XMonitor />}
            {effectiveActiveTab === 'facebook' && <FacebookMonitor />}
            {effectiveActiveTab === 'instagram' && <InstagramMonitor />}
            {effectiveActiveTab === 'youtube' && <YouTubeMonitor />}
          </Suspense>
        </div>
      </div>
    </div>
  );
};

export default UnifiedMonitors;
