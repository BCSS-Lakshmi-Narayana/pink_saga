import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from './AuthContext';
import api from '../lib/api';

const FEATURED_PAGES = new Set(['/alerts', '/monitors', '/grievances']);

const normalizeRoutePath = (value) => {
    if (!value || typeof value !== 'string') return '/';
    const withoutQuery = value.split('?')[0].split('#')[0];
    const path = (withoutQuery.replace(/\/+$/, '') || '/').toLowerCase();

    if (path.startsWith('/reports/generate/')) return '/reports';
    if (path.startsWith('/instagram-monitor/')) return '/instagram-monitor';
    if (path.startsWith('/person-of-interest/')) return '/person-of-interest';
    if (path.startsWith('/mla/')) return '/mla';

    return path;
};

const RbacContext = createContext(null);

export const useRbac = () => {
    const context = useContext(RbacContext);
    if (!context) {
        throw new Error('useRbac must be used within RbacProvider');
    }
    return context;
};

export const RbacProvider = ({ children }) => {
    const { user } = useAuth();
    const [allowedPages, setAllowedPages] = useState([]);
    const [permissions, setPermissions] = useState({});
    const [loading, setLoading] = useState(true);

    const fetchPermissions = useCallback(async () => {
        try {
            setLoading(true);
            const response = await api.get('/rbac/my-permissions');
            setAllowedPages(Array.isArray(response.data.allowed_pages) ? response.data.allowed_pages : []);
            setPermissions(response.data.permissions || {});
        } catch (error) {
            console.error('Failed to fetch permissions:', error);
            setAllowedPages([]);
            setPermissions({});
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!user) {
            setAllowedPages([]);
            setPermissions({});
            setLoading(false);
            return;
        }

        if (user.allowed_pages && Array.isArray(user.allowed_pages)) {
            setAllowedPages(user.allowed_pages);
            setPermissions(user.permissions || {});
            setLoading(false);
            return;
        }

        fetchPermissions();
    }, [user, fetchPermissions]);

    const normalizedAllowedPages = useMemo(
        () => allowedPages.map((path) => normalizeRoutePath(path)),
        [allowedPages]
    );

    const refreshPermissions = useCallback(async () => {
        await fetchPermissions();
    }, [fetchPermissions]);

    const hasAccess = useCallback((pagePath) => {
        if (loading) return true;
        if (!user) return false;
        if (user.role === 'superadmin') return true;

        const normalizedPath = normalizeRoutePath(pagePath);
        if (normalizedAllowedPages.includes(normalizedPath)) return true;

        // Fallback for nested children of allowed modules.
        return normalizedAllowedPages.some((allowedPath) => (
            normalizedPath.startsWith(`${allowedPath}/`)
        ));
    }, [loading, user, normalizedAllowedPages]);

    const hasFeatureAccess = useCallback((pagePath, featureId) => {
        if (loading) return true;
        if (!user) return false;
        if (user.role === 'superadmin') return true;

        const normalizedPath = normalizeRoutePath(pagePath);
        const pagePerm = permissions?.[normalizedPath];

        if (!pagePerm || !pagePerm.enabled) return false;

        if (!FEATURED_PAGES.has(normalizedPath)) return true;

        if (!featureId || typeof featureId !== 'string') return false;
        if (!Array.isArray(pagePerm.features)) return false;
        return pagePerm.features.includes(featureId);
    }, [loading, permissions, user]);

    return (
        <RbacContext.Provider
            value={{
                allowedPages: normalizedAllowedPages,
                permissions,
                hasAccess,
                hasFeatureAccess,
                normalizeRoutePath,
                refreshPermissions,
                loading
            }}
        >
            {children}
        </RbacContext.Provider>
    );
};

export default RbacContext;
