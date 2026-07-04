import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    // CLI-only (db push / migrate); the app connects via the pg adapter in src/db.ts
    url: process.env.DATABASE_URL ?? 'postgresql://somo:somo@localhost:5432/somo',
  },
})
