import { Hono } from "hono";
import type { Env } from "../types";
import { filesRoutes } from "./files";
import { leasesRoutes } from "./leases";
import { changesetsRoutes } from "./changesets";

const api = new Hono<Env>();

api.route("/files", filesRoutes);
api.route("/leases", leasesRoutes);
api.route("/changesets", changesetsRoutes);

export { api };
