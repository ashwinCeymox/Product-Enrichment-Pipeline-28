import React, { useState, useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { 
  LayoutDashboard, 
  FilePlus2, 
  CheckSquare, 
  Image as ImageIcon, 
  PackageCheck, 
  AlertTriangle,
  Settings,
  ChevronLeft,
  ChevronRight,
  UserCircle,
  LogOut,
  Download,
  Users,
  Menu,
  X,
  Server,
  Eye,
  FileText
} from 'lucide-react';
import clsx from 'clsx';

const ALL_NAV_ITEMS = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', roles: ['superadmin', 'admin', 'user'] },
  { to: '/jobs/create', icon: FilePlus2, label: 'Create Job', roles: ['superadmin', 'admin', 'user'] },
  { to: '/task-logs', icon: Server, label: 'Task Logs', roles: ['superadmin', 'admin'] },
  { to: '/downloads', icon: Download, label: 'Downloads', roles: ['superadmin', 'admin', 'user'] },
  { to: '/users', icon: Users, label: 'Users', roles: ['superadmin', 'admin'] },
  { to: '/settings', icon: Settings, label: 'Settings', roles: ['superadmin'] },
];

export default function Layout() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { user, logout } = useAuth();
  const location = useLocation();
  const [stats, setStats] = useState(null);
  const [errorLogs, setErrorLogs] = useState([]);
  

  // Profile Modal State
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [profileTab, setProfileTab] = useState('info');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');
    
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match');
      return;
    }
    
    setIsChangingPassword(true);
    try {
      await api.post('/auth/profile/password', {
        current_password: currentPassword,
        new_password: newPassword
      });
      setPasswordSuccess('Password updated successfully');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => {
        setIsProfileModalOpen(false);
        setPasswordSuccess('');
      }, 2000);
    } catch (err) {
      setPasswordError(err.response?.data?.detail || 'Failed to update password');
    } finally {
      setIsChangingPassword(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    const fetchData = async () => {
      try {
        const [statsRes, errorRes] = await Promise.all([
          api.get('/dashboard/stats'),
          api.get('/dashboard/error-logs?limit=50')
        ]);
        setStats(statsRes.data);
        setErrorLogs(errorRes.data.items || []);
      } catch (err) {
        console.error('Failed to fetch sidebar data', err);
      }
    };
    fetchData();
    const interval = setInterval(fetchData, 10000);
    
    const handleClear = () => fetchData();
    window.addEventListener('errorLogsCleared', handleClear);
    
    return () => {
      clearInterval(interval);
      window.removeEventListener('errorLogsCleared', handleClear);
    };
  }, [user]);

  const navItems = ALL_NAV_ITEMS.filter(item => item.roles.includes(user.role));

  const getBadgeCount = (path) => {
    if (!stats) return 0;
    switch (path) {
      case '/task-logs': return (stats.approval_breakdown?.json_count || 0) + (stats.approval_breakdown?.image_count || 0); // Combined queue
      default: return 0;
    }
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-slate-50 relative">
      {/* Mobile Overlay */}
      {mobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-slate-900/50 z-40 md:hidden backdrop-blur-sm transition-opacity"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside 
        className={clsx(
          "bg-slate-900 text-slate-300 flex flex-col transition-all duration-300 z-50",
          "fixed inset-y-0 left-0 md:relative md:flex h-full",
          mobileMenuOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
          collapsed ? "md:w-16 w-64" : "w-64"
        )}
      >
        <div className="h-16 flex items-center justify-between px-4 border-b border-slate-800 shrink-0">
          {!collapsed && <span className="font-bold text-white text-sm tracking-tight">Active Fitness</span>}
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setCollapsed(!collapsed)}
              className="hidden md:flex p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white"
            >
              {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
            </button>
            <button 
              onClick={() => setMobileMenuOpen(false)}
              className="md:hidden p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        <nav className="flex-1 py-4 flex flex-col gap-1 px-2 overflow-y-auto">
          {navItems.map((item) => (
            <React.Fragment key={item.to}>
              <NavLink
                to={item.to}
                className={({ isActive }) => clsx(
                  "flex items-center justify-between px-3 py-2 rounded-md transition-colors text-sm font-medium relative",
                  isActive || (item.to === '/task-logs' && location.pathname.startsWith('/task-logs/'))
                    ? "bg-primary text-white" 
                    : "hover:bg-slate-800 hover:text-white"
                )}
                onClick={() => setMobileMenuOpen(false)}
                title={collapsed ? item.label : undefined}
              >
                <div className="flex items-center gap-3">
                  <item.icon size={18} className="shrink-0" />
                  {(!collapsed || mobileMenuOpen) && <span>{item.label}</span>}
                </div>
                
                {getBadgeCount(item.to) > 0 && (
                  collapsed ? (
                    <span className={clsx(
                      "absolute top-2 right-2 w-2 h-2 rounded-full",
                      item.to === '/error-logs' ? "bg-rose-500" : "bg-blue-500"
                    )} />
                  ) : (
                    <span className={clsx(
                      "px-1.5 py-0.5 rounded-full text-[10px] font-bold min-w-[20px] text-center",
                      item.to === '/error-logs' ? "bg-rose-500 text-white" : "bg-blue-500 text-white"
                    )}>
                      {getBadgeCount(item.to) > 99 ? '99+' : getBadgeCount(item.to)}
                    </span>
                  )
                )}
              </NavLink>
              
              {/* Dynamic Subsections for Task Logs */}
              {item.to === '/task-logs' && location.pathname.startsWith('/task-logs/') && (!collapsed || mobileMenuOpen) && (
                <div className="ml-8 mt-1 space-y-1">
                  {location.pathname.includes('/content-preview') && (
                    <div className="flex items-center gap-2 px-3 py-2 bg-[#00A389] text-white rounded-md text-sm font-medium">
                      <FileText size={16} />
                      <span>Content Preview</span>
                    </div>
                  )}
                  {location.pathname.includes('/ai-images') && (
                    <div className="flex items-center gap-2 px-3 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium">
                      <ImageIcon size={16} />
                      <span>Image Review</span>
                    </div>
                  )}
                </div>
              )}
            </React.Fragment>
          ))}
        </nav>

        <div className="p-4 border-t border-slate-800 shrink-0">
          <div 
            className="flex items-center gap-3 mb-4 cursor-pointer hover:bg-slate-800 p-2 rounded-md transition-colors -mx-2"
            onClick={() => {
              setProfileTab('info');
              setIsProfileModalOpen(true);
              if (mobileMenuOpen) setMobileMenuOpen(false);
            }}
          >
            <UserCircle size={24} className="text-slate-400 shrink-0" />
            {(!collapsed || mobileMenuOpen) && (
              <div className="flex flex-col overflow-hidden">
                <span className="text-xs font-semibold text-white truncate">{user.username || user.full_name || user.email}</span>
                <span className="text-[10px] text-slate-500 uppercase">{user.role}</span>
              </div>
            )}
          </div>
          
          <button 
            onClick={logout}
            className={clsx(
              "w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition-colors",
              collapsed && "justify-center px-0"
            )}
            title={collapsed ? "Logout" : undefined}
          >
            <LogOut size={18} className="shrink-0" />
            {(!collapsed || mobileMenuOpen) && <span>Logout</span>}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden w-full relative">
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 md:px-6 shrink-0 shadow-sm z-10 w-full">
          <div className="flex items-center gap-3 min-w-0">
            <button 
              className="md:hidden p-2 -ml-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-md transition-colors shrink-0"
              onClick={() => setMobileMenuOpen(true)}
            >
              <Menu size={22} />
            </button>
            <h1 className="text-base md:text-lg font-semibold text-slate-800 truncate">Product Enrichment</h1>
          </div>
          <div className="text-xs md:text-sm font-medium text-slate-500 bg-slate-100 px-2 md:px-3 py-1 rounded-full uppercase flex-shrink-0 ml-2">
            {user.role} <span className="hidden sm:inline">Mode</span>
          </div>
        </header>
        <div className={clsx(
          "flex-1 overflow-auto w-full",
          location.pathname.includes('/content-preview') || location.pathname.includes('/ai-images') ? "p-0" : "p-4 md:p-6"
        )}>
          <Outlet />
        </div>
      </main>

      {/* Profile Modal */}
      {isProfileModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
              <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                <UserCircle size={20} className="text-primary" /> User Profile
              </h3>
              <button 
                onClick={() => setIsProfileModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            
            <div className="flex border-b border-slate-200">
              <button 
                className={clsx("flex-1 py-3 text-sm font-semibold transition-colors", profileTab === 'info' ? "text-primary border-b-2 border-primary" : "text-slate-500 hover:bg-slate-50")}
                onClick={() => setProfileTab('info')}
              >
                Profile Info
              </button>
              <button 
                className={clsx("flex-1 py-3 text-sm font-semibold transition-colors", profileTab === 'password' ? "text-primary border-b-2 border-primary" : "text-slate-500 hover:bg-slate-50")}
                onClick={() => setProfileTab('password')}
              >
                Change Password
              </button>
            </div>

            <div className="p-6">
              {profileTab === 'info' ? (
                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Name / Username</label>
                    <div className="text-slate-800 font-medium">{user.full_name || user.username || 'Not set'}</div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Email Address</label>
                    <div className="text-slate-800 font-medium">{user.email}</div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">System Role</label>
                    <div className="inline-block px-2 py-1 bg-blue-50 text-blue-700 text-xs font-bold rounded border border-blue-100 uppercase">
                      {user.role}
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Invited By</label>
                    <div className="text-slate-800 font-medium">{user.invited_by || 'System Administrator'}</div>
                  </div>
                </div>
              ) : (
                <form onSubmit={handlePasswordChange} className="space-y-4">
                  {passwordError && <div className="text-sm text-red-600 bg-red-50 border border-red-100 p-3 rounded-md">{passwordError}</div>}
                  {passwordSuccess && <div className="text-sm text-emerald-600 bg-emerald-50 border border-emerald-100 p-3 rounded-md">{passwordSuccess}</div>}
                  
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">Current Password</label>
                    <input 
                      type="password" 
                      required
                      value={currentPassword}
                      onChange={e => setCurrentPassword(e.target.value)}
                      className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:ring-primary focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">New Password</label>
                    <input 
                      type="password" 
                      required
                      minLength={8}
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:ring-primary focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">Confirm New Password</label>
                    <input 
                      type="password" 
                      required
                      minLength={8}
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:ring-primary focus:border-primary"
                    />
                  </div>
                  <div className="pt-2">
                    <button 
                      type="submit" 
                      disabled={isChangingPassword}
                      className="w-full bg-primary hover:bg-primary-hover text-white font-semibold py-2 rounded-md transition-colors disabled:opacity-50"
                    >
                      {isChangingPassword ? 'Updating...' : 'Update Password'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
