const jwt = require('jsonwebtoken');
const prisma = require('../src/utils/prismaClient');

async function testSuperAdminFlow() {
  console.log('====================================================');
  console.log('   HERO LOGISTICS — SUPER ADMIN FULL AUDIT & TEST   ');
  console.log('====================================================');

  const user = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' } }) || await prisma.user.findFirst();
  if (!user) {
    console.error('❌ No user found in database for testing!');
    process.exit(1);
  }

  const token = jwt.sign(
    { id: user.id, email: user.email, role: 'SUPER_ADMIN' },
    process.env.JWT_SECRET || 'hero-logistic-jwt-secret-2026',
    { expiresIn: '1h' }
  );

  const testEndpoints = [
    { name: 'Dashboard Overview', path: '/super-admin/dashboard' },
    { name: 'Companies List', path: '/companies' },
    { name: 'User Management', path: '/users' },
    { name: 'Roles & Permissions', path: '/custom-roles' },
    { name: 'Tenant Subscriptions', path: '/tenant-subscriptions' },
    { name: 'Subscription Plans', path: '/subscription-plans' },
    { name: 'Feature Access / Overrides', path: '/features' },
    { name: 'White-Label Configs', path: '/white-label-configs' },
    { name: 'Support Tickets', path: '/support-tickets' },
    { name: 'Billing Records', path: '/billing-records' },
    { name: 'System Analytics / Audit Logs', path: '/audit-logs' },
    { name: 'Inter-Company Asset Transfers', path: '/asset-transfers' },
    { name: 'AI Controls & Activity Logs', path: '/ai-modules' }
  ];

  let successCount = 0;
  let failCount = 0;

  for (const ep of testEndpoints) {
    try {
      const res = await fetch(`http://localhost:5000/api/v1${ep.path}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.status === 200 && (data.success || Array.isArray(data.data) || data.data)) {
        console.log(`✅ [200 OK] ${ep.name.padEnd(32)} -> Path: ${ep.path}`);
        successCount++;
      } else {
        console.warn(`⚠️ [${res.status}] ${ep.name.padEnd(32)} -> Path: ${ep.path}`, data);
        failCount++;
      }
    } catch (err) {
      console.error(`❌ [FAIL] ${ep.name.padEnd(32)} -> Path: ${ep.path} Error: ${err.message}`);
      failCount++;
    }
  }

  console.log('====================================================');
  console.log(`RESULTS: ${successCount} PASSED, ${failCount} FAILED out of ${testEndpoints.length} Super Admin Endpoints.`);
  console.log('====================================================');
}

testSuperAdminFlow()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Audit Script Error:', err);
    process.exit(1);
  });
