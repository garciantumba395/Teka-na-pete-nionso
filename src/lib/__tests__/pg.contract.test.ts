import { afterAll } from "vitest";
import { defineContract } from "./contract";
import { endTestPool, makePgEnv, TEST_URL } from "./pg-env";

afterAll(endTestPool);

// Même suite de scénarios que la couche factice, contre un vrai PostgreSQL (DATABASE_URL_TEST, voir npm run test:pg).
defineContract("PostgreSQL", () => makePgEnv(), { skip: !TEST_URL });
