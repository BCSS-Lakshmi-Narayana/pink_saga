import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { BRAND, LOCAL_LOGO } from '../config/partyMedia';

const ProtectedRoute = ({ children }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="relative">
          <img
            src={LOCAL_LOGO}
            alt={`${BRAND.partyShort} logo`}
            className="h-16 w-16 rounded-full object-contain bg-white p-1.5 border-2 border-pink-500 shadow-lg"
          />
          <div className="absolute inset-0 rounded-full border-2 border-t-pink-500 border-r-transparent border-b-transparent border-l-transparent animate-spin" />
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return children;
};

export default ProtectedRoute;
