import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Image as ImageIcon, CheckCircle, RefreshCcw, Rocket, Layers, UploadCloud, Loader2, StopCircle, PlayCircle, Folder, FolderOpen, Maximize2, Minimize2, Trash2, ChevronLeft, ChevronRight, X, XCircle, AlertTriangle, Search, FileText } from 'lucide-react';
import clsx from 'clsx';
import api from '../api/client';
import { useSearchParams, useParams, useNavigate } from 'react-router-dom';
import { ImageQueueSkeleton, ShimmerBar, ImageReviewSkeletonPanels } from '../components/Shimmer';
import InsufficientCreditsModal from '../components/InsufficientCreditsModal';

const fallbackImage = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="100%" height="100%"><rect width="400" height="400" fill="%23f1f5f9"/><text x="200" y="200" font-family="system-ui, sans-serif" font-size="20" font-weight="600" fill="%2364748b" text-anchor="middle" dominant-baseline="middle">Failed to load</text></svg>`;

export default function AIImages() {
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [activeJobId, setActiveJobId] = useState(null);
  const [activeAssetGroup, setActiveAssetGroup] = useState(null);
  const [selectedVariationId, setSelectedVariationId] = useState(null);
  const [promptText, setPromptText] = useState("");
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showPromptModal, setShowPromptModal] = useState(false);
  const [hasInitialSelection, setHasInitialSelection] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try { return localStorage.getItem('aiImages_sidebarOpen') !== 'false'; } catch { return true; }
  });

  const toggleSidebar = () => {
    setSidebarOpen(prev => {
      const next = !prev;
      try { localStorage.setItem('aiImages_sidebarOpen', String(next)); } catch {}
      return next;
    });
  };

  const [showStopModal, setShowStopModal] = useState(false);
  const [showKeepImagesModal, setShowKeepImagesModal] = useState(false);
  const [stopJobId, setStopJobId] = useState(null);
  
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [variationToDelete, setVariationToDelete] = useState(null);
  const [dismissedAlerts, setDismissedAlerts] = useState(new Set());

  const [showDeleteJobModal, setShowDeleteJobModal] = useState(false);
  const [jobToDelete, setJobToDelete] = useState(null);

  const [remainingCredits, setRemainingCredits] = useState(null);
  const [showCreditModal, setShowCreditModal] = useState(false);
  const [creditError, setCreditError] = useState(null);

  const { jobId: routeJobId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const targetTaskId = routeJobId || searchParams.get('taskId');
  const initialSelectGroup = searchParams.get('selectGroup');
  
  const [searchQuery, setSearchQuery] = useState("");
  const taskName = searchParams.get('taskName') || 'Unknown Task';

  const activeJobIdRef = React.useRef(activeJobId || targetTaskId);
  useEffect(() => {
    activeJobIdRef.current = activeJobId || targetTaskId;
  }, [activeJobId, targetTaskId]);

  useEffect(() => {
    fetchQueue();
    fetchCredits();
    const interval = setInterval(() => {
      fetchQueue();
      fetchCredits();
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const fetchCredits = async () => {
    try {
      const res = await api.get('/credits/status');
      setRemainingCredits(res.data.actual_remaining);
    } catch (err) {
      // Silently fail
    }
  };

  // Handle default selection when queue loads or changes
  useEffect(() => {
    if (queue.length > 0 && !hasInitialSelection) {
      if (targetTaskId) {
        const job = queue.find(j => j.job_id === targetTaskId);
        if (job) {
          setActiveJobId(job.job_id);
          if (job.assets && job.assets.length > 0 && !activeAssetGroup) {
            const groupToSelect = initialSelectGroup && job.assets.some(a => a.variation_group === initialSelectGroup)
              ? initialSelectGroup
              : job.assets[0].variation_group;
            setActiveAssetGroup(groupToSelect);
            setSelectedVariationId(null);
          }
        } else {
          // alert("This task is no longer available."); // Removed to prevent annoying alerts
        }
      } else {
        const firstJob = queue[0];
        setActiveJobId(firstJob.job_id);
        if (firstJob.assets && firstJob.assets.length > 0 && !activeAssetGroup) {
          setActiveAssetGroup(firstJob.assets[0].variation_group);
          setSelectedVariationId(null);
        } else if (!firstJob.assets || firstJob.assets.length === 0) {
          setLoadingAssets(true);
          fetchQueue(firstJob.job_id);
        }
      }
      setHasInitialSelection(true);
    }
  }, [queue, hasInitialSelection, activeAssetGroup, targetTaskId, initialSelectGroup]);

  const fetchQueue = async (overrideJobId = null) => {
    try {
      const activeId = overrideJobId !== null ? overrideJobId : activeJobIdRef.current;
      const res = await api.get('/images/queue', { params: { active_job_id: activeId } });
      setQueue(res.data);
    } catch (err) {
      console.error('Failed to fetch queue', err);
    } finally {
      setLoading(false);
      setLoadingAssets(false);
    }
  };

  const handleRegenerate = async (assetId) => {
    if (!assetId || !promptText) return;
    setIsRegenerating(true);
    try {
      await api.post(`/images/${assetId}/regenerate`, null, { params: { prompt_text: promptText } });
      await fetchQueue();
    } catch (err) {
      if (err.response?.status === 402 && err.response?.data?.detail?.error === 'insufficient_credits') {
        setCreditError(err.response.data.detail);
        setShowCreditModal(true);
      } else {
        console.error('Failed to regenerate', err);
      }
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleApprove = async (assetId) => {
    if (!assetId) return;
    try {
      await api.post(`/images/${assetId}/approve`);
      await fetchQueue();
    } catch (err) {
      console.error('Failed to approve', err);
    }
  };

  const handleStop = async (jobId) => {
    if (!jobId) return;
    try {
      await api.post(`/images/job/${jobId}/stop`);
      setShowStopModal(false);
      await fetchQueue();
    } catch (err) {
      console.error('Failed to stop', err);
    }
  };

  const handleAbort = async (jobId) => {
    if (!jobId) return;
    try {
      await api.post(`/images/job/${jobId}/abort`);
      setShowStopModal(false);
      setActiveJobId(null);
      await fetchQueue();
    } catch (err) {
      console.error('Failed to abort', err);
    }
  };

  const handleRevert = async (jobId, keepImages = false) => {
    if (!jobId) return;
    try {
      await api.post(`/images/job/${jobId}/revert`, null, { params: { keep_images: keepImages } });
      setShowStopModal(false);
      setShowKeepImagesModal(false);
      setActiveJobId(null);
      await fetchQueue();
    } catch (err) {
      console.error('Failed to revert', err);
    }
  };

  const handleRevertClick = (jobId) => {
    const job = queue.find(j => j.job_id === jobId);
    const hasVariations = job?.assets?.some(a => a.variations && a.variations.length > 0);
    if (hasVariations) {
      setShowKeepImagesModal(true);
    } else {
      handleRevert(jobId, false);
    }
  };

  const handleDeleteJob = async () => {
    if (!jobToDelete) return;
    try {
      await api.delete(`/jobs/${jobToDelete}`);
      setShowDeleteJobModal(false);
      setJobToDelete(null);
      if (activeJobId === jobToDelete) {
        setActiveJobId(null);
      }
      await fetchQueue();
    } catch (err) {
      console.error('Failed to delete job', err);
    }
  };

  const handleResume = async (jobId) => {
    if (!jobId) return;
    try {
      await api.post(`/images/job/${jobId}/resume`);
      await fetchQueue();
    } catch (err) {
      console.error('Failed to resume', err);
    }
  };

  const handleFinish = async (jobId) => {
    if (!jobId) return;
    try {
      await api.post(`/images/job/${jobId}/finish`);
      const searchParams = new URLSearchParams(location.search);
      const taskName = searchParams.get('taskName') || 'Unknown Task';
      navigate(`/task-logs/content-preview/${jobId}?taskName=${encodeURIComponent(taskName)}&tab=ai`);
    } catch (err) {
      console.error('Failed to finish', err);
    }
  };

  const confirmDeleteVariation = (e, assetId) => {
    e.stopPropagation();
    if (!assetId) return;
    setVariationToDelete(assetId);
    setShowDeleteModal(true);
  };

  const executeDeleteVariation = async () => {
    if (!variationToDelete) return;
    try {
      await api.delete(`/images/${variationToDelete}`);
      if (selectedVariationId === variationToDelete) {
        setSelectedVariationId(null);
      }
      setShowDeleteModal(false);
      setVariationToDelete(null);
      await fetchQueue();
    } catch (err) {
      console.error('Failed to delete variation', err);
    }
  };

  const activeJob = queue.find(j => j.job_id === activeJobId) || null;
  const activeAssets = activeJob ? activeJob.assets : [];
  
  const currentAssetIndex = activeAssets.findIndex(a => a.variation_group === activeAssetGroup);
  const currentAsset = activeAssets[currentAssetIndex] || activeAssets[0];
  const variations = currentAsset ? currentAsset.variations : [];
  
  const activeVariationId = selectedVariationId && variations.find(v => v.id === selectedVariationId) 
    ? selectedVariationId 
    : (variations.length > 0 ? variations[0].id : null);
    
  const activeVariation = variations.find(v => v.id === activeVariationId) || variations[0];
  const isGroupGenerating = variations.some(v => v.status === 'generating');

  // Sync prompt text when active variation changes
  useEffect(() => {
    if (activeVariation && activeVariation.prompt) {
      setPromptText(activeVariation.prompt);
    }
  }, [activeVariation?.id]);

  const handlePrev = () => {
    if (currentAssetIndex > 0) {
      const nextAsset = activeAssets[currentAssetIndex - 1];
      setActiveAssetGroup(nextAsset.variation_group);
      setSelectedVariationId(null);
    }
  };

  const handleNext = () => {
    if (currentAssetIndex < activeAssets.length - 1) {
      const nextAsset = activeAssets[currentAssetIndex + 1];
      setActiveAssetGroup(nextAsset.variation_group);
      setSelectedVariationId(null);
    }
  };

  if (loading) {
    return <ImageQueueSkeleton />;
  }

  if (queue.length === 0) {
    // If a specific task was requested via URL, keep the shimmer effect while we wait
    // for it to transition into the image_generation phase.
    if (targetTaskId) {
      return <ImageQueueSkeleton />;
    }

    return (
      <div className="h-[calc(100vh-6rem)] flex flex-col items-center justify-center text-slate-500">
        <ImageIcon size={48} className="text-slate-300 mb-4" />
        <h2 className="text-xl font-semibold mb-2">Image Review Empty</h2>
        <p>No jobs are currently waiting for image review or generation.</p>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-6rem)] md:h-[calc(100vh-6rem)] flex flex-col md:flex-row gap-4 md:gap-6 overflow-y-auto md:overflow-hidden pb-4 md:pb-0 relative z-0">
      
      {/* LEFT PANEL: Project Assets */}
      <div 
        className={clsx(
          "flex flex-col bg-white rounded-xl border border-slate-200 shadow-sm shrink-0 md:h-full transition-all duration-200 ease-in-out relative z-10",
          sidebarOpen ? "w-full md:w-1/4 md:min-w-[300px]" : "w-0 md:w-0 overflow-hidden border-0 shadow-none min-w-0 !p-0 !m-0 opacity-0 md:opacity-100 hidden md:flex"
        )}
      >
        <div className="p-4 border-b border-slate-100 bg-slate-50">
          <div className="text-xs font-bold text-slate-400 tracking-wider mb-2">PROJECT ASSETS</div>
          <h2 className="text-lg font-bold text-slate-800 mb-3">{taskName}</h2>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="text"
              placeholder="Search products..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 rounded-md text-sm transition-all outline-none"
            />
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-slate-50 max-h-[35vh] md:max-h-none">
          {queue.filter(job => 
            job.task_name === taskName && 
            (job.product_name || job.task_name || '').toLowerCase().includes(searchQuery.toLowerCase())
          ).map(job => {
            const isJobActive = activeJobId === job.job_id;
            // Calculate percentage based on status or approved assets
            const totalAssets = job.assets.length;
            const approvedCount = job.assets.filter(a => a.variations.some(v => v.status === 'approved')).length;
            const percentage = job.status === 'image_generation_complete' ? 100 : (totalAssets > 0 ? Math.round((approvedCount / totalAssets) * 100) : 0);

            return (
              <div key={job.job_id} className="mb-2 bg-slate-50/30 rounded-xl overflow-hidden">
                <div 
                  className={clsx(
                    "flex justify-between items-center p-3 cursor-pointer transition-colors rounded-xl bg-slate-50/50",
                    isJobActive ? "border border-slate-100 shadow-sm" : "hover:bg-slate-100/50"
                  )}
                  onClick={() => {
                    if (isJobActive) {
                      setActiveJobId(null);
                    } else {
                      setActiveJobId(job.job_id);
                      if (job.assets.length > 0) {
                        setActiveAssetGroup(job.assets[0].variation_group);
                        setSelectedVariationId(null);
                      } else {
                        setLoadingAssets(true);
                        fetchQueue(job.job_id);
                      }
                    }
                  }}
                >
                  <div className="flex items-center gap-2 overflow-hidden">
                    {isJobActive ? <FolderOpen size={18} className="text-blue-600 flex-shrink-0" /> : <Folder size={18} className="text-blue-600 flex-shrink-0" />}
                    <span className="text-base font-bold text-slate-700 truncate" title={job.product_name || job.task_name}>{job.product_name || job.task_name}</span>
                  </div>
                  <div className="flex-shrink-0 ml-2 relative w-10 h-10 flex items-center justify-center rounded-full border-2 border-slate-200 text-[11px] font-bold text-slate-700 bg-white shadow-sm">
                    {percentage}%
                  </div>
                </div>

                {/* Expandable Task Content (Assets List) */}
                {isJobActive && !loadingAssets && (
                  <div className="p-3 pt-4 flex flex-col gap-3">
                    {job.assets.map(asset => {
                      const isApproved = asset.variations.some(v => v.status === 'approved');
                      const approvedVariation = asset.variations.find(v => v.status === 'approved');
                      const displayVariation = approvedVariation || asset.variations[0];
                      const isActive = activeAssetGroup === asset.variation_group;
                      return (
                        <div 
                          key={`${job.job_id}-${asset.variation_group}`}
                          onClick={() => {
                            setActiveAssetGroup(asset.variation_group);
                            setSelectedVariationId(null);
                          }}
                          className={clsx(
                            "p-3.5 rounded-xl border cursor-pointer transition-all relative overflow-hidden bg-white shadow-sm",
                            isActive 
                              ? "border-blue-500/50 shadow-md" 
                              : "border-slate-200 hover:border-slate-300 opacity-90"
                          )}
                        >
                          {isActive && (
                            <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-blue-600"></div>
                          )}
                          <div className="flex justify-between items-start mb-1">
                            <span className={clsx("text-sm font-bold tracking-wide truncate", isActive ? "text-slate-600" : "text-slate-500")}>
                              {asset.variation_group.toUpperCase()}
                            </span>
                            {isApproved && <CheckCircle size={14} className="text-emerald-500 flex-shrink-0 ml-2" />}
                          </div>
                          <div className="text-sm text-slate-400 truncate">{displayVariation?.asset_name || 'Generating...'}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Sidebar Toggle Button */}
      <div className="hidden md:flex items-center justify-center relative z-30 flex-shrink-0 -mx-9">
        <button
          onClick={toggleSidebar}
          title={sidebarOpen ? 'Hide Project Assets' : 'Show Project Assets'}
          className={clsx(
            "relative rounded-full w-12 h-12 flex items-center justify-center transition-all duration-200",
            "bg-green-500 text-white border-2 border-white",
            "shadow-[0_0_15px_rgba(34,197,94,0.5)] hover:shadow-[0_0_20px_rgba(34,197,94,0.7)] hover:bg-green-400 hover:scale-105 active:scale-95"
          )}
        >
          {sidebarOpen ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
        </button>
      </div>

      {!activeJobId ? (
        <div className="flex-1 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col items-center justify-center text-slate-400 relative z-10">
          <Folder size={64} className="mb-6 text-slate-200" />
          <h2 className="text-xl font-bold text-slate-500 mb-2">No Task Selected</h2>
          <p className="text-sm text-slate-400">Click on a task in the left panel to review its generated assets.</p>
        </div>
      ) : loadingAssets ? (
        <ImageReviewSkeletonPanels />
      ) : (
        <>
          {/* MIDDLE PANEL: Active Image & Bottom Status */}
          <div className="flex-1 flex flex-col gap-4 md:gap-6 min-h-[500px] md:min-h-0 md:overflow-hidden relative z-10">
            
            {/* Credit Exhaustion / Error Banner */}

            
            {/* Top: Active Preview & Prompt Editor */}
            <div className="flex-1 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-0 bg-slate-50">
            <h2 className="text-lg font-bold text-slate-800 uppercase tracking-wide truncate w-full sm:w-auto">
              {currentAsset?.variation_group ? currentAsset.variation_group.replace('_', ' ') : 'Asset Preview'}
            </h2>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 w-full sm:w-auto">

              {(activeJob?.status === 'image_generation_complete' || activeJob?.status === 'image_generation_stopped') && (
                <button 
                  onClick={() => handleFinish(activeJob.job_id)}
                  className="flex items-center justify-center gap-1.5 text-xs font-bold text-blue-600 bg-blue-50 border border-blue-200 px-3 py-1.5 rounded-md shadow-sm hover:bg-blue-100 transition-colors shrink-0 whitespace-nowrap"
                >
                  <CheckCircle size={14} /> APPROVE ALL
                </button>
              )}
              <div className="text-xs font-bold text-slate-500 bg-white border border-slate-200 px-3 py-1.5 rounded-md shadow-sm shrink-0 whitespace-nowrap">
                {activeJob?.status === 'image_generation' ? 'GENERATING...' : activeJob?.status === 'image_generation_stopped' ? 'STOPPED' : (activeJob?.status === 'failed' || activeJob?.status === 'image_generation_failed') ? 'FAILED' : 'COMPLETE'}
              </div>
            </div>
          </div>
          
          {/* Main Image Preview */}
          <div className="flex-1 bg-slate-100 p-6 flex flex-col relative overflow-hidden group">
            {variations.length > 0 && activeVariation && activeVariation.status !== 'generating' ? (
              <>
                <div className="flex-1 flex items-center justify-center relative w-full h-full p-2">
                  <div 
                    className="relative w-full h-full flex items-center justify-center rounded-lg group/img cursor-zoom-in overflow-hidden shadow-inner bg-slate-200"
                    onClick={() => setIsFullscreen(true)}
                  >
                    {/* Blurred Background to fill space */}
                    <div 
                      className="absolute inset-0 bg-cover bg-center blur-3xl opacity-50 scale-110"
                      style={{ backgroundImage: `url(${api.defaults.baseURL.replace('/api', '')}/${activeVariation.url})` }}
                    />
                    
                    {/* Actual Uncropped Image */}
                    <img 
                      src={`${api.defaults.baseURL.replace('/api', '')}/${activeVariation.url}`} 
                      alt="Generated preview" 
                      className="relative z-0 max-h-full max-w-full rounded-lg object-contain shadow-2xl transition-transform duration-300 group-hover/img:scale-[1.02] bg-white"
                      onError={(e) => { e.target.onerror = null; e.target.src = fallbackImage; }}
                    />
                    
                    {/* Dark overlay on hover with highly aesthetic VIEW button */}
                    <div className="absolute inset-0 z-10 bg-slate-900/10 opacity-0 group-hover/img:opacity-100 transition-opacity duration-300 flex items-center justify-center pointer-events-none rounded-lg">
                       <button className="bg-white/95 backdrop-blur-md text-slate-800 font-bold px-8 py-3.5 tracking-[0.2em] text-sm shadow-2xl rounded hover:bg-white hover:scale-105 transition-all pointer-events-auto flex items-center gap-2 border border-white/20">
                         <Maximize2 size={16} className="text-slate-500" />
                         VIEW
                       </button>
                    </div>

                    {/* Navigation Buttons (Centered vertically on edges) */}
                    <button 
                      onClick={(e) => { e.stopPropagation(); handlePrev(); }}
                      disabled={currentAssetIndex === 0}
                      className="absolute left-6 z-20 w-12 h-12 bg-white/90 backdrop-blur-sm hover:bg-white rounded-full flex items-center justify-center shadow-xl disabled:opacity-0 transition-all opacity-0 group-hover/img:opacity-100 border border-slate-100"
                    >
                      <ChevronLeft size={24} className="text-slate-800" />
                    </button>
                    
                    <button 
                      onClick={(e) => { e.stopPropagation(); handleNext(); }}
                      disabled={currentAssetIndex === activeAssets.length - 1}
                      className="absolute right-6 z-20 w-12 h-12 bg-white/90 backdrop-blur-sm hover:bg-white rounded-full flex items-center justify-center shadow-xl disabled:opacity-0 transition-all opacity-0 group-hover/img:opacity-100 border border-slate-100"
                    >
                      <ChevronRight size={24} className="text-slate-800" />
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="h-full w-full flex flex-col items-center justify-center relative overflow-hidden rounded-lg">
                {activeJob?.status === 'image_generation_stopped' ? (
                  <div className="text-slate-400 flex flex-col items-center">
                    <StopCircle className="mb-2 text-rose-400" size={32} />
                    <p>Generation Stopped.</p>
                  </div>
                ) : (
                  <>
                    <div className="absolute inset-0 z-0">
                      <ShimmerBar className="w-full h-full opacity-60" />
                    </div>
                    <div className="z-10 flex flex-col items-center justify-center text-slate-500 w-full h-full">
                      <ImageIcon className="mb-4 opacity-50" size={48} />
                      <p className="font-semibold tracking-wide bg-white/75 px-4 py-1.5 rounded-full shadow-sm backdrop-blur-md border border-white/40 text-sm">Generating</p>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Prompt Editor */}
          <div className="border-t border-slate-200 bg-white p-5 flex flex-col shrink-0 @container">
            <div className="text-xs font-bold text-slate-400 tracking-wider mb-3">PROMPT EDITOR</div>
            <div className="relative w-full mb-5">
              <textarea 
                rows="5"
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
                className="w-full bg-slate-900 text-slate-100 rounded-lg p-4 pb-10 font-mono text-sm border border-slate-800 focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none shadow-inner block"
              />
              <button 
                onClick={() => setShowPromptModal(true)}
                className="absolute bottom-2 right-2 p-1.5 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded transition-colors"
                title="Expand Prompt Editor"
              >
                <Maximize2 size={16} />
              </button>
            </div>
            
            <div className="flex items-stretch gap-2 @2xl:gap-3 justify-end">
              <button 
                onClick={(e) => confirmDeleteVariation(e, activeVariationId)}
                disabled={!activeVariationId}
                className="flex items-center justify-center gap-2 px-3 @2xl:px-5 bg-white border border-rose-200 text-rose-600 rounded-lg font-bold text-[13px] hover:bg-rose-50 transition-colors shadow-sm disabled:opacity-50"
                title="Remove"
              >
                <Trash2 size={16} /> <span className="hidden @2xl:inline">REMOVE</span>
              </button>
              <button 
                onClick={() => handleRegenerate(activeVariationId)}
                disabled={isRegenerating || isGroupGenerating || !activeVariationId}
                className={clsx(
                  "flex items-center justify-center gap-2.5 px-4 @2xl:px-6 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg font-bold text-[13px] hover:bg-slate-50 transition-colors shadow-sm disabled:opacity-50 leading-tight tracking-wide",
                  (isRegenerating || isGroupGenerating) && "blur-[1px] cursor-not-allowed"
                )}
                title="Regenerate Variation"
              >
                {isRegenerating || isGroupGenerating ? <Loader2 size={16} className="animate-spin" /> : <RefreshCcw size={16} />}
                <div className="text-left hidden @2xl:block">
                  <div>REGENERATE</div>
                  <div>VARIATION</div>
                </div>
              </button>
              <button 
                onClick={() => handleApprove(activeVariationId)}
                disabled={!activeVariationId}
                className="flex items-center justify-center gap-2.5 px-4 @2xl:px-6 py-2 bg-slate-800 text-white rounded-lg font-bold text-[13px] hover:bg-slate-900 transition-colors shadow-sm disabled:opacity-50 leading-tight tracking-wide"
                title="Approve Asset"
              >
                <CheckCircle size={16} />
                <div className="text-left hidden @2xl:block">
                  <div>APPROVE</div>
                  <div>ASSET</div>
                </div>
              </button>
            </div>
          </div>
        </div>



      </div>

      {/* RIGHT PANEL: Variations */}
      <div className="w-full md:w-[280px] shrink-0 flex flex-col bg-white rounded-xl border border-slate-200 shadow-sm md:h-full">
        <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between gap-2">
          <div className="text-xs font-bold text-slate-500 tracking-wider flex items-center gap-2 shrink-0">
            <Layers size={14} />
            VARIATIONS ({variations.length})
          </div>
          {remainingCredits !== null && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 border border-emerald-200/80 rounded-full shadow-sm shrink-0" title="Remaining API Credits">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
              <span className="text-[11px] font-bold text-emerald-700 tracking-wider whitespace-nowrap">
                ${typeof remainingCredits === 'number' ? remainingCredits.toFixed(2) : remainingCredits}
              </span>
            </div>
          )}
        </div>
        
        <div className="flex-1 overflow-y-auto p-5 bg-slate-50">
          <div className="grid grid-cols-2 gap-4 pb-8">
            {variations.map((variation) => (
              <div 
                key={variation.id} 
                onClick={() => (variation.status !== 'generating' && variation.status !== 'failed') && setSelectedVariationId(variation.id)}
                className={clsx(
                  "aspect-square rounded-lg border-2 cursor-pointer overflow-hidden transition-all bg-white relative group flex items-center justify-center",
                  variation.id === activeVariationId && variation.status !== 'failed'
                    ? "border-primary ring-2 ring-primary ring-opacity-20 shadow-md" 
                    : "border-transparent hover:border-slate-300 shadow-sm",
                  variation.status === 'generating' && "opacity-70 cursor-not-allowed",
                  variation.status === 'failed' && "border-rose-200 cursor-default"
                )}
              >
                {variation.status === 'generating' ? (
                  <div className="relative w-full h-full overflow-hidden">
                    <ShimmerBar className="absolute inset-0 w-full h-full" />
                    {/* <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 z-10 bg-white/30 backdrop-blur-[1px]">
                      <ImageIcon className="mb-1.5 opacity-50" size={20} />
                      <span className="text-[10px] font-bold tracking-wider bg-white/80 px-2 py-0.5 rounded shadow-sm text-center">Generating</span>
                    </div> */}
                  </div>
                ) : variation.status === 'failed' ? (
                  <div className="flex flex-col items-center justify-center text-rose-400 p-2 text-center bg-rose-50 w-full h-full relative group/failed">
                    <XCircle className="mb-2 text-rose-500" size={20} />
                    <span className="text-[10px] font-bold tracking-wider text-rose-500">FAILED</span>
                    
                    {/* Delete button overlay for failed */}
                    <button
                      onClick={(e) => confirmDeleteVariation(e, variation.id)}
                      className="absolute top-1 right-1 bg-black/60 hover:bg-rose-600 text-white p-1.5 rounded-md opacity-0 group-hover/failed:opacity-100 transition-all z-10"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ) : (
                  <>
                    <img 
                      src={`${api.defaults.baseURL.replace('/api', '')}/${variation.url}`} 
                      alt="Variation" 
                      className="w-full h-full object-cover"
                      onError={(e) => { e.target.onerror = null; e.target.src = fallbackImage; }}
                    />
                    
                    {/* Delete button overlay */}
                    <button
                      onClick={(e) => confirmDeleteVariation(e, variation.id)}
                      className="absolute top-1 right-1 bg-black/60 hover:bg-rose-600 text-white p-1.5 rounded-md opacity-0 group-hover:opacity-100 transition-all z-10"
                    >
                      <Trash2 size={12} />
                    </button>
                    
                    {variation.status === 'approved' && (
                      <div className="absolute top-1 left-1 bg-emerald-500 text-white p-1 rounded-full shadow-sm z-10">
                        <CheckCircle size={12} />
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
          
          {/* Metadata Section - Bottom Right */}
          {activeVariation && (
            <div className="p-6 border-t border-slate-200 bg-white mt-auto">
              <h3 className="text-[13px] font-bold text-slate-500 uppercase tracking-wider mb-5">Asset Metadata</h3>
              <div className="space-y-4 text-[15px]">
                <div className="flex justify-between items-start gap-4">
                  <span className="text-slate-500 flex-shrink-0">Product</span>
                  <span className="font-semibold text-slate-800 text-right leading-tight">
                    {activeJob?.product_name || activeJob?.task_name || 'Unknown Product'}
                  </span>
                </div>
                <div className="flex justify-between items-start gap-4">
                  <span className="text-slate-500 flex-shrink-0">File</span>
                  <span className="font-semibold text-slate-800 break-all text-right leading-tight">{activeVariation.asset_name}</span>
                </div>
                {activeVariation.metadata && (
                  <>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500">Type</span>
                      <span className="font-semibold text-slate-800">{activeVariation.metadata.type}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500">Ratio</span>
                      <span className="font-semibold text-slate-800">{activeVariation.metadata.ratio}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500">Size</span>
                      <span className="font-semibold text-slate-800">{activeVariation.metadata.size_kb} KB</span>
                    </div>
                    {activeVariation.metadata.created_on && (
                      <div className="flex justify-between items-center mt-3 pt-3 border-t border-slate-100">
                        <span className="text-slate-500 text-xs">Created On</span>
                        <span className="font-semibold text-slate-700 text-xs">{activeVariation.metadata.created_on}</span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
        
          {/* Bottom Right Actions */}
          <div className="p-4 border-t border-slate-200 bg-white mt-auto shrink-0 flex flex-col gap-2">
            <button 
              onClick={() => handleApprove(selectedVariationId || activeVariation?.id)}
              disabled={!activeVariation}
              className="w-full bg-white border border-emerald-500 text-emerald-700 flex items-center justify-center gap-2 py-2.5 rounded-lg font-semibold text-[13px] hover:bg-emerald-50 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <CheckCircle size={16} />
              APPROVE
            </button>
            <button 
              onClick={() => navigate(`/task-logs/content-preview/${activeJobId}?taskName=${encodeURIComponent(taskName)}&tab=ai`)}
              className="w-full bg-emerald-100 text-emerald-800 flex items-center justify-center py-3 rounded-lg font-semibold text-sm hover:bg-emerald-200 transition-colors shadow-sm"
            >
              BACK TO CONTENT PREVIEW
            </button>
          </div>
        </div>
        </>
      )}
      
      {/* Fullscreen Overlay */}
      {isFullscreen && activeVariation && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/90 flex flex-col items-center justify-center backdrop-blur-sm">
          <div className="absolute top-4 right-4 flex items-center gap-4">
            <button 
              onClick={() => setIsFullscreen(false)}
              className="text-white/70 hover:text-white p-2 bg-white/10 hover:bg-white/20 rounded-full transition-colors"
            >
              <X size={24} />
            </button>
          </div>
          
          <button 
            onClick={(e) => { e.stopPropagation(); handlePrev(); }}
            disabled={currentAssetIndex === 0}
            className="absolute left-8 z-10 w-14 h-14 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center text-white disabled:opacity-20 transition-colors"
          >
            <ChevronLeft size={32} />
          </button>

          <img 
            src={`${api.defaults.baseURL.replace('/api', '')}/${activeVariation.url}`} 
            alt="Fullscreen preview" 
            className="max-h-[90vh] max-w-[90vw] object-contain shadow-2xl rounded-sm bg-white"
            onError={(e) => { e.target.onerror = null; e.target.src = fallbackImage; }}
          />

          <button 
            onClick={(e) => { e.stopPropagation(); handleNext(); }}
            disabled={currentAssetIndex === activeAssets.length - 1}
            className="absolute right-8 z-10 w-14 h-14 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center text-white disabled:opacity-20 transition-colors"
          >
            <ChevronRight size={32} />
          </button>
          
          <div className="absolute bottom-8 px-6 py-3 bg-black/60 rounded-full text-white font-medium tracking-wide">
            {currentAsset?.variation_group.toUpperCase()} — {activeVariation.asset_name}
          </div>
        </div>,
        document.body
      )}

      {/* Stop Modal */}
      {showStopModal && createPortal(
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex flex-col items-center justify-center backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-6 border-b border-slate-100">
              <h3 className="text-xl font-bold text-slate-800">Stop Generation</h3>
              <p className="text-sm text-slate-500 mt-2">
                Do you want to completely abort this task, or return it to JSON Review?
              </p>
            </div>
            <div className="p-6 bg-slate-50 flex flex-col gap-3">
              <button 
                onClick={() => handleStop(stopJobId)}
                className="w-full text-left px-4 py-3 bg-white border border-amber-200 rounded-lg text-sm font-bold text-amber-600 hover:bg-amber-50 hover:border-amber-300 transition-colors shadow-sm flex flex-col gap-1"
              >
                <span>Stop Further Generation</span>
                <span className="text-xs font-normal text-amber-500">Keep generated images but stop making new ones.</span>
              </button>
              <button 
                onClick={() => handleAbort(stopJobId)}
                className="w-full text-left px-4 py-3 bg-white border border-rose-200 rounded-lg text-sm font-bold text-rose-600 hover:bg-rose-50 hover:border-rose-300 transition-colors shadow-sm flex flex-col gap-1"
              >
                <span>Abort Task entirely</span>
                <span className="text-xs font-normal text-rose-500">Deletes images and aborts workflow.</span>
              </button>
              <button 
                onClick={() => handleRevertClick(stopJobId)}
                className="w-full text-left px-4 py-3 bg-white border border-slate-300 rounded-lg text-sm font-bold text-slate-700 hover:bg-slate-100 hover:border-slate-400 transition-colors shadow-sm flex flex-col gap-1"
              >
                <span>Return to JSON Review</span>
                <span className="text-xs font-normal text-slate-500">Returns task to previous step.</span>
              </button>
              <button 
                onClick={() => setShowStopModal(false)}
                className="w-full text-center px-4 py-2 mt-2 text-sm font-bold text-slate-500 hover:text-slate-700 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
      {/* Keep Images Confirmation Modal */}
      {showKeepImagesModal && createPortal(
        <div className="fixed inset-0 z-[60] bg-slate-900/50 flex flex-col items-center justify-center backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex flex-col items-center text-center">
              <div className="w-12 h-12 bg-blue-100 text-blue-500 rounded-full flex items-center justify-center mb-4">
                <ImageIcon size={24} />
              </div>
              <h3 className="text-xl font-bold text-slate-800">Keep generated images?</h3>
              <p className="text-sm text-slate-500 mt-2">
                Images have already been generated for this task. Do you want to keep them when returning to JSON Review?
              </p>
            </div>
            
            <div className="p-4 bg-slate-50 flex flex-col gap-2">
              <button 
                onClick={() => handleRevert(stopJobId || activeJob?.job_id, true)}
                className="w-full py-2.5 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm transition-colors"
              >
                Yes, Keep Images
              </button>
              <button 
                onClick={() => handleRevert(stopJobId || activeJob?.job_id, false)}
                className="w-full py-2.5 text-sm font-bold text-rose-600 bg-white border border-rose-200 hover:bg-rose-50 rounded-lg transition-colors"
              >
                No, Clear Images
              </button>
              <button 
                onClick={() => setShowKeepImagesModal(false)}
                className="w-full py-2 text-sm font-bold text-slate-500 hover:text-slate-700 transition-colors mt-1"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Delete Variation Modal */}
      {showDeleteModal && createPortal(
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex flex-col items-center justify-center backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex flex-col items-center text-center">
              <div className="w-12 h-12 bg-rose-100 text-rose-500 rounded-full flex items-center justify-center mb-4">
                <Trash2 size={24} />
              </div>
              <h3 className="text-xl font-bold text-slate-800">Remove Variation</h3>
              <p className="text-sm text-slate-500 mt-2">
                Are you sure you want to permanently delete this generated image variation? This action cannot be undone.
              </p>
            </div>
            
            <div className="p-4 bg-slate-50 flex justify-end gap-3">
              <button 
                onClick={() => { setShowDeleteModal(false); setVariationToDelete(null); }}
                className="px-5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-200 bg-slate-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={executeDeleteVariation}
                className="px-5 py-2.5 text-sm font-semibold text-white bg-rose-500 hover:bg-rose-600 rounded-lg shadow-sm transition-colors"
              >
                Delete Variation
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Job Modal */}
      {showDeleteJobModal && createPortal(
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex flex-col items-center justify-center backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex flex-col items-center text-center">
              <div className="w-12 h-12 bg-rose-100 text-rose-500 rounded-full flex items-center justify-center mb-4">
                <Trash2 size={24} />
              </div>
              <h3 className="text-xl font-bold text-slate-800">Remove Task</h3>
              <p className="text-sm text-slate-500 mt-2">
                Are you sure you want to permanently delete this task? All generated images and data will be lost.
              </p>
            </div>
            
            <div className="p-4 bg-slate-50 flex justify-end gap-3">
              <button 
                onClick={() => { setShowDeleteJobModal(false); setJobToDelete(null); }}
                className="px-5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-200 bg-slate-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={handleDeleteJob}
                className="px-5 py-2.5 text-sm font-semibold text-white bg-rose-500 hover:bg-rose-600 rounded-lg shadow-sm transition-colors"
              >
                Remove Task
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Insufficient Credits Modal */}
      <InsufficientCreditsModal
        isOpen={showCreditModal}
        onClose={() => setShowCreditModal(false)}
        remainingCredits={creditError?.expected_remaining}
        mode="variant"
        onKeepImages={() => {
          setShowCreditModal(false);
          if (activeJob) handleRevertClick(activeJob.job_id);
        }}
        onClearImages={() => {
          setShowCreditModal(false);
          if (activeJob) {
            api.post(`/images/job/${activeJob.job_id}/abort`);
            fetchQueue();
          }
        }}
      />
      {/* Expanded Prompt Editor Modal */}
      {showPromptModal && createPortal(
        <div className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl flex flex-col h-[80vh] overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-200">
            <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50 shrink-0">
              <div className="font-bold text-slate-800 flex items-center gap-2">
                <FileText size={18} className="text-blue-500" />
                Prompt Editor
              </div>
              <button 
                onClick={() => setShowPromptModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded transition-colors"
                title="Close"
              >
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 p-6 bg-slate-100 flex flex-col">
              <textarea 
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
                placeholder="Enter prompt text here..."
                className="flex-1 w-full bg-slate-900 text-slate-100 rounded-xl p-6 font-mono text-base md:text-lg border-2 border-slate-800 focus:ring-4 focus:ring-blue-500/30 focus:border-blue-500 focus:outline-none resize-none shadow-inner leading-relaxed"
              />
            </div>
          </div>
        </div>,
        document.body
      )}

    </div>
  );
}
