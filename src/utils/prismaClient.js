require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaMariaDb } = require('@prisma/adapter-mariadb');

let prisma;

try {
  const dbUrl = process.env.DATABASE_URL || 'mysql://root:@127.0.0.1:3306/hero-logistic';
  const urlObj = new URL(dbUrl);
  
  if (!urlObj.searchParams.has('connectionLimit')) urlObj.searchParams.set('connectionLimit', '50');
  if (!urlObj.searchParams.has('acquireTimeout')) urlObj.searchParams.set('acquireTimeout', '30000');
  if (!urlObj.searchParams.has('connectTimeout')) urlObj.searchParams.set('connectTimeout', '30000');
  if (!urlObj.searchParams.has('idleTimeout')) urlObj.searchParams.set('idleTimeout', '30000');
  if (!urlObj.searchParams.has('allowPublicKeyRetrieval')) urlObj.searchParams.set('allowPublicKeyRetrieval', 'true');

  const adapter = new PrismaMariaDb(urlObj.toString());
  prisma = new PrismaClient({ adapter });
} catch (err) {
  console.warn('PrismaMariaDb adapter initialization warning, using standard PrismaClient:', err?.message);
  prisma = new PrismaClient();
}

module.exports = prisma;
