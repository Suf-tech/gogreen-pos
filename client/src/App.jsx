import { useState, useEffect } from 'react';
import {
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  onAuthStateChanged,
  signOut
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { Routes, Route, Navigate } from 'react-router-dom';

import { auth, db } from './firebase';
import AdminDashboard from './pages/AdminDashboard';
import {
  OwnerSignup,
  OwnerLogin
} from './pages/OwnerAuth';

import OwnerDashboard from './pages/OwnerDashboard';
import BusinessPOSAuth from './pages/BusinessPOSAuth';
import {EmployeeLogin,EmployeeDashboard} from './pages/EmployeePortal';
import './App.css';

function LoginPage() {
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



function App() {
  const [user, setUser] = useState(undefined);
  const [profile, setProfile] = useState(null);
  const [checkingRole, setCheckingRole] = useState(true);
  const [roleError, setRoleError] = useState('');

  useEffect(() => {
    let requestId = 0;

    const unsubscribe = onAuthStateChanged(
      auth,
      async (currentUser) => {
        const currentRequest = ++requestId;

        setUser(currentUser);
        setCheckingRole(true);
        setProfile(null);
        setRoleError('');

        if (!currentUser) {
          setCheckingRole(false);
          return;
        }

        try {
          const userRef = doc(
            db,
            'users',
            currentUser.uid
          );

          const userSnap = await getDoc(userRef);

          if (currentRequest !== requestId) return;

          if (userSnap.exists()) {
            setProfile(userSnap.data());
          }
        } catch (error) {
          if (currentRequest !== requestId) return;

          console.error(
            'Role verification failed:',
            error
          );

          setRoleError(
            'Unable to verify account permissions.'
          );
        } finally {
          if (currentRequest === requestId) {
            setCheckingRole(false);
          }
        }
      }
    );

    return () => {
      requestId++;
      unsubscribe();
    };
  }, []);

  const isEmployee=profile?.role==='employee'&&Boolean(profile.businessId);

  const isAdmin =
    profile?.role === 'super_admin';

  const isOwner =
    profile?.role === 'business_owner' &&
    Boolean(profile.businessId);

  const loadingScreen = (
    <div className="min-vh-100 d-flex align-items-center justify-content-center">
      <div className="text-center">
        <div className="spinner-border text-success mb-3" />
        <p>Verifying access...</p>
      </div>
    </div>
  );

  if (user === undefined || checkingRole) {
    return loadingScreen;
  }

  const accessDenied = (
    <div className="min-vh-100 d-flex align-items-center justify-content-center bg-light">
      <div
        className="card border-0 shadow-sm p-4 text-center"
        style={{ maxWidth: 430 }}
      >
        <h3 className="text-danger">Access Denied</h3>

        <p className="text-secondary">
          {roleError ||
            'Your account is not authorized for this portal.'}
        </p>

        <button
          className="btn btn-success"
          onClick={() => signOut(auth)}
        >
          Logout
        </button>
      </div>
    </div>
  );

  return (
    <Routes>
      {/* SUPER ADMIN LOGIN */}
      <Route
        path="/login"
        element={
          user
            ? isAdmin
              ? <Navigate to="/admin" replace />
              : isOwner
                ? <Navigate to="/owner/dashboard" replace />
                : accessDenied
            : <LoginPage />
        }
      />

      {/* SUPER ADMIN DASHBOARD */}
      <Route
        path="/admin"
        element={
          user && isAdmin
            ? <AdminDashboard />
            : user
              ? accessDenied
              : <Navigate to="/login" replace />
        }
      />

      {/* OWNER INVITATION SIGNUP */}
      <Route
        path="/owner/signup"
        element={<OwnerSignup />}
      />

      {/* OWNER LOGIN */}
      <Route
        path="/owner/login"
        element={
          user && isOwner
            ? <Navigate
                to="/owner/dashboard"
                replace
              />
            : <OwnerLogin />
        }
      />

      {/* OWNER DASHBOARD */}
      <Route
        path="/owner/dashboard"
        element={
          user && isOwner
            ? <OwnerDashboard profile={profile} />
            : user
              ? accessDenied
              : <Navigate
                  to="/owner/login"
                  replace
                />
        }
      />

      <Route path="/pos/:slug" element={<BusinessPOSAuth />} />

      <Route path="/employee/login" element={user&&isEmployee?<Navigate to="/employee/dashboard" replace/>:<EmployeeLogin/>}/>
      <Route path="/employee/dashboard" element={user&&isEmployee?<EmployeeDashboard/>:user?accessDenied:<Navigate to="/employee/login" replace/>}/>
      {/* DEFAULT ROUTE */}
      <Route
        path="*"
        element={
          <Navigate
            to={
              isAdmin
                ? '/admin'
                : isOwner
                  ? '/owner/dashboard'
                  : isEmployee
                    ? '/employee/dashboard'
                  : '/login'
            }
            replace
          />
        }
      />
    </Routes>
  );
}

export default App;



