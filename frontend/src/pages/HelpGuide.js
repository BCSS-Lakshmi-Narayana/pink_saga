import React, { useState } from 'react';
import {
  LayoutDashboard,
  Rss,
  FileText,
  AlertTriangle,
  BarChart3,
  Shield,
  Settings,
  Search,
  Plus,
  Download,
  RefreshCw,
  Play,
  Pause,
  HelpCircle,
  CheckCircle,
  XCircle,
  Youtube,
  Twitter,
  ChevronRight,
  BookOpen,
  Zap,
  Activity,
  Trash2,
  ExternalLink
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../components/ui/accordion';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';

const HelpGuide = () => {
  const [activeTab, setActiveTab] = useState("dashboard");

  return (
    <div className="min-h-screen bg-transparent space-y-8 animate-in fade-in duration-500">

      {/* Premium Hero Section */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white shadow-2xl border border-slate-700/50">
        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 brightness-100 contrast-150"></div>
        <div className="absolute -top-24 -right-24 h-96 w-96 rounded-full bg-blue-500/20 blur-3xl"></div>
        <div className="absolute -bottom-24 -left-24 h-96 w-96 rounded-full bg-amber-500/10 blur-3xl"></div>

        <div className="relative px-8 py-16 md:py-24 max-w-4xl mx-auto text-center space-y-6">
          <Badge className="bg-blue-500/10 text-blue-200 hover:bg-blue-500/20 border-blue-500/50 px-4 py-1.5 text-sm uppercase tracking-widest backdrop-blur-md">
            Official Documentation
          </Badge>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-b from-white to-white/70">
            SANKET Master Guide
          </h1>
          <p className="text-lg md:text-xl text-slate-300 max-w-2xl mx-auto leading-relaxed">
            The complete operational manual for SANKET.
            Master the tools of social sentiment and goodwill analysis.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-4 pt-4">
            <Button size="lg" className="bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-900/20 transition-all hover:scale-105" onClick={() => document.getElementById('main-guide').scrollIntoView({ behavior: 'smooth' })}>
              <BookOpen className="mr-2 h-5 w-5" /> Start Learning
            </Button>
            <Button size="lg" variant="outline" className="border-slate-600 text-slate-200 hover:bg-slate-800 hover:text-white transition-all">
              <Play className="mr-2 h-5 w-5" /> Watch Tutorials
            </Button>
          </div>
        </div>
      </div>

      {/* Feature Highlights - Glassmorphism Cards */}
      <div className="grid gap-6 md:grid-cols-3">
        <Card className="group relative overflow-hidden border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-950/50 backdrop-blur-sm transition-all duration-300 hover:shadow-xl hover:-translate-y-1">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <CardHeader>
            <div className="h-12 w-12 rounded-2xl bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
              <Zap className="h-6 w-6" />
            </div>
            <CardTitle className="text-xl">Real-Time Analysis</CardTitle>
            <CardDescription>Instant sentiment tracking across monitored networks.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground leading-relaxed">
              The system processes incoming streams in sub-seconds, flagging keywords and sentiment anomalies as they happen.
            </p>
          </CardContent>
        </Card>

        <Card className="group relative overflow-hidden border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-950/50 backdrop-blur-sm transition-all duration-300 hover:shadow-xl hover:-translate-y-1">
          <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <CardHeader>
            <div className="h-12 w-12 rounded-2xl bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
              <Shield className="h-6 w-6" />
            </div>
            <CardTitle className="text-xl">Sentiment Scoring Engine</CardTitle>
            <CardDescription>Automated sentiment assessment and categorization.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Proprietary algorithms assign risk scores (0-100) to every piece of content, prioritizing your attention where it matters most.
            </p>
          </CardContent>
        </Card>

        <Card className="group relative overflow-hidden border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-950/50 backdrop-blur-sm transition-all duration-300 hover:shadow-xl hover:-translate-y-1">
          <div className="absolute inset-0 bg-gradient-to-br from-red-500/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <CardHeader>
            <div className="h-12 w-12 rounded-2xl bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
              <Youtube className="h-6 w-6" />
            </div>
            <CardTitle className="text-xl">Deep Media Analysis</CardTitle>
            <CardDescription>Video & Comment sentiment extraction.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Go beyond titles. The system analyzes video descriptions, tags, and comment sections to uncover hidden radicalization vectors.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Documentation Area */}
      <div id="main-guide" className="space-y-6 pt-8">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <div className="sticky top-20 z-30 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 py-4 border-b">
            <TabsList className="w-full justify-start h-auto p-0 bg-transparent gap-2 md:gap-6 overflow-x-auto">
              <TabsTrigger value="dashboard" className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:border-primary border-b-2 border-transparent px-4 py-3 rounded-none transition-all">
                <LayoutDashboard className="h-4 w-4 mr-2" />
                Dashboard
              </TabsTrigger>
              <TabsTrigger value="monitoring" className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:border-primary border-b-2 border-transparent px-4 py-3 rounded-none transition-all">
                <Activity className="h-4 w-4 mr-2" />
                Monitoring
              </TabsTrigger>
              <TabsTrigger value="analysis" className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:border-primary border-b-2 border-transparent px-4 py-3 rounded-none transition-all">
                <Search className="h-4 w-4 mr-2" />
                Investigation
              </TabsTrigger>
              <TabsTrigger value="admin" className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:border-primary border-b-2 border-transparent px-4 py-3 rounded-none transition-all">
                <Shield className="h-4 w-4 mr-2" />
                Administration
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="mt-8">
            {/* DASHBOARD TAB */}
            <TabsContent value="dashboard" className="space-y-8 animate-in fly-in-bottom duration-300">
              <div className="grid md:grid-cols-2 gap-8 items-start">
                <div className="space-y-6">
                  <h2 className="text-2xl font-bold flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground text-sm font-bold">1</span>
                    Command Center Overview
                  </h2>
                  <p className="text-muted-foreground text-lg leading-relaxed">
                    The dashboard is your "Single Pane of Glass." It aggregates data from all 12 surveillance nodes into a unified threat landscape view.
                  </p>

                  <div className="bg-card border rounded-xl p-6 space-y-4 shadow-sm">
                    <h3 className="font-semibold text-foreground">Key Interface Elements</h3>
                    <ul className="space-y-3">
                      <li className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
                        <Activity className="h-5 w-5 text-green-500" />
                        <span><strong>Live Feed:</strong> Real-time ticker of processed content.</span>
                      </li>
                      <li className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
                        <AlertTriangle className="h-5 w-5 text-red-500" />
                        <span><strong>Threat Map:</strong> Geospatial distribution of alerts (Phase 2).</span>
                      </li>
                      <li className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
                        <BarChart3 className="h-5 w-5 text-blue-500" />
                        <span><strong>Volume Analysis:</strong> Weekly trend lines of activity.</span>
                      </li>
                    </ul>
                  </div>
                </div>

                {/* Visual Representation (Mock Layout) */}
                <div className="bg-slate-900 rounded-xl p-4 shadow-2xl border border-slate-800">
                  <div className="aspect-video bg-slate-800/50 rounded-lg flex items-center justify-center border border-slate-700 dashed">
                    <div className="text-center space-y-2">
                      <LayoutDashboard className="h-16 w-16 text-slate-600 mx-auto" />
                      <p className="text-slate-500 font-medium">Interactive Dashboard Preview</p>
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* MONITORING TAB */}
            <TabsContent value="monitoring" className="space-y-8 animate-in fly-in-bottom duration-300">
              <div className="space-y-8">
                <div className="border-l-4 border-blue-500 pl-6 py-2">
                  <h2 className="text-2xl font-bold">Source Management</h2>
                  <p className="text-muted-foreground mt-2">
                    Control the input vectors of your intelligence system. Add, pause, or remove surveillance targets.
                  </p>
                </div>

                <div className="grid md:grid-cols-2 gap-6">
                  <Card className="hover:border-blue-500/50 transition-colors">
                    <CardHeader>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Plus className="h-5 w-5 text-blue-500" /> Adding Channels
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <p className="text-sm text-muted-foreground">Supports direct URL input for maximum precision.</p>
                      <div className="bg-muted p-4 rounded-md text-sm font-mono space-y-2">
                        <div className="flex items-center gap-2 text-green-600">
                          <CheckCircle className="h-4 w-4" /> https://youtube.com/@channelname
                        </div>
                        <div className="flex items-center gap-2 text-green-600">
                          <CheckCircle className="h-4 w-4" /> https://youtube.com/channel/UC123...
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="hover:border-red-500/50 transition-colors">
                    <CardHeader>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Trash2 className="h-5 w-5 text-red-500" /> Bulk Operations
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <p className="text-sm text-muted-foreground">Manage large datasets efficiently.</p>
                      <ul className="list-disc list-inside text-sm text-muted-foreground space-y-2">
                        <li>Select multiple channels using checkboxes.</li>
                        <li>Click <strong>"Delete Selected"</strong> to remove them in one batch.</li>
                        <li>Includes a safety confirmation dialog to prevent accidents.</li>
                      </ul>
                    </CardContent>
                  </Card>
                </div>

                <Card className="bg-gradient-to-r from-slate-100 to-white dark:from-slate-900 dark:to-slate-900/50">
                  <CardHeader>
                    <CardTitle>Platform Specifics: YouTube</CardTitle>
                    <CardDescription>Advanced monitoring features for video content</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid md:grid-cols-3 gap-8">
                      <div className="space-y-2">
                        <div className="h-10 w-10 rounded-lg bg-red-100 dark:bg-red-900/20 text-red-600 flex items-center justify-center">
                          <ExternalLink className="h-5 w-5" />
                        </div>
                        <h4 className="font-semibold">Quick Verification</h4>
                        <p className="text-xs text-muted-foreground">Click the external link icon next to any channel name to instantly verify the target on the live platform.</p>
                      </div>
                      <div className="space-y-2">
                        <div className="h-10 w-10 rounded-lg bg-blue-100 dark:bg-blue-900/20 text-blue-600 flex items-center justify-center">
                          <RefreshCw className="h-5 w-5" />
                        </div>
                        <h4 className="font-semibold">Smart Sync</h4>
                        <p className="text-xs text-muted-foreground">System tracks "Last Sync" time accurately. Auto-sync is triggered based on priority, or manually requested.</p>
                      </div>
                      <div className="space-y-2">
                        <div className="h-10 w-10 rounded-lg bg-amber-100 dark:bg-amber-900/20 text-amber-600 flex items-center justify-center">
                          <Youtube className="h-5 w-5" />
                        </div>
                        <h4 className="font-semibold">Thumbnail Intelligence</h4>
                        <p className="text-xs text-muted-foreground">Visual recognition of thumbnails with smart failover (Medium {'->'} High {'->'} Default) to ensure no broken UI.</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* ANALYSIS TAB */}
            <TabsContent value="analysis" className="space-y-8 animate-in fly-in-bottom duration-300">
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-bold">Investigation & Forensics</h2>
                  <Badge variant="outline" className="border-primary text-primary">Advanced Feature</Badge>
                </div>

                <div className="bg-card border rounded-xl overflow-hidden">
                  <div className="grid md:grid-cols-2">
                    <div className="p-8 space-y-6">
                      <h3 className="text-xl font-bold">The "Analyze Intelligence" Modal</h3>
                      <p className="text-muted-foreground">
                        Clicking the <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 dark:bg-slate-800 border"><Activity className="w-3 h-3 mr-1" /> Analyze</span> button on any video opens the deep-dive forensics view.
                      </p>

                      <div className="space-y-4">
                        <div className="flex items-start gap-3">
                          <div className="mt-1 h-2 w-2 rounded-full bg-red-500" />
                          <div>
                            <h4 className="font-semibold text-sm">Risk Breakdown</h4>
                            <p className="text-xs text-muted-foreground">Granular score components: Violence, Hate Speech, Threats.</p>
                          </div>
                        </div>
                        <div className="flex items-start gap-3">
                          <div className="mt-1 h-2 w-2 rounded-full bg-amber-500" />
                          <div>
                            <h4 className="font-semibold text-sm">Keyword Evidence</h4>
                            <p className="text-xs text-muted-foreground">See exactly which words triggered the system, highlighted in context.</p>
                          </div>
                        </div>
                        <div className="flex items-start gap-3">
                          <div className="mt-1 h-2 w-2 rounded-full bg-blue-500" />
                          <div>
                            <h4 className="font-semibold text-sm">Comment Sentiment</h4>
                            <p className="text-xs text-muted-foreground">AI analysis of user comments to detect radicalization in the audience.</p>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="bg-muted/30 p-8 flex items-center justify-center border-l">
                      {/* Abstract representation of the modal */}
                      <div className="w-full max-w-sm bg-background rounded-lg shadow-xl border p-4 space-y-3 opacity-90">
                        <div className="h-32 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
                        <div className="h-4 w-3/4 bg-slate-200 dark:bg-slate-800 rounded" />
                        <div className="h-4 w-1/2 bg-slate-200 dark:bg-slate-800 rounded" />
                        <div className="grid grid-cols-3 gap-2 pt-2">
                          <div className="h-16 bg-red-100 dark:bg-red-900/20 rounded" />
                          <div className="h-16 bg-blue-100 dark:bg-blue-900/20 rounded" />
                          <div className="h-16 bg-amber-100 dark:bg-amber-900/20 rounded" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* ADMIN TAB */}
            <TabsContent value="admin" className="space-y-8 animate-in fly-in-bottom duration-300">
              <div className="grid md:grid-cols-2 gap-8">
                <div className="space-y-6">
                  <h2 className="text-2xl font-bold">Administrative Controls</h2>

                  <Accordion type="single" collapsible className="w-full">
                    <AccordionItem value="audit">
                      <AccordionTrigger className="text-lg font-semibold">Audit Logging</AccordionTrigger>
                      <AccordionContent className="text-muted-foreground">
                        Every action is immutable. The Audit Log records:
                        <ul className="list-disc list-inside mt-2 space-y-1">
                          <li>User Logins/Logouts</li>
                          <li>Data Exports</li>
                          <li>Channel Deletions</li>
                          <li>System Configuration Changes</li>
                        </ul>
                      </AccordionContent>
                    </AccordionItem>
                    <AccordionItem value="export">
                      <AccordionTrigger className="text-lg font-semibold">Generating Reports</AccordionTrigger>
                      <AccordionContent className="text-muted-foreground">
                        Create official case files in PDF format.
                        <div className="mt-2 p-3 bg-muted rounded border text-xs font-mono">
                          Format: [Case_ID]_[Date]_[Classification].pdf
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </div>

                <Card className="bg-slate-950 text-white border-slate-800">
                  <CardHeader>
                    <CardTitle className="text-amber-500 flex items-center gap-2">
                      <Shield className="h-5 w-5" /> Security Protocol
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4 text-sm text-slate-400">
                    <p>
                      This system is classified. Access is restricted to authorized personnel only.
                      Unauthorized access attempts are logged and reported automatically.
                    </p>
                    <div className="grid grid-cols-2 gap-4 pt-4">
                      <div className="p-3 rounded bg-white/5 border border-white/10 text-center">
                        <div className="text-2xl font-bold text-white">256-bit</div>
                        <div className="text-[10px] uppercase tracking-widest">Encryption</div>
                      </div>
                      <div className="p-3 rounded bg-white/5 border border-white/10 text-center">
                        <div className="text-2xl font-bold text-white">RBAC</div>
                        <div className="text-[10px] uppercase tracking-widest">Access Control</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </div>
        </Tabs>
      </div>

      {/* Footer / Support */}
      <div className="border-t pt-12 mt-12 text-center space-y-4">
        <h3 className="font-semibold text-lg">Still need help?</h3>
        <p className="text-muted-foreground">Contact the System Administrator for technical support or access requests.</p>
        <Button variant="ghost" className="text-sm">
          support@blurahub.internal
        </Button>
      </div>
    </div>
  );
};

export default HelpGuide;

