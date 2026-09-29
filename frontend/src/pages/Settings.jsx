import React, { useState, useEffect } from 'react';
import { Key, Activity, Users, Eye, EyeOff, MoreVertical, UserPlus, Database, Clock, Download, Save, X, CheckCircle2, XCircle, Loader2, Trash2 } from 'lucide-react';
import api from '../api/client';
import CategorySpecsCard from '../components/CategorySpecsCard';

export default function Settings() {
  const [showApiModal, setShowApiModal] = useState(false);
  const [credentials, setCredentials] = useState({
    nano_banana: '',
    serper: '',
    openrouter: ''
  });
  const [verifyStatus, setVerifyStatus] = useState({});
  const [verifying, setVerifying] = useState({});
  const [showKey, setShowKey] = useState({});

  // Models State
  const [showModelsModal, setShowModelsModal] = useState(false);
  const [openRouterModels, setOpenRouterModels] = useState([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [selectedModels, setSelectedModels] = useState({
    scraping_model: 'google/gemini-2.5-flash',
    image_generation_model: 'google/gemini-2.5-flash-image'
  });

  const [health, setHealth] = useState({ redis: 'LOADING...', celery_beat: 'LOADING...' });

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 10000);
    return () => clearInterval(interval);
  }, []);

  const fetchHealth = async () => {
    try {
      const res = await api.get('/health');
      setHealth(res.data);
    } catch (err) {
      console.error("Failed to fetch health", err);
      setHealth({ redis: 'DOWN', celery_beat: 'DOWN' });
    }
  };

  useEffect(() => {
    if (showApiModal) {
      fetchCredentials();
    }
  }, [showApiModal]);

  const fetchCredentials = async () => {
    try {
      const res = await api.get('/settings/credentials');
      setCredentials(res.data);
    } catch (err) {
      console.error("Failed to fetch credentials", err);
    }
  };

  useEffect(() => {
    if (showModelsModal) {
      fetchConfiguredModels();
      fetchOpenRouterModels();
    }
  }, [showModelsModal]);

  const fetchConfiguredModels = async () => {
    try {
      const res = await api.get('/settings/models');
      setSelectedModels({
        scraping_model: res.data.scraping_model || 'google/gemini-2.5-flash',
        image_generation_model: res.data.image_generation_model || 'google/gemini-2.5-flash-image'
      });
    } catch (err) {
      console.error("Failed to fetch configured models", err);
    }
  };

  const fetchOpenRouterModels = async () => {
    setFetchingModels(true);
    try {
      const res = await api.get('/settings/openrouter-models');
      if (res.data.status === 'success') {
        setOpenRouterModels(res.data.models || []);
      } else {
        setOpenRouterModels([
          { id: 'google/gemini-2.5-flash', name: 'DeepSeek Chat (Fallback)' },
          { id: 'google/gemini-2.5-flash-image', name: 'Gemini 2.5 Flash Image (Fallback)' }
        ]);
      }
    } catch (err) {
      console.error("Failed to fetch openrouter models", err);
      setOpenRouterModels([
        { id: 'google/gemini-2.5-flash', name: 'DeepSeek Chat (Fallback)' },
        { id: 'google/gemini-2.5-flash-image', name: 'Gemini 2.5 Flash Image (Fallback)' }
      ]);
    } finally {
      setFetchingModels(false);
    }
  };

  const handleSaveModels = async () => {
    try {
      await api.post('/settings/models', selectedModels);
      setShowModelsModal(false);
    } catch (err) {
      console.error("Failed to save models", err);
    }
  };

  const handleSaveCredentials = async () => {
    try {
      await api.post('/settings/credentials', credentials);
    } catch (err) {
      console.error("Failed to save credentials", err);
    }
  };

  const handleRemoveKey = async (toolKey) => {
    const updated = { ...credentials, [toolKey]: '' };
    setCredentials(updated);
    try {
      await api.post('/settings/credentials', updated);
      setVerifyStatus(prev => ({ ...prev, [toolKey]: null }));
    } catch (err) {
      console.error("Failed to remove credential", err);
    }
  };

  const handleVerify = async (toolKey) => {
    setVerifying(prev => ({ ...prev, [toolKey]: true }));
    try {
      await handleSaveCredentials(); // Save first so backend uses new key
      const res = await api.post(`/settings/verify/${toolKey}`);
      setVerifyStatus(prev => ({ 
        ...prev, 
        [toolKey]: { status: res.data.status, message: res.data.message || res.data.data?.label, credits: res.data.credits_remaining } 
      }));

      // Refresh credit cache so REMAINING CREDITS badge updates globally
      if (toolKey === 'openrouter' && res.data.status === 'success') {
        try {
          await api.post('/credits/refresh');
        } catch (e) {
          // Non-critical
        }
      }
    } catch (err) {
      setVerifyStatus(prev => ({ 
        ...prev, 
        [toolKey]: { status: 'error', message: err.response?.data?.message || 'Verification failed' } 
      }));
    } finally {
      setVerifying(prev => ({ ...prev, [toolKey]: false }));
    }
  };

  const renderVerifyResult = (toolKey) => {
    const status = verifyStatus[toolKey];
    if (!status) return null;
    if (status.status === 'success') {
      return (
        <div className="flex flex-col mt-2">
          <div className="flex items-center gap-1.5 text-xs text-emerald-600 font-semibold">
            <CheckCircle2 size={14} /> {status.message}
          </div>
          {status.credits !== undefined && (
            <div className="text-xs text-slate-500 mt-1">Remaining Credits: <span className="font-bold text-slate-700">{status.credits}</span></div>
          )}
        </div>
      );
    }
    return (
      <div className="flex items-center gap-1.5 text-xs text-rose-500 font-semibold mt-2">
        <XCircle size={14} /> {status.message}
      </div>
    );
  };

  return (
    <div className="h-full bg-slate-50 flex flex-col p-6 overflow-auto text-slate-800 font-sans">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 tracking-tight">System Configuration</h1>
      </div>

      <div className="flex flex-col gap-6 mb-6">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-[15px] font-bold text-slate-800 mb-1">
             <Key size={16} className="text-blue-600" /> API Connections
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h3 className="font-semibold text-slate-800 text-[15px]">AI Tools Credentials</h3>
              <p className="text-sm text-slate-500 mt-1">Manage API keys for OpenRouter and Serper API.</p>
            </div>
            <button 
              onClick={() => setShowApiModal(true)}
              className="w-full sm:w-auto px-4 py-2 bg-indigo-50 text-indigo-700 font-semibold rounded-md border border-indigo-200 hover:bg-indigo-100 transition-colors text-sm text-center shrink-0"
            >
              Manage Credentials
            </button>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mt-3">
            <div>
              <h3 className="font-semibold text-slate-800 text-[15px]">AI Models Configuration</h3>
              <p className="text-sm text-slate-500 mt-1">Select the specific LLM models for text (scraping) and image generation via OpenRouter.</p>
            </div>
            <button 
              onClick={() => setShowModelsModal(true)}
              className="w-full sm:w-auto px-4 py-2 bg-indigo-50 text-indigo-700 font-semibold rounded-md border border-indigo-200 hover:bg-indigo-100 transition-colors text-sm text-center shrink-0"
            >
              Select Models
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-[15px] font-bold text-slate-800 mb-1">
             <Activity size={16} className="text-blue-600" /> System Health
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Redis Server */}
            <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] flex items-center justify-between">
              <div className="flex items-center gap-3">
                 <div className="w-9 h-9 rounded-full bg-rose-50 flex items-center justify-center text-rose-500">
                   <Database size={16} />
                 </div>
                 <div>
                   <div className="font-semibold text-slate-800 text-sm">Redis Server</div>
                   <div className="text-[11px] text-slate-500">6379 / main-cache</div>
                 </div>
              </div>
              <div className={`flex items-center gap-1.5 text-[10px] font-bold tracking-wide ${health.redis === 'UP' ? 'text-emerald-500' : health.redis === 'LOADING...' ? 'text-slate-400' : 'text-rose-500'}`}>
                <div className={`w-2 h-2 rounded-full ${health.redis === 'UP' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : health.redis === 'LOADING...' ? 'bg-slate-300' : 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]'}`}></div> {health.redis}
              </div>
            </div>

            {/* Celery Beat */}
            <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] flex items-center justify-between">
              <div className="flex items-center gap-3">
                 <div className="w-9 h-9 rounded-full bg-orange-50 flex items-center justify-center text-orange-500">
                   <Clock size={16} />
                 </div>
                 <div>
                   <div className="font-semibold text-slate-800 text-sm">Celery Beat</div>
                   <div className="text-[11px] text-slate-500">Scheduler engine</div>
                 </div>
              </div>
              <div className={`flex items-center gap-1.5 text-[10px] font-bold tracking-wide ${health.celery_beat === 'POLLING' ? 'text-emerald-500' : health.celery_beat === 'LOADING...' ? 'text-slate-400' : 'text-rose-500'}`}>
                <div className={`w-2 h-2 rounded-full ${health.celery_beat === 'POLLING' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : health.celery_beat === 'LOADING...' ? 'bg-slate-300' : 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]'}`}></div> {health.celery_beat}
              </div>
            </div>
          </div>
        </div>

        {/* Category Specs Component */}
        <CategorySpecsCard />

      </div>



      {/* AI Credentials Modal */}
      {showApiModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <Key size={18} className="text-blue-600" /> AI Tools Credentials
              </h2>
              <button onClick={() => setShowApiModal(false)} className="text-slate-400 hover:text-slate-700">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-6 bg-slate-50/50">
              {/* Open Router */}
              <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="font-semibold text-slate-800 text-[14px]">Open Router</h3>
                </div>
                <div className="relative mb-3">
                  <input 
                    type={showKey.openrouter ? "text" : "password"} 
                    value={credentials.openrouter} 
                    onChange={(e) => setCredentials({...credentials, openrouter: e.target.value})}
                    placeholder="Enter OpenRouter API Key"
                    className="w-full bg-white border border-slate-300 rounded-md py-2 pl-3 pr-10 text-xs text-slate-700 font-mono focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none" 
                  />
                  <button 
                    type="button"
                    onClick={() => setShowKey(prev => ({ ...prev, openrouter: !prev.openrouter }))}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showKey.openrouter ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={() => handleVerify('openrouter')}
                    disabled={verifying.openrouter}
                    className="flex-1 py-1.5 border border-slate-300 rounded text-xs font-semibold text-slate-700 hover:bg-slate-50 flex justify-center items-center gap-2"
                  >
                    {verifying.openrouter ? <Loader2 size={14} className="animate-spin" /> : "Verify & Check Credits"}
                  </button>
                  <button
                    onClick={() => handleRemoveKey('openrouter')}
                    className="px-3 py-1.5 border border-rose-200 text-rose-600 rounded text-xs font-semibold hover:bg-rose-50 flex justify-center items-center"
                    title="Remove Key"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                {renderVerifyResult('openrouter')}
              </div>

              
              {/* Serper API */}
              <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="font-semibold text-slate-800 text-[14px]">Serper API</h3>
                </div>
                <div className="relative mb-3">
                  <input 
                    type={showKey.serper ? "text" : "password"} 
                    value={credentials.serper} 
                    onChange={(e) => setCredentials({...credentials, serper: e.target.value})}
                    placeholder="Enter Serper API Key"
                    className="w-full bg-white border border-slate-300 rounded-md py-2 pl-3 pr-10 text-xs text-slate-700 font-mono focus:ring-2 focus:ring-slate-500 focus:border-slate-500 outline-none" 
                  />
                  <button 
                    type="button"
                    onClick={() => setShowKey(prev => ({ ...prev, serper: !prev.serper }))}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showKey.serper ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={() => handleVerify('serper')}
                    disabled={verifying.serper}
                    className="flex-1 py-1.5 border border-slate-300 rounded text-xs font-semibold text-slate-700 hover:bg-slate-50 flex justify-center items-center gap-2"
                  >
                    {verifying.serper ? <Loader2 size={14} className="animate-spin" /> : "Verify Connection"}
                  </button>
                  <button
                    onClick={() => handleRemoveKey('serper')}
                    className="px-3 py-1.5 border border-rose-200 text-rose-600 rounded text-xs font-semibold hover:bg-rose-50 flex justify-center items-center"
                    title="Remove Key"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                {renderVerifyResult('serper')}
              </div>
            </div>
            
            <div className="px-6 py-4 border-t border-slate-100 bg-white flex justify-end gap-3">
              <button 
                onClick={async () => {
                  await handleSaveCredentials();
                  setShowApiModal(false);
                }}
                className="px-5 py-2 bg-[#3626A7] text-white rounded-md text-sm font-semibold hover:bg-blue-800 transition-colors"
              >
                Save & Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showModelsModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <Activity size={18} className="text-blue-600" /> AI Models Configuration
              </h2>
              <button onClick={() => setShowModelsModal(false)} className="text-slate-400 hover:text-slate-700">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1 space-y-6">
              {fetchingModels ? (
                <div className="flex justify-center items-center h-32">
                  <Loader2 className="animate-spin text-indigo-600" size={24} />
                  <span className="ml-2 text-sm text-slate-500">Fetching available models from OpenRouter...</span>
                </div>
              ) : (
                <>
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-5">
                    <h3 className="font-bold text-slate-800 mb-1 text-[15px]">Text Generation (Scraping) Model</h3>
                    <p className="text-xs text-slate-500 mb-3">Used by the pipeline to extract and structure product data from raw HTML. List filtered to highly capable models to ensure JSON integrity.</p>
                    <select
                      value={selectedModels.scraping_model}
                      onChange={(e) => setSelectedModels({...selectedModels, scraping_model: e.target.value})}
                      className="w-full border border-slate-300 rounded-md p-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      {openRouterModels
                        .filter(m => [
                          'openai/gpt-4o',
                          'openai/gpt-4o-mini',
                          'anthropic/claude-haiku-4.5',
                          'anthropic/claude-sonnet-5',
                          'google/gemini-3.8-flash',
                          'google/gemini-3.7-flash',
                          'google/gemini-3.6-flash',
                          'google/gemini-3.5-flash',
                          'google/gemini-2.5-pro',
                          'google/gemini-2.5-flash',
                          'google/gemini-2.5-flash'
                        ].includes(m.id))
                        .map(m => (
                        <option key={m.id} value={m.id}>{m.name || m.id}</option>
                      ))}
                    </select>
                  </div>
                  
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-5">
                    <h3 className="font-bold text-slate-800 mb-1 text-[15px]">Image Generation Model</h3>
                    <p className="text-xs text-slate-500 mb-3">Used to generate AI lifestyle and feature images.</p>
                    <select
                      value={selectedModels.image_generation_model}
                      onChange={(e) => setSelectedModels({...selectedModels, image_generation_model: e.target.value})}
                      className="w-full border border-slate-300 rounded-md p-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      {openRouterModels
                        .filter(m => [
                          'google/gemini-3-pro-image',
                          'google/gemini-3.1-flash-image',
                          'google/gemini-3.1-flash-lite-image',
                          'google/gemini-2.5-flash-image'
                        ].includes(m.id))
                        .map(m => (
                        <option key={m.id} value={m.id}>{m.id}</option>
                      ))}
                    </select>
                  </div>
                </>
              )}
            </div>
            
            <div className="px-6 py-4 border-t border-slate-100 bg-white flex justify-end gap-3">
              <button 
                onClick={handleSaveModels}
                className="px-5 py-2 bg-[#3626A7] text-white rounded-md text-sm font-semibold hover:bg-blue-800 transition-colors flex items-center gap-2"
              >
                <Save size={16} /> Save Models
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
