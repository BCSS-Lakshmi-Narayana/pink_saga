import { useState, useEffect, createContext, useContext } from 'react';
import api from '../lib/api';
import { toast } from 'sonner';

const AuthContext = createContext(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const initAuth = async () => {
      if (token) {
        try {
          const response = await api.get('/auth/me');
          setUser(response.data);
        } catch (error) {
          console.error('Failed to fetch user:', error);
          logout();
        }
      }
      setLoading(false);
    };

    initAuth();
  }, [token]);

  const login = async (email, password) => {
    try {
      const response = await api.post('/auth/login', { email, password });
      const { access_token, user: userData } = response.data;

      localStorage.setItem('token', access_token);
      setToken(access_token);
      setUser(userData);

      toast.success('Logged in successfully');
      return userData;
    } catch (error) {
      const message = error.response?.data?.message || 'Login failed';
      toast.error(message);
      throw error;
    }
  };

  const register = async (email, password, full_name, role = 'level-1') => {
    try {
      await api.post('/auth/register', { email, password, full_name, role });
      return login(email, password);
    } catch (error) {
      const message = error.response?.data?.message || 'Registration failed';
      toast.error(message);
      throw error;
    }
  };

  const logout = () => {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
    toast.info('Logged out');
  };

  // Derived scope helpers used by route guards / map gating.
  const role = user?.role;
  const isSuperAdmin =
    user?.is_super_admin === true || role === 'superadmin' || role === 'super_admin';
  const isScoped =
    user?.is_scoped === true || ['mla', 'mp', 'senior_leader'].includes(role);
  const assignedConstituency = user?.assigned_constituency || null;
  const extraConstituencies = user?.extra_constituencies || [];
  const allowedConstituencies = [assignedConstituency, ...extraConstituencies].filter(Boolean);
  const canAccessConstituency = (name) => {
    if (isSuperAdmin || !isScoped) return true;
    const norm = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return allowedConstituencies.some((c) => norm(c) === norm(name));
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        login,
        register,
        logout,
        loading,
        isSuperAdmin,
        isScoped,
        assignedConstituency,
        allowedConstituencies,
        canAccessConstituency,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export default AuthContext;
