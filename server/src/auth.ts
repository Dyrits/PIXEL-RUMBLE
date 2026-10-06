// BetterAuth instance, created per Workers environment (the D1 binding and
// secret only exist at request time).
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/schema";

export type Env = {
  DB: D1Database;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
};

export function makeAuth(env: Env) {
  return betterAuth({
    appName: "Pixel Rumble",
    // The schema is passed explicitly: better-auth's adapter maps its model
    // fields onto these tables, and relying on it to infer the schema from
    // the drizzle instance alone proved bundler-sensitive.
    database: drizzleAdapter(drizzle(env.DB, { schema }), {
      provider: "sqlite",
      schema,
    }),
    emailAndPassword: { enabled: true },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
  });
}
