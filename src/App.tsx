import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout/Layout';
import Review from './pages/Review';
import Stats from './pages/Stats';
import CriteriaManager from './pages/CriteriaManager';
import Execute from './pages/Execute';
import Login from './pages/Login';

// Protected route wrapper
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

// Main app content
function AppRoutes() {
  const { isAuthenticated, isLoading } = useAuth();

  // Show loading while checking auth
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={isAuthenticated ? <Navigate to="/" replace /> : <Login />}
      />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout>
              <Review />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/stats"
        element={
          <ProtectedRoute>
            <Layout>
              <Stats />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/criteria"
        element={
          <ProtectedRoute>
            <Layout>
              <CriteriaManager />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/criteria/:type"
        element={
          <ProtectedRoute>
            <Layout>
              <CriteriaManager />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/execute"
        element={
          <ProtectedRoute>
            <Layout>
              <Execute />
            </Layout>
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}

export default App;
