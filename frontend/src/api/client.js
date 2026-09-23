import axios from 'axios';

const api = axios.create({
  baseURL: '/productpipeline/api'
});

// Add a request interceptor to automatically attach the token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Add a response interceptor to handle 401 Unauthorized globally
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      // Clear token and force logout if unauthorized
      localStorage.removeItem('token');
      // Using window.location to avoid circular dependencies with React Router
      const base = import.meta.env.BASE_URL || '/';
      const loginPath = base.endsWith('/') ? base + 'login' : base + '/login';
      const eligibilityPath = base.endsWith('/') ? base + 'eligibility' : base + '/eligibility';
      const signupPath = base.endsWith('/') ? base + 'signup' : base + '/signup';

      if (window.location.pathname !== loginPath && window.location.pathname !== eligibilityPath && window.location.pathname !== signupPath) {
        window.location.href = loginPath;
      }
    }
    return Promise.reject(error);
  }
);

export default api;
