import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { apply, getRuleSet, listActions, preview, suggestions, undo } from "../policies.ts";

const Draft = z.object({
    action: z.enum(["DROP", "PASS"]),
    match: z.enum(["CIDR", "IP", "PATH", "COUNTRY", "COUNTRY_IS_NOT", "ASN", "REGION", "METHOD"]),
    value: z.string().trim().min(1).max(300)
});
const Target = z.object({
    connectionId: z.number().int(),
    resourceId: z.number().int(),
    rules: z.array(Draft).min(1).max(50),
    position: z.enum(["top", "bottom"]).optional()
});

export async function policyRoutes(app: FastifyInstance) {
    app.get<{ Querystring: { days?: string } }>("/api/policies/suggestions", async (req) => suggestions(Math.min(30, Math.max(1, Number(req.query.days ?? 7)))));

    app.get<{ Querystring: { connectionId: string; resourceId: string } }>("/api/policies/rules", async (req) =>
        getRuleSet(Number(req.query.connectionId), Number(req.query.resourceId), true)
    );

    /** The requester's own IP is checked too, so you can't lock yourself out without being told. */
    app.post("/api/policies/preview", async (req) => {
        const b = Target.extend({ days: z.number().int().min(1).max(30).optional() }).parse(req.body);
        return preview(b.connectionId, b.resourceId, b.rules, b.position, req.ip ?? null, b.days);
    });

    app.post("/api/policies/apply", async (req) => {
        const b = Target.extend({ enableRules: z.boolean().default(false), note: z.string().max(500).nullable().optional() }).parse(req.body);
        return apply(b.connectionId, b.resourceId, b.rules, b.position, b.enableRules, b.note ?? null);
    });

    app.get("/api/policies/actions", async () => listActions());
    app.post<{ Params: { id: string } }>("/api/policies/actions/:id/undo", async (req) => undo(Number(req.params.id)));
}
