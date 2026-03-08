import {
  pgTable,
  text,
  integer,
  timestamp,
  uuid,
  jsonb,
  bigserial,
  boolean,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const files = pgTable("files", {
  path: text("path").primaryKey(),
  content: text("content").notNull().default(""),
  version: integer("version").notNull().default(1),
  contentHash: text("content_hash").notNull(),
  lastModifiedBy: text("last_modified_by"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const leases = pgTable(
  "leases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    filePath: text("file_path").notNull(),
    agentId: text("agent_id").notNull(),
    intent: text("intent"),
    acquiredAt: timestamp("acquired_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    released: boolean("released").notNull().default(false),
  },
  (table) => [
    uniqueIndex("active_lease_idx")
      .on(table.filePath)
      .where(sql`${table.released} = false`),
  ]
);

export const changesets = pgTable("changesets", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: text("agent_id").notNull(),
  status: text("status", {
    enum: ["open", "validating", "committed", "failed"],
  })
    .notNull()
    .default("open"),
  message: text("message"),
  validationStage: integer("validation_stage").notNull().default(0),
  validationErrors: jsonb("validation_errors").$type<unknown[]>().default([]),
  gitSha: text("git_sha"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  committedAt: timestamp("committed_at", { withTimezone: true }),
});

export const changesetFiles = pgTable(
  "changeset_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    changesetId: uuid("changeset_id")
      .notNull()
      .references(() => changesets.id),
    filePath: text("file_path").notNull(),
    content: text("content").notNull(),
    baseVersion: integer("base_version"),
    operation: text("operation", {
      enum: ["create", "update", "delete"],
    })
      .notNull()
      .default("update"),
  },
  (table) => [
    uniqueIndex("changeset_file_idx").on(table.changesetId, table.filePath),
  ]
);

export const fileVersions = pgTable("file_versions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  path: text("path").notNull(),
  version: integer("version").notNull(),
  content: text("content").notNull(),
  contentHash: text("content_hash").notNull(),
  modifiedBy: text("modified_by"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const events = pgTable("events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  type: text("type").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Inferred types
export type File = typeof files.$inferSelect;
export type NewFile = typeof files.$inferInsert;
export type Lease = typeof leases.$inferSelect;
export type NewLease = typeof leases.$inferInsert;
export type Changeset = typeof changesets.$inferSelect;
export type ChangesetFile = typeof changesetFiles.$inferSelect;
export type FileVersion = typeof fileVersions.$inferSelect;
export type Event = typeof events.$inferSelect;
