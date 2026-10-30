
import { useState } from 'react';
import {
  signInWithEmailAndPassword,
  sendPasswordResetEmail
} from 'firebase/auth';

import { auth } from './firebase';
import './App.css';

function App() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [forgotMode, setForgotMode] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');

    try {
      await signInWithEmailAndPassword(auth, email, password);
      setMessage('Login successful! Admin dashboard will be connected next.');
    } catch (err) {
      setError('Unable to sign in. Please check your email and password.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');

    try {
      await sendPasswordResetEmail(auth, email);
      setMessage('If this email is registered, a password reset link will be sent.');
    } catch (err) {
      setError('Unable to send the reset email right now. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-container">
        <div className="login-brand">
          <div className="brand-mark">G.</div>
          <span>GoGreen<span className="brand-accent">POS</span></span>
        </div>

        <div className="login-card">
          <div className="login-heading">
            <span className="eyebrow">ADMIN PORTAL</span>
            <h1>{forgotMode ? 'Reset password' : 'Welcome back'}</h1>
            <p>
              {forgotMode
                ? 'Enter your registered email to receive a password reset link.'
                : 'Sign in to manage your GoGreen platform.'}
            </p>
          </div>

          {error && <div className="alert alert-danger">{error}</div>}
          {message && <div className="alert alert-success">{message}</div>}

          <form onSubmit={forgotMode ? handleForgotPassword : handleLogin}>
            <div className="mb-3">
              <label htmlFor="email" className="form-label">
                Email address
              </label>
              <input
                id="email"
                type="email"
                className="form-control"
                placeholder="admin@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            {!forgotMode && (
              <div className="mb-3">
                <label htmlFor="password" className="form-label">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  className="form-control"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
            )}

            {!forgotMode && (
              <div className="text-end mb-4">
                <button
                  type="button"
                  className="forgot-link"
                  onClick={() => {
                    setForgotMode(true);
                    setError('');
                    setMessage('');
                  }}
                >
                  Forgot password?
                </button>
              </div>
            )}

            <button
              type="submit"
              className="login-button"
              disabled={loading}
            >
              {loading
                ? 'Please wait...'
                : forgotMode
                  ? 'Send reset link'
                  : 'Sign in to dashboard'}
            </button>

            {forgotMode && (
              <button
                type="button"
                className="forgot-link back-link"
                onClick={() => {
                  setForgotMode(false);
                  setError('');
                  setMessage('');
                }}
              >
                Back to login
              </button>
            )}
          </form>

          <div className="login-footer">
            Authorized administrators only.
          </div>
        </div>

        <p className="copyright">
          © 2026 GoGreen POS. All rights reserved.
        </p>
      </div>
    </div>
  );
}

export default App;

