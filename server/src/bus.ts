import { EventEmitter } from "node:events";
import type { TrafficEvent } from "./events.ts";

export type AlertFired = { id: number; ruleId: number; ruleName: string; ts: number; count: number; summary: string };

/**
 * In-process fan-out of newly ingested events. Alerts subscribe today; future
 * sinks (SIEM streaming: syslog/CEF, Splunk HEC, Elastic, etc.) subscribe here too.
 */
class Bus extends EventEmitter<{ events: [TrafficEvent[]]; alert: [AlertFired] }> {}

export const bus = new Bus();
bus.setMaxListeners(100);
