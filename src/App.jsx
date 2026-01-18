import { useState, useEffect } from 'react'
import './App.css'
import Map from './Map.jsx'
import Login from './Login.jsx'

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [userEmail, setUserEmail] = useState('');

  useEffect(() => {
    // Check if user is already authenticated
    const checkAuth = () => {
      const storedEmail = localStorage.getItem('auth_email');
      const storedTimestamp = localStorage.getItem('auth_timestamp');
      
      if (storedEmail && storedTimestamp) {
        // Check if session is still valid (24 hours)
        const hoursSinceLogin = (Date.now() - parseInt(storedTimestamp)) / (1000 * 60 * 60);
        if (hoursSinceLogin < 24) {
          setUserEmail(storedEmail);
          setIsAuthenticated(true);
        } else {
          // Session expired
          localStorage.removeItem('auth_email');
          localStorage.removeItem('auth_timestamp');
        }
      }
      setIsCheckingAuth(false);
    };

    checkAuth();
  }, []);

  const handleLogin = (email) => {
    setUserEmail(email);
    setIsAuthenticated(true);
  };

  const handleLogout = () => {
    localStorage.removeItem('auth_email');
    localStorage.removeItem('auth_timestamp');
    setIsAuthenticated(false);
    setUserEmail('');
  };

  if (isCheckingAuth) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh',
        background: '#f5f5f5'
      }}>
        <div>Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Login onLogin={handleLogin} />;
  }

  return <Map onLogout={handleLogout} userEmail={userEmail} />;
}

export default App
