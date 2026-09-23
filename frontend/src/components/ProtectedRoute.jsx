import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const ProtectedRoute = ({ children, allowedRoles }) => {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900 text-cyan-500">
        <div className="w-8 h-8 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!user) {
    // Redirect them to the /login page, but save the current location they were trying to go to
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // If the user's status is pending (needs signup completion), force them to signup
  if (user.status === 'pending' && location.pathname !== '/signup') {
    return <Navigate to="/signup" replace />;
  }
  
  // If the user is removed, log them out entirely
  if (user.status === 'removed') {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    // User role not authorized
    return <Navigate to="/" replace />;
  }

  return children;
};

export default ProtectedRoute;
