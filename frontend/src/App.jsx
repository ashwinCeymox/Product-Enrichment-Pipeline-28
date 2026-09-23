import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import CreateJob from './pages/CreateJob';
import TaskLogs from './pages/TaskLogs';
import Login from './pages/Login';
import Eligibility from './pages/Eligibility';
import Signup from './pages/Signup';
import Downloads from './pages/Downloads';
import Settings from './pages/Settings';
import Users from './pages/Users';
import AIImages from './pages/AIImages';
import ContentPreview from './pages/ContentPreview';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter basename="/productpipeline">
        <Routes>
          {/* Public Auth Routes */}
          <Route path="/login" element={<Login />} />
          <Route path="/eligibility" element={<Eligibility />} />
          <Route path="/signup" element={<Signup />} />
          
          {/* Protected Dashboard Routes */}
          <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route index element={<Dashboard />} />
            <Route path="jobs/create" element={<CreateJob />} />
            
            <Route path="task-logs" element={
              <ProtectedRoute allowedRoles={['superadmin', 'admin']}>
                <TaskLogs />
              </ProtectedRoute>
            } />
            <Route path="task-logs/ai-images/:jobId" element={
              <ProtectedRoute allowedRoles={['superadmin', 'admin']}>
                <AIImages />
              </ProtectedRoute>
            } />
            <Route path="task-logs/content-preview/:jobId" element={
              <ProtectedRoute allowedRoles={['superadmin', 'admin']}>
                <ContentPreview />
              </ProtectedRoute>
            } />
            
            <Route path="downloads" element={<Downloads />} />
            
            {/* Strict role-based protection */}
            <Route path="users" element={
              <ProtectedRoute allowedRoles={['superadmin', 'admin']}>
                <Users />
              </ProtectedRoute>
            } />
            <Route path="settings" element={
              <ProtectedRoute allowedRoles={['superadmin']}>
                <Settings />
              </ProtectedRoute>
            } />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
