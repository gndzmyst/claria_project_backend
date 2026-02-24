import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding database...");

  // Hapus data lama
  await prisma.userPosition.deleteMany();
  await prisma.watchlist.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.user.deleteMany();

  // Buat demo user
  const user = await prisma.user.create({
    data: {
      email: "demo@aurora.app",
      name: "Aurora Demo User",
      balance: 1000.0,
    },
  });
  console.log(`✅ Created user: ${user.email} | Balance: $${user.balance}`);

  // Buat sample transactions
  await prisma.transaction.createMany({
    data: [
      {
        userId: user.id,
        type: "DEPOSIT",
        amount: 1000.0,
        description: "Initial demo deposit",
        status: "COMPLETED",
        metadata: { method: "demo", simulated: true },
      },
    ],
  });
  console.log("✅ Created sample transactions");

  console.log("\n🌱 Seed complete!");
  console.log(`   Demo user email : demo@aurora.app`);
  console.log(`   Demo balance    : $1000.00 USDC`);
}

main()
  .catch((err) => {
    console.error("❌ Seed failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
