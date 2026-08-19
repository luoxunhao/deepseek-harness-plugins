/**
 * dsh-skill-manager — host half.
 *
 * Registers loopback-fenced JSON routes under /skill-manager/api that serve
 * the merged skill catalog and write per-skill invocation policy back to the
 * skill's own frontmatter file:
 *
 *   GET  /skill-manager/api/skills                       → { skills }
 *   GET  /skill-manager/api/skills/:name/body            → { content }
 *   PUT  /skill-manager/api/skills/:name/invocation      → { skill }
 *        body: { modelInvocable?, userInvocable? }
 *
 * Reads ride the public `ctx.skills` read API (snapshot + get). Writes accept
 * only a skill NAME from the client; the target path is resolved server-side
 * from `ctx.skills.get(name).path`, so a client can never direct a write to an
 * arbitrary location. Everything is a pure catalog/browse/edit surface — no
 * skill content is created, deleted, or moved here.
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "dsh-skill-manager";
export declare const inject: string[];
/**
 * Plugin body: register the loopback-fenced API routes. Disposal of the
 * returned effect unregisters them (HMR-safe).
 * @param ctx - a context with `skills` and `webServer` ready.
 */
export declare function apply(ctx: Context): void;
