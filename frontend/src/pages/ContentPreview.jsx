import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Save, Check, CheckCircle2, Search, Maximize, ExternalLink, Globe, FileText, Image as ImageIcon, Sparkles, Loader2, PlayCircle, StopCircle, RefreshCcw, ChevronLeft, ChevronRight, Heart, Share2, Trash2, Copy } from 'lucide-react';
import clsx from 'clsx';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import api from '../api/client';
import ActiveFitnessPreview from '../components/ActiveFitnessPreview';

export default function ContentPreview() {
  const { jobId } = useParams();
  const [searchParams] = useSearchParams();
  const taskName = searchParams.get('taskName') || 'Review Extraction Data';
  const navigate = useNavigate();
  const tabParam = searchParams.get('tab') || 'table';
  const [activeTab, setActiveTab] = useState(tabParam); // 'json' | 'table' | 'product' | 'ai'
  const [job, setJob] = useState(null);
  const [jsonData, setJsonData] = useState('');
  const [loading, setLoading] = useState(true);
  const [realAssets, setRealAssets] = useState([]);
  const [previewImage, setPreviewImage] = useState(null);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [bundles, setBundles] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const userEditedRef = React.useRef(false); // Prevents poll from overwriting local edits
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try { return localStorage.getItem('contentPreview_sidebarOpen') !== 'false'; } catch { return true; }
  });
  
  // Toast State
  const [toastMessage, setToastMessage] = useState(null);

  const showToast = (msg, type = "info") => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };
  const [itemToRemove, setItemToRemove] = useState(null);
  const [arrayItemToRemove, setArrayItemToRemove] = useState(null);

  // Accordion state: keep track of which main JSON keys are expanded. 
  // Undefined means "expanded by default".
  const [expandedSections, setExpandedSections] = useState({});
  const [showCompletionModal, setShowCompletionModal] = useState(false);
  const [nextTaskGroup, setNextTaskGroup] = useState(null);

  const toggleSection = (key) => {
    setExpandedSections(prev => ({
      ...prev,
      [key]: prev[key] === undefined ? false : !prev[key]
    }));
  };

  const [sourcesList, setSourcesList] = useState([]);
  const [rightPanelTab, setRightPanelTab] = useState('llm'); // 'llm' | 'html' | 'sources'

  const toggleSidebar = () => {
    setSidebarOpen(prev => {
      const next = !prev;
      try { localStorage.setItem('contentPreview_sidebarOpen', String(next)); } catch {}
      return next;
    });
  };

  const copyToClipboard = async (text) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setToastMessage("Link copied");
      setTimeout(() => setToastMessage(null), 3000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  useEffect(() => {
    if (taskName) {
      api.get(`/jobs/?task_name=${encodeURIComponent(taskName)}&limit=1000`)
        .then(res => {
          const activeJobs = (res.data.jobs || []).filter(j => j.status !== 'completed' && j.status !== 'removed' && j.status !== 'aborted');
          setBundles(activeJobs);
        })
        .catch(err => console.error(err));
    }
  }, [taskName]);

  const currentJobIdRef = React.useRef(jobId);

  // Strictly invalidate the state buffer on route/jobId changes
  useEffect(() => {
    currentJobIdRef.current = jobId;
    setJob(null);
    setJsonData('');
    setRealAssets([]);
  }, [jobId]);

  useEffect(() => {
    const fetchJob = async () => {
      try {
        const res = await api.get(`/jobs/detail/${jobId}`);
        // Prevent race condition if the user navigated away before this API call finished
        if (currentJobIdRef.current !== jobId) return;
        
        setJob(res.data);
        
        const pData = res.data.product_data ? { ...res.data.product_data } : {};
        if (pData.sources) {
          setSourcesList(pData.sources);
          delete pData.sources;
        } else if (pData.enrichment_metadata && pData.enrichment_metadata.visited_urls) {
          setSourcesList(pData.enrichment_metadata.visited_urls);
          delete pData.enrichment_metadata;
        } else if (pData.enrichment_metadata) {
          delete pData.enrichment_metadata;
        }
        
        // Only set jsonData on initial load or if the buffer was just cleared
        setJsonData(prev => prev ? prev : JSON.stringify(pData, null, 2));
        
        // Parse images from AI JSON
        const aiImagesDict = res.data.product_data?.['Product Highlights Ai Images'] || {};
        const imagesList = Array.isArray(res.data.product_data?.images) ? res.data.product_data.images : [];
        const lifestyle = aiImagesDict.lifestyle_images || [];
        const feature = aiImagesDict.feature_images || [];
        
        let combined = [
          ...lifestyle.map((img, i) => ({
            id: `LIFESTYLE_${i}`,
            url: `http://localhost:8000/${img.local_path}`,
          })),
          ...feature.map((img, i) => ({
            id: `FEATURE_${i}`,
            url: `http://localhost:8000/${img.local_path}`,
          }))
        ];
        
        if (combined.length === 0 && imagesList.length > 0) {
           combined.push(...imagesList.map((img, i) => ({
             id: `SCRAPED_${i}`,
             url: img.media || img.url
           })));
        }

        setRealAssets(combined);
      } catch (err) {
        console.error("Failed to fetch job", err);
      } finally {
        if (currentJobIdRef.current === jobId) {
          setLoading(false);
        }
      }
    };
    
    fetchJob();

    const pollJob = async () => {
      try {
        const res = await api.get(`/jobs/detail/${jobId}`);
        if (currentJobIdRef.current !== jobId) return;
        
        const currentData = res.data.product_data || {};
        
        // 1. Update live assets for carousel
        const aiImagesDict = currentData['Product Highlights Ai Images'] || {};
        const imagesList = Array.isArray(currentData.images) ? currentData.images : [];
        const lifestyle = aiImagesDict.lifestyle_images || [];
        const feature = aiImagesDict.feature_images || [];
        
        let combined = [
          ...lifestyle.map((img, i) => ({
            id: `LIFESTYLE_${i}`,
            url: `http://localhost:8000/${img.local_path}`,
          })),
          ...feature.map((img, i) => ({
            id: `FEATURE_${i}`,
            url: `http://localhost:8000/${img.local_path}`,
          }))
        ];
        
        if (combined.length === 0 && imagesList.length > 0) {
           combined.push(...imagesList.map((img, i) => ({
             id: `SCRAPED_${i}`,
             url: img.media || img.url
           })));
        }
        
        setRealAssets(prev => JSON.stringify(prev) !== JSON.stringify(combined) ? combined : prev);
        
        // 2. Merge the live images array and AI images into the user's current jsonData
        // SKIP if the user has made local edits (deletions, text changes) to avoid overwriting them
        if (!userEditedRef.current) {
          setJsonData(prevJsonStr => {
            try {
              if (!prevJsonStr) return prevJsonStr; // skip if buffer is empty
              const parsed = JSON.parse(prevJsonStr);
              let updated = false;
              
              if (JSON.stringify(parsed.images) !== JSON.stringify(imagesList)) {
                parsed.images = imagesList;
                updated = true;
              }
              if (JSON.stringify(parsed['Product Highlights Ai Images']) !== JSON.stringify(aiImagesDict)) {
                parsed['Product Highlights Ai Images'] = aiImagesDict;
                updated = true;
              }
              
              if (updated) {
                return JSON.stringify(parsed, null, 2);
              }
              return prevJsonStr;
            } catch (e) {
              return prevJsonStr;
            }
          });
        }
        
        // 3. Update the job state itself
        setJob(prev => {
           if (JSON.stringify(prev?.product_data?.images) !== JSON.stringify(imagesList) || 
               JSON.stringify(prev?.product_data?.['Product Highlights Ai Images']) !== JSON.stringify(aiImagesDict)) {
             return res.data;
           }
           return prev;
        });
        
      } catch (err) {}
    };
    
    const interval = setInterval(pollJob, 3000);
    return () => clearInterval(interval);
  }, [jobId]);

  if (loading) {
    return (
      <div className="h-[calc(100vh-8rem)] -m-4 md:-m-6 flex items-center justify-center bg-slate-50">
        <Loader2 size={32} className="animate-spin text-indigo-600" />
      </div>
    );
  }

  const aiData = job?.product_data || {};
  const productIdentity = aiData.product_identity || {};

  const updateJsonPath = (path, value) => {
    try {
      const newParsed = JSON.parse(jsonData);
      let current = newParsed;
      for (let i = 0; i < path.length - 1; i++) {
        current = current[path[i]];
      }
      current[path[path.length - 1]] = value;
      userEditedRef.current = true; // Prevent poll from overwriting this edit
      setJsonData(JSON.stringify(newParsed, null, 2));
    } catch (e) {
      console.error(e);
    }
  };

  const removeArrayItem = (path, indexToRemove) => {
    try {
      const newParsed = JSON.parse(jsonData);
      let current = newParsed;
      for (let i = 0; i < path.length; i++) {
        current = current[path[i]];
      }
      if (Array.isArray(current)) {
        current.splice(indexToRemove, 1);
        userEditedRef.current = true; // Prevent poll from overwriting this edit
        setJsonData(JSON.stringify(newParsed, null, 2));
      }
    } catch (e) {
      console.error(e);
    }
  };

  const renderRecursiveEditor = (data, path = []) => {
    if (data === null || data === undefined) {
      return (
        <input 
          className="w-full text-sm border-slate-300 rounded-md shadow-sm focus:border-indigo-500 focus:ring-indigo-500 p-2 border bg-white focus:outline-none"
          value=""
          placeholder="null"
          onChange={(e) => updateJsonPath(path, e.target.value)}
        />
      );
    }

    if (Array.isArray(data)) {
      return (
        <div className="flex flex-col gap-3 pl-4 border-l-2 border-indigo-200 mt-1 mb-2">
          {data.map((item, idx) => (
            <div key={JSON.stringify(item).substring(0, 30) + idx} className="flex gap-3 items-start bg-slate-50/50 p-2 rounded border border-slate-100 relative group pr-8">
              <span className="text-[10px] font-bold text-slate-400 mt-2 w-4 shrink-0">{idx + 1}.</span>
              <div className="flex-1 overflow-hidden">
                {renderRecursiveEditor(item, [...path, idx])}
              </div>
              <button 
                onClick={() => setArrayItemToRemove({ path, index: idx })}
                className="absolute top-2 right-2 flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 p-1.5 rounded-md transition-all bg-white"
                title="Remove Item"
              >
                <Trash2 size={14} strokeWidth={2.5} />
              </button>
            </div>
          ))}
        </div>
      );
    }

    if (typeof data === 'object') {
      return (
        <div className="flex flex-col gap-4 pl-4 border-l-2 border-slate-200 mt-2 mb-3 w-full">
          {Object.entries(data).map(([key, val]) => {
            const isUrl = typeof val === 'string' && val.match(/^https?:\/\//i);
            const isImage = isUrl && (key.toLowerCase().includes('media') || key.toLowerCase().includes('image') || val.match(/\.(jpeg|jpg|gif|png|webp|svg|avif)$/i));
            
            return (
              <div key={key} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-600 tracking-wide uppercase">{key.replace(/_/g, ' ')}</label>
                  {isImage && (
                    <button 
                      onClick={() => setPreviewImage(val)}
                      className="text-[10px] bg-indigo-50 text-indigo-600 border border-indigo-200 px-2 py-0.5 rounded shadow-sm hover:bg-indigo-100 transition-colors font-semibold flex items-center gap-1"
                      title="View image in a popup"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                      View
                    </button>
                  )}
                </div>
                {renderRecursiveEditor(val, [...path, key])}
              </div>
            );
          })}
        </div>
      );
    }

    // Primitive (string, number, boolean)
    return (
      <textarea 
        value={data}
        rows={String(data).length > 80 ? 3 : 1}
        onChange={(e) => {
          let val = e.target.value;
          if (typeof data === 'number') val = Number(val) || 0;
          if (typeof data === 'boolean') val = val === 'true';
          updateJsonPath(path, val);
        }}
        className="w-full text-sm border-slate-300 rounded-md shadow-sm focus:border-indigo-500 focus:ring-indigo-500 p-2 border bg-white focus:outline-none transition-shadow"
      />
    );
  };

  const filteredBundles = bundles.filter(b => {
    const searchStr = searchQuery.toLowerCase();
    const bTaskName = (b.task_name || '').toLowerCase();
    const prodName = (b.product_data?.product_identity?.product_name || b.product_data?.product_identity?.brand || '').toLowerCase();
    return bTaskName.includes(searchStr) || prodName.includes(searchStr);
  });

  const handleSelectJob = (selected) => {
    if (selected.id !== jobId) {
      navigate(`/task-logs/content-preview/${selected.id}?taskName=${encodeURIComponent(taskName)}&tab=${activeTab}`);
    }
  };

  const handleSaveChanges = async () => {
    setSaving(true);
    try {
      await api.post(`/jobs/${jobId}/update_data`, { product_data: JSON.parse(jsonData) });
    } catch (e) {
      console.error(e);
      showToast("Failed to save changes.", "error");
    } finally {
      setSaving(false);
    }
  };


  const fetchNextTaskGroup = async () => {
    try {
      const res = await api.get('/dashboard/recent-activity?limit=50');
      const jobs = res.data.items || [];
      const pendingJob = jobs.find(j => 
        j.task_name !== taskName && 
        !['completed', 'aborted', 'failed', 'removed'].includes(j.status)
      );
      setNextTaskGroup(pendingJob || null);
    } catch (e) {
      console.error("Failed to fetch next task group", e);
    }
  };

  const handleFinalizeAndSave = async () => {
    setSaving(true);
    const currentJobId = jobId;
    try {
      // 1. Save manual JSON edits
      await api.post(`/jobs/${currentJobId}/approve`, { product_data: JSON.parse(jsonData) });
      
      // 2. Embed generated AI images into the database product_data if applicable
      if (job?.status === 'image_generation_complete' || (job?.generate_ai_images && job?.status !== 'success')) {
        try {
          await api.post(`/images/job/${currentJobId}/finish`);
        } catch (e) {
          console.error("Failed to finish images", e);
        }
      }
      
      // 3. Finalize bundle (generates ZIP and makes it available in Downloads tab)
      await api.post(`/jobs/${currentJobId}/finalize`, {});
      
      // 4. Pop this task from the sidebar queue
      const activeBundles = bundles.filter(b => b.id !== currentJobId && b.status !== 'completed' && b.status !== 'removed');
      setBundles(activeBundles);
      
      // 5. Show toast and navigate to the next subtask
      if (activeBundles.length > 0) {
        showToast('Subtask finalized and saved to downloads.');
        navigate(`/task-logs/content-preview/${activeBundles[0].id}?taskName=${encodeURIComponent(taskName)}&tab=${activeTab}`);
      } else {
        await fetchNextTaskGroup();
        setShowCompletionModal(true);
      }
    } catch (e) {
      console.error(e);
      showToast("Failed to finalize bundle.", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleGenerateAiImages = async () => {
    setSaving(true);
    try {
      // Ensure the JSON is saved/approved before deepseek starts writing prompts
      await api.post(`/jobs/${jobId}/approve`, { product_data: JSON.parse(jsonData) });
      
      // Kick off the generation
      await api.post(`/images/job/${jobId}/resume`);
      
      // Navigate to the Image Review tab to wait for the Shimmer effect to finish
      navigate(`/task-logs/ai-images/${jobId}?taskName=${encodeURIComponent(taskName)}`);
    } catch (e) {
      console.error(e);
      showToast("Failed to start AI image generation.", "error");
    } finally {
      setSaving(false);
    }
  };

  const confirmRemoveItem = async () => {
    if (!itemToRemove) return;
    setSaving(true);
    try {
      await api.delete(`/jobs/${itemToRemove}`);
      
      // Invalidate local cache/buffer
      setJob(null);
      setJsonData('');
      setRealAssets([]);
      
      const activeBundles = bundles.filter(b => b.id !== itemToRemove && b.status !== 'completed' && b.status !== 'removed');
      setBundles(activeBundles);
      
      if (activeBundles.length > 0) {
        navigate(`/task-logs/content-preview/${activeBundles[0].id}?taskName=${encodeURIComponent(taskName)}&tab=${activeTab}`);
      } else {
        navigate(`/task-logs?taskName=${encodeURIComponent(taskName)}`);
      }
    } catch (e) {
      console.error(e);
      showToast("Failed to remove.", "error");
    } finally {
      setSaving(false);
      setItemToRemove(null);
    }
  };

  return (
    <div className="h-full w-full bg-slate-50 flex flex-col md:flex-row text-sm overflow-hidden z-0">
      {/* Sidebar */}
      <div
        className={clsx(
          "flex-shrink-0 border-b md:border-b-0 md:border-r border-slate-200 bg-white flex flex-col shadow-sm z-20 transition-all duration-200 ease-in-out",
          sidebarOpen ? "w-full md:w-64" : "w-0 md:w-0 overflow-hidden border-r-0"
        )}
      >
        <div className="p-3 border-b border-slate-200">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="text"
              placeholder="Search bundles..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-slate-100 border-transparent focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 rounded-md text-sm transition-all outline-none"
            />
          </div>
        </div>
        
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
          <span className="text-xs font-bold text-slate-500 tracking-wider truncate mr-2" title={taskName}>{taskName}</span>
          <span className="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full text-xs font-bold shrink-0">{bundles.length}</span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filteredBundles.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-sm">
              No products found.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {filteredBundles.map(b => {
                const isActive = job?.id === b.id;
                const bProdName = b.product_data?.product_identity?.product_name || b.product_data?.product_identity?.brand || "Unknown Product";
                
                return (
                  <li key={b.id}>
                    <button
                      onClick={() => handleSelectJob(b)}
                      className={clsx(
                        "w-full text-left p-3 hover:bg-slate-50 transition-colors focus:outline-none flex flex-col gap-1",
                        isActive ? "bg-indigo-50/50 border-l-4 border-indigo-500" : "border-l-4 border-transparent"
                      )}
                    >
                      <div className="flex justify-between items-start w-full">
                        <h4 className="font-semibold text-slate-800 text-sm truncate pr-2">{bProdName}</h4>
                        {isActive && <span className="bg-green-100 text-green-700 text-[9px] font-bold px-1.5 py-0.5 rounded uppercase shrink-0">Active</span>}
                      </div>
                      <p className="text-[10px] text-slate-400 mt-1 flex items-center gap-1">
                        <Check size={10} /> Updated {new Date(b.updated_at || b.created_at).toLocaleDateString()}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Action Panel */}
        {job && (
          <div className="p-4 bg-white border-t border-slate-200 flex flex-col gap-3 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] shrink-0">
            <div>
              <h5 className="text-[10px] font-bold text-slate-500 tracking-wider mb-2">PRODUCT SUMMARY</h5>
              <div className="text-xs">
                <div className="mb-1"><span className="text-slate-400 text-[10px]">TASK NAME:</span><br/><span className="font-medium text-slate-700 truncate block">{job.task_name}</span></div>
                <div><span className="text-slate-400 text-[10px]">BRAND:</span><br/><span className="font-medium text-slate-700 truncate block">{job.product_data?.product_identity?.brand || "Unknown"}</span></div>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <button
                onClick={handleFinalizeAndSave}
                disabled={saving}
                className="w-full py-2 px-3 bg-[#5235e8] text-white rounded-md text-xs font-semibold hover:bg-[#4323c2] transition-colors flex justify-center items-center gap-2"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                FINALIZE AND SAVE
              </button>
              <button
                onClick={() => setItemToRemove(jobId)}
                disabled={saving}
                className="w-full py-2 px-3 bg-rose-50 text-rose-600 border border-rose-200 rounded-md text-xs font-semibold hover:bg-rose-100 transition-colors flex justify-center items-center gap-2 mt-2"
              >
                <Trash2 size={14} />
                REMOVE BUNDLE
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Sidebar Toggle Button — anchored at the sidebar/content boundary */}
      <div className="hidden md:flex items-center justify-center relative z-30 flex-shrink-0">
        <button
          onClick={toggleSidebar}
          title={sidebarOpen ? 'Hide Task List' : 'Show Task List'}
          className={clsx(
            "absolute left-0 -translate-x-1/2 rounded-full w-12 h-12 flex items-center justify-center transition-all duration-200",
            "bg-green-500 text-white border-2 border-white",
            "shadow-[0_0_15px_rgba(34,197,94,0.5)] hover:shadow-[0_0_20px_rgba(34,197,94,0.7)] hover:bg-green-400 hover:scale-105 active:scale-95"
          )}
        >
          {sidebarOpen ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
        </button>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-h-[600px] md:min-h-0 md:h-full relative overflow-hidden">
        
        {/* Top Navigation Tabs */}
      <div className="bg-white px-6 border-b border-slate-200 shrink-0 flex flex-wrap items-center justify-between gap-y-2 gap-x-4">
        <div className="flex flex-wrap -mb-px">
          <button 
            onClick={() => setActiveTab('json')}
            className={clsx(
              "px-5 py-4 text-sm font-bold border-b-2 transition-colors",
              activeTab === 'json' ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-700"
            )}
          >
            Edit Generated JSON
          </button>
          <button 
            onClick={() => setActiveTab('table')}
            className={clsx(
              "px-5 py-4 text-sm font-bold border-b-2 transition-colors",
              activeTab === 'table' ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-700"
            )}
          >
            Table View
          </button>

          <button 
            onClick={() => setActiveTab('ai')}
            className={clsx(
              "px-5 py-4 text-sm font-bold border-b-2 flex items-center gap-2 transition-colors",
              activeTab === 'ai' ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-700"
            )}
          >
            AI GENERATED PAGE
          </button>
        </div>
        
        <div className="flex flex-wrap items-center gap-3 ml-auto py-2">
          <button
            onClick={handleSaveChanges}
            disabled={saving}
            className="py-1.5 px-4 bg-white border border-slate-300 text-slate-700 rounded-md text-xs font-semibold hover:bg-slate-50 transition-colors flex justify-center items-center gap-2 shadow-sm"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            SAVE CHANGES
          </button>

          {job?.generate_ai_images && (
            <>
              {['image_generation', 'image_generation_stopped', 'image_generation_complete', 'image_generation_failed'].includes(job?.status) || 
               ([...(job?.product_data?.['Product Highlights Ai Images']?.lifestyle_images || []), ...(job?.product_data?.['Product Highlights Ai Images']?.feature_images || [])].some(img => typeof img === 'object' && img !== null && (img.local_path || (img.url && !img.url.startsWith('http'))))) ? (
                <button
                  onClick={() => navigate(`/task-logs/ai-images/${jobId}?taskName=${encodeURIComponent(taskName)}`)}
                  className="py-1.5 px-4 bg-[#00A389]/10 text-[#00A389] border border-[#00A389]/30 rounded-md text-xs font-semibold hover:bg-[#00A389]/20 transition-colors flex justify-center items-center gap-2 shadow-sm"
                >
                  <ImageIcon size={14} />
                  IMAGE REVIEW
                </button>
              ) : (
                <button
                  onClick={handleGenerateAiImages}
                  disabled={saving}
                  className="py-1.5 px-4 bg-[#00A389]/10 text-[#00A389] border border-[#00A389]/30 rounded-md text-xs font-semibold hover:bg-[#00A389]/20 transition-colors flex justify-center items-center gap-2 shadow-sm"
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <ImageIcon size={14} />}
                  GENERATE AI IMAGES
                </button>
              )}
            </>
          )}

          {activeTab === 'ai' && (
            <button 
              onClick={() => setIsFullscreen(true)}
              className="flex items-center gap-1.5 text-slate-500 text-sm font-semibold hover:text-slate-800 transition-colors ml-2"
            >
              <Maximize size={16} /> Fullscreen
            </button>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
        
        {/* TAB 1: Edit Generated JSON */}
        {activeTab === 'json' && (
          <div className="max-w-5xl mx-auto">
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
              <div className="flex items-center justify-between bg-slate-50 px-4 py-3 border-b border-slate-200">
                <div className="flex items-center gap-2">
                  <Globe size={18} className="text-indigo-600" />
                  <div>
                    <h3 className="text-sm font-bold text-slate-800">Original Source</h3>
                    <p className="text-xs text-slate-500 truncate max-w-lg">{job?.url}</p>
                  </div>
                </div>
                <button onClick={() => copyToClipboard(job?.url)} className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 text-white rounded-md text-xs font-bold hover:bg-slate-700 transition-colors" title="Click to copy URL">
                  Copy URL <Copy size={14} />
                </button>
              </div>
              <textarea 
                className="w-full h-[600px] font-mono text-sm p-4 resize-none focus:outline-none focus:ring-0 bg-[#1e1e1e] text-emerald-400"
                value={jsonData}
                onChange={e => setJsonData(e.target.value)}
                spellCheck={false}
              />
            </div>
          </div>
        )}

        {/* TAB 2: Table View */}
        {activeTab === 'table' && (
          <div className="max-w-[1400px] mx-auto h-[700px] overflow-hidden flex flex-col space-y-4">
            <div className="grid grid-cols-2 gap-6 h-full overflow-hidden">
              {/* Left Column: AI Generated (Editable) */}
              <div className="flex flex-col h-full bg-slate-100 rounded-xl border border-slate-200 overflow-hidden shadow-sm relative">
                <div className="bg-white border-b border-slate-200 px-4 py-3 flex items-center shadow-sm z-10">
                  <svg className="w-5 h-5 text-indigo-500 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                  </svg>
                  <h3 className="font-bold text-slate-800 text-sm">AI Generated</h3>
                </div>
                <div className="p-6 overflow-auto flex-1">
                  <div className="min-w-[600px]">
                  {(() => {
                    let parsed = {};
                    let isValid = true;
                    try {
                      parsed = JSON.parse(jsonData);
                      if (typeof parsed !== 'object' || parsed === null) throw new Error();
                    } catch (e) {
                      isValid = false;
                    }

                    if (!isValid) {
                      return (
                        <div className="flex items-center justify-center h-full text-red-500 text-sm">
                          Invalid JSON format.
                        </div>
                      );
                    }

                    if (Object.keys(parsed).length === 0) {
                      return (
                        <div className="flex flex-col items-center justify-center h-full text-slate-500 text-sm">
                          <p>The JSON object is empty.</p>
                        </div>
                      );
                    }

                    return (
                      <>
                        {Object.entries(parsed).map(([key, val]) => {
                          const isExpanded = expandedSections[key] !== false; // Default true
                          return (
                            <div key={key} className="mb-6 bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
                              <button 
                                onClick={() => toggleSection(key)}
                                className="w-full text-left bg-slate-50 border-b border-slate-200 px-4 py-3 flex items-center justify-between hover:bg-slate-100 transition-colors focus:outline-none"
                              >
                                <h4 className="text-sm font-bold text-slate-800 uppercase tracking-wide">{key.replace(/_/g, ' ')}</h4>
                                <svg 
                                  className={`w-5 h-5 text-slate-500 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} 
                                  fill="none" 
                                  viewBox="0 0 24 24" 
                                  stroke="currentColor"
                                >
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                              </button>
                              {isExpanded && (
                                <div className="p-4 bg-white transition-all">
                                  {renderRecursiveEditor(val, [key])}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </>
                    );
                  })()}
                  </div>
                </div>
              </div>

              {/* Right Column: LLM Input / Source HTML (Read Only) */}
              <div className="flex flex-col h-full bg-[#1e1e1e] rounded-xl border border-slate-200 overflow-hidden shadow-sm relative">
                <div className="bg-slate-800 border-b border-slate-700 px-2 py-1 flex items-center justify-between shadow-sm z-10">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setRightPanelTab?.('llm')}
                      className={`px-3 py-2 text-xs font-bold rounded-t transition-colors ${
                        (rightPanelTab || 'llm') === 'llm' 
                          ? 'bg-[#1e1e1e] text-amber-400 border-b-2 border-amber-400' 
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      LLM Input 1
                    </button>
                    <button
                      onClick={() => setRightPanelTab?.('llm2')}
                      className={`px-3 py-2 text-xs font-bold rounded-t transition-colors ${
                        (rightPanelTab || 'llm') === 'llm2' 
                          ? 'bg-[#1e1e1e] text-fuchsia-400 border-b-2 border-fuchsia-400' 
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      LLM Input 2
                    </button>
                    <button
                      onClick={() => setRightPanelTab?.('html')}
                      className={`px-3 py-2 text-xs font-bold rounded-t transition-colors ${
                        (rightPanelTab || 'llm') === 'html' 
                          ? 'bg-[#1e1e1e] text-emerald-400 border-b-2 border-emerald-400' 
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Source HTML
                    </button>
                    <button
                      onClick={() => setRightPanelTab?.('sources')}
                      className={`px-3 py-2 text-xs font-bold rounded-t transition-colors ${
                        (rightPanelTab || 'llm') === 'sources' 
                          ? 'bg-[#1e1e1e] text-blue-400 border-b-2 border-blue-400' 
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Sources
                    </button>
                  </div>
                  <button
                    onClick={() => copyToClipboard(job?.url)}
                    className="flex items-center gap-1.5 px-3 py-1.5 mr-1 bg-slate-700/50 hover:bg-slate-600 text-slate-300 rounded text-xs font-bold transition-colors"
                    title="Copy primary product URL"
                  >
                    <Copy size={14} /> Copy URL
                  </button>
                </div>
                <div className="p-4 overflow-auto flex-1">
                  {(() => {
                    const rawFull = job?.raw_html || '';
                    let llmInput = '';
                    let sourceHtml = '';
                    let llmInput2 = '';
                    
                    const delim2Index = rawFull.indexOf('<!--LLM_INPUT_2_DELIMITER-->');
                    let textBeforeDelim2 = rawFull;
                    
                    if (delim2Index !== -1) {
                        textBeforeDelim2 = rawFull.substring(0, delim2Index);
                        llmInput2 = rawFull.substring(delim2Index + '<!--LLM_INPUT_2_DELIMITER-->'.length).trim();
                    }
                    
                    const delim1Index = textBeforeDelim2.indexOf('<!--LLM_INPUT_DELIMITER-->');
                    if (delim1Index !== -1) {
                        llmInput = textBeforeDelim2.substring(0, delim1Index).trim();
                        sourceHtml = textBeforeDelim2.substring(delim1Index + '<!--LLM_INPUT_DELIMITER-->'.length).trim();
                    } else {
                        sourceHtml = textBeforeDelim2.trim();
                    }

                    if ((rightPanelTab || 'llm') === 'llm') {
                      if (!llmInput) {
                        return (
                          <div className="flex items-center justify-center h-full text-slate-500 text-sm italic">
                            No LLM input data available. Run a new scrape to see this.
                          </div>
                        );
                      }
                      return (
                        <pre className="text-xs text-amber-300/90 font-mono whitespace-pre-wrap break-words leading-relaxed">
                          {llmInput}
                        </pre>
                      );
                    }
                    
                    if (rightPanelTab === 'llm2') {
                      if (!llmInput2) {
                        return (
                          <div className="flex items-center justify-center h-full text-slate-500 text-sm italic">
                            No final phase enrichment data available.
                          </div>
                        );
                      }
                      return (
                        <pre className="text-xs text-fuchsia-300/90 font-mono whitespace-pre-wrap break-words leading-relaxed">
                          {llmInput2}
                        </pre>
                      );
                    }

                    if ((rightPanelTab || 'llm') === 'sources') {
                      if (!sourcesList || sourcesList.length === 0) {
                        return (
                          <div className="flex items-center justify-center h-full text-slate-500 text-sm italic">
                            No sources data available. Run a new scrape to see this.
                          </div>
                        );
                      }
                      return (
                        <div className="text-xs text-blue-300/90 font-mono flex flex-col gap-2">
                          {sourcesList.map((src, i) => (
                            <div key={i} className="flex gap-2 break-all">
                              <span className="text-slate-500 shrink-0">[{i+1}]</span>
                              <button 
                                onClick={() => copyToClipboard(src)}
                                className="hover:text-blue-200 hover:underline text-left cursor-pointer transition-colors"
                                title="Click to copy URL"
                              >
                                {src}
                              </button>
                            </div>
                          ))}
                        </div>
                      );
                    }

                    // Source HTML tab
                    if ((rightPanelTab || 'llm') === 'html') {
                      if (!sourceHtml) {
                        return (
                          <div className="flex items-center justify-center h-full text-slate-500 text-sm italic">
                            No source HTML available for this task.
                          </div>
                        );
                      }
                      
                      let formatted = '';
                      try {
                        let pad = 0;
                        const tokens = sourceHtml.replace(/>\s+</g, '><').split(/(?=<)|(?<=>)/);
                        
                        for (let i = 0; i < tokens.length; i++) {
                          let token = tokens[i].trim();
                          if (!token) continue;
                          
                          if (token.startsWith('</')) {
                            pad -= 1;
                            formatted += '  '.repeat(Math.max(0, pad)) + token + '\n';
                          } else if (token.startsWith('<') && !token.endsWith('/>') && !token.includes('</')) {
                            formatted += '  '.repeat(Math.max(0, pad)) + token + '\n';
                            pad += 1;
                          } else {
                            formatted += '  '.repeat(Math.max(0, pad)) + token + '\n';
                          }
                        }
                      } catch (e) {
                        formatted = sourceHtml;
                      }
                      
                      return (
                        <pre className="text-xs text-emerald-400 font-mono whitespace-pre-wrap break-all">
                          {formatted.trim() || sourceHtml}
                        </pre>
                      );
                    }
                    
                    return null;
                  })()}
                </div>
              </div>
            </div>
          </div>
        )}



        {/* TAB 4: AI GENERATED PAGE (Mock Storefront) */}
        {activeTab === 'ai' && (
          <div className="h-full bg-white relative overflow-hidden flex flex-col">
            {(() => {
              let liveData = job?.product_data;
              try {
                liveData = JSON.parse(jsonData);
              } catch (e) {
                // If invalid JSON, fallback to last valid product_data
              }
              return (
                <ActiveFitnessPreview 
                  productData={liveData} 
                  onViewInImageReview={(group) => {
                    navigate(`/task-logs/ai-images/${jobId}?taskName=${encodeURIComponent(taskName)}&selectGroup=${group}`);
                  }}
                />
              );
            })()}
          </div>
        )}
      </div>

      {/* Fullscreen Overlay */}
      {isFullscreen && activeTab === 'ai' && createPortal(
        <div className="fixed inset-0 z-[9999] bg-white flex flex-col">
          <div className="flex items-center justify-between p-4 border-b border-slate-200 bg-slate-50 shadow-sm shrink-0">
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <Sparkles size={20} className="text-amber-500" />
              AI GENERATED PAGE PREVIEW
            </h2>
            <button 
              onClick={() => setIsFullscreen(false)}
              className="px-4 py-2 bg-slate-800 text-white rounded-md text-sm font-bold hover:bg-slate-700 transition-colors shadow-sm"
            >
              Exit Fullscreen
            </button>
          </div>
          <div className="flex-1 overflow-auto bg-white">
            {(() => {
              let liveData = job?.product_data;
              try {
                liveData = JSON.parse(jsonData);
              } catch (e) {}
              return (
                <ActiveFitnessPreview 
                  productData={liveData} 
                  onViewInImageReview={(group) => {
                    setIsFullscreen(false);
                    navigate(`/task-logs/ai-images/${jobId}?taskName=${encodeURIComponent(taskName)}&selectGroup=${group}`);
                  }}
                />
              );
            })()}
          </div>
        </div>,
        document.body
      )}

            {/* Task Group Completion Modal */}
      {showCompletionModal && createPortal(
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-8 text-center border border-slate-200 animate-in fade-in zoom-in-95 duration-200">
            <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 size={32} />
            </div>
            <h2 className="text-2xl font-bold text-slate-800 mb-2">Task Group Complete!</h2>
            <p className="text-slate-500 mb-8 leading-relaxed">
              All products for <span className="font-semibold text-slate-700">"{taskName}"</span> have been successfully finalized and saved to downloads.
            </p>
            <div className="flex flex-col gap-3">
              {nextTaskGroup ? (
                <button
                  onClick={() => {
                    setShowCompletionModal(false);
                    navigate(`/task-logs/content-preview/${nextTaskGroup.job_id}?taskName=${encodeURIComponent(nextTaskGroup.task_name)}&tab=table`);
                  }}
                  className="w-full py-3 px-4 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2 shadow-sm"
                >
                  Review Next Task: {nextTaskGroup.task_name} <ChevronRight size={16} />
                </button>
              ) : (
                <div className="w-full py-3 px-4 bg-slate-100 text-slate-500 rounded-lg text-sm font-semibold flex items-center justify-center gap-2">
                  No more pending tasks
                </div>
              )}
              <button
                onClick={() => {
                  setShowCompletionModal(false);
                  navigate('/task-logs');
                }}
                className="w-full py-3 px-4 bg-white border border-slate-300 text-slate-700 rounded-lg text-sm font-bold hover:bg-slate-50 transition-colors shadow-sm"
              >
                Return to Dashboard
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-5 left-1/2 z-50 bg-slate-800 text-white px-4 py-2 rounded-lg shadow-lg text-sm font-medium flex items-center gap-2 toast-animate">
          <CheckCircle2 size={16} className="text-emerald-400" />
          {toastMessage}
        </div>
      )}

      {/* Image Preview Modal */}
      {previewImage && createPortal(
        <div 
          className="fixed inset-0 z-[10000] bg-black/80 flex items-center justify-center p-4 sm:p-8 backdrop-blur-sm transition-all"
          onClick={() => setPreviewImage(null)}
        >
          <div 
            className="relative bg-white rounded-lg overflow-hidden shadow-2xl max-w-full max-h-full flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="absolute top-2 right-2 z-10 flex gap-2">
              <a 
                href={previewImage}
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 bg-black/50 hover:bg-black/80 text-white rounded-full transition-colors backdrop-blur-md"
                title="Open in new tab"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
              </a>
              <button 
                onClick={() => setPreviewImage(null)}
                className="p-2 bg-black/50 hover:bg-black/80 text-white rounded-full transition-colors backdrop-blur-md"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>
            <img 
              src={previewImage} 
              alt="Preview" 
              className="w-auto h-auto max-w-[90vw] max-h-[85vh] object-contain"
            />
          </div>
        </div>,
        document.body
      )}
    </div>

      {/* Remove Bundle Modal */}
      {itemToRemove && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 w-full max-w-sm shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-start gap-4 mb-6">
              <div className="w-10 h-10 bg-rose-50 rounded-full flex items-center justify-center border border-rose-100 shrink-0">
                <Trash2 className="text-rose-600" size={20} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">Remove Bundle</h3>
                <p className="text-sm text-slate-500 mt-1">Are you sure you want to remove this bundle? This action cannot be undone.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button 
                onClick={() => setItemToRemove(null)}
                className="flex-1 py-2.5 rounded-xl text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 font-semibold transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={confirmRemoveItem}
                className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded-xl transition-colors shadow-sm"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    
      {/* Array Item Remove Modal */}
      {arrayItemToRemove && (
        <div className="fixed inset-0 z-[100] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 w-full max-w-sm shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-start gap-4 mb-6">
              <div className="w-10 h-10 bg-rose-50 rounded-full flex items-center justify-center border border-rose-100 shrink-0">
                <Trash2 className="text-rose-600" size={20} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">Delete Item</h3>
                <p className="text-sm text-slate-500 mt-1">Proceed with deleting the image?</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button 
                onClick={() => setArrayItemToRemove(null)}
                className="flex-1 py-2.5 rounded-xl text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 font-semibold transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={() => {
                  removeArrayItem(arrayItemToRemove.path, arrayItemToRemove.index);
                  setArrayItemToRemove(null);
                }}
                className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded-xl transition-colors shadow-sm"
              >
                Proceed
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}