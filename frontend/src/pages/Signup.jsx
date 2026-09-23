import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Eye, EyeOff, ArrowLeft } from 'lucide-react';

const Signup = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  const navigate = useNavigate();
  const { login } = useAuth();

  const handleSignup = async (e) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      return setError('Passwords do not match');
    }
    if (password.length < 12) {
      return setError('Password must be at least 12 characters');
    }

    setIsLoading(true);

    try {
      const response = await api.post('/auth/signup', {
        username,
        password
      });
      
      const { access_token, user } = response.data;
      
      // Update global context with verified user profile
      login(access_token, user);
      
      // Route to dashboard
      navigate('/');
      
    } catch (err) {
      if (err.response && err.response.data && err.response.data.detail) {
        setError(err.response.data.detail);
      } else {
        setError('Failed to complete registration');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const goBack = () => {
    // If they go back, clear the temporary pending token and return to login/eligibility
    localStorage.removeItem('token');
    navigate('/login'); // Or /eligibility
  };

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-4">
      {/* Logo Header */}
      <div className="flex items-center mb-8">
        <h1 className="text-cyan-400 font-bold text-lg tracking-wide flex items-center">
          <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7l-2 1m2-1l-2-1m2 1v2.5M14 4l-2-1-2 1M4 7l2-1M4 7l2 1M4 7v2.5M12 21l-2-1m2 1l2-1m-2 1v-2.5M6 18l-2-1v-2.5M18 18l2-1v-2.5" />
          </svg>
          Pipeline AI
        </h1>
      </div>

      <div className="bg-gray-800 border border-gray-700 rounded-[8px] p-8 w-full max-w-md shadow-2xl relative overflow-hidden">
        {/* Subtle top glow */}
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50"></div>
        
        <h2 className="text-white text-xl font-medium mb-2">Complete Your Registration</h2>
        <p className="text-gray-400 text-sm mb-6">Set your access credentials to initialize your data pipeline environment.</p>
        
        {error && (
          <div className="bg-red-500/10 border border-red-500/50 text-red-400 p-3 rounded text-sm mb-6">
            {error}
          </div>
        )}

        <form onSubmit={handleSignup} className="space-y-5">
          <div>
            <label className="block text-gray-300 text-xs font-mono uppercase tracking-wider mb-2">Username</label>
            <input 
              type="text" 
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded-md py-2.5 px-3 text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-colors"
              placeholder="johndoe_ai"
            />
          </div>

          <div>
            <label className="block text-gray-300 text-xs font-mono uppercase tracking-wider mb-2">Password</label>
            <div className="relative">
              <input 
                type={showPassword ? "text" : "password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-md py-2.5 pl-3 pr-10 text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-colors"
                placeholder="••••••••••••"
              />
              <button 
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-500 hover:text-gray-300 transition-colors"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          
          <div>
            <label className="block text-gray-300 text-xs font-mono uppercase tracking-wider mb-2">Re-enter Password</label>
            <div className="relative">
              <input 
                type={showPassword ? "text" : "password"}
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-md py-2.5 pl-3 pr-10 text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-colors"
                placeholder="••••••••••••"
              />
              <button 
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-500 hover:text-gray-300 transition-colors"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <button 
            type="submit" 
            disabled={isLoading}
            className="w-full bg-blue-500 hover:bg-blue-400 text-white font-medium py-2.5 px-4 rounded-md transition-colors flex items-center justify-center mt-6 disabled:opacity-50"
          >
            {isLoading ? 'Creating...' : 'Create Account'}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button 
            onClick={goBack}
            className="text-gray-400 hover:text-white text-sm flex items-center justify-center w-full transition-colors"
          >
            <ArrowLeft size={16} className="mr-1" /> Back
          </button>
        </div>
      </div>
      
      <div className="mt-8 w-full max-w-md flex justify-between text-xs text-gray-500">
        <span>© 2024 Pipeline AI. All rights reserved.</span>
        <a href="#" className="hover:text-gray-300">Security</a>
      </div>
    </div>
  );
};

export default Signup;
