import React, { useState, useEffect } from 'react';
import api from '../api/client';
import { UploadCloud, Play, Calendar, AlertCircle, Loader2, XCircle, Search, RefreshCw, ChevronLeft, ChevronRight, Check, Copy } from 'lucide-react';
import clsx from 'clsx';
import InsufficientCreditsModal from '../components/InsufficientCreditsModal';


const useSessionState = (key, defaultValue) => {
  const [value, setValue] = useState(() => {
    try {
      const saved = sessionStorage.getItem(key);
      if (saved !== null) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.error("Session storage parse error:", e);
    }
    return defaultValue;
  });

  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.error("Session storage set error:", e);
    }
  }, [key, value]);

  return [value, setValue];
};

export default function CreateJob() {
  const [taskName, setTaskName] = useSessionState('cj_taskName', '');
  const [urls, setUrls] = useSessionState('cj_urls', '');
  const [priority, setPriority] = useSessionState('cj_priority', 'low');
  const [scheduledDate, setScheduledDate] = useSessionState('cj_scheduledDate', '');
  const [productType, setProductType] = useSessionState('cj_productType', 'simple');
  const [generateAiImages, setGenerateAiImages] = useSessionState('cj_generateAiImages', false);
  const [textModel, setTextModel] = useSessionState('cj_textModel', '');
  const [globalDefaultModel, setGlobalDefaultModel] = useState('');

  useEffect(() => {
    api.get('/settings/models').then(res => {
      if (res.data && res.data.scraping_model) {
        setGlobalDefaultModel(res.data.scraping_model);
      }
    }).catch(err => console.error("Failed to load default models:", err));
  }, []);
  
  // New Tab State
  const [activeTab, setActiveTab] = useSessionState('cj_activeTab', 'source'); // 'source' or 'search'
  
  // Search State
  const [searchQuery, setSearchQuery] = useSessionState('cj_searchQuery', '');
  const [selectedCountry, setSelectedCountry] = useSessionState('cj_selectedCountry', 'us');
  const [searchResults, setSearchResults] = useSessionState('cj_searchResults', []);
  const [searchLoading, setSearchLoading] = useState(false);
  const [refetchLoading, setRefetchLoading] = useState(false);
  const [selectedSearchUrls, setSelectedSearchUrls] = useSessionState('cj_selectedSearchUrls', []);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchError, setSearchError] = useState('');
  const [toastMessage, setToastMessage] = useState(null);

  const copyToClipboard = async (text, e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setToastMessage('URL copied to clipboard!');
      setTimeout(() => setToastMessage(null), 3000);
    } catch (err) {
      setToastMessage('Failed to copy URL');
      setTimeout(() => setToastMessage(null), 3000);
    }
  };
  
  const ITEMS_PER_PAGE = 5;
  
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  
  const [showCredentialModal, setShowCredentialModal] = useState(false);
  
  const [showCreditModal, setShowCreditModal] = useState(false);
  const [creditError, setCreditError] = useState(null);
  const [showAiWarningModal, setShowAiWarningModal] = useState(false);

  const urlList = urls.split('\n').map(u => u.trim()).filter(Boolean);

  const performSearch = async (e, isRefetch = false) => {
    if (e) e.preventDefault();
    if (!searchQuery.trim()) {
      setSearchError('Please enter a product name, SKU, or search term.');
      return;
    }
    setSearchError('');
    if (isRefetch) setRefetchLoading(true);
    else setSearchLoading(true);
    
    try {
      const res = await api.post('/jobs/search-urls', {
        query: searchQuery,
        country: selectedCountry
      });
      setSearchResults(res.data.results || []);
      setCurrentPage(1);
      if (isRefetch || !isRefetch) { // Clear selections on new search or refetch
        setSelectedSearchUrls([]);
      }
    } catch (err) {
      setSearchError(err.response?.data?.detail || 'Unable to fetch search results. Please try again.');
    } finally {
      if (isRefetch) setRefetchLoading(false);
      else setSearchLoading(false);
    }
  };

  const toggleUrlSelection = (url) => {
    setSelectedSearchUrls(prev => {
      if (prev.includes(url)) {
        return prev.filter(u => u !== url);
      }
      if (prev.length >= 4) return prev;
      return [...prev, url];
    });
  };

  const currentSearchItems = searchResults.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);
  const totalPages = Math.ceil(searchResults.length / ITEMS_PER_PAGE);

  // ... (Original logic below) ...


  const handleStartProcessingClick = (e) => {
    e.preventDefault();
    if (!generateAiImages) {
      setShowAiWarningModal(true);
    } else {
      executeSubmit();
    }
  };

  const executeSubmit = async () => {
    if (!taskName) return;
    if (activeTab === 'source' && urlList.length === 0) return;
    if (activeTab === 'search' && selectedSearchUrls.length === 0) return;
    setShowAiWarningModal(false);
    
    setLoading(true);
    setMessage('');
    try {
      const payload = {
        task_name: taskName,
        priority: priority,
        scheduled_date: scheduledDate || null,
        product_type: productType,
        created_by: 'admin',
        generate_ai_images: generateAiImages,
        text_model_override: textModel || undefined
      };

      if (activeTab === 'source') {
        payload.urls = urlList;
      } else {
        payload.primary_url = selectedSearchUrls[0];
        payload.reference_urls = selectedSearchUrls.slice(1);
      }

      const res = await api.post('/jobs', payload);
      setMessage(`Success! ${res.data.message}`);
      setTimeout(() => setMessage(''), 5000);
      setUrls('');
      setTaskName('');
      setSelectedSearchUrls([]);
      setSearchResults([]);
      setSearchQuery('');
      setScheduledDate('');
      setPriority('low');
      setProductType('simple');
      setGenerateAiImages(false);
    } catch (err) {
      let errorMsg = err.message;
      if (err.response?.data?.detail) {
        if (Array.isArray(err.response.data.detail)) {
          errorMsg = err.response.data.detail.map(d => `${d.loc?.[d.loc.length-1] || 'field'}: ${d.msg}`).join(', ');
        } else {
          errorMsg = err.response.data.detail;
        }
      }
      
      if (err.response?.status === 402 && err.response?.data?.detail?.error === 'insufficient_credits') {
        setCreditError(err.response.data.detail);
        setShowCreditModal(true);
        setMessage('');
      } else if (errorMsg.includes("CREDENTIALS_MISSING")) {
        setShowCredentialModal(true);
        setMessage('');
      } else {
        setMessage(`Error: ${errorMsg}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCsvUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    setLoading(true);
    setMessage('');
    
    const formData = new FormData();
    formData.append('file', file);
    const queryParams = new URLSearchParams({
      task_name: taskName,
      url_column: 'url',
      priority: priority,
      product_type: productType,
      created_by: 'admin',
      generate_ai_images: generateAiImages
    });
    
    if (scheduledDate) {
      queryParams.append('scheduled_date', scheduledDate);
    }

    try {
      const res = await api.post(`/jobs/upload-csv?${queryParams.toString()}`, formData);
      setMessage(`Success! ${res.data.message}`);
      setTimeout(() => setMessage(''), 5000);
      setUrls('');
      setTaskName('');
      setSelectedSearchUrls([]);
      setSearchResults([]);
      setSearchQuery('');
      setScheduledDate('');
      setPriority('low');
      setProductType('simple');
      setGenerateAiImages(false);
    } catch (err) {
      let errorMsg = err.message;
      if (err.response?.data?.detail) {
        if (Array.isArray(err.response.data.detail)) {
          errorMsg = err.response.data.detail.map(d => `${d.loc?.[d.loc.length-1] || 'field'}: ${d.msg}`).join(', ');
        } else {
          errorMsg = err.response.data.detail;
        }
      }
      
      if (err.response?.status === 402 && err.response?.data?.detail?.error === 'insufficient_credits') {
        setCreditError(err.response.data.detail);
        setShowCreditModal(true);
        setMessage('');
      } else if (errorMsg.includes("CREDENTIALS_MISSING")) {
        setShowCredentialModal(true);
        setMessage('');
      } else {
        setMessage(`Error: ${errorMsg}`);
      }
    } finally {
      setLoading(false);
      e.target.value = '';
    }
  };

  return (
    <div className="mx-auto max-w-5xl">
      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden flex flex-col h-full">
        <div className="p-4 md:p-6 border-b border-slate-200 bg-slate-50 shrink-0">
          <h2 className="text-lg md:text-xl font-bold text-slate-800">Create Extraction Job</h2>
          <p className="text-sm text-slate-500 mt-1">Submit URLs to be scraped and processed by the AI pipeline.</p>
        </div>
        
        <form onSubmit={handleStartProcessingClick} className="p-4 md:p-6 space-y-6 flex-1">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Task Name</label>
              <input 
                type="text" 
                required
                value={taskName}
                onChange={e => setTaskName(e.target.value)}
                placeholder="e.g. JOOLA Spring Catalog"
                className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-primary focus:border-primary sm:text-sm"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Priority</label>
              <select 
                value={priority}
                onChange={e => setPriority(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-primary focus:border-primary sm:text-sm bg-white"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
          </div>


          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Schedule Date <span className="text-slate-400 font-normal">(Optional)</span>
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Calendar size={16} className="text-slate-400" />
                </div>
                <input 
                  type="date" 
                  value={scheduledDate}
                  onChange={e => setScheduledDate(e.target.value)}
                  className="w-full pl-10 px-3 py-2 border border-slate-300 rounded-md focus:ring-primary focus:border-primary sm:text-sm text-slate-700"
                />
              </div>
              <p className="text-xs text-slate-500 mt-1">If left blank, task starts immediately.</p>
            </div>
            {/* Empty div for the second column to constrain width */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Text Model <span className="text-slate-400 font-normal">(Optional)</span>
              </label>
              <select 
                value={textModel}
                onChange={e => setTextModel(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-primary focus:border-primary sm:text-sm bg-white"
              >
                <option value="">System Default</option>
                {[
                  { value: 'openai/gpt-4o', label: 'GPT-4o' },
                  { value: 'openai/gpt-4o-mini', label: 'GPT-4o Mini' },
                  { value: 'anthropic/claude-sonnet-5', label: 'Claude 5 Sonnet' },
                  { value: 'anthropic/claude-haiku-4.5', label: 'Claude 4.5 Haiku' },
                  { value: 'google/gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
                  { value: 'google/gemini-3.7-flash', label: 'Gemini 3.7 Flash' },
                  { value: 'google/gemini-3.6-flash', label: 'Gemini 3.6 Flash' },
                  { value: 'google/gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
                  { value: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
                  { value: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
                  { value: 'deepseek/deepseek-chat', label: 'DeepSeek Chat' }
                ].filter(m => m.value !== globalDefaultModel).map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
                
              </select>
              <p className="text-xs text-slate-500 mt-1">Overrides the global settings model for this task.</p>
            </div>
          </div>

          <div className="border-t border-slate-100 pt-4">
            <div className="flex border-b border-slate-200 mb-4">
              <button
                type="button"
                onClick={() => setActiveTab('source')}
                className={`py-2 px-4 border-b-2 font-medium text-sm transition-colors ${activeTab === 'source' ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'}`}
              >
                Source URLs
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('search')}
                className={`py-2 px-4 border-b-2 font-medium text-sm transition-colors ${activeTab === 'search' ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'}`}
              >
                Search URLs
              </button>
            </div>

            {activeTab === 'source' && (
              <div>
                <div className="flex justify-between items-end mb-1">
                  <label className="block text-sm font-medium text-slate-700">Source URLs</label>
                  <span className="text-xs text-slate-500">{urlList.length} valid URL(s) detected</span>
                </div>
                <textarea 
                  required={activeTab === 'source'}
                  rows={8}
                  value={urls}
                  onChange={e => setUrls(e.target.value)}
                  placeholder="https://example.com/product-1\nhttps://example.com/product-2"
                  className="w-full px-3 border border-slate-300 rounded-md font-mono text-sm focus:ring-primary focus:border-primary bg-white outline-none"
                  style={{
                    backgroundImage: 'linear-gradient(transparent, transparent 27px, #e2e8f0 27px, #e2e8f0 28px)',
                    backgroundSize: '100% 28px',
                    lineHeight: '28px',
                    paddingTop: '6px',
                    resize: 'vertical'
                  }}
                />
              </div>
            )}

            {activeTab === 'search' && (
              <div className="flex flex-col gap-4">
                <div className="flex gap-2">
                  <div className="flex-1">
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && performSearch(e)}
                      placeholder="Enter product name, SKU, brand, model, price, etc."
                      className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-primary focus:border-primary sm:text-sm bg-white"
                    />
                  </div>
                  <div className="w-[180px] shrink-0 relative">
                    <select
                      value={selectedCountry}
                      onChange={e => setSelectedCountry(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-primary focus:border-primary sm:text-sm bg-white cursor-pointer"
                    >
                      {[
  { code: 'us', name: 'United States' },
  { code: 'af', name: 'Afghanistan' },
  { code: 'al', name: 'Albania' },
  { code: 'dz', name: 'Algeria' },
  { code: 'as', name: 'American Samoa' },
  { code: 'ad', name: 'Andorra' },
  { code: 'ao', name: 'Angola' },
  { code: 'ai', name: 'Anguilla' },
  { code: 'aq', name: 'Antarctica' },
  { code: 'ar', name: 'Argentina' },
  { code: 'au', name: 'Australia' },
  { code: 'at', name: 'Austria' },
  { code: 'br', name: 'Brazil' },
  { code: 'ca', name: 'Canada' },
  { code: 'cn', name: 'China' },
  { code: 'fr', name: 'France' },
  { code: 'de', name: 'Germany' },
  { code: 'in', name: 'India' },
  { code: 'it', name: 'Italy' },
  { code: 'jp', name: 'Japan' },
  { code: 'mx', name: 'Mexico' },
  { code: 'ae', name: 'UAE' },
  { code: 'gb', name: 'United Kingdom' }
].map(c => (
                        <option key={c.code} value={c.code}>
                          {c.name} ({c.code})
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={e => performSearch(e)}
                    disabled={searchLoading}
                    className="inline-flex items-center justify-center gap-2 bg-slate-800 text-white px-4 py-2 rounded-md font-medium text-sm hover:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-800 disabled:opacity-50 transition-colors"
                  >
                    {searchLoading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
                    Search
                  </button>
                </div>
                
                {searchError && <div className="text-sm text-red-600 bg-red-50 p-2 rounded">{searchError}</div>}
                
                {searchResults.length > 0 && (
                  <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
                    <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex justify-between items-center">
                      <div className="text-sm font-medium text-slate-700">
                        Selected: <span className={selectedSearchUrls.length === 4 ? "text-amber-600 font-bold" : ""}>{selectedSearchUrls.length} / 4</span>
                      </div>
                      <button
                        type="button"
                        onClick={e => performSearch(e, true)}
                        disabled={refetchLoading}
                        className="text-slate-500 hover:text-slate-800 flex items-center gap-1 text-sm font-medium transition-colors disabled:opacity-50"
                      >
                        <RefreshCw size={14} className={refetchLoading ? "animate-spin" : ""} /> Refetch
                      </button>
                    </div>
                    
                    <div className="divide-y divide-slate-100">
                      {currentSearchItems.map((result, idx) => {
                        const isSelected = selectedSearchUrls.includes(result.url);
                        const selectionIndex = selectedSearchUrls.indexOf(result.url);
                        const isDisabled = !isSelected && selectedSearchUrls.length >= 4;
                        
                        return (
                          <label key={result.url} className={`flex items-start gap-3 p-4 hover:bg-slate-50 cursor-pointer transition-colors ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
                            <div className="pt-1">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                disabled={isDisabled}
                                onChange={() => toggleUrlSelection(result.url)}
                                className="w-4 h-4 rounded border-slate-300 text-primary focus:ring-primary cursor-pointer disabled:cursor-not-allowed"
                              />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                {isSelected && (
                                  <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-medium ${selectionIndex === 0 ? 'bg-primary/10 text-primary' : 'bg-slate-100 text-slate-600'}`}>
                                    {selectionIndex === 0 ? 'PRIMARY' : `REFERENCE ${selectionIndex}`}
                                  </span>
                                )}
                                <h4 className="text-sm font-medium text-slate-900 truncate">{result.title}</h4>
                              </div>
                              <div className="flex items-center gap-2 mb-1 group max-w-full">
                                <button 
                                  type="button"
                                  onClick={(e) => copyToClipboard(result.url, e)}
                                  className="text-xs text-blue-600 hover:underline truncate text-left"
                                  title="Click to copy"
                                >
                                  {result.url}
                                </button>
                                <button 
                                  type="button"
                                  onClick={(e) => copyToClipboard(result.url, e)}
                                  className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-slate-600 shrink-0"
                                  title="Copy URL"
                                >
                                  <Copy size={14} />
                                </button>
                              </div>
                              <p className="text-xs text-slate-500 line-clamp-2">{result.snippet}</p>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                    
                    {totalPages > 1 && (
                      <div className="bg-slate-50 px-4 py-3 border-t border-slate-200 flex items-center justify-between">
                        <button
                          type="button"
                          onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                          disabled={currentPage === 1}
                          className="p-1 rounded text-slate-500 hover:bg-slate-200 disabled:opacity-50 transition-colors"
                        >
                          <ChevronLeft size={20} />
                        </button>
                        <span className="text-sm text-slate-600">Page {currentPage} of {totalPages}</span>
                        <button
                          type="button"
                          onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                          disabled={currentPage === totalPages}
                          className="p-1 rounded text-slate-500 hover:bg-slate-200 disabled:opacity-50 transition-colors"
                        >
                          <ChevronRight size={20} />
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {selectedSearchUrls.length > 0 && (
                  <div className="mt-2 bg-slate-50 border border-slate-200 rounded-lg p-4">
                    <h3 className="text-sm font-semibold text-slate-800 mb-3">Selected URLs</h3>
                    <div className="space-y-3">
                      <div>
                        <div className="text-xs font-bold text-primary uppercase tracking-wider mb-1">Primary URL</div>
                        <div className="text-sm text-slate-700 bg-white px-3 py-2 border border-slate-200 rounded break-all shadow-sm">
                          {selectedSearchUrls[0]}
                        </div>
                      </div>
                      {selectedSearchUrls.length > 1 && (
                        <div>
                          <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Reference URLs</div>
                          <div className="space-y-1.5">
                            {selectedSearchUrls.slice(1).map((url, i) => (
                              <div key={url} className="text-sm text-slate-600 bg-white px-3 py-2 border border-slate-200 rounded break-all shadow-sm">
                                {url}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {(activeTab === 'source' || (activeTab === 'search' && selectedSearchUrls.length === 4)) && (
            <>
              <div className="flex items-start gap-3 pt-2">
                <div className="flex items-center h-5 mt-0.5">
                  <input
                    id="generate_ai_images"
                    type="checkbox"
                    checked={generateAiImages}
                    onChange={(e) => setGenerateAiImages(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-primary focus:ring-primary cursor-pointer"
                  />
                </div>
                <div className="text-sm">
                  <label htmlFor="generate_ai_images" className="font-medium text-slate-800 cursor-pointer">Generate AI Images</label>
                  <p className="text-slate-500 text-xs mt-0.5">Automatically generate high-quality product images using AI.</p>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-4 border-t border-slate-100">
                <button 
                  type="submit" 
                  disabled={loading || !taskName || (activeTab === 'source' ? urlList.length === 0 : selectedSearchUrls.length === 0)}
                  className="inline-flex items-center justify-center gap-2 bg-primary text-white px-5 py-2.5 rounded-md font-medium text-sm hover:bg-primary-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 transition-colors"
                >
                  {loading ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                  Start Processing
                </button>
                <div className="relative flex-1 sm:flex-none">
                  <input
                    type="file"
                    accept=".csv"
                    onChange={handleCsvUpload}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    disabled={loading || !taskName}
                    title={!taskName ? "Please enter a Task Name first" : "Upload CSV"}
                  />
                  <button 
                    type="button"
                    disabled={loading || !taskName}
                    className="w-full inline-flex items-center justify-center gap-2 bg-white text-slate-700 border border-slate-300 px-5 py-2.5 rounded-md font-medium text-sm hover:bg-slate-50 focus:outline-none transition-colors disabled:opacity-50"
                  >
                    <UploadCloud size={16} />
                    Upload CSV
                  </button>
                </div>
              </div>
            </>
          )}
          
          {message && (
            <div className={clsx("p-3 rounded-md text-sm", message.startsWith('Error') ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700")}>
              {message}
            </div>
          )}
        </form>
      </div>

      {/* Missing Credentials Modal */}
      {showCredentialModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full overflow-hidden flex flex-col p-6 text-center">
            <div className="w-16 h-16 bg-red-100 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertCircle size={32} />
            </div>
            <h2 className="text-lg font-bold text-slate-800 mb-2">Credentials Missing</h2>
            <p className="text-slate-500 text-sm mb-6">
              Your credentials are not configured. Contact your administrator to set up the required API keys.
            </p>
            <button
              onClick={() => setShowCredentialModal(false)}
              className="w-full py-2.5 bg-slate-800 text-white rounded-md font-semibold text-sm hover:bg-slate-900 transition-colors"
            >
              Okay, I understand
            </button>
          </div>
        </div>
      )}

      {/* Credit Error Modal */}
      <InsufficientCreditsModal 
        isOpen={showCreditModal}
        onClose={() => setShowCreditModal(false)}
        remainingCredits={creditError?.balance}
        jobCost={creditError?.job_cost}
        mode="create"
        providerName={creditError?.provider === 'deepseek' ? 'DeepSeek' : 'OpenRouter'}
      />

      {/* AI Warning Modal */}
      {showAiWarningModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex flex-col items-center justify-center backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex flex-col items-center text-center">
              <div className="w-12 h-12 bg-amber-100 text-amber-500 rounded-full flex items-center justify-center mb-4">
                <AlertCircle size={24} />
              </div>
              <h3 className="text-xl font-bold text-slate-800">No Image Generation?</h3>
              <p className="text-sm text-slate-500 mt-2">
                You have not checked "Generate AI Images". Do you want to proceed with no AI image generation?
              </p>
            </div>
            <div className="p-4 bg-slate-50 flex justify-end gap-3">
              <button 
                onClick={() => setShowAiWarningModal(false)}
                className="px-5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-200 bg-slate-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={executeSubmit}
                className="px-5 py-2.5 text-sm font-semibold text-white bg-primary hover:bg-primary-hover rounded-lg shadow-sm transition-colors"
              >
                Proceed
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Message */}
      {toastMessage && (
        <div className="fixed bottom-4 right-4 z-50 bg-slate-800 text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 animate-fade-in-up">
          <Check size={18} className="text-emerald-400" />
          <span className="text-sm font-medium">{toastMessage}</span>
        </div>
      )}
    </div>
  );
}
