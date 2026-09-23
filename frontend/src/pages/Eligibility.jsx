import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../api/client';

const Eligibility = () => {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  const handleCheck = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const response = await api.get(`/auth/eligibility?email=${encodeURIComponent(email)}`);
      
      if (response.data.eligible) {
        // Technically they still need a token to sign up. So we route them to the login endpoint silently to get the pending token.
        try {
          const params = new URLSearchParams();
          params.append('username', email);
          params.append('password', 'dummy'); 
          
          const loginRes = await api.post('/auth/login', params, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
          });
          
          // Store token briefly and send to signup
          localStorage.setItem('token', loginRes.data.access_token);
          navigate('/signup');
        } catch (err) {
           setError('You are not eligible. Please contact your administrator.');
        }
      } else {
        setError('You are not eligible. Please contact your administrator.');
      }
    } catch (err) {
      setError('You are not eligible. Please contact your administrator.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-4">
      {/* Logo Header */}
      <div className="flex flex-col items-center mb-8">
        <h1 className="text-cyan-400 font-bold text-xl tracking-wide flex items-center">
          <svg className="w-6 h-6 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7l-2 1m2-1l-2-1m2 1v2.5M14 4l-2-1-2 1M4 7l2-1M4 7l2 1M4 7v2.5M12 21l-2-1m2 1l2-1m-2 1v-2.5M6 18l-2-1v-2.5M18 18l2-1v-2.5" />
          </svg>
          Pipeline AI
        </h1>
      </div>

      <div className="bg-gray-800 border border-gray-700 rounded-[8px] p-8 w-full max-w-md shadow-2xl relative overflow-hidden">
        {/* Subtle top glow */}
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-cyan-500 to-transparent opacity-50"></div>
        
        <div className="text-center mb-6">
          <h2 className="text-white text-2xl font-serif mb-2">Check Your Eligibility</h2>
          <p className="text-gray-400 text-sm">
            Enter your professional email to see if your organization is ready for high-performance product enrichment.
          </p>
        </div>
        
        {error && (
          <div className="bg-red-500/10 border border-red-500/50 text-red-400 p-3 rounded text-sm mb-6 text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleCheck} className="space-y-6">
          <div>
            <label className="block text-gray-300 text-xs font-mono uppercase tracking-wider mb-2">Work Email Address</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <span className="text-gray-500 font-serif italic text-lg">@</span>
              </div>
              <input 
                type="email" 
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-md py-3 pl-10 pr-3 text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-colors"
                placeholder="name@company.com"
              />
            </div>
          </div>

          <button 
            type="submit" 
            disabled={isLoading}
            className="w-full bg-cyan-400 hover:bg-cyan-300 text-gray-900 font-bold py-3 px-4 rounded-md transition-colors flex items-center justify-center disabled:opacity-50 text-lg shadow-[0_0_15px_rgba(34,211,238,0.3)]"
          >
            {isLoading ? 'Checking...' : 'Check Eligibility →'}
          </button>
          
          <div className="flex justify-center mt-6">
            {/* Subtle rings graphic */}
            <div className="flex">
              <div className="w-8 h-8 rounded-full border border-gray-700 -mr-2"></div>
              <div className="w-8 h-8 rounded-full border border-gray-700"></div>
            </div>
          </div>
        </form>
      </div>

      <div className="mt-8 text-sm text-gray-400">
        Already have an account? <Link to="/login" className="text-cyan-500 hover:text-cyan-400 font-medium">Log in</Link>
      </div>
      
      <div className="mt-12 text-xs text-gray-600">
        © 2024 Pipeline AI. All rights reserved.
      </div>
    </div>
  );
};

export default Eligibility;
