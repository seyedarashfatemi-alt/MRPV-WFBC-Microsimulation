import { useState } from 'react';
import './Login.css';

const ALLOWED_EMAILS = [
  'arash@clarityconsult.com.au',
  'trent@clarityconsult.com.au',
  'pedram@clarityconsult.com.au',
  'ash.bailey@vida.vic.gov.au',
  'cameron.grant@vida.vic.gov.au',
  'stephanie.liu@vida.vic.gov.au',
  // Add your allowed email addresses here
];


const Login = ({ onLogin }) => {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    // Simple validation - check if email is in allowed list
    const emailLower = email.trim().toLowerCase();
    const isAllowed = ALLOWED_EMAILS.some(allowedEmail => 
      allowedEmail.toLowerCase() === emailLower
    );

    if (!email) {
      setError('Please enter your email address');
      setIsLoading(false);
      return;
    }

    if (!isAllowed) {
      setError('Access denied. Your email address is not authorized.');
      setIsLoading(false);
      return;
    }

    // Simulate login process (you can add actual authentication here)
    setTimeout(() => {
      // Store authentication in localStorage
      localStorage.setItem('auth_email', emailLower);
      localStorage.setItem('auth_timestamp', Date.now().toString());
      
      setIsLoading(false);
      onLogin(emailLower);
    }, 500);
  };

  return (
    <div className="login-container">
      <div className="login-box">
        <div className="login-header">
          <h2>Western Freeway Business Case</h2>
          <p>Microsimulation Modelling</p>

          <p>Please sign in to access the map</p>
        </div>
        
        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label htmlFor="email">Email Address</label>
            <input
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email"
              disabled={isLoading}
              autoComplete="email"
              required
            />
          </div>

          {error && <div className="error-message">{error}</div>}

          <button 
            type="submit" 
            className="login-button"
            disabled={isLoading}
          >
            {isLoading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default Login;
