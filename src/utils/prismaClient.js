require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaMariaDb } = require('@prisma/adapter-mariadb');
const mariadb = require('mariadb');

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
  connectionLimit: 15,
  allowPublicKeyRetrieval: true,
  acquireTimeout: 10000
});

const adapter = new PrismaMariaDb(pool);

const prisma = new PrismaClient({ adapter });

module.exports = prisma;
