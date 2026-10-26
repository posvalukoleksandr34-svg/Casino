/** Loads .env into process.env if present (Node ≥ 21.7). Existing variables win. */
try {
  process.loadEnvFile('.env');
} catch {
  // no .env file: rely on the real environment
}
export {};
