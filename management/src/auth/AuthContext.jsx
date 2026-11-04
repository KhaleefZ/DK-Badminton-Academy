import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { PASSWORD_CHANGE_EVENT, SESSION_ENDED_EVENT } from '../lib/api';
import * as authService from './authService';

const AuthContext = createContext(null);

// Other open tabs hear about a sign-in or sign-out through this channel.
const CHANNEL = 'dk-auth';
const RECHECK_MIN_MS = 30_000;

/**
 * status: 'loading' until the server has answered, then 'signedIn', 'signedOut' or 'unreachable'.
 * endReason says why a session ended, so the login page can show the right message.
 */
export function AuthProvider({ children }) {
  const [status, setStatus] = useState('loading');
  const [user, setUser] = useState(null);
  const [endReason, setEndReason] = useState(null);
  const signedInRef = useRef(false);
  const channel = useRef(null);
  const lastCheck = useRef(0);

  useEffect(() => {
    signedInRef.current = status === 'signedIn';
  }, [status]);

  const load = useCallback(async () => {
    lastCheck.current = Date.now();
    try {
      const current = await authService.fetchCurrentUser();
      setUser(current);
      setStatus(current ? 'signedIn' : 'signedOut');
    } catch {
      // A brief network drop must not throw someone out of a page they're using.
      setStatus((previous) => (previous === 'signedIn' ? previous : 'unreachable'));
    }
  }, []);

  const endSession = useCallback((reason) => {
    setUser(null);
    setStatus('signedOut');
    setEndReason(reason);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onEnded = () => {
      if (signedInRef.current) endSession('expired');
    };
    const onPasswordChange = () => setUser((u) => (u ? { ...u, mustChangePassword: true } : u));
    // A page restored by the Back button, or a tab returned to, must not show a stale session.
    const recheck = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastCheck.current > RECHECK_MIN_MS) load();
    };
    // Catches a deactivation or a sign-out elsewhere even on pages that make no API calls.
    const timer = setInterval(recheck, RECHECK_MIN_MS);
    const onPageShow = (e) => e.persisted && load();
    const onOnline = () => authService.finishPendingSignOut();

    window.addEventListener(SESSION_ENDED_EVENT, onEnded);
    window.addEventListener(PASSWORD_CHANGE_EVENT, onPasswordChange);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', recheck);

    if ('BroadcastChannel' in window) {
      channel.current = new BroadcastChannel(CHANNEL);
      channel.current.onmessage = ({ data }) => {
        if (data === 'signed-out') endSession('signedOut');
        if (data === 'signed-in') load();
      };
    }
    return () => {
      window.removeEventListener(SESSION_ENDED_EVENT, onEnded);
      window.removeEventListener(PASSWORD_CHANGE_EVENT, onPasswordChange);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', recheck);
      clearInterval(timer);
      channel.current?.close();
    };
  }, [endSession, load]);

  const signIn = useCallback(async (email, password, remember) => {
    const signedIn = await authService.signIn(email, password, remember);
    setUser(signedIn);
    setStatus('signedIn');
    setEndReason(null);
    channel.current?.postMessage('signed-in');
    return signedIn;
  }, []);

  const signOut = useCallback(async () => {
    // The screen clears straight away; a slow server must not leave private data showing.
    endSession('signedOut');
    const reachedServer = await authService.signOut();
    // Told after the server call, so another tab's check can't find the session still alive.
    channel.current?.postMessage('signed-out');
    if (!reachedServer) setEndReason('signedOutOffline');
  }, [endSession]);

  const signOutEverywhere = useCallback(async () => {
    await authService.signOutEverywhere();
    endSession('signedOut');
    channel.current?.postMessage('signed-out');
  }, [endSession]);

  const changePassword = useCallback(async (currentPassword, newPassword) => {
    setUser(await authService.changePassword(currentPassword, newPassword));
  }, []);

  const value = useMemo(
    () => ({ status, user, endReason, retry: load, signIn, signOut, signOutEverywhere, changePassword }),
    [status, user, endReason, load, signIn, signOut, signOutEverywhere, changePassword],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** Mirrors the server's permission list, to hide what this account can't use. */
export function useCan() {
  const { user } = useAuth();
  return useCallback((permission) => Boolean(user?.permissions?.includes(permission)), [user]);
}
