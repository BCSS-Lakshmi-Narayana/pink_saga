import React, { useState, useEffect } from 'react';
import api from '../lib/api';
import { Save, Plus, Trash2, TrendingUp, Wand2 } from 'lucide-react';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Switch } from '../components/ui/switch';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { ScrollArea } from '../components/ui/scroll-area';
import { toast } from 'sonner';
import Sources from './Sources';
import { Badge } from '../components/ui/badge';
import AccessManagement from './AccessManagement';
import UnrestPredictor from './UnrestPredictor';
import ConstituencyLeaderPopularity from '../components/settings/ConstituencyLeaderPopularity';
import { useAuth } from '../contexts/AuthContext';
import { STATE_MLAS } from '../data/stateMLAs';
import { KEYWORD_LANGUAGE_OPTIONS, transliterationCode } from '../lib/languages';

const AC_NAMES = [...new Set((STATE_MLAS || []).map((m) => m.constituency).filter(Boolean))].sort();

const Settings = () => {
  const { isSuperAdmin, assignedConstituency } = useAuth();
  const [settings, setSettings] = useState(null);
  const [keywords, setKeywords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newKeyword, setNewKeyword] = useState({ category: 'violence', language: 'en', keyword: '', constituency: '' });
  const [transliterationEnabled, setTransliterationEnabled] = useState(true);
  const [suggestions, setSuggestions] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [thresholds, setThresholds] = useState([]);

  const [thresholdsLoading, setThresholdsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('unrest');



  // Transliteration logic
  const handleKeywordChange = async (e) => {
    const val = e.target.value;
    setNewKeyword(prev => ({ ...prev, keyword: val }));

    if (transliterationEnabled &&
      newKeyword.language !== 'en' &&
      newKeyword.language !== 'all') {

      const words = val.split(' ');
      const lastWord = words[words.length - 1];
      const isSpace = val.endsWith(' ');

      if (isSpace && words.length > 1) {
        const wordToConvert = words[words.length - 2];
        if (wordToConvert) {
          const langCode = transliterationCode(newKeyword.language);
          try {
            const response = await fetch(
              `https://inputtools.google.com/request?text=${encodeURIComponent(wordToConvert)}&itc=${langCode}&num=1&cp=0&cs=1&ie=utf-8&oe=utf-8`
            );
            const data = await response.json();
            if (data[0] === 'SUCCESS' && data[1] && data[1][0] && data[1][0][1]) {
              const transliteratedWord = data[1][0][1][0];
              const newVal = val.substring(0, val.lastIndexOf(wordToConvert)) + transliteratedWord + ' ';
              setNewKeyword(prev => ({ ...prev, keyword: newVal }));
            }
          } catch (err) { }
        }
        setSuggestions([]);
        return;
      }

      if (lastWord && lastWord.length > 0) {
        const langCode = transliterationCode(newKeyword.language);
        try {
          const response = await fetch(
            `https://inputtools.google.com/request?text=${encodeURIComponent(lastWord)}&itc=${langCode}&num=5&cp=0&cs=1&ie=utf-8&oe=utf-8`
          );
          const data = await response.json();
          if (data[0] === 'SUCCESS' && data[1] && data[1][0] && data[1][0][1]) {
            setSuggestions(data[1][0][1]);
          } else {
            setSuggestions([]);
          }
        } catch (err) {
          setSuggestions([]);
        }
      } else {
        setSuggestions([]);
      }
    } else {
      setSuggestions([]);
    }
  };

  const handleSuggestionClick = (suggestion) => {
    const val = newKeyword.keyword;
    const words = val.split(' ');
    words.pop();
    words.push(suggestion);
    const newVal = words.join(' ') + ' ';
    setNewKeyword(prev => ({ ...prev, keyword: newVal }));
    setSuggestions([]);

    setTimeout(() => {
      document.querySelector('input[name="keywordInput"]')?.focus();
    }, 10);
  };

  useEffect(() => {
    fetchData();
    fetchThresholds();
  }, []);

  // The keyword list is shared with the Mentions page's keyword panel; re-read
  // it whenever this tab regains focus so additions/removals made there show here.
  useEffect(() => {
    const refreshKeywords = () => {
      if (document.visibilityState !== 'visible') return;
      api.get('/keywords').then((res) => setKeywords(res.data)).catch(() => {});
    };
    window.addEventListener('focus', refreshKeywords);
    document.addEventListener('visibilitychange', refreshKeywords);
    return () => {
      window.removeEventListener('focus', refreshKeywords);
      document.removeEventListener('visibilitychange', refreshKeywords);
    };
  }, []);

  const fetchData = async () => {
    try {
      const [settingsRes, keywordsRes] = await Promise.all([
        api.get('/settings'),
        api.get('/keywords')
      ]);
      setSettings(settingsRes.data);
      setKeywords(keywordsRes.data);
    } catch (error) {
      toast.error('Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  const fetchThresholds = async () => {
    try {
      setThresholdsLoading(true);
      const res = await api.get('/alert-thresholds');
      setThresholds(res.data);
    } catch (error) {
      toast.error('Failed to load velocity thresholds');
    } finally {
      setThresholdsLoading(false);
    }
  };

  const handleSaveThresholds = async () => {
    try {
      await api.put('/alert-thresholds/bulk', { thresholds });
      toast.success('Velocity thresholds saved successfully');
    } catch (error) {
      toast.error('Failed to save thresholds');
    }
  };



  const updateThreshold = (platform, metric, field, value) => {
    setThresholds(prev => prev.map(t =>
      t.platform === platform
        ? { ...t, [field]: parseInt(value) || 0 }
        : t
    ));
  };

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    try {
      await api.put('/settings', settings);
      toast.success('Settings saved successfully');
    } catch (error) {
      toast.error('Failed to save settings');
    }
  };

  const handleAddKeyword = async (e) => {
    e.preventDefault();
    try {
      await api.post('/keywords', newKeyword);
      toast.success('Keyword added successfully');
      setDialogOpen(false);
      setNewKeyword({ category: 'violence', language: 'en', keyword: '', constituency: '' });
      fetchData();
    } catch (error) {
      toast.error('Failed to add keyword');
    }
  };

  const handleDeleteKeyword = async (id) => {
    try {
      await api.delete(`/keywords/${id}`);
      toast.success('Keyword deleted successfully');
      fetchData();
    } catch (error) {
      toast.error('Failed to delete keyword');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300 p-4 md:p-6 lg:p-8 max-w-none" data-testid="settings-page">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Settings</h1>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="h-9 p-1">
          <TabsTrigger value="unrest" className="text-xs px-4">Unrest predictor</TabsTrigger>
          <TabsTrigger value="sources" className="text-xs px-4">Profiles</TabsTrigger>
          <TabsTrigger value="keywords" className="text-xs px-4">Keywords</TabsTrigger>
          {isSuperAdmin && <TabsTrigger value="access" className="text-xs px-4">Access Management</TabsTrigger>}
          <TabsTrigger value="general" className="text-xs px-4">Risk Thresholds</TabsTrigger>
          <TabsTrigger value="leader-popularity" className="text-xs px-4">Constituency Leader Popularity</TabsTrigger>
        </TabsList>

        {/* Mounted lazily — this aggregation unions three collections and most
            Settings visits never open this tab. */}
        <TabsContent value="leader-popularity" className="space-y-4">
          {activeTab === 'leader-popularity' && <ConstituencyLeaderPopularity />}
        </TabsContent>

        {/* General Settings */}
        <TabsContent value="general" className="space-y-4">
          {/* Risk Thresholds */}
          <Card className="p-3">
            <form onSubmit={handleSaveSettings}>
              <div className="flex items-center gap-4">
                <span className="text-xs font-medium whitespace-nowrap">Risk Thresholds</span>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1">
                    <Label className="text-[10px] text-muted-foreground">High</Label>
                    <Input
                      type="number" min="0" max="100"
                      value={settings?.risk_threshold_high || 70}
                      onChange={(e) => setSettings({ ...settings, risk_threshold_high: parseInt(e.target.value) })}
                      className="h-7 w-16 text-xs"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <Label className="text-[10px] text-muted-foreground">Medium</Label>
                    <Input
                      type="number" min="0" max="100"
                      value={settings?.risk_threshold_medium || 40}
                      onChange={(e) => setSettings({ ...settings, risk_threshold_medium: parseInt(e.target.value) })}
                      className="h-7 w-16 text-xs"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <Label className="text-[10px] text-muted-foreground">Interval</Label>
                    <Input
                      type="number" min="5" max="1440"
                      value={settings?.monitoring_interval_minutes || 15}
                      onChange={(e) => setSettings({ ...settings, monitoring_interval_minutes: parseInt(e.target.value) })}
                      className="h-7 w-16 text-xs"
                    />
                  </div>
                </div>
                <Button type="submit" size="sm" className="h-7 px-2 text-[10px]">
                  <Save className="h-3 w-3 mr-1" /> Save
                </Button>
              </div>
            </form>
          </Card>

          {/* Viral Detection */}
          <Card className="p-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-semibold">Viral Detection</h3>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Label className="text-[11px]">Enabled</Label>
                    <Switch
                      checked={settings?.velocity_alerts_enabled ?? true}
                      onCheckedChange={(checked) => setSettings({ ...settings, velocity_alerts_enabled: checked })}
                      className="scale-75"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="text-[11px]">All Posts</Label>
                    <Switch
                      checked={settings?.alert_for_every_post ?? false}
                      onCheckedChange={(checked) => setSettings({ ...settings, alert_for_every_post: checked })}
                      className="scale-75"
                    />
                  </div>
                </div>
              </div>

              {/* Platform Threshold Cards */}
              {['x', 'youtube'].map(platform => {
                const threshold = thresholds.find(t => t.platform === platform);
                if (!threshold) return null;
                return (
                  <div key={platform} className="border rounded-lg p-4 mb-4">
                    <div className="flex items-center gap-2 mb-2">
                      <TrendingUp className="h-4 w-4" />
                      <h3 className="font-semibold">{platform === 'x' ? 'X (Twitter)' : 'YouTube'}</h3>
                    </div>
                    <p className="text-xs text-muted-foreground mb-4">
                      Alert when ANY metric (likes, retweets, comments, views) crosses these thresholds within the time window
                    </p>
                    <div className="grid grid-cols-4 gap-4">
                      <div className="space-y-2">
                        <Label className="text-xs text-green-600 font-medium">LOW Threshold</Label>
                        <Input
                          type="number"
                          value={threshold.low_threshold}
                          onChange={(e) => updateThreshold(threshold.platform, null, 'low_threshold', e.target.value)}
                          placeholder="100"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs text-amber-600 font-medium">MEDIUM Threshold</Label>
                        <Input
                          type="number"
                          value={threshold.medium_threshold}
                          onChange={(e) => updateThreshold(threshold.platform, null, 'medium_threshold', e.target.value)}
                          placeholder="500"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs text-red-600 font-medium">HIGH Threshold</Label>
                        <Input
                          type="number"
                          value={threshold.high_threshold}
                          onChange={(e) => updateThreshold(threshold.platform, null, 'high_threshold', e.target.value)}
                          placeholder="1000"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs font-medium">Time Window (min)</Label>
                        <Input
                          type="number"
                          value={threshold.time_window_minutes}
                          onChange={(e) => updateThreshold(threshold.platform, null, 'time_window_minutes', e.target.value)}
                          placeholder="60"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}

              <Button onClick={handleSaveThresholds} variant="secondary">
                <Save className="h-4 w-4 mr-2" />
                Save Thresholds
              </Button>
            </div>
          </Card>
        </TabsContent>



        <TabsContent value="sources" className="mt-2">
          <Sources />
        </TabsContent>

        {/* Keywords */}
        <TabsContent value="keywords" className="space-y-4">
          <Card className="p-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Keywords</h3>
                <div className="flex gap-2">
                  <Button
                    variant="outline" size="sm" className="h-7 px-2 text-xs"
                    onClick={async () => {
                      try { await api.post('/keywords/scan'); toast.success('Scan started'); }
                      catch { toast.error('Scan failed'); }
                    }}
                  >Scan</Button>
                  <Dialog open={dialogOpen} onOpenChange={(open) => {
                    setDialogOpen(open);
                    if (!open) { setNewKeyword({ category: 'violence', language: 'en', keyword: '', constituency: '' }); setTransliterationEnabled(true); setSuggestions([]); }
                  }}>
                    <DialogTrigger asChild>
                      <Button size="sm" className="h-7 px-2 text-xs"><Plus className="h-3 w-3 mr-1" /> Add</Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[400px]">
                      <DialogHeader>
                        <DialogTitle className="text-base">Add Keyword</DialogTitle>
                        <DialogDescription className="text-[10px]">
                          Enter a specific keyword or phrase to monitor for potential violations.
                        </DialogDescription>
                      </DialogHeader>
                      <form onSubmit={handleAddKeyword} className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label className="text-xs">Category</Label>
                            <Select value={newKeyword.category} onValueChange={(v) => setNewKeyword({ ...newKeyword, category: v })}>
                              <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="violence">Violence</SelectItem>
                                <SelectItem value="threat">Threat</SelectItem>
                                <SelectItem value="hate">Hate</SelectItem>
                                <SelectItem value="other">Others</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="text-xs">Language</Label>
                            <Select value={newKeyword.language} onValueChange={(v) => setNewKeyword({ ...newKeyword, language: v })}>
                              <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {KEYWORD_LANGUAGE_OPTIONS.map((o) => (
                                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <div>
                          <Label className="text-xs">Keyword</Label>
                          {newKeyword.language !== 'en' && newKeyword.language !== 'all' && (
                            <div className="flex items-center gap-2 mt-1 mb-1">
                              <Switch checked={transliterationEnabled} onCheckedChange={setTransliterationEnabled} className="scale-75" />
                              <span className="text-[10px] text-muted-foreground flex items-center gap-1"><Wand2 className="h-3 w-3" /> Auto-transliterate</span>
                            </div>
                          )}
                          <div className="relative">
                            <Input name="keywordInput" value={newKeyword.keyword} onChange={handleKeywordChange} placeholder="Enter keyword" required className="h-8 text-xs" autoComplete="off" />
                            {suggestions.length > 0 && (
                              <div className="absolute z-50 w-full mt-1 bg-background border rounded-md shadow-lg">
                                {suggestions.map((s, i) => (
                                  <button key={i} type="button" onClick={() => handleSuggestionClick(s)} className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent">{s}</button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                        <div>
                          <Label className="text-xs">Scope</Label>
                          {isSuperAdmin ? (
                            <>
                              <Input
                                list="ac-list"
                                value={newKeyword.constituency}
                                onChange={(e) => setNewKeyword({ ...newKeyword, constituency: e.target.value })}
                                placeholder="Leave blank for party-wide"
                                className="h-8 text-xs mt-1"
                                autoComplete="off"
                              />
                              <datalist id="ac-list">
                                {AC_NAMES.map((c) => <option key={c} value={c} />)}
                              </datalist>
                              <span className="text-[10px] text-muted-foreground">
                                {newKeyword.constituency ? `Owned by ${newKeyword.constituency}` : 'Party-wide (all constituencies)'}
                              </span>
                            </>
                          ) : (
                            <p className="text-[10px] text-muted-foreground mt-1">
                              Scoped to your constituency{assignedConstituency ? `: ${assignedConstituency}` : ''}
                            </p>
                          )}
                        </div>
                        <Button type="submit" className="w-full h-8 text-xs">Add</Button>
                      </form>
                    </DialogContent>
                  </Dialog>
                </div>
              </div>

              <Tabs defaultValue="violence" className="space-y-2">
                <TabsList className="h-8 p-1">
                  <TabsTrigger value="violence" className="text-xs px-3">Violence ({keywords.filter(k => k.category === 'violence').length})</TabsTrigger>
                  <TabsTrigger value="threat" className="text-xs px-3">Threat ({keywords.filter(k => k.category === 'threat').length})</TabsTrigger>
                  <TabsTrigger value="hate" className="text-xs px-3">Hate ({keywords.filter(k => k.category === 'hate').length})</TabsTrigger>
                  {/* 'other' = everything that is not violence/threat/hate: leader names, handles, hashtags and
                      narrative phrases (the ones the Mentions keyword list also shows). */}
                  <TabsTrigger value="other" className="text-xs px-3">Others ({keywords.filter(k => k.category === 'other').length})</TabsTrigger>
                </TabsList>
                {['violence', 'threat', 'hate', 'other'].map(category => {
                  const catKw = keywords.filter(k => k.category === category);
                  return (
                    <TabsContent key={category} value={category}>
                      {catKw.length === 0 ? (
                        <p className="text-xs text-muted-foreground text-center py-6">No keywords</p>
                      ) : (
                        <ScrollArea className="h-[200px]">
                          <div className="flex flex-wrap gap-2 pr-2">
                            {catKw.map(kw => (
                              <div key={kw.id} className="group inline-flex items-center gap-1.5 px-2 py-1 rounded border bg-secondary/30 text-xs">
                                <Badge variant="outline" className="text-[10px] px-1 py-0">{kw.language?.toUpperCase() || 'EN'}</Badge>
                                <span>{kw.keyword}</span>
                                {kw.is_party_wide ? (
                                  <Badge variant="secondary" className="text-[10px] px-1 py-0">Party-wide</Badge>
                                ) : kw.constituency ? (
                                  <Badge variant="outline" className="text-[10px] px-1 py-0 border-primary/40 text-primary">{kw.constituency}</Badge>
                                ) : null}
                                <button onClick={() => handleDeleteKeyword(kw.id)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive">
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </div>
                            ))}
                          </div>
                        </ScrollArea>
                      )}
                    </TabsContent>
                  );
                })}
              </Tabs>
            </div>
          </Card>
        </TabsContent>

        {isSuperAdmin && (
          <TabsContent value="access" className="mt-2">
            <AccessManagement />
          </TabsContent>
        )}

        <TabsContent value="unrest" className="mt-2">
          <UnrestPredictor />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Settings;