export const PROD_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' infinity-attachment: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";

export const DEV_CSP =
  "default-src 'none'; script-src 'self' 'unsafe-inline' http://localhost:*; style-src 'self' 'unsafe-inline'; img-src 'self' infinity-attachment: blob:; font-src 'self'; connect-src 'self' ws://localhost:* http://localhost:*; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
