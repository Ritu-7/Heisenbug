const { createClerkClient } = require('@clerk/backend');

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY || 'sk_test_stp220g73j4tus1ZlV8JNEuNghs4eHG1uJ7fctDnBf';
const clerk = createClerkClient({ secretKey: CLERK_SECRET_KEY });

// Rotated strong passwords (>= 15 characters, highly secure)
const DEMO_ACCOUNTS = [
  {
    email: 'alice@heisenbug.dev',
    username: 'alice_candidate',
    firstName: 'Alice',
    lastName: 'Candidate',
    password: 'Heisenbug_Alice_Rotated_2026_Secure!',
    role: 'CANDIDATE',
  },
  {
    email: 'recruiter@heisenbug.dev',
    username: 'dana_recruiter',
    firstName: 'Dana',
    lastName: 'Recruiter',
    password: 'Heisenbug_Recruiter_Rotated_2026_Secure!',
    role: 'RECRUITER',
  },
  {
    email: 'admin@heisenbug.dev',
    username: 'heisenbug_admin',
    firstName: 'Heisenbug',
    lastName: 'Admin',
    password: 'Heisenbug_Admin_Rotated_2026_Secure!',
    role: 'ADMIN',
  },
  {
    email: 'author@heisenbug.dev',
    username: 'arthur_author',
    firstName: 'Arthur',
    lastName: 'Author',
    password: 'Heisenbug_Author_Rotated_2026_Secure!',
    role: 'AUTHOR',
  },
];

async function seedClerkDemoUsers() {
  console.log('Syncing real Clerk demo users...');
  const existingList = await clerk.users.getUserList({ limit: 100 });
  const existing = existingList.data || [];

  for (const acc of DEMO_ACCOUNTS) {
    const found = existing.find((u) =>
      u.emailAddresses.some((e) => e.emailAddress.toLowerCase() === acc.email.toLowerCase())
    );

    if (found) {
      console.log(`✓ Updating existing Clerk user: ${acc.email} (${found.id})`);
      await clerk.users.updateUser(found.id, {
        firstName: acc.firstName,
        lastName: acc.lastName,
        password: acc.password,
        privateMetadata: {
          role: acc.role,
          approvalStatus: acc.role === 'RECRUITER' ? 'APPROVED' : 'NONE',
          requestedRole: null,
        },
      });
    } else {
      console.log(`+ Creating real Clerk user: ${acc.email}`);
      const created = await clerk.users.createUser({
        emailAddress: [acc.email],
        username: acc.username,
        firstName: acc.firstName,
        lastName: acc.lastName,
        password: acc.password,
        privateMetadata: {
          role: acc.role,
          approvalStatus: acc.role === 'RECRUITER' ? 'APPROVED' : 'NONE',
          requestedRole: null,
        },
      });
      console.log(`  Created ${acc.email} with Clerk ID: ${created.id}`);
    }
  }

  console.log('✅ Real Clerk demo users seeded successfully.');
}

if (require.main === module) {
  seedClerkDemoUsers().catch((err) => {
    console.error('Error seeding Clerk demo users:', err);
    process.exit(1);
  });
}

module.exports = { seedClerkDemoUsers, DEMO_ACCOUNTS };
