/**
 * Minimal client for the Pangolin Integration API (https://api.pangolin.net/v1/docs).
 * Every response is wrapped as { data, success, error, message, status }.
 */

export class PangolinError extends Error {
    constructor(public status: number, message: string) {
        super(message);
    }
}

export type PangolinCreds = { baseUrl: string; orgId: string; apiKey: string };

export type RequestLog = {
    id?: number;
    timestamp: number;
    action: boolean;
    reason: number;
    actorType: string | null;
    actor: string | null;
    actorId: string | null;
    resourceId: number | null;
    siteResourceId: number | null;
    resourceName: string | null;
    ip: string | null;
    location: string | null;
    userAgent: string | null;
    host: string | null;
    path: string | null;
    method: string | null;
    scheme: string | null;
    tls: boolean | null;
    [k: string]: unknown;
};

export type AccessLog = {
    timestamp: number;
    action: boolean;
    type: string;
    actorType: string | null;
    actor: string | null;
    actorId: string | null;
    resourceId: number | null;
    siteResourceId: number | null;
    resourceName: string | null;
    ip: string | null;
    location: string | null;
    userAgent: string | null;
    [k: string]: unknown;
};

export type ConnectionLog = {
    sessionId: string;
    siteResourceId: number | null;
    siteId: number | null;
    clientEndpoint: string | null;
    userId: string | null;
    userEmail: string | null;
    clientName: string | null;
    sourceAddr: string;
    destAddr: string;
    protocol: string;
    startedAt: number;
    endedAt: number | null;
    bytesTx: number | null;
    bytesRx: number | null;
    resourceName: string | null;
    [k: string]: unknown;
};

export type PangolinSite = { siteId: number; name: string; niceId: string; type: string; online: boolean };
export type PangolinResource = {
    resourceId: number;
    name: string;
    niceId: string;
    fullDomain: string | null;
    targets?: { siteId: number }[];
};

export type RuleAction = "ACCEPT" | "DROP" | "PASS";
export type RuleMatch = "CIDR" | "IP" | "PATH" | "COUNTRY" | "COUNTRY_IS_NOT" | "ASN" | "REGION" | "METHOD";
export type NewRule = { action: RuleAction; match: RuleMatch; value: string; priority: number; enabled: boolean };
export type PangolinRule = NewRule & { ruleId: number };
export type PangolinResourceDetail = {
    resourceId: number;
    name: string;
    applyRules: boolean | null;
    resourcePolicyId: number | null;
    defaultResourcePolicyId: number | null;
};

type Paged<K extends string, T> = { [P in K]: T[] } & {
    pagination: { total: number; limit?: number; offset?: number; page?: number; pageSize?: number };
};

export class PangolinClient {
    constructor(private creds: PangolinCreds) {}

    private get<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
        return this.request<T>("GET", path, params);
    }

    private async request<T>(method: string, path: string, params: Record<string, string | number | undefined> = {}, body?: unknown): Promise<T> {
        const url = new URL(this.creds.baseUrl.replace(/\/$/, "") + path);
        for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));
        const res = await fetch(url, {
            method,
            headers: {
                Authorization: `Bearer ${this.creds.apiKey}`,
                Accept: "application/json",
                ...(body !== undefined ? { "Content-Type": "application/json" } : {})
            },
            body: body !== undefined ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(30_000)
        });
        const json = (await res.json().catch(() => null)) as { data: T; message?: string } | null;
        if (!res.ok || !json) {
            throw new PangolinError(res.status, json?.message ?? `HTTP ${res.status} from ${url.pathname}`);
        }
        return json.data;
    }

    private org(p: string) {
        return `/org/${encodeURIComponent(this.creds.orgId)}${p}`;
    }

    getOrg() {
        return this.get<{ org: { orgId: string; name: string } }>(this.org(""));
    }

    async listSites(): Promise<PangolinSite[]> {
        return this.pageAll<"sites", PangolinSite>(this.org("/sites"), "sites");
    }

    async listResources(): Promise<PangolinResource[]> {
        return this.pageAll<"resources", PangolinResource>(this.org("/resources"), "resources");
    }

    private async pageAll<K extends string, T>(path: string, key: K): Promise<T[]> {
        const out: T[] = [];
        for (let page = 1; page < 500; page++) {
            const d = await this.get<Paged<K, T>>(path, { page, pageSize: 100 });
            out.push(...d[key]);
            if (d[key].length === 0 || out.length >= d.pagination.total) break;
        }
        return out;
    }

    // ---- resource rules (Pangolin evaluates a resource's own rules, lowest priority first, then its policy's) ----

    getResource(resourceId: number) {
        return this.get<PangolinResourceDetail>(`/resource/${resourceId}`);
    }

    async listResourceRules(resourceId: number): Promise<PangolinRule[]> {
        const d = await this.get<{ rules: PangolinRule[] }>(`/resource/${resourceId}/rules`, { limit: 1000, offset: 0 });
        return d.rules;
    }

    async getResourcePolicyRules(resourcePolicyId: number): Promise<{ name: string | null; applyRules: boolean | null; rules: PangolinRule[] }> {
        const d = await this.get<{ name?: string; applyRules?: boolean; rules?: PangolinRule[] }>(`/resource-policy/${resourcePolicyId}`);
        return { name: d.name ?? null, applyRules: d.applyRules ?? null, rules: d.rules ?? [] };
    }

    createResourceRule(resourceId: number, rule: NewRule) {
        return this.request<PangolinRule>("PUT", `/resource/${resourceId}/rule`, {}, rule);
    }

    deleteResourceRule(resourceId: number, ruleId: number) {
        return this.request<unknown>("DELETE", `/resource/${resourceId}/rule/${ruleId}`);
    }

    setApplyRules(resourceId: number, applyRules: boolean) {
        return this.request<unknown>("POST", `/resource/${resourceId}`, {}, { applyRules });
    }

    /** Pages through a log endpoint (newest first) between timeStart and timeEnd. */
    async *logs<T>(kind: "request" | "access" | "connection", timeStart: number, timeEnd: number, pageSize = 1000) {
        for (let offset = 0; ; offset += pageSize) {
            const d = await this.get<Paged<"log", T>>(this.org(`/logs/${kind}`), {
                timeStart: new Date(timeStart * 1000).toISOString(),
                timeEnd: new Date(timeEnd * 1000).toISOString(),
                limit: pageSize,
                offset
            });
            yield d.log;
            if (d.log.length < pageSize || offset + pageSize >= d.pagination.total) return;
        }
    }
}
