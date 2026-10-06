import React, { useMemo, useState } from 'react';
import { Search, X, Info } from 'lucide-react';
import { STATE_MLAS } from '../../data/stateMLAs';

/**
 * Constituency assignment for the user create / edit modals.
 *
 * Ticking "Restrict to selected constituencies" sets `is_scoped` on the user,
 * which is what makes the backend narrow every query to the chosen seats.
 * One or many seats may be selected.
 *
 * The MLA is shown next to each seat rather than picked separately — there is
 * exactly one sitting member per constituency, so it is a label, not a choice.
 */

// Roles the backend scopes by definition; the toggle would be misleading.
const INHERENTLY_SCOPED_ROLES = new Set(['mla', 'mp', 'senior_leader', 'constituency_manager']);

const ScopeAssignmentFields = ({ value, onChange, role }) => {
    const [search, setSearch] = useState('');

    const normalizedRole = role === 'super_admin' ? 'superadmin' : role;
    const isSuperAdmin = normalizedRole === 'superadmin';
    const isInherentlyScoped = INHERENTLY_SCOPED_ROLES.has(normalizedRole);

    const selected = useMemo(
        () => (Array.isArray(value.constituencies) ? value.constituencies : []),
        [value.constituencies]
    );

    const allSeats = useMemo(
        () => [...STATE_MLAS].sort((a, b) => a.constituency.localeCompare(b.constituency)),
        []
    );

    const visibleSeats = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return allSeats;
        return allSeats.filter(
            (m) =>
                m.constituency.toLowerCase().includes(q) ||
                (m.mla || '').toLowerCase().includes(q)
        );
    }, [allSeats, search]);

    const patch = (fields) => onChange({ ...value, ...fields });

    const toggleSeat = (name) => {
        patch({
            constituencies: selected.includes(name)
                ? selected.filter((c) => c !== name)
                : [...selected, name]
        });
    };

    if (isSuperAdmin) {
        return (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 flex gap-2">
                <Info size={15} className="text-amber-600 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-800">
                    Super admins always see every constituency. Area restrictions do not apply.
                </p>
            </div>
        );
    }

    const showPicker = value.is_scoped || isInherentlyScoped;

    return (
        <div className="rounded-lg border border-gray-200 bg-gray-50/70 p-3 space-y-3">
            <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500/30"
                    checked={Boolean(value.is_scoped) || isInherentlyScoped}
                    disabled={isInherentlyScoped}
                    onChange={(e) => patch({
                        is_scoped: e.target.checked,
                        // Clear the selection when un-restricting, so re-ticking
                        // later can't silently reinstate a stale assignment.
                        ...(e.target.checked ? {} : { constituencies: [] })
                    })}
                />
                <span>
                    <span className="block text-sm font-medium text-gray-800">
                        Restrict to selected constituencies
                    </span>
                    <span className="block text-xs text-gray-500 mt-0.5">
                        {isInherentlyScoped
                            ? 'Always on for this role.'
                            : 'This user will only see data for the constituencies selected below.'}
                    </span>
                </span>
            </label>

            {showPicker && (
                <div className="space-y-2">
                    {selected.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                            {selected.map((name) => (
                                <span
                                    key={name}
                                    className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md bg-indigo-50 border border-indigo-200 text-xs font-medium text-indigo-700"
                                >
                                    {name}
                                    <button
                                        type="button"
                                        onClick={() => toggleSeat(name)}
                                        className="p-0.5 rounded hover:bg-indigo-100"
                                        aria-label={`Remove ${name}`}
                                    >
                                        <X size={11} />
                                    </button>
                                </span>
                            ))}
                        </div>
                    )}

                    <div className="relative">
                        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search constituency or MLA…"
                            className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                        />
                    </div>

                    <div className="max-h-52 overflow-y-auto rounded-lg border border-gray-200 bg-white divide-y divide-gray-100">
                        {visibleSeats.length === 0 && (
                            <p className="px-3 py-4 text-xs text-gray-500 text-center">
                                No constituency matches “{search}”.
                            </p>
                        )}
                        {visibleSeats.map((m) => (
                            <label
                                key={m.key}
                                className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-gray-50"
                            >
                                <input
                                    type="checkbox"
                                    className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500/30"
                                    checked={selected.includes(m.constituency)}
                                    onChange={() => toggleSeat(m.constituency)}
                                />
                                <span className="min-w-0 flex-1">
                                    <span className="block text-sm text-gray-800 truncate">{m.constituency}</span>
                                    <span className="block text-xs text-gray-500 truncate">
                                        {m.vacant ? 'Seat vacant' : <>{m.mla} <span className="text-gray-400">({m.party})</span></>}
                                    </span>
                                </span>
                            </label>
                        ))}
                    </div>

                    <p className="text-xs text-gray-500">
                        {selected.length === 0
                            ? 'Select at least one constituency — a restricted user with none assigned would see nothing.'
                            : `${selected.length} constituenc${selected.length === 1 ? 'y' : 'ies'} selected.`}
                    </p>
                </div>
            )}
        </div>
    );
};

export default ScopeAssignmentFields;
