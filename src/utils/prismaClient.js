require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaMariaDb } = require('@prisma/adapter-mariadb');
const mariadb = require('mariadb');

let prisma;

try {
  const dbUrl = process.env.DATABASE_URL || 'mysql://root:@127.0.0.1:3306/hero-logistic';
  const urlObj = new URL(dbUrl);
  
  const host = (urlObj.hostname === 'localhost' || !urlObj.hostname) ? '127.0.0.1' : urlObj.hostname;
  const port = Number(urlObj.port) || 3306;
  const user = urlObj.username || 'root';
  const password = urlObj.password ? decodeURIComponent(urlObj.password) : '';
  const database = urlObj.pathname ? urlObj.pathname.replace(/^\//, '') : 'hero-logistic';

  const pool = mariadb.createPool({
    host,
    port,
    user,
    password,
    database,
    connectionLimit: 50,
    allowPublicKeyRetrieval: true,
    acquireTimeout: 30000,
    connectTimeout: 30000,
    idleTimeout: 30000
  });

  const adapter = new PrismaMariaDb(pool);
  prisma = new PrismaClient({ adapter });
} catch (err) {
  console.warn('PrismaMariaDb adapter initialization warning, using standard PrismaClient:', err?.message);
  prisma = new PrismaClient();
}

module.exports = prisma;
