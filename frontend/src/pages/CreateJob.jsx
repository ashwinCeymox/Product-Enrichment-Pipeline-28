import React, { useState } from 'react';
import api from '../api/client';
import { UploadCloud, Play, Calendar, AlertCircle, Loader2, XCircle } from 'lucide-react';
import clsx from 'clsx';
import InsufficientCreditsModal from '../components/InsufficientCreditsModal';

export default function CreateJob() {
  const [taskName, setTaskName] = useState('');
  const [urls, setUrls] = useState('');
  const [priority, setPriority] = useState('low');
  const [scheduledDate, setScheduledDate] = useState('');
  const [productType, setProductType] = useState('simple');
  const [generateAiImages, setGenerateAiImages] = useState(false);
  
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  
  const [showCredentialModal, setShowCredentialModal] = useState(false);
  
  const [showCreditModal, setShowCreditModal] = useState(false);
  const [creditError, setCreditError] = useState(null);
  const [showAiWarningModal, setShowAiWarningModal] = useState(false);

  const urlList = urls.split('\n').map(u => u.trim()).filter(Boolean);

  const handleStartProcessingClick = (e) => {
    e.preventDefault();
    if (!generateAiImages) {
      setShowAiWarningModal(true);
    } else {
      executeSubmit();
    }
  };

  const executeSubmit = async () => {
    if (!taskName || urlList.length === 0) return;
    setShowAiWarningModal(false);
    
    setLoading(true);
    setMessage('');
    try {
      const res = await api.post('/jobs', {
        task_name: taskName,
        urls: urlList,
        priority: priority,
        scheduled_date: scheduledDate || null,
        product_type: productType,
        created_by: 'admin',
        generate_ai_images: generateAiImages
      });
      setMessage(`Success! ${res.data.message}`);
      setUrls('');
      setTaskName('');
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
      setUrls('');
      setTaskName('');
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
            <div></div>
          </div>

          <div>
            <div className="flex justify-between items-end mb-1">
              <label className="block text-sm font-medium text-slate-700">Source URLs</label>
              <span className="text-xs text-slate-500">{urlList.length} valid URL(s) detected</span>
            </div>
            <textarea 
              required
              rows={8}
              value={urls}
              onChange={e => setUrls(e.target.value)}
              placeholder="https://example.com/product-1&#10;https://example.com/product-2"
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
              disabled={loading || !taskName || urlList.length === 0}
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
    </div>
  );
}
