import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  email: string | null;
}

interface AuthContextType extends AuthState {
  login: () => void;
  logout: () => Promise<void>;
  checkAuthStatus: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [state, setState] = useState<AuthState>({
    isAuthenticated: false,
    isLoading: true,
    email: null,
  });

  const checkAuthStatus = async () => {
    try {
      console.log('Checking auth status...');
      const response = await fetch('/auth/status', { credentials: 'include' });
      const data = await response.json();
      console.log('Auth status response:', data);

      setState({
        isAuthenticated: data.authenticated,
        isLoading: false,
        email: data.email || null,
      });
    } catch (error) {
      console.error('Error checking auth status:', error);
      setState({
        isAuthenticated: false,
        isLoading: false,
        email: null,
      });
    }
  };

  const login = () => {
    // Redirect directly to backend auth endpoint (bypass Vite proxy for redirects)
    window.location.href = 'http://localhost:5000/auth/login';
  };

  const logout = async () => {
    try {
      await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
      setState({
        isAuthenticated: false,
        isLoading: false,
        email: null,
      });
    } catch (error) {
      console.error('Error logging out:', error);
    }
  };

  useEffect(() => {
    // Check if we just completed OAuth (redirected with ?authenticated=true)
    const params = new URLSearchParams(window.location.search);
    if (params.get('authenticated') === 'true') {
      // Clean up the URL
      window.history.replaceState({}, '', window.location.pathname);
    }
    checkAuthStatus();
  }, []);

  return (
    <AuthContext.Provider
      value={{
        ...state,
        login,
        logout,
        checkAuthStatus,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
