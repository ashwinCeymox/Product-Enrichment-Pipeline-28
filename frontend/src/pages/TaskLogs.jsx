import React, { useState, useEffect } from 'react';
import api from '../api/client';
import { Search, Loader2, Image as ImageIcon, FileText, RefreshCw, Clock, CheckCircle2, XCircle, AlertCircle, RefreshCcw, Trash2, Calendar, Filter, X } from 'lucide-react';
import { TaskLogsSkeleton } from '../components/Shimmer';
import clsx from 'clsx';
import { useNavigate, useSearchParams } from 'react-router-dom';

export default function TaskLogs() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilterPopover, setShowFilterPopover] = useState(false);
  const [filterDate, setFilterDate] = useState('');
  const [filterStatuses, setFilterStatuses] = useState([]);
  const [expandedTasks, setExpandedTasks] = useState(new Set());
  const [jobToAbort, setJobToAbort] = useState(null);
  const [isAborting, setIsAborting] = useState(false);
  const [reschedulingJob, setReschedulingJob] = useState(null);
  
  // Reschedule Modal States
  const [showRescheduleModal, setShowRescheduleModal] = useState(false);
  const [rescheduleTask, setRescheduleTask] = useState(null);
  const [rescheduleType, setRescheduleType] = useState('now');
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleLoading, setRescheduleLoading] = useState(false);
  const [rescheduleCategory, setRescheduleCategory] = useState('');
  const [availableCategories, setAvailableCategories] = useState([]);
  
  // Toast State
  const [toastMessage, setToastMessage] = useState(null);
  const [groupToAbort, setGroupToAbort] = useState(null);

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const targetTaskId = searchParams.get('taskId');

  const fetchTasks = async (isManualRefresh = false) => {
    if (isManualRefresh === true) setIsRefreshing(true);
    try {
      // Fetching individual jobs and grouping them by task_name
      const res = await api.get('/dashboard/recent-activity?limit=100');
      const jobs = res.data.items || [];
      
      const grouped = {};
      jobs.forEach(job => {
        if (!grouped[job.task_name]) {
          grouped[job.task_name] = {
            task_name: job.task_name,
            jobs: [],
            status: 'processing' // Will be computed after
          };
        }
        grouped[job.task_name].jobs.push(job);
      });
      
      // Compute accurate group status
      Object.values(grouped).forEach(group => {
        const statuses = group.jobs.map(j => j.status);
        const hasError = statuses.some(s => ['failed', 'aborted', 'error', 'rescheduled'].includes(s));
        const hasPending = statuses.some(s => ['pending', 'queued', 'processing', 'scraping', 'ai_processing', 'image_generation'].includes(s));
        
        if (hasError) {
          group.status = 'error';
        } else if (hasPending) {
          group.status = 'processing';
        } else {
          group.status = 'completed';
        }
      });
      
      const taskList = Object.values(grouped).sort((a, b) => {
        const latestA = Math.max(...a.jobs.map(j => new Date(j.created_at || 0).getTime()));
        const latestB = Math.max(...b.jobs.map(j => new Date(j.created_at || 0).getTime()));
        return latestB - latestA;
      });
      
      setTasks(taskList);
      
      // Auto-expand the target task if specified, else the first task
      setExpandedTasks(prev => {
        const newSet = new Set(prev);
        if (targetTaskId) {
          const targetGroup = taskList.find(t => t.jobs.some(j => j.id === targetTaskId || j.job_id === targetTaskId));
          if (targetGroup) {
            newSet.add(targetGroup.task_name);
            return newSet;
          }
        }
        if (taskList.length > 0 && prev.size === 0) {
          return new Set([taskList[0].task_name]);
        }
        return prev;
      });
    } catch (err) {
      console.error('Failed to fetch task logs', err);
    } finally {
      setLoading(false);
      if (isManualRefresh === true) {
        setTimeout(() => setIsRefreshing(false), 500); // Small delay for visual feedback
      }
    }
  };

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, 10000);
    return () => clearInterval(interval);
  }, []);

  // Fetch available categories for the reschedule override dropdown
  useEffect(() => {
    api.get('/settings/category-specs').then(res => {
      setAvailableCategories(res.data || []);
    }).catch(() => {});
  }, []);
  useEffect(() => {
    if (targetTaskId && tasks.length > 0) {
      setTimeout(() => {
        const el = document.getElementById(`job-${targetTaskId}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
    }
  }, [targetTaskId, tasks]);


  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && jobToAbort && !isAborting) {
        setJobToAbort(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [jobToAbort, isAborting]);

  const toggleTask = (taskName) => {
    const newExpanded = new Set(expandedTasks);
    if (newExpanded.has(taskName)) {
      newExpanded.delete(taskName);
    } else {
      newExpanded.add(taskName);
    }
    setExpandedTasks(newExpanded);
  };

  const confirmAbortGroup = async () => {
    if (!groupToAbort) return;
    try {
      await api.delete(`/jobs/task/${encodeURIComponent(groupToAbort)}`);
      setToastMessage(`Group ${groupToAbort} aborted`);
      fetchTasks();
    } catch (err) {
      showToast("Failed to abort group.", "error");
    } finally {
      setGroupToAbort(null);
    }
  };

  const handleAbortConfirm = async () => {
    if (!jobToAbort) return;
    setIsAborting(true);
    try {
      await api.delete(`/jobs/${jobToAbort}`);
      setJobToAbort(null);
      fetchTasks();
    } catch (err) {
      showToast("Failed to abort task.", "error");
    } finally {
      setIsAborting(false);
    }
  };

  const handleOpenReschedule = (job) => {
    setRescheduleTask(job);
    setRescheduleType('now');
    setRescheduleDate('');
    setShowRescheduleModal(true);
  };

  const handleRescheduleSubmit = async () => {
    if (!rescheduleTask) return;
    if (rescheduleType === 'later' && !rescheduleDate) {
      showToast("Please select a date to schedule.", "error");
      return;
    }
    
    setRescheduleLoading(true);
    setReschedulingJob(rescheduleTask.job_id); // update button loading state too
    try {
      await api.post(`/jobs/${rescheduleTask.job_id}/reschedule`, {
        scheduled_date: rescheduleType === 'later' ? rescheduleDate : null,
        category_override: rescheduleCategory || null
      });
      fetchTasks();
      setShowRescheduleModal(false);
      setRescheduleTask(null);
      setRescheduleCategory('');
    } catch (error) {
      showToast("Failed to reschedule job.", "error");
    } finally {
      setRescheduleLoading(false);
      setReschedulingJob(null);
    }
  };

  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setToastMessage("Link copied");
      setTimeout(() => setToastMessage(null), 3000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'success': 
      case 'waiting_for_approval': 
      case 'image_generation_complete': return <CheckCircle2 size={16} className="text-emerald-500" />;
      case 'failed':
      case 'aborted':
      case 'error': return <XCircle size={16} className="text-rose-500" />;
      case 'rescheduled': return <AlertCircle size={16} className="text-amber-500" />;
      default: return <Loader2 size={16} className="text-indigo-500 animate-spin" />;
    }
  };

  const getStatusLabel = (status) => {
    switch(status) {
      case 'pending':
      case 'queued': return 'Queued';
      case 'processing':
      case 'scraping': return 'Processing';
      case 'ai_processing': return 'Ai Processing';
      case 'image_generation': return 'Image Generation';
      case 'waiting_for_approval': return 'Pending Review';
      case 'success': return 'Success';
      case 'failed': return 'Failed';
      case 'error': return 'Error';
      case 'rescheduled': return 'Rescheduled';
      default: return status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Processing';
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    // Format to match screenshot: MM/DD/YYYY
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  const activeFiltersCount = (filterDate ? 1 : 0) + filterStatuses.length;

  const getFilteredJobs = (jobs) => {
    return jobs.filter(job => {
      // Status filter
      if (filterStatuses.length > 0) {
        let simplifiedStatus = 'completed';
        if (['failed', 'aborted', 'error', 'rescheduled', 'pending', 'queued', 'processing', 'scraping', 'ai_processing', 'image_generation'].includes(job.status)) {
          simplifiedStatus = 'processing';
        }
        
        if (!filterStatuses.includes(simplifiedStatus)) return false;
      }

      // Date filter
      if (filterDate) {
        const jobDate = formatDate(job.created_at);
        const [y, m, d] = filterDate.split('-');
        const formattedFilterDate = `${d}/${m}/${y}`;
        if (jobDate !== formattedFilterDate) return false;
      }
      return true;
    });
  };

  const filteredTasks = tasks.map(t => ({
    ...t,
    jobs: getFilteredJobs(t.jobs)
  }))
  .filter(t => t.jobs.length > 0)
  .filter(t => t.task_name.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Task Logs</h1>
          <p className="text-sm text-slate-500 mt-1">Pipeline execution records for product enrichment.</p>
        </div>
        
        <div className="flex items-center gap-3 flex-wrap justify-end">
          
          {/* Active Filter Chips */}
          {(filterDate || filterStatuses.length > 0) && (
            <div className="flex items-center gap-2 mr-2">
              {filterDate && (
                <span className="flex items-center gap-1 bg-slate-100 text-slate-700 border border-slate-200 px-2.5 py-1 rounded-full text-xs font-semibold">
                  Date: {filterDate}
                  <button onClick={() => setFilterDate('')} className="hover:bg-slate-200 rounded-full p-0.5 transition-colors"><X size={12}/></button>
                </span>
              )}
              {filterStatuses.map(status => (
                <span key={status} className="flex items-center gap-1 bg-slate-100 text-slate-700 border border-slate-200 px-2.5 py-1 rounded-full text-xs font-semibold capitalize">
                  {status}
                  <button onClick={() => setFilterStatuses(prev => prev.filter(s => s !== status))} className="hover:bg-slate-200 rounded-full p-0.5 transition-colors"><X size={12}/></button>
                </span>
              ))}
            </div>
          )}

          {/* Filter Popover Container */}
          <div className="relative">
            <button 
              onClick={() => setShowFilterPopover(prev => !prev)}
              className={clsx(
                "flex items-center gap-2 bg-white border px-4 py-2 rounded-md text-sm font-medium transition-colors h-10",
                showFilterPopover || activeFiltersCount > 0 ? "border-primary text-primary bg-primary/5" : "border-slate-300 text-slate-700 hover:bg-slate-50"
              )}
            >
              <Filter size={16} />
              Filter
              {activeFiltersCount > 0 && (
                <span className="bg-primary text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-1 leading-none">
                  {activeFiltersCount}
                </span>
              )}
            </button>
            
            {showFilterPopover && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowFilterPopover(false)} />
                <div className="absolute right-0 top-full mt-2 w-64 bg-white border border-slate-200 rounded-lg shadow-xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="p-4 space-y-4">
                    {/* Date Picker */}
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">Date</label>
                      <input 
                        type="date"
                        value={filterDate}
                        onChange={(e) => setFilterDate(e.target.value)}
                        className="w-full border border-slate-300 rounded-md text-sm p-2 focus:ring-primary focus:border-primary outline-none"
                      />
                    </div>
                    
                    {/* Status Checkboxes */}
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-2">Status</label>
                      <div className="space-y-2">
                        <label className="flex items-center gap-2 cursor-pointer group">
                          <input 
                            type="checkbox"
                            checked={filterStatuses.includes('completed')}
                            onChange={(e) => {
                              if (e.target.checked) setFilterStatuses(prev => [...prev, 'completed']);
                              else setFilterStatuses(prev => prev.filter(s => s !== 'completed'));
                            }}
                            className="rounded text-primary focus:ring-primary border-slate-300 h-4 w-4 cursor-pointer"
                          />
                          <span className="text-sm text-slate-700 group-hover:text-slate-900 transition-colors">Completed</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer group">
                          <input 
                            type="checkbox"
                            checked={filterStatuses.includes('processing')}
                            onChange={(e) => {
                              if (e.target.checked) setFilterStatuses(prev => [...prev, 'processing']);
                              else setFilterStatuses(prev => prev.filter(s => s !== 'processing'));
                            }}
                            className="rounded text-primary focus:ring-primary border-slate-300 h-4 w-4 cursor-pointer"
                          />
                          <span className="text-sm text-slate-700 group-hover:text-slate-900 transition-colors">Processing</span>
                        </label>
                      </div>
                    </div>
                  </div>
                  
                  {/* Footer */}
                  <div className="bg-slate-50 border-t border-slate-100 p-3 flex items-center justify-between">
                    <button 
                      onClick={() => {
                        setFilterDate('');
                        setFilterStatuses([]);
                      }}
                      className="text-xs font-semibold text-slate-500 hover:text-slate-800 transition-colors"
                    >
                      Clear all
                    </button>
                    <button 
                      onClick={() => setShowFilterPopover(false)}
                      className="bg-slate-800 text-white px-4 py-1.5 rounded-md text-xs font-bold hover:bg-slate-700 transition-colors shadow-sm"
                    >
                      Apply
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search tasks..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-4 py-2 border border-slate-300 rounded-md text-sm focus:ring-primary focus:border-primary w-64 bg-white outline-none h-10"
            />
          </div>
          <button onClick={() => fetchTasks(true)} disabled={isRefreshing} className="flex items-center gap-2 bg-white border border-slate-300 text-slate-700 px-4 py-2 rounded-md text-sm font-medium hover:bg-slate-50 transition-colors h-10 disabled:opacity-50">
            <RefreshCw size={16} className={clsx(isRefreshing && "animate-spin")} />
            {isRefreshing ? 'Refreshing...' : 'Refresh Logs'}
          </button>
        </div>
      </div>

      {loading ? (
        <TaskLogsSkeleton items={4} />
      ) : filteredTasks.length === 0 ? (
        <div className="bg-white rounded-lg border border-slate-200 p-12 text-center flex flex-col items-center">
          <AlertCircle size={48} className="text-slate-300 mb-4" />
          <h3 className="text-lg font-semibold text-slate-800">No tasks match your filters</h3>
          <p className="text-slate-500 mb-6">Try adjusting your search or filters.</p>
          <button 
            onClick={() => {
              setSearchQuery('');
              setFilterDate('');
              setFilterStatuses([]);
            }}
            className="bg-primary text-white px-6 py-2 rounded-md text-sm font-bold hover:bg-primary/90 transition-colors"
          >
            Clear all filters and search
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredTasks.map((task) => {
            const isExpanded = expandedTasks.has(task.task_name);
            return (
              <div key={task.task_name} className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden transition-all">
                {/* Task Header */}
                <div 
                  className="flex items-center justify-between p-4 cursor-pointer hover:bg-slate-50 transition-colors"
                  onClick={() => toggleTask(task.task_name)}
                >
                  <div className="flex items-center gap-3">
                    <h3 className="font-bold text-slate-800">{task.task_name}</h3>
                    <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-xs font-semibold rounded-md">
                      {task.jobs.length} Links
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className={clsx("flex items-center gap-1.5 text-sm font-medium bg-white px-2 py-1", 
                      task.status === 'completed' ? "text-emerald-600" : "text-indigo-600"
                    )}>
                      <div className={clsx("w-2 h-2 rounded-full",
                        task.status === 'completed' ? "bg-emerald-600" : "bg-indigo-600 animate-pulse"
                      )}></div>
                      {task.status === 'completed' ? 'Completed' : 'Processing'}
                    </div>
                    
                    {/* Abort Group Button */}
                    <button 
                      onClick={(e) => { e.stopPropagation(); setGroupToAbort(task.task_name); }}
                      className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-md transition-colors"
                      title="Abort entire task group"
                    >
                      <Trash2 size={16} />
                    </button>

                    <svg
                      className={clsx("w-5 h-5 text-slate-400 transition-transform", isExpanded && "rotate-180")}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>

                {/* Job List */}
                {isExpanded && (
                  <div className="p-4 pt-0 border-t border-slate-100 bg-slate-50/50 space-y-3 mt-3">
                    {task.jobs.map((job) => {
                      const isComplete = ['success', 'completed', 'waiting_for_approval', 'image_generation_complete'].includes(job.status);
                      const showReviewButtons = isComplete || job.status === 'image_generation';
                      const isFailed = ['failed', 'aborted', 'error', 'rescheduled'].includes(job.status);
                      const inProgress = !isComplete && !isFailed;
                      const progress = isComplete ? 100 : (job.progress || (job.status === 'ai_processing' ? 60 : 30));

                      return (
                        <div 
                          key={job.job_id} 
                          id={`job-${job.job_id}`}
                          className={clsx(
                            "flex flex-col p-4 rounded-xl border transition-all duration-500",
                            targetTaskId === job.job_id 
                              ? "border-blue-400 bg-blue-50/50 shadow-md ring-4 ring-blue-50" 
                              : "border-slate-200 bg-white shadow-sm"
                          )}
                        >
                          <div className="flex justify-between items-start mb-2">
                            <h4 className="font-bold text-slate-800 text-lg truncate pr-4">
                              {(() => {
                                const domainName = job.source_url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0];
                                if (!isComplete) return domainName;
                                return job.product_name || domainName;
                              })()}
                            </h4>
                            <div className="flex items-center gap-3 shrink-0">
                              <span className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-50 text-slate-500 text-xs font-semibold rounded-md border border-slate-100">
                                <Clock size={12}/> {formatDate(job.created_at)}
                              </span>
                              {getStatusIcon(job.status)}
                            </div>
                          </div>
                          
                          <span 
                            onClick={() => copyToClipboard(job.source_url)} 
                            className="text-sm text-slate-500 hover:text-indigo-600 hover:underline truncate block mb-4 cursor-pointer"
                            title="Click to copy URL"
                          >
                            {job.source_url}
                          </span>

                          <div className="flex justify-between items-center mt-auto pt-2">
                            <div className="flex items-center gap-3">
                              <span className="border border-slate-200 px-3 py-1 rounded-full text-sm font-medium text-slate-600 bg-white">
                                {job.error_message && job.error_message.includes('No reference image found') ? 'No reference image found' : getStatusLabel(job.status)}
                              </span>
                              
                              {/* Review Buttons - Only show when waiting_for_approval, success, or generating images */}
                              {showReviewButtons && (
                                <div className="flex items-center gap-2 ml-2">
                                  {job.generate_ai_images ? (
                                    <>
                                      <button 
                                        onClick={() => navigate(`/task-logs/content-preview/${job.job_id}?taskName=${encodeURIComponent(task.task_name)}&tab=table`)}
                                        className="flex items-center gap-1.5 px-3 py-1.5 bg-[#00A389]/10 text-[#00A389] border border-[#00A389]/30 rounded-md text-xs font-bold hover:bg-[#00A389]/20 transition-colors"
                                      >
                                        <FileText size={14} /> CONTENT PREVIEW
                                      </button>
                                      {['image_generation', 'image_generation_stopped', 'image_generation_complete', 'image_generation_failed'].includes(job.status) && (
                                        <button 
                                          onClick={() => navigate(`/task-logs/ai-images/${job.job_id}?taskName=${encodeURIComponent(task.task_name)}`)}
                                          className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-md text-xs font-bold hover:bg-indigo-100 transition-colors"
                                        >
                                          <ImageIcon size={14} /> IMAGE REVIEW
                                        </button>
                                      )}
                                    </>
                                  ) : (
                                    <button 
                                      onClick={() => navigate(`/task-logs/content-preview/${job.job_id}?taskName=${encodeURIComponent(task.task_name)}`)}
                                      className="flex items-center gap-1.5 px-4 py-1.5 bg-indigo-600 text-white rounded-md text-xs font-bold hover:bg-indigo-700 transition-colors shadow-sm"
                                    >
                                      PROCEED
                                    </button>
                                  )}
                                </div>
                              )}
                              
                              {isFailed && (
                                <button 
                                  onClick={() => handleOpenReschedule(job)}
                                  disabled={reschedulingJob === job.job_id}
                                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 transition-colors shadow-sm disabled:opacity-50"
                                >
                                  {reschedulingJob === job.job_id ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />} 
                                  {reschedulingJob === job.job_id ? 'RESCHEDULING...' : 'RESCHEDULE'}
                                </button>
                              )}
                            </div>
                            
                            <div className="flex items-center gap-2">
                              {job.status !== 'aborted' && (
                                <button 
                                  onClick={() => setJobToAbort(job.job_id)}
                                  className="flex items-center justify-center w-8 h-8 rounded-[10px] border-2 border-rose-200 bg-white text-rose-600 hover:bg-rose-50 hover:border-rose-300 transition-all shadow-sm" 
                                  title="Abort Job"
                                >
                                  <Trash2 size={15} strokeWidth={2.5} />
                                </button>
                              )}
                              <span className="text-indigo-600 font-bold tracking-tight">
                                {progress}%
                              </span>
                            </div>
                          </div>
                          
                          {/* Error message row if failed */}
                          {isFailed && job.error_message && (
                            <div className="mt-3 text-xs text-rose-600 bg-rose-50 p-2 rounded border border-rose-100">
                              {job.error_message}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Abort Confirmation Modal */}
      {jobToAbort && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6 border border-slate-200">
            <h3 className="text-lg font-bold text-slate-800 mb-2">Abort this task?</h3>
            <p className="text-sm text-slate-500 mb-6">
              Are you sure you want to abort this task? The task will be removed from the active processing pipeline.
            </p>
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setJobToAbort(null)}
                disabled={isAborting}
                className="px-4 py-2 text-sm font-semibold text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors"
              >
                CANCEL
              </button>
              <button 
                onClick={handleAbortConfirm}
                disabled={isAborting}
                className="px-4 py-2 text-sm font-semibold text-white bg-rose-600 rounded-lg hover:bg-rose-700 disabled:opacity-50 flex items-center gap-2 transition-colors"
              >
                {isAborting && <Loader2 size={14} className="animate-spin" />}
                ABORT TASK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reschedule Modal */}
      {showRescheduleModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex flex-col items-center justify-center backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200">
            <div className="p-6 border-b border-slate-100 flex flex-col items-center text-center">
              <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mb-4">
                <RefreshCcw size={24} />
              </div>
              <h3 className="text-xl font-bold text-slate-800">Reschedule Task</h3>
              <p className="text-sm text-slate-500 mt-2 truncate w-full max-w-sm">
                {rescheduleTask?.task_name}
              </p>
            </div>
            
            <div className="p-6">
              <div className="flex flex-col gap-4">
                <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-slate-50 transition-colors">
                  <input 
                    type="radio" 
                    name="rescheduleType" 
                    value="now" 
                    checked={rescheduleType === 'now'} 
                    onChange={() => setRescheduleType('now')} 
                    className="w-4 h-4 text-blue-600 focus:ring-blue-600"
                  />
                  <div className="flex flex-col">
                    <span className="font-semibold text-sm text-slate-800">Schedule Now</span>
                    <span className="text-xs text-slate-500">Send immediately to the scraping queue</span>
                  </div>
                </label>
                
                <label className="flex flex-col gap-3 p-3 border rounded-lg cursor-pointer hover:bg-slate-50 transition-colors">
                  <div className="flex items-center gap-3">
                    <input 
                      type="radio" 
                      name="rescheduleType" 
                      value="later" 
                      checked={rescheduleType === 'later'} 
                      onChange={() => setRescheduleType('later')} 
                      className="w-4 h-4 text-blue-600 focus:ring-blue-600"
                    />
                    <div className="flex flex-col">
                      <span className="font-semibold text-sm text-slate-800">Schedule Later</span>
                      <span className="text-xs text-slate-500">Choose a future date to run this task</span>
                    </div>
                  </div>
                  
                  {rescheduleType === 'later' && (
                    <div className="pl-7 pr-2 pt-2">
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                          <Calendar size={16} className="text-slate-400" />
                        </div>
                        <input 
                          type="date" 
                          value={rescheduleDate}
                          onChange={e => setRescheduleDate(e.target.value)}
                          min={new Date().toISOString().split('T')[0]}
                          className="w-full pl-10 px-3 py-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 sm:text-sm text-slate-700 outline-none"
                        />
                      </div>
                    </div>
                  )}
                </label>
              </div>

              {/* Category Override */}
              {availableCategories.length > 0 && (
                <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <label className="block text-xs font-bold text-amber-800 mb-1">
                    Force Category Template <span className="font-normal text-amber-600">(Optional)</span>
                  </label>
                  <p className="text-[11px] text-amber-700 mb-2">
                    Override AI category detection. Use this if the task failed with a category error.
                  </p>
                  <select
                    value={rescheduleCategory}
                    onChange={e => setRescheduleCategory(e.target.value)}
                    className="w-full px-3 py-2 border border-amber-300 rounded-md text-sm text-slate-700 bg-white focus:ring-amber-500 focus:border-amber-500 outline-none"
                  >
                    <option value="">— Let AI decide (no override) —</option>
                    {availableCategories.map(cat => (
                      <option key={cat.id} value={cat.category_name}>{cat.category_name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            
            <div className="p-4 bg-slate-50 flex justify-end gap-3 border-t border-slate-100">
              <button 
                onClick={() => { setShowRescheduleModal(false); setRescheduleTask(null); setRescheduleCategory(''); }}
                disabled={rescheduleLoading}
                className="px-5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-200 bg-slate-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={handleRescheduleSubmit}
                disabled={rescheduleLoading || (rescheduleType === 'later' && !rescheduleDate)}
                className="px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                {rescheduleLoading ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Processing...
                  </>
                ) : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-5 left-1/2 z-50 bg-slate-800 text-white px-4 py-2 rounded-lg shadow-lg text-sm font-medium flex items-center gap-2 toast-animate">
          <CheckCircle2 size={16} className="text-emerald-400" />
          {toastMessage}
        </div>
      )}

      {/* Abort Group Modal */}
      {groupToAbort && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 w-full max-w-sm shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-start gap-4 mb-6">
              <div className="w-10 h-10 bg-rose-50 rounded-full flex items-center justify-center border border-rose-100 shrink-0">
                <Trash2 className="text-rose-600" size={20} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">Abort Group</h3>
                <p className="text-sm text-slate-500 mt-1">Are you sure you want to permanently abort and delete all jobs under <strong>{groupToAbort}</strong>? This action cannot be undone.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button 
                onClick={() => setGroupToAbort(null)}
                className="flex-1 py-2.5 rounded-xl text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 font-semibold transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={confirmAbortGroup}
                className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded-xl transition-colors shadow-sm"
              >
                Abort All
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}