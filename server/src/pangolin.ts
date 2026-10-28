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

type Paged<K extends string, T> = { [P in K]: T[] } & {
    pagination: { total: number; limit?: number; offset?: number; page?: number; pageSize?: number };
};

export class PangolinClient {
    constructor(private creds: PangolinCreds) {}

    private async get<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
        const url = new URL(this.creds.baseUrl.replace(/\/$/, "") + path);
        for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));
        const res = await fetch(url, {
            headers: { Authorization: `Bearer ${this.creds.apiKey}`, Accept: "application/json" },
            signal: AbortSignal.timeout(30_000)
        });
        const body = (await res.json().catch(() => null)) as { data: T; message?: string } | null;
        if (!res.ok || !body) {
            throw new PangolinError(res.status, body?.message ?? `HTTP ${res.status} from ${url.pathname}`);
        }
        return body.data;
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
