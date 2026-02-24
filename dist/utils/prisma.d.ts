import { PrismaClient } from "@prisma/client";
declare const prisma: PrismaClient<{
    log: ("error" | "warn")[];
}, never, import("@prisma/client/runtime/library").DefaultArgs>;
export default prisma;
