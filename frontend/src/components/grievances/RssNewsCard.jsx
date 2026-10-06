import React, { useState } from 'react';
import { Calendar, Clock, MapPin, ExternalLink, Globe, Tag, Newspaper, Trash2, Bookmark, Share2, Copy, FileText, Shield } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '../../lib/utils';
// Same shared resolver Mentions and Alerts use — one vocabulary across all three.
import { getArticleStance } from '../../lib/sentiment';
import { languageLabel } from '../../lib/languages';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { toast } from 'sonner';

// Same positive / neutral / negative scheme as Mentions & Alerts.
const SENTIMENT_CONFIG = {
  positive: { label: 'Positive', color: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-800/30', dot: 'bg-emerald-500' },
  neutral: { label: 'Neutral', color: 'bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-900/20 dark:text-slate-300 dark:border-slate-700/30', dot: 'bg-slate-500' },
  negative: { label: 'Negative', color: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/20 dark:text-rose-400 dark:border-rose-800/30', dot: 'bg-rose-500' },
  neutral: { label: 'Neutral', color: 'bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-800/40 dark:text-slate-400 dark:border-slate-700/50', dot: 'bg-slate-500' },
  unknown: { label: 'Unknown', color: 'bg-slate-50 text-slate-500 border-slate-200 dark:bg-slate-800/40 dark:text-slate-500 dark:border-slate-700/50', dot: 'bg-slate-400' }
};

const CATEGORY_CONFIG = {
  crime: { label: 'Crime', color: 'bg-red-50 text-red-700 border-red-200 ring-1 ring-red-100 dark:bg-red-950/20 dark:text-red-400 dark:border-red-800/30' },
  politics: { label: 'Politics', color: 'bg-blue-50 text-blue-700 border-blue-200 ring-1 ring-blue-100 dark:bg-blue-950/20 dark:text-blue-400 dark:border-blue-800/30' },
  development: { label: 'Development', color: 'bg-green-50 text-green-700 border-green-200 ring-1 ring-green-100 dark:bg-green-950/20 dark:text-green-400 dark:border-green-800/30' },
  agriculture: { label: 'Agriculture', color: 'bg-amber-50 text-amber-700 border-amber-200 ring-1 ring-amber-100 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-800/30' },
  health: { label: 'Health', color: 'bg-pink-50 text-pink-700 border-pink-200 ring-1 ring-pink-100 dark:bg-pink-950/20 dark:text-pink-400 dark:border-pink-800/30' },
  education: { label: 'Education', color: 'bg-indigo-50 text-indigo-700 border-indigo-200 ring-1 ring-indigo-100 dark:bg-indigo-950/20 dark:text-indigo-400 dark:border-indigo-800/30' },
  law_order: { label: 'Law & Order', color: 'bg-orange-50 text-orange-700 border-orange-200 ring-1 ring-orange-100 dark:bg-orange-950/20 dark:text-orange-400 dark:border-orange-800/30' },
  accident: { label: 'Accident', color: 'bg-red-50 text-red-650 border-red-200 ring-1 ring-red-100 dark:bg-red-950/20 dark:text-red-400 dark:border-red-800/30' },
  sports: { label: 'Sports', color: 'bg-emerald-50 text-emerald-700 border-emerald-200 ring-1 ring-emerald-100 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-800/30' },
  culture: { label: 'Culture', color: 'bg-purple-50 text-purple-700 border-purple-200 ring-1 ring-purple-100 dark:bg-purple-950/20 dark:text-purple-400 dark:border-purple-800/30' },
  infrastructure: { label: 'Infrastructure', color: 'bg-cyan-50 text-cyan-700 border-cyan-200 ring-1 ring-cyan-100 dark:bg-cyan-950/20 dark:text-cyan-400 dark:border-cyan-800/30' },
  economy: { label: 'Economy', color: 'bg-emerald-50 text-emerald-700 border-emerald-200 ring-1 ring-emerald-100 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-800/30' },
  technology: { label: 'Technology', color: 'bg-teal-50 text-teal-700 border-teal-200 ring-1 ring-teal-100 dark:bg-teal-950/20 dark:text-teal-400 dark:border-teal-800/30' },
  entertainment: { label: 'Entertainment', color: 'bg-purple-50 text-purple-700 border-purple-200 ring-1 ring-purple-100 dark:bg-purple-950/20 dark:text-purple-400 dark:border-purple-800/30' },
  general: { label: 'General', color: 'bg-slate-50 text-slate-650 border-slate-200 ring-1 ring-slate-100 dark:bg-slate-800/40 dark:text-slate-400 dark:border-slate-700/50' },
};

function timeAgo(date) {
  if (!date) return '';
  const diff = Date.now() - new Date(date).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return format(new Date(date), 'dd MMM yyyy');
}

export const RssNewsCard = ({ article, canManage = false, onDelete, onSentimentChange }) => {
  const [imgError, setImgError] = useState(false);
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [isOriginalOpen, setIsOriginalOpen] = useState(false);

  const pubDate = article.published_date ? new Date(article.published_date) : null;
  const displayTitle = article.title_english || article.title;
  const showOriginal = article.is_translated && article.title && article.title_english && article.title !== article.title_english;
  const displaySummary = article.content || article.summary_english || article.summary;

  const catConfig = CATEGORY_CONFIG[article.category] || CATEGORY_CONFIG.general;
  const sentKey = String(article.sentiment || '').toLowerCase();
  
  let sentConfigKey = 'unknown';
  if (sentKey === 'positive') sentConfigKey = 'positive';
  else if (sentKey === 'negative') sentConfigKey = 'negative';
  else if (sentKey === 'neutral' || sentKey === 'moderate') sentConfigKey = 'neutral';
  else if (sentKey === 'neutral') sentConfigKey = 'neutral';
  
  const sentConfig = SENTIMENT_CONFIG[sentConfigKey];
  const stance = getArticleStance(article);
  const sourceName = article.source_name || article.source || article.source_domain || 'Unknown Source';
  const hasImage = article.image_url && !imgError;

  const handleCopyLink = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const url = article.source_url || article.url;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied to clipboard!");
    } catch (err) {
      toast.error("Failed to copy link.");
    }
  };

  const handleShare = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const url = article.source_url || article.url;
    const shareText = `*${displayTitle}*\nSource: ${sourceName}\nRead more: ${url}`;
    try {
      if (navigator.share) {
        await navigator.share({
          title: displayTitle,
          text: `Check out this article from ${sourceName}`,
          url: url,
        });
        toast.success("Shared successfully!");
      } else {
        await navigator.clipboard.writeText(shareText);
        toast.success("Article details copied to clipboard!");
      }
    } catch (err) {
      console.error("Share failed", err);
    }
  };

  const handleBookmarkToggle = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsBookmarked(!isBookmarked);
    toast.success(isBookmarked ? "Removed from bookmarks" : "Article bookmarked successfully!");
  };

  return (
    <>
      <div className={cn(
        "relative flex flex-col justify-between overflow-hidden bg-white dark:bg-[#0d1117] border border-slate-200 dark:border-slate-800 rounded-lg hover:shadow-md transition-all duration-200 shadow-sm h-full pl-5 pr-4 py-4",
        "before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1",
        sentConfigKey === 'positive' && "before:bg-emerald-500",
        sentConfigKey === 'negative' && "before:bg-rose-500",
        sentConfigKey === 'neutral' && "before:bg-slate-400",
        sentConfigKey === 'neutral' && "before:bg-slate-400",
        sentConfigKey === 'unknown' && "before:bg-slate-300"
      )}>
        <div>
          {/* Header row: badges and actions */}
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div className="flex flex-wrap gap-1.5 items-center">
              {sentConfigKey !== 'unknown' && (
                <span className={cn(
                  "text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border inline-flex items-center gap-1",
                  sentConfig.color
                )}>
                  <span className={cn("w-1.5 h-1.5 rounded-full", sentConfig.dot)} />
                  {sentConfig.label}
                </span>
              )}
              {/*
                * Client-relative stance, same badge Mentions and Alerts show.
                * `sentiment` above is the tone; this is who the article helps.
                * Hidden when `inferred` — that means the article has not been
                * re-scored through the Node pipeline yet, and the resolver would
                * only be restating the sentiment badge beside it.
                */}
              {stance && !stance.inferred && (
                <span className={cn(
                  "text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded border inline-flex items-center gap-1",
                  stance.cls
                )}>
                  <Shield className="h-2.5 w-2.5" />{stance.label}
                </span>
              )}
              <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded border", catConfig.color)}>
                {catConfig.label}
              </span>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-100 dark:bg-blue-950/20 dark:text-blue-400 dark:border-blue-800/30">
                {languageLabel(article.language)}
              </span>
            </div>

            {canManage && (
              <div className="flex gap-1.5 items-center z-20">
                <select
                  value={sentKey === 'neutral' ? 'neutral' : (sentKey || 'unknown')}
                  onChange={(e) => onSentimentChange?.(article, e.target.value)}
                  title="Edit sentiment"
                  className="text-[10px] font-semibold px-1.5 py-0.5 rounded border cursor-pointer outline-none bg-white text-slate-700 border-slate-200 focus:ring-1 focus:ring-violet-400 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-800"
                >
                  <option value="positive">Positive</option>
                  <option value="neutral">Neutral</option>
                  <option value="negative">Negative</option>
                  <option value="neutral">Neutral</option>
                  <option value="unknown">Unknown</option>
                </select>
                <button
                  type="button"
                  title="Delete article"
                  onClick={() => {
                    if (window.confirm('Delete this article? This cannot be undone.')) onDelete?.(article);
                  }}
                  className="text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded p-1 transition-colors dark:hover:bg-rose-950/20"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* Article Image (16:9) */}
          <div className="relative w-full aspect-[16/9] rounded-lg overflow-hidden mb-3 bg-slate-100 dark:bg-slate-800 border border-slate-100 dark:border-slate-800 shrink-0">
            {hasImage ? (
              <img
                src={article.image_url}
                alt="News article"
                className="w-full h-full object-cover"
                loading="lazy"
                onError={() => setImgError(true)}
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-violet-100 to-indigo-50 dark:from-slate-800 dark:to-slate-900 flex items-center justify-center">
                <Newspaper className="h-8 w-8 text-violet-300 dark:text-slate-600" />
              </div>
            )}
            {/* RSS / Scraper badge on image */}
            <span className="absolute top-2 left-2 bg-[#6366f1] text-white text-[9px] font-bold px-2 py-0.5 rounded shadow-sm z-10 uppercase">
              {article.source_type === 'scraper' ? 'Scraper' : 'RSS'}
            </span>
          </div>

          {/* Headline */}
          <h4 className="font-bold text-slate-900 dark:text-slate-100 text-sm md:text-base leading-snug line-clamp-2 mb-2 hover:text-violet-600 transition-colors" title={displayTitle}>
            {displayTitle}
          </h4>

          {/* Summary clamped */}
          {displaySummary ? (
            <p className="text-xs md:text-[13px] text-slate-600 dark:text-slate-400 line-clamp-3 mb-4 leading-relaxed">
              {displaySummary}
            </p>
          ) : (
            <p className="text-slate-450 italic text-xs mb-4">No summary available.</p>
          )}

          {/* Keywords tags if present */}
          {article.keywords_matched && article.keywords_matched.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 mb-3">
              <Tag className="h-3 w-3 text-slate-400 mr-0.5 shrink-0" />
              {article.keywords_matched.slice(0, 3).map((tag) => (
                <span 
                  key={tag} 
                  className="px-1.5 py-0.5 rounded bg-violet-50 text-violet-600 border border-violet-100 text-[10px] font-medium dark:bg-violet-950/20 dark:text-violet-400 dark:border-violet-800/30"
                >
                  {tag}
                </span>
              ))}
              {article.keywords_matched.length > 3 && (
                <span className="text-[9px] text-slate-400 font-medium">+{article.keywords_matched.length - 3}</span>
              )}
            </div>
          )}
        </div>

        <div>
          {/* Metadata Row */}
          <div className="space-y-1.5 text-[11px] text-slate-500 dark:text-slate-400 border-t border-slate-100 dark:border-slate-800 pt-3 mb-3">
            {sourceName && (
              <div className="flex items-center gap-1.5">
                <span className="shrink-0 text-slate-400">🌐 Source:</span>
                <span className="font-medium text-slate-700 dark:text-slate-300 truncate">{sourceName}</span>
              </div>
            )}
            {pubDate && (
              <div className="flex items-center gap-1.5">
                <span className="shrink-0 text-slate-400">📅 Published:</span>
                <span className="text-slate-600 dark:text-slate-400">{format(pubDate, 'dd MMM yyyy, h:mm a')}</span>
              </div>
            )}
            {pubDate && (
              <div className="flex items-center gap-1.5">
                <span className="shrink-0 text-slate-400">🛰 Detected:</span>
                <span className="text-slate-600 dark:text-slate-400">{timeAgo(pubDate)}</span>
              </div>
            )}
            {article.district && article.district !== 'all' && (
              <div className="flex items-center gap-1.5">
                <span className="shrink-0 text-slate-400">📍 District:</span>
                <span className="font-medium text-slate-700 dark:text-slate-300">{article.district}</span>
              </div>
            )}
          </div>

          {/* Footer actions */}
          <div className="flex flex-wrap items-center justify-between gap-1 pt-1.5 border-t border-slate-100 dark:border-slate-800">
            <a 
              href={article.source_url || article.url} 
              target="_blank" 
              rel="noopener noreferrer" 
              className="text-xs font-semibold text-violet-600 dark:text-violet-400 hover:text-violet-800 dark:hover:text-violet-300 flex items-center gap-1 z-20 px-1.5 py-1 rounded hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              <span>Read Article</span>
            </a>

            {showOriginal && (
              <button 
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setIsOriginalOpen(true); }}
                className="text-xs font-medium text-slate-650 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-350 flex items-center gap-1 z-20 px-1.5 py-1 rounded hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors"
              >
                <FileText className="h-3.5 w-3.5" />
                <span>Open Original</span>
              </button>
            )}

            <div className="flex items-center gap-1 ml-auto">
              <button 
                onClick={handleBookmarkToggle}
                className={cn(
                  "p-1.5 rounded hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors z-20",
                  isBookmarked ? "text-amber-500" : "text-slate-400 hover:text-slate-600"
                )}
                title="Bookmark"
              >
                <Bookmark className={cn("h-3.5 w-3.5", isBookmarked && "fill-current")} />
              </button>

              <button 
                onClick={handleShare}
                className="p-1.5 rounded hover:bg-slate-50 dark:hover:bg-slate-900 text-slate-400 hover:text-slate-600 transition-colors z-20"
                title="Share"
              >
                <Share2 className="h-3.5 w-3.5" />
              </button>

              <button 
                onClick={handleCopyLink}
                className="p-1.5 rounded hover:bg-slate-50 dark:hover:bg-slate-900 text-slate-400 hover:text-slate-600 transition-colors z-20"
                title="Copy Link"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Original Content Modal */}
      {showOriginal && (
        <Dialog open={isOriginalOpen} onOpenChange={setIsOriginalOpen}>
          <DialogContent className="sm:max-w-[600px] bg-white dark:bg-[#0f0f0f] border-slate-200 dark:border-slate-800">
            <DialogHeader>
              <DialogTitle className="text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Newspaper className="h-5 w-5 text-violet-500" />
                Original Article
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500">
                Untranslated source contents.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-4">
              <div>
                <h4 className="text-xs font-semibold text-slate-450 uppercase tracking-wider mb-1">Original Title</h4>
                <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{article.title}</p>
              </div>
              {article.summary && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-450 uppercase tracking-wider mb-1">Original Summary</h4>
                  <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">{article.summary}</p>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setIsOriginalOpen(false)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
};

export default RssNewsCard;
