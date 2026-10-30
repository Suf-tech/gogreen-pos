
import { useEffect, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signOut,
  reload
} from 'firebase/auth';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { auth } from '../firebase';

const API_URL = 'http://localhost:5000';

export function OwnerSignup() {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const token = params.get('token') || '';

  const [invitation, setInvitation] = useState(null);
  const [loadingInvite, setLoadingInvite] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [stage, setStage] = useState('signup');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function loadInvitation() {
      setLoadingInvite(true);

      try {
        if (!/^[a-f0-9]{64}$/.test(token)) {
          throw new Error('Invalid invitation link.');
        }

        const response = await fetch(
          `${API_URL}/api/owner/invitations/${token}`
        );

        const result = await response.json();

        if (!response.ok || !result.success) {
          throw new Error(
            result.message || 'Invitation is not valid.'
          );
        }

        if (!cancelled) {
          setInvitation(result.invitation);
          setEmail(result.invitation.ownerEmail);
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoadingInvite(false);
      }
    }

    loadInvitation();

    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleSignup = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');

    if (password.length < 8) {
      setError('Use a password with at least 8 characters.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setBusy(true);

    try {
      // Ensure the current Firebase session does not
      // accidentally belong to another account.
      if (auth.currentUser) {
        await signOut(auth);
      }

      const credential = await createUserWithEmailAndPassword(
        auth,
        email,
        password
      );

      await sendEmailVerification(credential.user);

      setStage('verify');
      setMessage(
        'Account created. Check your inbox and verify your email.'
      );
    } catch (err) {
      if (err.code === 'auth/email-already-in-use') {
        setError(
          'This email already has an account. Sign in below using that account, then complete the invitation.'
        );
        setStage('existing');
      } else {
        setError(
          err.message || 'Unable to create account.'
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const handleExistingLogin = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');

    try {
      await signInWithEmailAndPassword(
        auth,
        email,
        password
      );

      setStage('verify');
      setMessage(
        'Signed in. Verify your email if needed, then continue.'
      );
    } catch (err) {
      setError('Incorrect email or password.');
    } finally {
      setBusy(false);
    }
  };

  const handleResendVerification = async () => {
    setBusy(true);
    setError('');
    setMessage('');

    try {
      const user = auth.currentUser;

      if (!user) {
        throw new Error('Please sign in again.');
      }

      await reload(user);

      if (user.emailVerified) {
        setMessage('Your email is already verified.');
      } else {
        await sendEmailVerification(user);
        setMessage('Verification email sent again.');
      }
    } catch (err) {
      setError(err.message || 'Unable to send email.');
    } finally {
      setBusy(false);
    }
  };

  const handleClaim = async () => {
    setBusy(true);
    setError('');
    setMessage('');

    try {
      const user = auth.currentUser;

      if (!user) {
        setStage('existing');
        throw new Error(
          'Your session expired. Please sign in again.'
        );
      }

      await reload(user);

      if (!user.emailVerified) {
        throw new Error(
          'Please verify your email using the link in your inbox first.'
        );
      }

      const idToken = await user.getIdToken(true);

      const response = await fetch(
        `${API_URL}/api/owner/claim-invitation`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`
          },
          body: JSON.stringify({ token })
        }
      );

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(
          result.message || 'Unable to claim invitation.'
        );
      }

     window.location.replace('/owner/dashboard');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (loadingInvite) {
    return (
      <OwnerLayout title="Checking invitation">
        <p className="text-secondary">
          Please wait while we verify your invitation...
        </p>
      </OwnerLayout>
    );
  }

  if (!invitation) {
    return (
      <OwnerLayout title="Invitation unavailable">
        <div className="alert alert-danger">
          {error || 'This invitation is invalid or expired.'}
        </div>
        <p className="text-secondary">
          Contact your GoGreen POS administrator for a new link.
        </p>
      </OwnerLayout>
    );
  }

  return (
    <OwnerLayout
      title={
        stage === 'signup'
          ? 'Create your owner account'
          : stage === 'existing'
            ? 'Sign in to continue'
            : 'Verify your email'
      }
    >
      <div className="alert alert-success">
        <strong>{invitation.businessName}</strong>
        <div className="small mt-1">
          Invited email: {invitation.ownerEmail}
        </div>
      </div>

      {error && (
        <div className="alert alert-danger">{error}</div>
      )}

      {message && (
        <div className="alert alert-info">{message}</div>
      )}

      {(stage === 'signup' || stage === 'existing') && (
        <form
          onSubmit={
            stage === 'signup'
              ? handleSignup
              : handleExistingLogin
          }
        >
          <label className="form-label">Owner Email</label>
          <input
            className="form-control mb-3"
            type="email"
            value={email}
            readOnly
          />

          <label className="form-label">Password</label>
          <input
            className="form-control mb-3"
            type="password"
            minLength={stage === 'signup' ? 8 : undefined}
            required
            value={password}
            onChange={(event) =>
              setPassword(event.target.value)
            }
            placeholder="Enter password"
          />

          {stage === 'signup' && (
            <>
              <label className="form-label">
                Confirm Password
              </label>
              <input
                className="form-control mb-3"
                type="password"
                minLength={8}
                required
                value={confirmPassword}
                onChange={(event) =>
                  setConfirmPassword(event.target.value)
                }
                placeholder="Confirm password"
              />
            </>
          )}

          <button
            type="submit"
            className="btn btn-success w-100 py-2"
            disabled={busy}
          >
            {busy
              ? 'Please wait...'
              : stage === 'signup'
                ? 'Create Account'
                : 'Sign In'}
          </button>

          {stage === 'signup' && (
            <button
              type="button"
              className="btn btn-link w-100 mt-2"
              onClick={() => {
                setStage('existing');
                setError('');
              }}
            >
              Already have an account? Sign in
            </button>
          )}

          {stage === 'existing' && (
            <button
              type="button"
              className="btn btn-link w-100 mt-2"
              onClick={() => {
                setStage('signup');
                setError('');
              }}
            >
              Back to create account
            </button>
          )}
        </form>
      )}

      {stage === 'verify' && (
        <div>
          <p className="text-secondary">
            Open your email verification link, then
            return here and click Continue.
          </p>

          <button
            type="button"
            className="btn btn-success w-100 py-2 mb-2"
            onClick={handleClaim}
            disabled={busy}
          >
            {busy
              ? 'Checking...'
              : 'I Verified My Email — Continue'}
          </button>

          <button
            type="button"
            className="btn btn-outline-success w-100 mb-2"
            onClick={handleResendVerification}
            disabled={busy}
          >
            Resend Verification Email
          </button>

          <button
            type="button"
            className="btn btn-link w-100"
            onClick={async () => {
              await signOut(auth);
              setStage('existing');
              setError('');
              setMessage('');
            }}
          >
            Sign in with another session
          </button>
        </div>
      )}
    </OwnerLayout>
  );
}

export function OwnerLogin() {
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [forgot, setForgot] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');

    try {
      if (forgot) {
        await sendPasswordResetEmail(auth, email);

        setMessage(
          'If your email is registered, a reset link will be sent.'
        );
      } else {
        await signInWithEmailAndPassword(
          auth,
          email,
          password
        );

        navigate('/owner/dashboard', {
          replace: true
        });
      }
    } catch (err) {
      setError(
        forgot
          ? 'Unable to send reset email.'
          : 'Unable to sign in. Check your credentials.'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <OwnerLayout
      title={
        forgot
          ? 'Reset your password'
          : 'Business Owner Login'
      }
    >
      <p className="text-secondary small">
        {forgot
          ? 'Enter your registered owner email.'
          : 'Sign in to access your GoGreen POS business.'}
      </p>

      {error && (
        <div className="alert alert-danger">{error}</div>
      )}

      {message && (
        <div className="alert alert-success">{message}</div>
      )}

      <form onSubmit={handleSubmit}>
        <label className="form-label">Email Address</label>
        <input
          type="email"
          className="form-control mb-3"
          value={email}
          onChange={(event) =>
            setEmail(event.target.value)
          }
          required
        />

        {!forgot && (
          <>
            <label className="form-label">Password</label>
            <input
              type="password"
              className="form-control mb-3"
              value={password}
              onChange={(event) =>
                setPassword(event.target.value)
              }
              required
            />
          </>
        )}

        <button
          type="submit"
          className="btn btn-success w-100 py-2"
          disabled={busy}
        >
          {busy
            ? 'Please wait...'
            : forgot
              ? 'Send Reset Email'
              : 'Sign In'}
        </button>
      </form>

      <button
        type="button"
        className="btn btn-link w-100 mt-2"
        onClick={() => {
          setForgot(!forgot);
          setError('');
          setMessage('');
        }}
      >
        {forgot
          ? 'Back to Login'
          : 'Forgot Password?'}
      </button>

      <p className="small text-secondary text-center mt-3">
        New business owners must use their private
        invitation link to register.
      </p>
    </OwnerLayout>
  );
}

function OwnerLayout({ title, children }) {
  return (
    <div
      className="min-vh-100 d-flex align-items-center justify-content-center p-3"
      style={{
        background:
          'linear-gradient(135deg, #effaf3, #f8fbf9)'
      }}
    >
      <div
        className="card border-0 shadow-sm p-4 p-md-5 w-100"
        style={{
          maxWidth: 480,
          borderRadius: 20
        }}
      >
        <div className="text-center mb-4">
          <div
            className="fw-bold mb-2"
            style={{
              color: '#078753',
              fontSize: 25
            }}
          >
            GoGreen POS
          </div>

          <h3 className="fw-bold">{title}</h3>
        </div>

        {children}

        <div className="text-center mt-4">
          <Link
            to="/owner/login"
            className="text-success small"
          >
            Owner Login
          </Link>
        </div>
      </div>
    </div>
  );
}
