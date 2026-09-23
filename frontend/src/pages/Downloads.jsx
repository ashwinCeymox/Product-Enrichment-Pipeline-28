import React, { useState, useEffect, useMemo } from 'react';
import api from '../api/client';
import { Search, Loader2, Download as DownloadIcon, Calendar, FilterX } from 'lucide-react';
import clsx from 'clsx';
import { DownloadsTableSkeleton } from '../components/Shimmer';

export default function Downloads() {
  const [bundles, setBundles] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  
  const [downloadingId, setDownloadingId] = useState(null);

  const fetchBundles = async () => {
    setLoading(true);
    try {
      const res = await api.get('/jobs/?status=completed,success');
      if (res.data?.jobs) {
        setBundles(res.data.jobs);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBundles();
  }, []);

  const handleDownload = async (job) => {
    setDownloadingId(job.id);
    try {
      const response = await api.get(`/jobs/${job.id}/download-zip`, {
        responseType: 'blob'
      });
      
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      const safeName = job.task_name.replace(/ /g, "_").replace(/\//g, "-");
      link.setAttribute('download', `${safeName}_bundle.zip`);
      document.body.appendChild(link);
      link.click();
      link.parentNode.removeChild(link);
      
    } catch (err) {
      console.error(err);
      alert('Failed to download bundle. The zip file may not exist.');
    } finally {
      setDownloadingId(null);
    }
  };

  const filteredBundles = useMemo(() => {
    return bundles.filter(b => {
      const matchesSearch = b.task_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            (b.product_data?.product_identity?.product_name || "").toLowerCase().includes(searchQuery.toLowerCase());
      
      let matchesDate = true;
      if (dateFilter) {
        // Compare YYYY-MM-DD
        const jobDate = new Date(b.updated_at).toISOString().split('T')[0];
        matchesDate = jobDate === dateFilter;
      }
      
      return matchesSearch && matchesDate;
    }).sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)); // Sort newest first
  }, [bundles, searchQuery, dateFilter]);

  const clearFilters = () => {
    setSearchQuery('');
    setDateFilter('');
  };

  return (
    <div className="h-full bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col overflow-hidden">
      {/* Header & Filters */}
      <div className="p-6 border-b border-slate-200 bg-slate-50 shrink-0">
        <h2 className="text-xl font-bold text-slate-800 mb-4">Bundle Downloads</h2>
        
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              type="text"
              placeholder="Search by task or product name..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-md focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary text-sm"
            />
          </div>
          
          <div className="flex gap-2">
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input
                type="date"
                value={dateFilter}
                onChange={e => setDateFilter(e.target.value)}
                className="w-[160px] pl-10 pr-4 py-2 border border-slate-300 rounded-md focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary text-sm text-slate-600"
              />
            </div>
            
            {(searchQuery || dateFilter) && (
              <button 
                onClick={clearFilters}
                className="px-3 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-md transition-colors flex items-center gap-2 text-sm font-medium"
              >
                <FilterX size={16} /> Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Table Area */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <DownloadsTableSkeleton rows={4} />
        ) : filteredBundles.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-500">
            <div className="text-4xl mb-3">📁</div>
            <p className="text-lg font-medium">No bundles found</p>
            <p className="text-sm mt-1">Try adjusting your search or date filters.</p>
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead className="bg-white sticky top-0 z-10 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
              <tr>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200">Task Name</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200">Product Info</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200">Reviewed By</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200">Approved Date</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredBundles.map(job => {
                const prodName = job.product_data?.product_identity?.product_name || "Unknown Product";
                const brand = job.product_data?.product_identity?.brand || "Unknown Brand";
                const date = new Date(job.updated_at);
                const isDownloading = downloadingId === job.id;

                return (
                  <tr key={job.id} className="hover:bg-slate-50 transition-colors group">
                    <td className="px-6 py-4">
                      <div className="font-semibold text-slate-800 text-sm">{job.task_name}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-slate-700 font-medium">{prodName}</div>
                      <div className="text-xs text-slate-500 mt-0.5">{brand}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center text-[10px] font-bold text-indigo-700 shrink-0 border border-indigo-200">
                          {(job.result_zip_file?.approved_by || "System").substring(0, 2).toUpperCase()}
                        </div>
                        <span className="text-sm font-medium text-slate-700 truncate max-w-[120px]">
                          {job.result_zip_file?.approved_by || "System"}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-slate-600">
                        {date.toLocaleDateString()}
                      </div>
                      <div className="text-xs text-slate-400">
                        {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => handleDownload(job)}
                        disabled={isDownloading}
                        className={clsx(
                          "inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold transition-colors shadow-sm",
                          isDownloading 
                            ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                            : "bg-primary text-white hover:bg-primary/90"
                        )}
                      >
                        {isDownloading ? <Loader2 size={16} className="animate-spin" /> : <DownloadIcon size={16} />}
                        {isDownloading ? 'Downloading...' : 'Download ZIP'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
