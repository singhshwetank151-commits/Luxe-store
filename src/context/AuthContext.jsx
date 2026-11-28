import { useCallback, useEffect, useMemo, useState } from 'react';
import { withBase } from '../lib/basePath';
import { isSupabaseConfigured, supabase, supabaseKey, supabaseUrl } from '../lib/supabase';
import { AuthContext } from './storeHooks';
import {
  ALLOWED_FINISH_OPTIONS,
  normalizePhoneDigits,
  validateProfileInput,
  withNetworkGuard,
} from '../lib/security';

function buildUserState(authUser, profileRow, roleRow) {
  if (!authUser) return null;

  const meta = authUser.user_metadata || {};
  const appMeta = authUser.app_metadata || {};
  const rawPhone =
    profileRow?.phone && !String(profileRow.phone).startsWith('user-')
      ? profileRow.phone
      : authUser.phone || meta.phone || '';

  const rawName =
    profileRow?.full_name && profileRow.full_name !== 'Valued Client'
      ? profileRow.full_name
      : meta.full_name || meta.name || '';

  // Authoritative identity email comes from Supabase Auth, not mutable client metadata
  const email = authUser.email || profileRow?.email || '';
  const address = meta.address || '';
  const city = meta.city || '';
  const postalCode = meta.postal_code || '';
  const country = meta.country || '';
  const preferredFinish = ALLOWED_FINISH_OPTIONS.includes(meta.preferred_finish)
    ? meta.preferred_finish
    : ALLOWED_FINISH_OPTIONS[0];

  const hasValidPhone = normalizePhoneDigits(rawPhone).length >= 7;
  const hasAddress = Boolean(address && city && postalCode && country);
  const profileComplete = Boolean(rawName.trim().length >= 2 && hasValidPhone && email && hasAddress);
  const role = roleRow?.role || 'customer';
  const isAdmin = role === 'admin' || role === 'super_admin';

  return {
    id: authUser.id,
    provider: appMeta.provider || 'google',
    email,
    fullName: rawName,
    phone: rawPhone,
    address,
    city,
    postalCode,
    country,
    preferredFinish,
    avatarUrl: profileRow?.avatar_url || meta.avatar_url || meta.picture || '',
    profileComplete,
    role,
    isAdmin,
  };
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(isSupabaseConfigured);

  const hydrateUser = useCallback(async (authUser) => {
    if (!authUser || !supabase) {
      setUser(null);
      setAuthLoading(false);
      return null;
    }

    const [{ data: profileRow }, { data: rolesRows }, { data: isAdminFlag }] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, full_name, phone, email, avatar_url, is_restricted')
        .eq('id', authUser.id)
        .maybeSingle(),
      supabase.from('user_roles').select('role').eq('user_id', authUser.id),
      supabase.rpc('is_admin', { check_user_id: authUser.id }),
    ]);

    const rolesList = Array.isArray(rolesRows) ? rolesRows.map((r) => r.role) : [];
    const elevatedRole = rolesList.includes('super_admin')
      ? 'super_admin'
      : rolesList.includes('admin')
      ? 'admin'
      : 'customer';

    const resolvedRole = isAdminFlag === true ? elevatedRole : 'customer';
    const mapped = buildUserState(authUser, profileRow, { role: resolvedRole });
    setUser(mapped);
    setAuthLoading(false);
    return mapped;
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      return undefined;
    }

    let active = true;

    const verifySession = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!active) return;
        if (!session) {
          setUser(null);
          setAuthLoading(false);
          return;
        }

        const {
          data: { user: verifiedUser },
          error: userErr,
        } = await withNetworkGuard(supabase.auth.getUser(), 12000);

        if (!active) return;
        if (userErr || !verifiedUser) {
          await supabase.auth.signOut({ scope: 'local' });
          setUser(null);
          setAuthLoading(false);
          return;
        }

        await hydrateUser(verifiedUser);
      } catch {
        if (!active) return;
        setUser(null);
        setAuthLoading(false);
      }
    };

    verifySession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      if (session?.user) {
        supabase.auth.getUser().then(({ data: { user: verifiedUser }, error }) => {
          if (!active) return;
          if (error || !verifiedUser) {
            setUser(null);
            setAuthLoading(false);
            return;
          }
          hydrateUser(verifiedUser);
        });
      } else {
        setUser(null);
        setAuthLoading(false);
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [hydrateUser]);

  const signInWithGoogle = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) {
      return { ok: false, error: 'Supabase is not configured.' };
    }

    try {
      const settingsRes = await withNetworkGuard(
        fetch(`${supabaseUrl}/auth/v1/settings`, {
          headers: { apikey: supabaseKey },
        }),
        10000
      );
      if (settingsRes.ok) {
        const settings = await settingsRes.json();
        if (!settings?.external?.google) {
          return {
            ok: false,
            providerNotEnabled: true,
            error:
              'Google OAuth is wired via Supabase, but the Google provider is currently disabled on your Supabase project.',
          };
        }
      }

      const { error } = await withNetworkGuard(
        supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: `${window.location.origin}${withBase('/account')}`,
            queryParams: {
              access_type: 'offline',
              prompt: 'select_account',
            },
          },
        }),
        12000
      );

      if (error) {
        return { ok: false, error: error.message };
      }

      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to start Google sign-in.',
      };
    }
  }, []);

  const saveProfile = useCallback(
    async (profileData) => {
      if (!user || !supabase) return { ok: false, error: 'No active session.' };

      const validated = validateProfileInput(profileData, user.email);
      if (!validated.ok) {
        return { ok: false, error: validated.error };
      }

      const { fullName, email, phone, address, city, postalCode, country, preferredFinish } =
        validated.data;

      try {
        const { data: authUpdated, error: authErr } = await withNetworkGuard(
          supabase.auth.updateUser({
            data: {
              full_name: fullName,
              phone,
              address,
              city,
              postal_code: postalCode,
              country,
              preferred_finish: preferredFinish,
              profile_complete: true,
            },
          }),
          15000
        );
        if (authErr) {
          return { ok: false, error: authErr.message };
        }

        const { error: profileErr } = await withNetworkGuard(
          supabase.from('profiles').upsert({
            id: user.id,
            full_name: fullName,
            phone,
            email,
          }),
          15000
        );
        if (profileErr) {
          return { ok: false, error: profileErr.message };
        }

        const refreshed = await hydrateUser(authUpdated.user);
        return { ok: true, user: refreshed };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Could not save profile changes.',
        };
      }
    },
    [user, hydrateUser]
  );

  const signInWithAdminPassword = useCallback(
    async (email, password) => {
      if (!isSupabaseConfigured || !supabase) {
        return { ok: false, error: 'Authentication service is unavailable.' };
      }
      const cleanEmail = String(email || '').trim().toLowerCase();
      if (!cleanEmail || !password) {
        return { ok: false, error: 'Email and password are required.' };
      }

      const startedAt = Date.now();
      const enforceMinFailureDelay = async () => {
        const elapsed = Date.now() - startedAt;
        if (elapsed < 400) {
          await new Promise((resolve) => setTimeout(resolve, 400 - elapsed));
        }
      };

      try {
        const { data, error } = await withNetworkGuard(
          supabase.auth.signInWithPassword({
            email: cleanEmail,
            password,
          }),
          15000
        );
        if (error || !data?.user) {
          await enforceMinFailureDelay();
          return { ok: false, error: 'Invalid credentials or insufficient privileges.' };
        }
        const hydrated = await hydrateUser(data.user);
        if (!hydrated?.isAdmin) {
          await supabase.auth.signOut().catch(() => undefined);
          setUser(null);
          await enforceMinFailureDelay();
          return { ok: false, error: 'Invalid credentials or insufficient privileges.' };
        }
        return { ok: true, user: hydrated };
      } catch {
        await enforceMinFailureDelay();
        return {
          ok: false,
          error: 'Unable to verify credentials right now. Please try again.',
        };
      }
    },
    [hydrateUser]
  );

  const reverifyAdminSession = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return false;
    try {
      const {
        data: { user: verifiedUser },
        error: userErr,
      } = await withNetworkGuard(supabase.auth.getUser(), 10000);
      if (userErr || !verifiedUser) {
        await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
        setUser(null);
        return false;
      }
      const hydrated = await hydrateUser(verifiedUser);
      if (!hydrated?.isAdmin) {
        await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
        setUser(null);
        return false;
      }
      return true;
    } catch {
      return true; // Do not lock out on transient offline blip
    }
  }, [hydrateUser]);

  const deleteOwnAccount = useCallback(async () => {
    if (!user || !supabase) {
      return { ok: false, error: 'No active session.' };
    }
    try {
      const { data, error } = await withNetworkGuard(
        supabase.functions.invoke('delete-account', { method: 'POST' }),
        15000
      );
      if (error || !data?.ok) {
        return {
          ok: false,
          error: data?.error || error?.message || 'Could not delete account.',
        };
      }
      try {
        window.localStorage.removeItem(`luxe_store_cart_v1:${user.id}`);
      } catch {
        // Ignore storage restrictions
      }
      await supabase.auth.signOut({ scope: 'local' });
      setUser(null);
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Could not delete account.',
      };
    }
  }, [user]);

  const signOut = useCallback(async () => {
    if (supabase) {
      await supabase.auth.signOut().catch(() => undefined);
    }
    setUser(null);
  }, []);

  const isAuthenticated = Boolean(user);
  const isAdmin = Boolean(user?.isAdmin);
  const needsOnboarding = Boolean(user && !user.profileComplete);

  const value = useMemo(
    () => ({
      user,
      authLoading,
      isAuthenticated,
      isAdmin,
      needsOnboarding,
      signInWithGoogle,
      signInWithAdminPassword,
      reverifyAdminSession,
      saveProfile,
      deleteOwnAccount,
      signOut,
    }),
    [
      user,
      authLoading,
      isAuthenticated,
      isAdmin,
      needsOnboarding,
      signInWithGoogle,
      signInWithAdminPassword,
      reverifyAdminSession,
      saveProfile,
      deleteOwnAccount,
      signOut,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
