// errors.js — turns a Postgres error into an HTTP response.
//
// The business rules live in SQL (sql/02_functions.sql and friends) and signal
// refusals by raising with a tagged message:
//
//     raise exception 'INVALID_TRANSITION: % cannot move directly to %', ...
//     raise exception 'FORBIDDEN: not your assignment' using errcode = 'insufficient_privilege';
//     raise exception 'LOCKED: this promised date has been confirmed and locked';
//     raise exception 'SELF_CREATED: ...';
//     raise exception 'REASON_REQUIRED: ...';
//
// The frontend's friendlyMoveError() (frontend/src/lib/filters.js) matches on
// those tags to show a human sentence. It did so against Supabase, where
// PostgREST passed the raw message through, and it still does — which is why
// this file forwards `err.message` VERBATIM rather than replacing it with a
// tidier generic string. Rewording a message here silently degrades a specific,
// actionable error into "Could not move the task. Try again." with no test
// failing anywhere. Keep the tags intact.

// Postgres SQLSTATE → HTTP. Anything unmapped is a genuine 500.
const STATUS_BY_CODE = {
  '42501': 403, // insufficient_privilege — raised by the FORBIDDEN guards
  '23514': 400, // check_violation — INVALID_TRANSITION, LOCKED
  '23505': 409, // unique_violation — e.g. same stakeholder added twice
  '23503': 400, // foreign_key_violation — unknown task/stakeholder id
  '22P02': 400, // invalid_text_representation — bad uuid/enum from the client
  '23502': 400, // not_null_violation
};

// A few refusals are raised without an errcode (plain `raise exception`), so
// they arrive as P0001 with only the tag to go on. Map those by prefix.
const STATUS_BY_TAG = [
  ['FORBIDDEN',          403],
  ['INVALID_TRANSITION', 400],
  ['LOCKED',             409],
  ['SELF_CREATED',       400],
  ['REASON_REQUIRED',    400],
  ['not found',          404],
];

/** Throw from a route to refuse with a specific status and message. */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function statusFor(err) {
  if (err instanceof HttpError) return err.status;
  if (STATUS_BY_CODE[err?.code]) return STATUS_BY_CODE[err.code];
  const msg = (err?.message || '');
  for (const [tag, status] of STATUS_BY_TAG) {
    if (msg.toUpperCase().includes(tag.toUpperCase())) return status;
  }
  return 500;
}

/**
 * Wrap an async route handler so thrown errors become correct HTTP responses.
 *
 *   router.post('/x', handle(async (req, res) => { ... }));
 *
 * Without this, a rejected promise in an Express 4 handler is an unhandled
 * rejection: the client waits for a response that never comes and eventually
 * times out, with nothing in the logs tying the hang to the cause.
 */
export function handle(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch((err) => {
      const status = statusFor(err);

      // 500s are our bug and deserve a stack; 4xx are the rules working as
      // designed and would just be noise at volume.
      if (status >= 500) {
        console.error(`[${req.method} ${req.originalUrl}]`, err);
      } else {
        console.warn(`[${req.method} ${req.originalUrl}] ${status}: ${err.message}`);
      }

      res.status(status).json({
        error: status >= 500
          // Never leak an internal Postgres message on a 500 — those can carry
          // column names, constraint names and query fragments.
          ? 'Something went wrong. Please try again.'
          : err.message,
      });
    });
  };
}
