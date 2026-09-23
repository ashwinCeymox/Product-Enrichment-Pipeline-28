import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import { MoreVertical, UserPlus, Filter, Search, X, AlertTriangle } from 'lucide-react';
import { UsersTableSkeleton } from '../components/Shimmer';

export default function Users() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Invite Modal State
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('user');
  const [inviteError, setInviteError] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);

  // Search & Filter
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [isFilterDropdownOpen, setIsFilterDropdownOpen] = useState(false);

  const fetchUsers = async () => {
    try {
      const response = await api.get('/users/');
      setUsers(response.data);
    } catch (err) {
      setError('Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleInvite = async (e) => {
    e.preventDefault();
    setInviteError('');
    setInviteLoading(true);
    
    try {
      await api.post('/users/invite', { email: inviteEmail, role: inviteRole });
      setIsInviteModalOpen(false);
      setInviteEmail('');
      setInviteRole('user');
      fetchUsers(); // Refresh list
    } catch (err) {
      setInviteError(err.response?.data?.detail || 'Failed to invite user');
    } finally {
      setInviteLoading(false);
    }
  };

  const handleRemoveUser = async (userId) => {
    if (!window.confirm("Are you sure you want to remove this user? This action will immediately end their session and lock them out.")) return;
    
    try {
      await api.post(`/users/${userId}/remove`);
      fetchUsers();
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to remove user');
    }
  };

  const filteredUsers = users.filter(u => {
    if (u.role === 'superadmin') return false;
    if (roleFilter !== 'all' && u.role !== roleFilter) return false;
    
    return (
      u.email.toLowerCase().includes(search.toLowerCase()) || 
      (u.username && u.username.toLowerCase().includes(search.toLowerCase())) ||
      (u.full_name && u.full_name.toLowerCase().includes(search.toLowerCase()))
    );
  });

  return (
    <div className="p-8 h-full bg-slate-50 text-slate-600 flex flex-col relative">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8 shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 mb-1">User Directory</h1>
          <p className="text-sm text-slate-500">Manage access control and system permissions for all platform personnel.</p>
        </div>
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-3 sm:gap-4 w-full sm:w-auto">
          <div className="relative w-full sm:w-auto">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
            <input 
              type="text" 
              placeholder="Search users by name, email or role..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="bg-white border border-slate-200 rounded-lg pl-10 pr-4 py-2 text-sm text-slate-900 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 w-full sm:w-80 shadow-sm"
            />
          </div>
          {currentUser.role === 'superadmin' && (
            <div className="relative">
              <button 
                onClick={() => setIsFilterDropdownOpen(!isFilterDropdownOpen)}
                className="flex items-center gap-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 px-4 py-2 rounded-lg text-sm transition-colors shadow-sm font-medium"
              >
                <Filter size={16} /> Filter
              </button>
              {isFilterDropdownOpen && (
                <div className="absolute top-full right-0 mt-2 w-48 bg-white border border-slate-200 rounded-lg shadow-lg z-20 py-1">
                  <div className="px-3 py-2 text-xs font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100">Role Filter</div>
                  <button onClick={() => {setRoleFilter('all'); setIsFilterDropdownOpen(false);}} className={`w-full text-left px-4 py-2 text-sm ${roleFilter === 'all' ? 'bg-cyan-50 text-cyan-700 font-medium' : 'text-slate-700 hover:bg-slate-50'}`}>All Users</button>
                  <button onClick={() => {setRoleFilter('admin'); setIsFilterDropdownOpen(false);}} className={`w-full text-left px-4 py-2 text-sm ${roleFilter === 'admin' ? 'bg-cyan-50 text-cyan-700 font-medium' : 'text-slate-700 hover:bg-slate-50'}`}>Admins Only</button>
                  <button onClick={() => {setRoleFilter('user'); setIsFilterDropdownOpen(false);}} className={`w-full text-left px-4 py-2 text-sm ${roleFilter === 'user' ? 'bg-cyan-50 text-cyan-700 font-medium' : 'text-slate-700 hover:bg-slate-50'}`}>Normal Users Only</button>
                </div>
              )}
            </div>
          )}
          <button 
            onClick={() => setIsInviteModalOpen(true)}
            className="flex items-center justify-center w-full sm:w-10 h-10 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg transition-colors shadow-sm gap-2 sm:gap-0 font-medium sm:font-normal"
            title="Invite User"
          >
            <UserPlus size={18} />
            <span className="sm:hidden">Invite User</span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-white border border-slate-200 rounded-xl shadow-sm">
        {loading ? (
          <UsersTableSkeleton rows={5} />
        ) : error ? (
          <div className="p-8 text-center text-red-500">{error}</div>
        ) : (
          <table className="w-full text-left border-collapse min-w-[700px]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <th className="px-6 py-4">User Identifier</th>
                <th className="px-6 py-4 text-center">Role</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Last Active</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="text-sm divide-y divide-slate-100">
              {filteredUsers.map((u) => {
                const displayName = u.full_name || u.username || 'Pending Acceptance';
                const initials = displayName !== 'Pending Acceptance' 
                  ? displayName.substring(0, 2).toUpperCase() 
                  : u.email.substring(0, 2).toUpperCase();
                
                // Presence dot using is_online from DB
                let presenceText = 'Inactive';
                let presenceColor = 'bg-slate-500';
                
                if (u.is_online) {
                  presenceText = 'Active';
                  presenceColor = 'bg-emerald-500';
                } else if (u.last_active_at) {
                  const lastActive = new Date(u.last_active_at);
                  const now = new Date();
                  const diffMin = (now - lastActive) / 1000 / 60;
                  if (diffMin < 1440) { // 1 day
                    presenceText = `${Math.floor(diffMin / 60)} hours ago`;
                  } else {
                    presenceText = `${Math.floor(diffMin / 1440)} days ago`;
                  }
                }

                // If they are removed, override
                if (u.status === 'removed') {
                  presenceText = 'Account Removed';
                  presenceColor = 'bg-red-500';
                }

                return (
                  <tr key={u.id} className="hover:bg-slate-50 transition-colors group">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-600 border border-slate-200 shrink-0">
                          {initials}
                        </div>
                        <div>
                          <div className={`font-semibold ${u.status === 'removed' ? 'text-slate-400' : 'text-slate-900'}`}>{displayName}</div>
                          <div className="text-xs text-slate-500">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className={`px-3 py-1 rounded-full border text-[10px] font-bold uppercase tracking-wider ${
                        u.role === 'admin' ? 'border-purple-200 text-purple-700 bg-purple-50' :
                        'border-slate-200 text-slate-600 bg-white'
                      }`}>
                        {u.role === 'user' ? 'normal' : u.role}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${presenceColor}`}></div>
                        <span className="text-slate-700 font-medium text-sm">{u.status === 'pending' ? 'Pending' : presenceText === 'Active' ? 'Active' : presenceText === 'Account Removed' ? 'Removed' : 'Inactive'}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-slate-500 text-xs">
                      {presenceText !== 'Active' && presenceText !== 'Inactive' && presenceText !== 'Account Removed' ? presenceText : (u.last_active_at ? 'Previously active' : 'Never')}
                    </td>
                    <td className="px-6 py-4 text-right relative">
                      {/* We only show actions if they are manageable */}
                      {u.id !== currentUser.id && u.role !== 'superadmin' && !(currentUser.role === 'admin' && u.role === 'admin') && (
                        <div className="group/dropdown relative inline-block text-left">
                          <button className="p-2 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-600 transition-colors">
                            <MoreVertical size={16} />
                          </button>
                          
                          {/* Dropdown Menu on hover */}
                          <div className="absolute right-0 mt-0 w-36 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 invisible group-hover/dropdown:visible opacity-0 group-hover/dropdown:opacity-100 transition-all z-10 border border-slate-100">
                            <div className="py-1">
                              <button 
                                onClick={() => handleRemoveUser(u.id)}
                                className="block w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                              >
                                Remove User
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filteredUsers.length === 0 && (
                <tr>
                  <td colSpan="5" className="px-6 py-8 text-center text-slate-500">
                    No users found matching your search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Invite Modal */}
      {isInviteModalOpen && (
        <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 w-full max-w-md shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-start justify-between mb-6">
              <div className="flex gap-4">
                <div className="w-12 h-12 bg-cyan-50 rounded-full flex items-center justify-center border border-cyan-100 shrink-0 shadow-sm">
                  <UserPlus className="text-cyan-600" size={24} />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-slate-900">Invite User</h2>
                  <p className="text-sm text-slate-500 mt-1 leading-snug">Send an invitation email to add a new team member.</p>
                </div>
              </div>
              <button onClick={() => setIsInviteModalOpen(false)} className="text-slate-400 hover:text-slate-600 transition-colors p-1.5 hover:bg-slate-100 rounded-full">
                <X size={20} />
              </button>
            </div>
            
            {inviteError && (
              <div className="mb-6 text-sm text-rose-700 bg-rose-50 border border-rose-200 p-3.5 rounded-xl flex items-center gap-2 shadow-sm font-medium">
                <AlertTriangle size={18} className="shrink-0 text-rose-500" /> 
                {inviteError}
              </div>
            )}
            
            <form onSubmit={handleInvite} className="space-y-6">
              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">Email Address</label>
                <div className="relative">
                  <input 
                    type="email" 
                    required
                    value={inviteEmail}
                    onChange={e => setInviteEmail(e.target.value)}
                    placeholder="name@company.com"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 focus:bg-white transition-all shadow-sm"
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">Assign Role</label>
                <div className={`grid gap-4 ${currentUser.role === 'superadmin' ? 'grid-cols-2' : 'grid-cols-1'}`}>
                  <div 
                    onClick={() => setInviteRole('user')}
                    className={`border rounded-xl p-4 cursor-pointer transition-all ${inviteRole === 'user' ? 'border-cyan-500 bg-cyan-50 ring-1 ring-cyan-500 shadow-sm' : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 shadow-sm'}`}
                  >
                    <div className={`text-sm font-bold ${inviteRole === 'user' ? 'text-cyan-800' : 'text-slate-700'}`}>Normal User</div>
                    <div className="text-xs text-slate-500 mt-1 font-medium">Standard access</div>
                  </div>
                  
                  {currentUser.role === 'superadmin' && (
                    <div 
                      onClick={() => setInviteRole('admin')}
                      className={`border rounded-xl p-4 cursor-pointer transition-all ${inviteRole === 'admin' ? 'border-cyan-500 bg-cyan-50 ring-1 ring-cyan-500 shadow-sm' : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 shadow-sm'}`}
                    >
                      <div className={`text-sm font-bold ${inviteRole === 'admin' ? 'text-cyan-800' : 'text-slate-700'}`}>Administrator</div>
                      <div className="text-xs text-slate-500 mt-1 font-medium">Management access</div>
                    </div>
                  )}
                </div>
              </div>
              
              <div className="pt-2 flex gap-3">
                <button 
                  type="button" 
                  onClick={() => setIsInviteModalOpen(false)}
                  className="flex-1 py-3 rounded-xl text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 hover:text-slate-800 font-bold transition-colors shadow-sm"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={inviteLoading}
                  className="flex-1 py-3 bg-cyan-600 hover:bg-cyan-700 text-white font-bold rounded-xl transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {inviteLoading ? (
                    <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> Sending...</>
                  ) : (
                    'Send Invite'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
