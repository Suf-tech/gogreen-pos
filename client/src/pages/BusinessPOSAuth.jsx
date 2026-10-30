
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  reload,
  signOut
} from 'firebase/auth';
import { auth } from '../firebase';

const API_URL =
  import.meta.env.VITE_API_URL || 'http://localhost:5000';

async function api(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, options);
  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.message || 'Request failed.');
  }

  return data;
}

export default function BusinessPOSAuth() {
  const { slug } = useParams();
  const [params] = useSearchParams();
  const token = params.get('activate');

  const [business, setBusiness] = useState(null);
  const [activation, setActivation] = useState(null);
  const [stage, setStage] = useState('loading');

  const [ownerName, setOwnerName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function loadPage() {
      try {
        const result = await api(
          `/api/owner/pos/${encodeURIComponent(slug)}`
        );

        if (cancelled) return;

        setBusiness(result.business);

        if (!token) {
          setStage('login');
          return;
        }

        const result2 = await api(
          `/api/owner/activation/${encodeURIComponent(token)}`
        );

        if (cancelled) return;

        if (result2.activation.slug !== slug) {
          throw new Error(
            'Activation link belongs to another business.'
          );
        }

        setActivation(result2.activation);
        setEmail(result2.activation.ownerEmail);

        // An existing Firebase account may already be signed in.
        const currentUser = auth.currentUser;

        if (
          currentUser &&
          currentUser.email?.toLowerCase() ===
            result2.activation.ownerEmail.toLowerCase()
        ) {
          setStage('verify');
        } else {
          setStage('signup');
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
          setStage('error');
        }
      }
    }

    loadPage();

    return () => {
      cancelled = true;
    };
  }, [slug, token]);

  function clearAlerts() {
    setError('');
    setMessage('');
  }

  async function createAccount(event) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    clearAlerts();

    try {
      if (!activation) {
        throw new Error('Invalid activation link.');
      }

      if (!ownerName.trim()) {
        throw new Error('Enter the registered owner name.');
      }

      if (auth.currentUser) {
        await signOut(auth);
      }

      const result = await createUserWithEmailAndPassword(
        auth,
        activation.ownerEmail,
        password
      );

      // Firebase sends this email automatically.
      try {
        await sendEmailVerification(result.user);
        setMessage(
          'Verification email sent! Open your email inbox ' +
          'and click the verification link.'
        );
      } catch (mailError) {
        setMessage(
          'Account created, but verification email could not ' +
          'be sent. Use Resend Verification below.'
        );
        setError(mailError.message);
      }

      setPassword('');
      setStage('verify');
    } catch (err) {
      if (err.code === 'auth/email-already-in-use') {
        setError(
          'This email already has a Firebase account. ' +
          'Use Sign In to Existing Account below. ' +
          'Do not delete the account.'
        );
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function signInExisting(event) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    clearAlerts();

    try {
      await signInWithEmailAndPassword(
        auth,
        activation.ownerEmail,
        password
      );

      setPassword('');
      setStage('verify');
      setMessage(
        'Signed in successfully. Verify your email if needed, ' +
        'then complete activation.'
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function resendVerification() {
    setBusy(true);
    clearAlerts();

    try {
      const user = auth.currentUser;

      if (!user) {
        throw new Error('Sign in to your owner account first.');
      }

      await reload(user);

      if (user.emailVerified) {
        setMessage(
          'Your email is already verified. ' +
          'Click Complete Activation.'
        );
        return;
      }

      await sendEmailVerification(user);
      setMessage(
        'Verification email sent. Check Inbox and Spam folder.'
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function completeActivation() {
    if (busy) return;

    setBusy(true);
    clearAlerts();

    try {
      const user = auth.currentUser;

      if (!user) {
        throw new Error(
          'Your session has ended. Sign in to the existing ' +
          'account first.'
        );
      }

      await reload(user);

      if (!user.emailVerified) {
        throw new Error(
          'Your email is not verified yet. Please open your ' +
          'inbox, click the Firebase verification link, ' +
          'then try again.'
        );
      }

      if (!ownerName.trim()) {
        throw new Error(
          'Enter the same Owner Name used during ' +
          'business registration.'
        );
      }

      const idToken = await user.getIdToken(true);

      await api('/api/owner/activate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({
          token,
          ownerName: ownerName.trim()
        })
      });

      // Remove the private activation token from the URL.
      // Show login only after the server confirms success.
      await signOut(auth);
      window.location.replace(`/pos/${slug}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function login(event) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    clearAlerts();

    try {
      const result = await signInWithEmailAndPassword(
        auth,
        email,
        password
      );

      const idToken = await result.user.getIdToken(true);

      await api(
        `/api/owner/pos/${encodeURIComponent(slug)}/access`,
        {
          headers: {
            Authorization: `Bearer ${idToken}`
          }
        }
      );

      window.location.replace('/owner/dashboard');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function forgotPassword() {
    clearAlerts();

    if (!email.trim()) {
      setError('Enter your email first.');
      return;
    }

    try {
      await sendPasswordResetEmail(auth, email.trim());
      setMessage(
        'If the account exists, a password reset email ' +
        'will be sent.'
      );
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div
      className="container py-5"
      style={{ maxWidth: '520px' }}
    >
      <div className="card border-0 shadow-sm">
        <div className="card-body p-4">
          <h3 className="fw-bold text-success">
            GoGreen POS
          </h3>

          <h5 className="mb-4">
            {business?.name || 'Business Portal'}
          </h5>

          {error && (
            <div className="alert alert-danger">
              {error}
            </div>
          )}

          {message && (
            <div className="alert alert-success">
              {message}
            </div>
          )}

          {stage === 'loading' && (
            <p>Loading POS...</p>
          )}

          {stage === 'signup' && activation && (
            <>
              <h5>Register Owner Account</h5>
              <p className="text-secondary small">
                Fill in your details to receive an email
                verification link.
              </p>

              <form onSubmit={createAccount}>
                <label className="form-label">
                  Owner Name
                </label>
                <input
                  className="form-control mb-3"
                  value={ownerName}
                  onChange={e =>
                    setOwnerName(e.target.value)
                  }
                  required
                />

                <label className="form-label">
                  Registered Email
                </label>
                <input
                  className="form-control mb-3"
                  value={activation.ownerEmail}
                  readOnly
                />

                <label className="form-label">
                  Create Password
                </label>
                <input
                  className="form-control mb-3"
                  type="password"
                  value={password}
                  onChange={e =>
                    setPassword(e.target.value)
                  }
                  minLength={6}
                  required
                />

                <button
                  type="submit"
                  className="btn btn-success w-100"
                  disabled={busy}
                >
                  {busy
                    ? 'Please wait...'
                    : 'Create Account & Send Verification'}
                </button>
              </form>

              <button
                type="button"
                className="btn btn-link w-100 mt-2"
                onClick={() => {
                  clearAlerts();
                  setStage('existing');
                }}
              >
                Already have an account? Sign In
              </button>
            </>
          )}

          {stage === 'existing' && activation && (
            <>
              <h5>Sign In to Existing Account</h5>

              <form onSubmit={signInExisting}>
                <label className="form-label">
                  Registered Email
                </label>
                <input
                  className="form-control mb-3"
                  value={activation.ownerEmail}
                  readOnly
                />

                <label className="form-label">
                  Password
                </label>
                <input
                  className="form-control mb-3"
                  type="password"
                  value={password}
                  onChange={e =>
                    setPassword(e.target.value)
                  }
                  required
                />

                <button
                  className="btn btn-success w-100"
                  disabled={busy}
                >
                  Sign In & Continue
                </button>
              </form>

              <button
                type="button"
                className="btn btn-link w-100 mt-2"
                onClick={() => {
                  clearAlerts();
                  setStage('signup');
                }}
              >
                Back to Registration
              </button>
            </>
          )}

          {stage === 'verify' && (
            <>
              <h5>Verify Your Email</h5>

              <p>
                We use Firebase to verify that you own
                the registered email address.
              </p>

              <div className="alert alert-info">
                <strong>{activation?.ownerEmail}</strong>
                <p className="mb-0 mt-2">
                  Open your inbox, click the verification
                  link, then return to this page.
                </p>
              </div>

              <label className="form-label">
                Confirm Registered Owner Name
              </label>
              <input
                className="form-control mb-3"
                value={ownerName}
                onChange={e =>
                  setOwnerName(e.target.value)
                }
                placeholder="Enter your registered owner name"
                required
              />

              <button
                type="button"
                className="btn btn-success w-100"
                disabled={busy}
                onClick={completeActivation}
              >
                {busy
                  ? 'Checking Verification...'
                  : 'I Verified My Email — Complete Activation'}
              </button>

              <button
                type="button"
                className="btn btn-outline-secondary w-100 mt-3"
                disabled={busy}
                onClick={resendVerification}
              >
                Resend Verification Email
              </button>

              <p className="small text-secondary mt-3">
                Activation will only succeed after
                Firebase confirms your email is verified.
              </p>
            </>
          )}

          {stage === 'login' && (
            <>
              <h5>Business Owner Login</h5>

              <form onSubmit={login}>
                <label className="form-label">
                  Email
                </label>
                <input
                  className="form-control mb-3"
                  type="email"
                  value={email}
                  onChange={e =>
                    setEmail(e.target.value)
                  }
                  required
                />

                <label className="form-label">
                  Password
                </label>
                <input
                  className="form-control mb-3"
                  type="password"
                  value={password}
                  onChange={e =>
                    setPassword(e.target.value)
                  }
                  required
                />

                <button
                  className="btn btn-success w-100"
                  disabled={busy}
                >
                  {busy ? 'Logging In...' : 'Login'}
                </button>
              </form>

              <button
                type="button"
                className="btn btn-link mt-2"
                onClick={forgotPassword}
              >
                Forgot Password?
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
