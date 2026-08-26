// http.js — the transport. Replaces lib/supabase.js.
//
// Every request to the CEO Office API goes through here, carrying a Cognito ID
// token. lib/cognito.js installs the token provider after sign-in.
//
// Three things in this file are lessons the Legal portal learned in production
// rather than design decisions, and all three are load-bearing:
//   1. hold a token PROVIDER, not a token
//   2. time requests out
//   3. turn an opaque network failure into a sentence naming the likely cause

export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:7869';

if (!import.meta.env.VITE_API_URL) {
  console.warn(
    '[http] VITE_API_URL is not set — falling back to http://localhost:7869. ' +
    'For a deployed build this must be baked in at build time (see frontend/buildspec.yml).'
  );
}

// A Cognito ID token expires after an hour. Holding the one captured at login
// meant that after 60 minutes every request went out with a dead token, the API
// answered 401, and the portal looked broken until someone reloaded the page.
// Hold a provider that returns a currently-valid token instead — Cognito
// refreshes it from the refresh token transparently.
let _token = null;
let _tokenProvider = null;

export const setAuthToken = (t) => { _token = t; };
export const setAuthTokenProvider = (fn) => { _tokenProvider = fn; };

let _onSessionExpired = null;
export const setOnSessionExpired = (fn) => { _onSessionExpired = fn; };

async function currentToken() {
  if (_tokenProvider) {
    try {
      const fresh = await _tokenProvider();
      if (fresh) { _token = fresh; return fresh; }
      if (_onSessionExpired) _onSessionExpired();
      return null;
    } catch {
      return _token;
    }
  }
  return _token;
}

// If the API host accepts the connection but never answers — a security group
// dropping traffic, an ALB with no healthy target — fetch waits forever. That
// presents as a button stuck on "Saving…" with nothing in the console.
const REQUEST_TIMEOUT_MS = 15000;

export async function request(path, options = {}) {
  const isFormData = options.body instanceof FormData;
  const headers = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(options.headers || {}),
  };
  const token = await currentToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(`${API_URL}${path}`, { ...options, headers, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(
        `The server did not respond within ${REQUEST_TIMEOUT_MS / 1000}s (${API_URL}). It may be down or unreachable.`,
        { cause: err }
      );
    }
    // A network-level failure here is almost always a blocked CORS preflight or
    // a wrong VITE_API_URL, neither of which fetch reports in any useful detail.
    throw new Error(
      `Could not reach the server at ${API_URL}. Check the API is running and its CORS origin matches this site.`,
      { cause: err }
    );
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 204) return null;

  const body = await res.json().catch(() => null);

  if (!res.ok) {
    // The server forwards the raw Postgres message for 4xx, tags and all
    // (FORBIDDEN, INVALID_TRANSITION, LOCKED, SELF_CREATED, REASON_REQUIRED).
    // friendlyMoveError() in lib/filters.js matches on those tags, exactly as
    // it did against Supabase, so preserving the message here is what keeps
    // every workflow error message specific instead of generic.
    const err = new Error(body?.error || `Request failed (${res.status})`);
    err.status = res.status;
    if (res.status === 401 && _onSessionExpired) _onSessionExpired();
    throw err;
  }

  return body;
}

export const get   = (p)      => request(p);
export const post  = (p, b)   => request(p, { method: 'POST',   body: JSON.stringify(b ?? {}) });
export const patch = (p, b)   => request(p, { method: 'PATCH',  body: JSON.stringify(b ?? {}) });
export const del   = (p)      => request(p, { method: 'DELETE' });
