import React, { useState, useMemo } from 'react';
import {
    ChevronDown, X as XIcon, Facebook,
    Globe, BarChart3, Plus, Trash2, Calendar, User, Building2, BadgeCheck, Download, Loader2, MapPin, Rss, Radio, Scale
} from 'lucide-react';
import { Button } from '../ui/button';
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem,
    DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator
} from '../ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { cn } from '../../lib/utils';
import { Card } from '../ui/card';

/* ═══════════════════════════════════════════════════════════════ */
/*                  PLATFORM ICONS & COMPONENTS                   */
/* ═══════════════════════════════════════════════════════════════ */

// X (Twitter) Logo
const XLogo = ({ className }) => (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
);

// Facebook Logo
const FacebookLogo = ({ className }) => (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
);

// Instagram Logo
const InstagramLogo = ({ className }) => (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
    </svg>
);

// YouTube Logo
const YouTubeLogo = ({ className }) => (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
        <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
);

/* ═══════════════════════════════════════════════════════════════ */
/*                  MAIN NAVBAR COMPONENT                         */
/* ═══════════════════════════════════════════════════════════════ */

/** Stance filter values — must match backend utils/stanceFilter.js. */
const STANCE_OPTIONS = [
    { value: 'supportive', label: 'Supportive', dot: 'bg-blue-500' },
    { value: 'opposing', label: 'Opposing', dot: 'bg-rose-500' },
    { value: 'neutral', label: 'Neutral', dot: 'bg-slate-400' },
];

export const GrievanceTopNavbar = ({
    activePlatform = 'all',
    onPlatformChange,
    selectedHandle = null,
    onHandleChange,
    stats = {},
    grievances = [],
    sources = [],
    onAddSource,
    onRemoveSource,
    onFetchSourceHistory,
    onFetchKeywords,
    fetchingSource,
    locationFilter = null,
    onLocationChange,
    uniqueLocations = [],
    stanceFilter = null,
    onStanceChange,
}) => {
    const [isHandleDropdownOpen, setIsHandleDropdownOpen] = useState(false);
    const [isLocationDropdownOpen, setIsLocationDropdownOpen] = useState(false);
    const [isStanceDropdownOpen, setIsStanceDropdownOpen] = useState(false);

    // Platform tabs
    const PLATFORMS = [
        { id: 'all', label: 'All', icon: null, color: 'text-slate-600' },
        { id: 'x', label: 'X', icon: XLogo, color: 'text-black' },
        { id: 'facebook', label: 'Facebook', icon: FacebookLogo, color: 'text-[#1877F2]' },
        { id: 'instagram', label: 'Instagram', icon: InstagramLogo, color: 'text-[#E4405F]' },
        { id: 'youtube', label: 'YouTube', icon: YouTubeLogo, color: 'text-[#FF0000]' },
        { id: 'rss',     label: 'Web Articles', icon: Rss,        color: 'text-violet-600' },
        // Live chat is its own feed — it is NOT part of "All" and never mixes
        // with grievance/mention counters.
        { id: 'ytlive',  label: 'YouTube LIVE', icon: Radio,      color: 'text-red-600', live: true },
    ];

    const selectedHandleData = sources.find(h => h.handle === selectedHandle || h.id === selectedHandle);

    return (
        <div className="bg-white border-b border-slate-200 flex flex-col">
            <div className="px-6 py-0">
                {/* ─────────────────────────────────────────────────── */
                /*              SECTION 1: PLATFORM TABS                */
                /* ─────────────────────────────────────────────────── */}
                <div className="flex items-center gap-3 border-b border-slate-100 overflow-x-auto scrollbar-hide py-1">
                    {PLATFORMS.map((platform) => {
                        const isActive = activePlatform === platform.id;
                        const Icon = platform.icon;

                        return (
                            <button
                                key={platform.id}
                                onClick={() => onPlatformChange?.(platform.id)}
                                className={cn(
                                    'flex items-center gap-3 px-6 py-4 text-base font-semibold transition-all duration-200 relative whitespace-nowrap rounded-lg active:scale-95 active:translate-y-[1px]',
                                    'hover:bg-slate-50',
                                    isActive
                                        ? 'text-slate-900 font-semibold'
                                        : 'text-slate-600 hover:text-slate-900',
                                    isActive && 'border-b-2 border-blue-500'
                                )}
                            >
                                {Icon ? (
                                    <Icon className={cn('h-5 w-5', platform.color)} />
                                ) : (
                                    <Globe className="h-5 w-5 text-slate-600" />
                                )}
                                <span>{platform.label}</span>
                                {platform.live && (
                                    <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                                )}
                            </button>
                        );
                    })}
                </div>

                {activePlatform !== 'rss' && activePlatform !== 'ytlive' && (
                <div className="flex items-center justify-end gap-4 py-3">
                    {/* Location Filter Dropdown */}
                    <div className="flex items-center gap-2">
                        <DropdownMenu open={isLocationDropdownOpen} onOpenChange={setIsLocationDropdownOpen}>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className={cn(
                                        'flex items-center gap-2 font-medium',
                                        locationFilter ? 'bg-emerald-50 text-emerald-700 border-emerald-300' : ''
                                    )}
                                >
                                    <MapPin className="h-3.5 w-3.5" />
                                    <span className="truncate max-w-[130px]">
                                        {locationFilter || 'Location'}
                                    </span>
                                    <ChevronDown className="h-4 w-4 opacity-50" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56 max-h-72 overflow-y-auto">
                                <DropdownMenuLabel className="text-slate-700 font-semibold">
                                    Filter by Location
                                </DropdownMenuLabel>
                                <DropdownMenuSeparator />

                                {/* Clear selection */}
                                {locationFilter && (
                                    <>
                                        <DropdownMenuItem
                                            onClick={() => {
                                                onLocationChange?.(null);
                                                setIsLocationDropdownOpen(false);
                                            }}
                                            className="cursor-pointer text-slate-600 hover:bg-slate-100"
                                        >
                                            <span className="flex items-center gap-2">
                                                <XIcon className="h-3.5 w-3.5" />
                                                Clear Selection
                                            </span>
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                    </>
                                )}

                                {/* Location options */}
                                {uniqueLocations.length > 0 ? (
                                    uniqueLocations.map((loc) => (
                                        <DropdownMenuItem
                                            key={loc.city}
                                            onClick={() => {
                                                onLocationChange?.(loc.city);
                                                setIsLocationDropdownOpen(false);
                                            }}
                                            className={cn(
                                                'cursor-pointer transition-colors',
                                                locationFilter === loc.city
                                                    ? 'bg-emerald-50 text-emerald-700 font-semibold'
                                                    : 'text-slate-700 hover:bg-slate-100'
                                            )}
                                        >
                                            <div className="flex items-center justify-between w-full">
                                                <span className="flex items-center gap-2">
                                                    <MapPin className="h-3 w-3 text-slate-400" />
                                                    {loc.city}
                                                </span>
                                                <span className={cn(
                                                    'text-xs font-medium ml-2',
                                                    locationFilter === loc.city ? 'text-emerald-600' : 'text-slate-400'
                                                )}>
                                                    {loc.count}
                                                </span>
                                            </div>
                                        </DropdownMenuItem>
                                    ))
                                ) : (
                                    <div className="px-3 py-2 text-xs text-slate-400 text-center">
                                        No locations detected
                                    </div>
                                )}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>

                    {/* Stance Filter Dropdown — the Supportive / Opposing / Neutral badge */}
                    <div className="flex items-center gap-2">
                        <DropdownMenu open={isStanceDropdownOpen} onOpenChange={setIsStanceDropdownOpen}>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className={cn(
                                        'flex items-center gap-2 font-medium',
                                        stanceFilter === 'supportive' ? 'bg-blue-50 text-blue-700 border-blue-300'
                                            : stanceFilter === 'opposing' ? 'bg-rose-50 text-rose-700 border-rose-300'
                                            : stanceFilter === 'neutral' ? 'bg-slate-100 text-slate-700 border-slate-300' : ''
                                    )}
                                >
                                    <Scale className="h-3.5 w-3.5" />
                                    <span>{STANCE_OPTIONS.find((o) => o.value === stanceFilter)?.label || 'Stance'}</span>
                                    <ChevronDown className="h-4 w-4 opacity-50" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-44">
                                <DropdownMenuLabel className="text-slate-700 font-semibold">
                                    Filter by Stance
                                </DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                {stanceFilter && (
                                    <>
                                        <DropdownMenuItem
                                            onClick={() => { onStanceChange?.(null); setIsStanceDropdownOpen(false); }}
                                            className="cursor-pointer text-slate-600 hover:bg-slate-100"
                                        >
                                            <span className="flex items-center gap-2">
                                                <XIcon className="h-3.5 w-3.5" />
                                                All Stances
                                            </span>
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                    </>
                                )}
                                {STANCE_OPTIONS.map((opt) => (
                                    <DropdownMenuItem
                                        key={opt.value}
                                        onClick={() => { onStanceChange?.(opt.value); setIsStanceDropdownOpen(false); }}
                                        className={cn(
                                            'cursor-pointer transition-colors',
                                            stanceFilter === opt.value ? 'bg-emerald-50 text-emerald-700 font-semibold' : 'text-slate-700 hover:bg-slate-100'
                                        )}
                                    >
                                        <span className="flex items-center gap-2">
                                            <span className={cn('h-2 w-2 rounded-full', opt.dot)} />
                                            {opt.label}
                                        </span>
                                    </DropdownMenuItem>
                                ))}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>

                    {/* Official Handles Dropdown - Only show if All platforms selected or as fallback */}
                   {activePlatform === 'all' && (
                        <div className="flex items-center gap-2 pl-4 border-l border-slate-200">
                        <span className="text-xs font-medium text-slate-600 hidden sm:inline">
                            Official Handle:
                        </span>
                        <DropdownMenu open={isHandleDropdownOpen} onOpenChange={setIsHandleDropdownOpen}>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className={cn(
                                        'flex items-center gap-2 font-medium',
                                        selectedHandle ? 'bg-blue-50 text-blue-700 border-blue-300' : ''
                                    )}
                                >
                                    <span className="truncate max-w-[150px]">
                                        {selectedHandleData?.display_name || selectedHandleData?.handle || 'Select Handle'}
                                    </span>
                                    <ChevronDown className="h-4 w-4 opacity-50" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56">
                                <DropdownMenuLabel className="text-slate-700 font-semibold">
                                    Filter by Account
                                </DropdownMenuLabel>
                                <DropdownMenuSeparator />

                                {/* Clear selection */}
                                {selectedHandle && (
                                    <>
                                        <DropdownMenuItem
                                            onClick={() => {
                                                onHandleChange?.(null);
                                                setIsHandleDropdownOpen(false);
                                            }}
                                            className="cursor-pointer text-slate-600 hover:bg-slate-100"
                                        >
                                            <span className="flex items-center gap-2">
                                                <XIcon className="h-3.5 w-3.5" />
                                                Clear Selection
                                            </span>
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                    </>
                                )}

                                {/* Handle options */}
                                {sources.map((source) => (
                                    <DropdownMenuItem
                                        key={source.id || source.handle}
                                        onClick={() => {
                                            onHandleChange?.(source.handle);
                                            setIsHandleDropdownOpen(false);
                                        }}
                                        className={cn(
                                            'cursor-pointer transition-colors pr-1',
                                            selectedHandle === source.handle
                                                ? 'bg-blue-50 text-blue-700 font-semibold'
                                                : 'text-slate-700 hover:bg-slate-100'
                                        )}
                                    >
                                        <div className="flex items-center justify-between w-full gap-2">
                                            <div className="flex flex-col gap-0.5 min-w-0">
                                                <span className="font-medium truncate">{source.display_name || source.handle}</span>
                                                <span className="text-xs text-slate-500">@{source.handle}</span>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onRemoveSource?.(source);
                                                    setIsHandleDropdownOpen(false);
                                                }}
                                                className="shrink-0 p-1 rounded hover:bg-red-50 text-slate-300 hover:text-red-500 transition-colors"
                                                title="Delete account"
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                    </DropdownMenuItem>
                                ))}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                   )}

                    {/* Add Account Button */}
                    <div className="flex items-center gap-2 pl-4 border-l border-slate-200">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={onAddSource}
                            className="gap-2 font-medium text-blue-600 border-blue-200 hover:bg-blue-50 hover:border-blue-300"
                        >
                            <Plus className="h-3.5 w-3.5" />
                            Add Account
                        </Button>
                    </div>
                </div>
                )}
            </div>

            {/* Monitored accounts section hidden — Add Account button moved to top right */}
        </div>
    );
};

export default GrievanceTopNavbar;
