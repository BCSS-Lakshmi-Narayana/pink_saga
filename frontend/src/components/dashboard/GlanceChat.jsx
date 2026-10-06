import React, { useState, useEffect, useRef } from 'react';
import api from '../../lib/api';
import {
  ExternalLink, Users, Sparkles, Loader2, ArrowUp,
  MessageSquare, Target
} from 'lucide-react';
import { Button } from '../ui/button';

const GlanceChat = () => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [timeRange, setTimeRange] = useState('24h');
  const [selectedPlatform, setSelectedPlatform] = useState('all');
  const [customDateRange, setCustomDateRange] = useState({ start: '', end: '' });
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [searchHistory, setSearchHistory] = useState(() => {
    const saved = localStorage.getItem('glance_history');
    return saved ? JSON.parse(saved).slice(0, 10) : [];
  });
  const scrollRef = useRef(null);

  const saveToHistory = (query) => {
    const newHistory = [query, ...searchHistory.filter(h => h !== query)].slice(0, 10);
    setSearchHistory(newHistory);
    localStorage.setItem('glance_history', JSON.stringify(newHistory));
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isSearching]);

  const handleSearch = async (e, customQuery = null) => {
    e?.preventDefault();
    const query = customQuery || input;
    if (!query.trim()) return;

    saveToHistory(query.trim());

    const userMsg = { role: 'user', content: query, timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsSearching(true);

    try {
      const params = {
        query,
        timeRange: timeRange,
        platforms: selectedPlatform
      };

      if (timeRange === 'custom' && customDateRange.start && customDateRange.end) {
        params.startDate = customDateRange.start;
        params.endDate = customDateRange.end;
      }

      const response = await api.get('/search/glance', { params });

      const { aiAnalysis, results, platformBreakdown, totalResults, searchDuration, topLinks } = response.data;

      const sources = [];

      if (Array.isArray(topLinks) && topLinks.length > 0) {
        topLinks.slice(0, 4).forEach((l) => {
          sources.push({
            title: l.title || l.url,
            domain: l.source || 'Link',
            url: l.url || '#',
            image: l.image || null,
            snippet: l.snippet || '',
            count: l.count || 1,
            platform: 'link'
          });
        });
      }
      const byPlatform = {};
      if (results && results.length > 0) {
        results.forEach(item => {
          const pKey = item.platformKey || 'other';
          if (!byPlatform[pKey]) byPlatform[pKey] = [];
          byPlatform[pKey].push(item);
        });
      }

      ['x', 'youtube', 'instagram', 'facebook'].forEach(pKey => {
        if (byPlatform[pKey] && byPlatform[pKey].length > 0 && sources.length < 4) {
          const item = byPlatform[pKey][0];
          sources.push({
            title: item.title || item.text?.slice(0, 50) + '...',
            domain: pKey === 'x' ? '𝕏' : pKey === 'youtube' ? '▶️ YT' : pKey === 'instagram' ? 'Instagram' : pKey === 'facebook' ? 'Facebook' : item.platform,
            url: item.link || item.url || '#',
            platform: pKey
          });
        }
      });


      const aiMsg = {
        role: 'assistant',
        content: aiAnalysis || 'Unable to generate analysis.',
        timestamp: new Date(),
        sources,
        topLinks: Array.isArray(topLinks) ? topLinks : [],
        stats: {
          total: totalResults || 0,
          duration: searchDuration || '0s',
          platforms: platformBreakdown || {}
        }
      };

      setMessages(prev => [...prev, aiMsg]);
    } catch (error) {
      console.error('Glance Search Error:', error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: "Connection to the intelligence network failed. Please try again.",
        timestamp: new Date(),
        isError: true
      }]);
    } finally {
      setIsSearching(false);
    }
  };

  const renderMarkdown = (text) => {
    if (!text) return null;

    return text.split('\n').map((line, i) => {
      if (line.startsWith('### ')) {
        return <h3 key={i} className="text-sm font-semibold text-foreground mt-4 mb-2 flex items-center gap-2">
          <span className="w-1 h-4 bg-gradient-to-b from-violet-500 to-indigo-500 rounded-full"></span>
          {line.slice(4)}
        </h3>;
      }
      if (line.startsWith('## ')) {
        return <h2 key={i} className="text-base font-bold text-foreground mt-5 mb-3 pb-2 border-b border-violet-500/20">{line.slice(3)}</h2>;
      }
      if (line.startsWith('# ')) {
        return <h1 key={i} className="text-lg font-bold text-foreground mt-4 mb-2">{line.slice(2)}</h1>;
      }

      if (line.startsWith('- ') || line.startsWith('* ')) {
        const content = line.slice(2);
        return (
          <div key={i} className="flex items-start gap-2 my-1.5 pl-1">
            <span className="w-1.5 h-1.5 rounded-full bg-gradient-to-br from-violet-500 to-indigo-500 mt-2 flex-shrink-0"></span>
            <span className="text-foreground/85 leading-relaxed">{renderInlineStyles(content)}</span>
          </div>
        );
      }

      if (!line.trim()) return <div key={i} className="h-2"></div>;

      return <p key={i} className="text-foreground/80 leading-relaxed my-1.5">{renderInlineStyles(line)}</p>;
    });
  };

  const renderInlineStyles = (text) => {
    const parts = text.split(/(\*\*.*?\*\*|`.*?`|\[.*?\]\(.*?\))/g);
    return parts.map((part, j) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={j} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith('`') && part.endsWith('`')) {
        return <code key={j} className="px-1.5 py-0.5 bg-violet-500/10 rounded text-xs font-mono text-violet-600 dark:text-violet-400">{part.slice(1, -1)}</code>;
      }
      const linkMatch = part.match(/\[(.*?)\]\((.*?)\)/);
      if (linkMatch) {
        return <a key={j} href={linkMatch[2]} target="_blank" rel="noopener noreferrer" className="text-violet-600 dark:text-violet-400 hover:underline">{linkMatch[1]}</a>;
      }
      return <span key={j}>{part}</span>;
    });
  };

  return (
    <div className="w-full h-full flex bg-gradient-to-br from-card via-card to-violet-500/5 rounded-xl border border-border/50 shadow-md hover:shadow-lg transition-all overflow-hidden">
      {/* History Sidebar */}
      <div className="w-48 bg-gradient-to-b from-muted/50 to-muted/30 border-r border-border/50 flex flex-col">
        <div className="p-3 border-b border-border/50 bg-gradient-to-r from-violet-500/10 to-transparent">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow-sm">
              <Target className="h-3.5 w-3.5 text-white" />
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-bold tracking-tight bg-gradient-to-r from-violet-600 to-indigo-600 bg-clip-text text-transparent">GLANCE</span>
              <span className="text-[9px] text-muted-foreground">Intelligence Hub</span>
            </div>
          </div>
        </div>

        <div className="p-2">
          <Button
            variant="outline"
            size="sm"
            className="w-full h-8 text-xs gap-1.5 justify-start hover:bg-violet-500/10 border-violet-500/20"
            onClick={() => setMessages([])}
          >
            <MessageSquare className="h-3 w-3" />
            New chat
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 space-y-1">
          <p className="text-[9px] uppercase tracking-wider text-muted-foreground px-2 py-1">Recent</p>
          {searchHistory.slice(0, 8).map((h, i) => (
            <button
              key={i}
              onClick={(e) => handleSearch(e, h)}
              className="w-full text-left px-2 py-1.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-violet-500/10 rounded truncate transition-colors"
            >
              {h}
            </button>
          ))}
          {searchHistory.length === 0 && (
            <p className="text-[10px] text-muted-foreground/50 px-2 py-2">No history yet</p>
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        <div className="flex-1 overflow-y-auto" ref={scrollRef}>
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center px-6">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center mb-4 shadow-lg">
                <Sparkles className="h-6 w-6 text-white" />
              </div>
              <h3 className="text-sm font-medium mb-1">How can I help you today?</h3>
              <p className="text-xs text-muted-foreground mb-4 text-center max-w-xs">
                Ask me anything about social media trends, news, or real-time insights
              </p>

              <div className="grid grid-cols-2 gap-2 w-full max-w-sm">
                {[
                  { q: "What's trending today?", icon: "🔥", color: "from-orange-500/10 to-red-500/10 border-orange-500/20" },
                  { q: "Latest political news", icon: "🗳️", color: "from-blue-500/10 to-indigo-500/10 border-blue-500/20" },
                  { q: "Tech updates", icon: "💻", color: "from-green-500/10 to-emerald-500/10 border-green-500/20" },
                  { q: "Viral posts", icon: "📈", color: "from-purple-500/10 to-pink-500/10 border-purple-500/20" }
                ].map(({ q, icon, color }, i) => (
                  <button
                    key={i}
                    onClick={(e) => handleSearch(e, q)}
                    className={`flex items-center gap-2 p-2.5 text-[11px] text-left bg-gradient-to-br ${color} hover:scale-105 border rounded-lg transition-all shadow-sm hover:shadow-md`}
                  >
                    <span className="text-sm">{icon}</span>
                    <span className="truncate font-medium">{q}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`px-4 py-3 ${msg.role === 'assistant' ? 'bg-gradient-to-r from-violet-500/5 to-transparent' : ''}`}
                >
                  <div className="flex gap-3 max-w-2xl mx-auto">
                    <div className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 shadow-sm ${msg.role === 'assistant'
                        ? 'bg-gradient-to-br from-violet-600 to-indigo-600'
                        : 'bg-gradient-to-br from-slate-600 to-slate-700'
                      }`}>
                      {msg.role === 'assistant'
                        ? <Target className="h-3 w-3 text-white" />
                        : <Users className="h-3 w-3 text-white" />
                      }
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-medium text-muted-foreground mb-0.5">
                        {msg.role === 'assistant' ? 'GLANCE' : 'You'}
                      </p>
                      <div className="text-xs text-foreground/90">
                        {msg.role === 'user' ? (
                          <p>{msg.content}</p>
                        ) : msg.isError ? (
                          <p className="text-destructive">{msg.content}</p>
                        ) : (
                          <div className="space-y-1.5">{renderMarkdown(msg.content)}</div>
                        )}
                      </div>

                      {msg.role === 'assistant' && Array.isArray(msg.topLinks) && msg.topLinks.length > 0 && (
                        <div className="mt-3">
                          <div className="flex gap-2 overflow-x-auto pb-1">
                            {msg.topLinks.slice(0, 4).map((l, i) => (
                              <a
                                key={i}
                                href={l.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="min-w-[170px] max-w-[170px] rounded-lg border border-border bg-card hover:bg-muted/30 transition-colors overflow-hidden shadow-sm"
                              >
                                <div className="h-20 w-full bg-muted/40">
                                  {l.image ? (
                                    <img src={l.image} alt="" className="h-20 w-full object-cover" />
                                  ) : (
                                    <div className="h-20 w-full flex items-center justify-center text-[10px] text-muted-foreground">Link</div>
                                  )}
                                </div>
                                <div className="p-2">
                                  <div className="text-[10px] text-muted-foreground truncate">{l.source || 'Source'}</div>
                                  <div className="text-[11px] font-medium leading-snug line-clamp-2">{l.title || l.url}</div>
                                  {l.count ? (
                                    <div className="mt-1 text-[9px] text-muted-foreground">Shared {l.count}x</div>
                                  ) : null}
                                </div>
                              </a>
                            ))}
                          </div>
                        </div>
                      )}

                      {msg.role === 'assistant' && msg.sources && msg.sources.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {msg.sources.slice(0, 3).map((source, i) => (
                            <a
                              key={i}
                              href={source.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/20 rounded transition-colors"
                            >
                              <ExternalLink className="h-2 w-2" />
                              <span className="truncate max-w-[60px]">{source.domain}</span>
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {isSearching && (
                <div className="px-4 py-3 bg-gradient-to-r from-violet-500/5 to-transparent">
                  <div className="flex gap-3 max-w-2xl mx-auto">
                    <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center animate-pulse shadow-sm">
                      <Sparkles className="h-3 w-3 text-white" />
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      <span>Thinking...</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Input Bar */}
        <div className="p-3 border-t border-border/50 bg-gradient-to-r from-violet-500/5 to-transparent">
          <form onSubmit={handleSearch} className="max-w-2xl mx-auto">
            <div className="flex items-center justify-between mb-2 px-1">
              <div className="flex items-center gap-2">
                {[
                  { id: '24h', label: '24 Hours' },
                  { id: '7d', label: '1 Week' },
                  { id: '30d', label: '1 Month' },
                  { id: 'custom', label: 'Custom' }
                ].map((range) => (
                  <button
                    key={range.id}
                    type="button"
                    onClick={() => {
                      setTimeRange(range.id);
                      if (range.id === 'custom') {
                        setShowDatePicker(true);
                      } else {
                        setShowDatePicker(false);
                      }
                    }}
                    className={`text-[10px] px-2 py-0.5 rounded-full border transition-all ${timeRange === range.id
                        ? 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white border-transparent shadow-sm font-medium'
                        : 'bg-muted/50 text-muted-foreground border-border hover:bg-violet-500/10 hover:border-violet-500/20'
                      }`}
                  >
                    {range.label}
                  </button>
                ))}
              </div>

              <select
                value={selectedPlatform}
                onChange={(e) => setSelectedPlatform(e.target.value)}
                className="bg-muted/50 text-[10px] border border-border rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-violet-500/50 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                <option value="all">All Platforms</option>
                <option value="twitter">X (Twitter)</option>
                <option value="youtube">YouTube</option>
                <option value="instagram">Instagram</option>
                <option value="facebook">Facebook</option>
              </select>
            </div>

            {showDatePicker && timeRange === 'custom' && (
              <div className="flex items-center gap-2 mb-2 px-1 py-2 bg-violet-500/10 rounded border border-violet-500/20">
                <div className="flex items-center gap-1">
                  <label className="text-[9px] text-muted-foreground">From:</label>
                  <input
                    type="date"
                    value={customDateRange.start}
                    onChange={(e) => setCustomDateRange({ ...customDateRange, start: e.target.value })}
                    className="bg-background text-[10px] border border-border rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-violet-500/50"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <label className="text-[9px] text-muted-foreground">To:</label>
                  <input
                    type="date"
                    value={customDateRange.end}
                    onChange={(e) => setCustomDateRange({ ...customDateRange, end: e.target.value })}
                    className="bg-background text-[10px] border border-border rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-violet-500/50"
                  />
                </div>
              </div>
            )}

            <div className="relative flex items-center">
              <Target className="absolute left-3 h-4 w-4 text-violet-500" />
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={isSearching}
                placeholder={`Ask GLANCE anything...`}
                className="w-full h-10 pl-10 pr-12 bg-muted/50 border border-border hover:border-violet-500/30 focus:border-violet-500/50 rounded-xl text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-violet-500/30 transition-all"
              />
              <Button
                type="submit"
                size="sm"
                disabled={!input.trim() || isSearching}
                className="absolute right-2 h-7 w-7 p-0 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 shadow-sm"
              >
                {isSearching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-3.5 w-3.5" />}
              </Button>
            </div>
            <p className="text-[9px] text-center text-muted-foreground/50 mt-1.5">
              GLANCE may produce inaccurate results. Verify critical information.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
};

export default GlanceChat;
