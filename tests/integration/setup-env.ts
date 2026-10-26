// Runs in every integration worker before test files are imported.
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST ?? 'postgresql://casino:casino@localhost:5432/casino_test';
// Cheap password hashing keeps the suite fast; production uses SCRYPT_LOG_N=17.
process.env.SCRYPT_LOG_N = '10';
process.env.LOG_LEVEL = 'error';
process.env.MAIL_TRANSPORT = 'disabled';
process.env.BACKGROUND_JOBS = 'false';
