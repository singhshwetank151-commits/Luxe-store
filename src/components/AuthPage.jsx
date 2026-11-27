import { useEffect, useRef, useState } from 'react';
import { LogOut, Edit3, Check, ArrowLeft, UserCheck, ExternalLink, ShoppingBag, Trash2 } from 'lucide-react';
import { useAuth, useCart, useRouter } from '../context/storeHooks';
import { withBase } from '../lib/basePath';
import {
  ALLOWED_FINISH_OPTIONS,
  consumePostLoginRedirect,
  sanitizeAuthUrlError,
} from '../lib/security';
import './AuthPage.css';

const SUPABASE_PROVIDERS_URL =
  'https://supabase.com/dashboard/project/youixtxcfluaskmylqmp/auth/providers';

function getInitialUrlError() {
  const params = new URLSearchParams(window.location.search);
  return sanitizeAuthUrlError(params.get('error_description') || params.get('error') || '');
}

function getInitials(name, email) {
  const source = (name || email || 'Client').trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

function ProfileDetailsForm({ user, needsOnboarding, isEditing, onCancel, onSaved, saveProfile }) {
  const [fullName, setFullName] = useState(user?.fullName || '');
  const profileEmail = user?.email || '';
  const [phone, setPhone] = useState(user?.phone || '');
  const [address, setAddress] = useState(user?.address || '');
  const [city, setCity] = useState(user?.city || '');
  const [postalCode, setPostalCode] = useState(user?.postalCode || '');
  const [country, setCountry] = useState(user?.country || '');
  const [preferredFinish, setPreferredFinish] = useState(
    user?.preferredFinish || '18K Yellow Gold'
  );
  const [profileError, setProfileError] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const submitLockRef = useRef(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitLockRef.current) return;
    submitLockRef.current = true;
    setProfileError('');
    setProfileSaving(true);
    const res = await saveProfile({
      fullName,
      email: profileEmail,
      phone,
      address,
      city,
      postalCode,
      country,
      preferredFinish,
    });
    setProfileSaving(false);
    submitLockRef.current = false;
    if (!res.ok) {
      setProfileError(res.error);
      return;
    }
    onSaved();
  };

  return (
    <section className="auth-card auth-card-wide" aria-label="Profile Details Form">
      <span className="auth-eyebrow">
        {needsOnboarding ? 'Client onboarding' : 'Profile settings'}
      </span>
      <h1 className="auth-title">
        {needsOnboarding ? 'Complete your profile' : 'Edit profile'}
      </h1>
      <p className="auth-subtitle">
        Signed in with Google ({user.email}).{' '}
        {needsOnboarding
          ? 'Add your full name, phone number, and delivery address to finish setting up your profile.'
          : 'Update your contact details, delivery address, and timepiece preferences below.'}
      </p>

      <form className="auth-form" onSubmit={handleSubmit}>
        <div className="auth-form-grid">
          <label className="auth-field">
            <span>Full name</span>
            <input
              type="text"
              required
              maxLength={100}
              dir="auto"
              autoComplete="name"
              placeholder="Alexander Vance"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </label>

          <label className="auth-field">
            <span>Phone number</span>
            <input
              type="tel"
              required
              maxLength={24}
              dir="auto"
              autoComplete="tel"
              placeholder="+91 98765 43210"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </label>

          <label className="auth-field auth-full-span">
            <span>Verified email address</span>
            <input
              type="email"
              required
              readOnly
              maxLength={160}
              dir="auto"
              autoComplete="email"
              value={profileEmail}
              title="Managed by your verified Google Sign-In account"
            />
          </label>

          <label className="auth-field auth-full-span">
            <span>Street address</span>
            <input
              type="text"
              required
              maxLength={200}
              dir="auto"
              autoComplete="street-address"
              placeholder="745 Fifth Avenue, Suite 1400"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </label>

          <label className="auth-field">
            <span>City</span>
            <input
              type="text"
              required
              maxLength={80}
              dir="auto"
              autoComplete="address-level2"
              placeholder="New York"
              value={city}
              onChange={(e) => setCity(e.target.value)}
            />
          </label>

          <label className="auth-field">
            <span>Postal code</span>
            <input
              type="text"
              required
              maxLength={24}
              dir="auto"
              autoComplete="postal-code"
              placeholder="10151"
              value={postalCode}
              onChange={(e) => setPostalCode(e.target.value)}
            />
          </label>

          <label className="auth-field">
            <span>Country</span>
            <input
              type="text"
              required
              maxLength={80}
              dir="auto"
              autoComplete="country-name"
              placeholder="United States"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
            />
          </label>

          <label className="auth-field">
            <span>Preferred timepiece finish</span>
            <select
              value={preferredFinish}
              onChange={(e) => setPreferredFinish(e.target.value)}
            >
              {ALLOWED_FINISH_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </label>
        </div>

        {profileError && (
          <p className="auth-error" role="alert">
            {profileError}
          </p>
        )}

        <div className="auth-actions-row">
          <button type="submit" disabled={profileSaving} className="auth-submit-btn">
            {profileSaving
              ? 'Saving...'
              : needsOnboarding
              ? 'Save and continue'
              : 'Save changes'}
          </button>
          {isEditing && (
            <button type="button" className="auth-secondary-btn" onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
      </form>
    </section>
  );
}

export function AuthPage() {
  const {
    user,
    authLoading,
    isAuthenticated,
    needsOnboarding,
    signInWithGoogle,
    saveProfile,
    deleteOwnAccount,
    signOut,
  } = useAuth();
  const { route, navigate } = useRouter();
  const { cartCount } = useCart();

  const [authError, setAuthError] = useState(getInitialUrlError);
  const [googleSetupNeeded, setGoogleSetupNeeded] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [profileSavedToast, setProfileSavedToast] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const actionLockRef = useRef(false);

  // Keep /signin (before sign in) and /profile (after sign in) aligned with auth state
  useEffect(() => {
    if (authLoading) return;
    if (isAuthenticated && !needsOnboarding) {
      const pendingRedirect = consumePostLoginRedirect();
      if (pendingRedirect && pendingRedirect !== '/signin') {
        navigate(pendingRedirect, { replace: true });
        return;
      }
    }
    if (isAuthenticated && route.view !== 'profile') {
      navigate('/profile', { replace: true, preserveScroll: true });
    } else if (!isAuthenticated && route.view !== 'signin') {
      navigate('/signin', { replace: true, preserveScroll: true });
    }
  }, [authLoading, isAuthenticated, needsOnboarding, route.view, navigate]);

  const handleGoogleClick = async () => {
    if (actionLockRef.current) return;
    actionLockRef.current = true;
    setAuthError('');
    setGoogleSetupNeeded(false);
    setGoogleLoading(true);
    const res = await signInWithGoogle();
    setGoogleLoading(false);
    actionLockRef.current = false;
    if (!res.ok) {
      setAuthError(res.error);
      if (res.providerNotEnabled) {
        setGoogleSetupNeeded(true);
      }
    }
  };

  const handleConfirmDeleteAccount = async () => {
    if (actionLockRef.current) return;
    actionLockRef.current = true;
    setDeleteError('');
    setDeleteLoading(true);
    const res = await deleteOwnAccount();
    setDeleteLoading(false);
    actionLockRef.current = false;
    if (!res.ok) {
      setDeleteError(res.error);
      return;
    }
    setConfirmDeleteOpen(false);
    navigate('/signin', { replace: true });
  };

  const handleProfileSaved = () => {
    setIsEditing(false);
    setProfileSavedToast(true);
    window.setTimeout(() => setProfileSavedToast(false), 2400);
  };

  const handleSignOut = async () => {
    setIsEditing(false);
    await signOut();
    navigate('/signin', { replace: true });
  };

  if (authLoading) {
    return (
      <main className="auth-page">
        <div className="auth-container">
          <section className="auth-card">
            <span className="auth-eyebrow">Luxe Store Private Client</span>
            <h1 className="auth-title">Verifying session</h1>
            <p className="auth-subtitle">Connecting securely to Supabase Auth.</p>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="auth-page">
      <div className="auth-container">
        <button type="button" className="auth-back-btn" onClick={() => navigate('/collection')}>
          <ArrowLeft size={16} strokeWidth={1.5} />
          <span>Back to collection</span>
        </button>

        {/* SIGN IN PAGE (/signin) */}
        {!isAuthenticated && (
          <section className="auth-card" aria-label="Sign In">
            <span className="auth-eyebrow">Luxe Store Private Client</span>
            <h1 className="auth-title">Sign in</h1>
            <p className="auth-subtitle">
              Sign in with Google to unlock your client profile, saved delivery details, and
              concierge checkout.
            </p>

            {authError && (
              <div className="auth-error" role="alert">
                <p>{authError}</p>
                {googleSetupNeeded && (
                  <p className="auth-setup-hint">
                    Enable <strong>Google</strong> with your Google Cloud Client ID &amp; Secret and
                    add <code>{window.location.origin}{withBase('/account')}</code> to Redirect URLs:{' '}
                    <a href={SUPABASE_PROVIDERS_URL} target="_blank" rel="noreferrer">
                      Open Supabase Auth Providers <ExternalLink size={14} strokeWidth={1.5} />
                    </a>
                  </p>
                )}
              </div>
            )}

            <button
              type="button"
              className="auth-google-btn"
              disabled={googleLoading}
              onClick={handleGoogleClick}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#EA4335"
                  d="M12 5.04c1.62 0 3.07.56 4.21 1.65l3.15-3.15C17.45 1.77 14.96 1 12 1 7.36 1 3.37 3.66 1.44 7.53l3.68 2.85C6 7.56 8.76 5.04 12 5.04z"
                />
                <path
                  fill="#4285F4"
                  d="M23.49 12.27c0-.79-.07-1.55-.2-2.27H12v4.51h6.47c-.29 1.48-1.14 2.74-2.41 3.58l3.73 2.89c2.18-2.01 3.7-4.97 3.7-8.71z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.12 14.62A7.01 7.01 0 0 1 4.74 12c0-.91.15-1.79.38-2.62L1.44 6.53A11 11 0 0 0 1 12c0 1.88.45 3.65 1.44 5.47l2.68-2.85z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.96 0 5.45-.98 7.26-2.65l-3.73-2.89c-.98.66-2.23 1.06-3.53 1.06-3.24 0-6-2.52-6.88-5.9L1.44 15.47C3.37 20.34 7.36 23 12 23z"
                />
              </svg>
              <span>{googleLoading ? 'Connecting to Google...' : 'Continue with Google'}</span>
            </button>
          </section>
        )}

        {/* PROFILE ONBOARDING / EDIT (/profile) */}
        {isAuthenticated && (needsOnboarding || isEditing) && (
          <ProfileDetailsForm
            key={`${user.id}-${isEditing ? 'edit' : 'onboard'}`}
            user={user}
            needsOnboarding={needsOnboarding}
            isEditing={isEditing}
            onCancel={() => setIsEditing(false)}
            onSaved={handleProfileSaved}
            saveProfile={saveProfile}
          />
        )}

        {/* PROFILE PAGE (/profile) */}
        {isAuthenticated && !needsOnboarding && !isEditing && (
          <section className="auth-card auth-card-wide" aria-label="Client Profile">
            <div className="auth-profile-top">
              <div className="auth-profile-identity">
                <div className="auth-avatar" aria-hidden="true">
                  {getInitials(user.fullName, user.email)}
                </div>
                <div>
                  <span className="auth-eyebrow">
                    <UserCheck size={16} strokeWidth={1.5} /> Client profile
                  </span>
                  <h1 className="auth-title">{user.fullName}</h1>
                  <p className="auth-subtitle auth-profile-email">{user.email}</p>
                </div>
              </div>

              <div className="auth-profile-btns">
                <button
                  type="button"
                  className="auth-secondary-btn"
                  onClick={() => setIsEditing(true)}
                >
                  <Edit3 size={16} strokeWidth={1.5} />
                  <span>Edit profile</span>
                </button>
                <button type="button" className="auth-secondary-btn" onClick={handleSignOut}>
                  <LogOut size={16} strokeWidth={1.5} />
                  <span>Sign out</span>
                </button>
              </div>
            </div>

            {profileSavedToast && (
              <div className="auth-saved-banner" role="status">
                <Check size={16} strokeWidth={1.5} />
                <span>Your profile details have been saved.</span>
              </div>
            )}

            <div className="auth-dossier-grid">
              <div className="auth-dossier-item">
                <span>Full name</span>
                <strong dir="auto">{user.fullName}</strong>
              </div>
              <div className="auth-dossier-item">
                <span>Phone number</span>
                <strong dir="auto">{user.phone}</strong>
              </div>
              <div className="auth-dossier-item">
                <span>Email address</span>
                <strong dir="auto">{user.email}</strong>
              </div>
              <div className="auth-dossier-item">
                <span>Preferred finish</span>
                <strong>{user.preferredFinish}</strong>
              </div>
              <div className="auth-dossier-item auth-full-span">
                <span>Delivery address</span>
                <strong dir="auto">
                  {user.address}, {user.city} {user.postalCode}, {user.country}
                </strong>
              </div>
            </div>

            <div className="auth-actions-row">
              <button
                type="button"
                className="auth-submit-btn"
                onClick={() => navigate('/collection')}
              >
                Explore collection
              </button>
              <button
                type="button"
                className="auth-secondary-btn"
                onClick={() => navigate('/cart')}
              >
                <ShoppingBag size={16} strokeWidth={1.5} />
                <span>View basket ({cartCount})</span>
              </button>
              {cartCount > 0 && (
                <button
                  type="button"
                  className="auth-secondary-btn"
                  onClick={() => navigate('/checkout')}
                >
                  Proceed to checkout
                </button>
              )}
              {!user.isAdmin && !confirmDeleteOpen && (
                <button
                  type="button"
                  className="auth-danger-btn"
                  onClick={() => {
                    setDeleteError('');
                    setConfirmDeleteOpen(true);
                  }}
                >
                  <Trash2 size={15} strokeWidth={1.5} />
                  <span>Delete account</span>
                </button>
              )}
            </div>

            {confirmDeleteOpen && (
              <div className="auth-delete-confirm" role="region" aria-label="Confirm Account Deletion">
                <p>
                  Permanently delete your Luxe Store profile and personal data? You can register
                  again later with Google.
                </p>
                {deleteError && (
                  <p className="auth-error" role="alert">
                    {deleteError}
                  </p>
                )}
                <div className="auth-actions-row">
                  <button
                    type="button"
                    className="auth-submit-btn"
                    disabled={deleteLoading}
                    onClick={handleConfirmDeleteAccount}
                  >
                    {deleteLoading ? 'Deleting...' : 'Confirm permanent deletion'}
                  </button>
                  <button
                    type="button"
                    className="auth-secondary-btn"
                    disabled={deleteLoading}
                    onClick={() => setConfirmDeleteOpen(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
