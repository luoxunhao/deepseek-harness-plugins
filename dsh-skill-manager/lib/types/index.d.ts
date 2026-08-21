/**
 * dsh-skill-manager — host half.
 *
 * Registers loopback-fenced JSON routes under /skill-manager/api that serve
 * the merged skill catalog and write per-skill invocation policy back to the
 * skill's own frontmatter file:
 *
 *   GET  /skill-manager/api/skills?scope=user|project&cwd=<dir>   → { skills }
 *   GET  /skill-manager/api/workspaces                             → { workspaces }
 *   GET  /skill-manager/api/skills/:name/body?scope=&cwd=          → { content }
 *   PUT  /skill-manager/api/skills/:name/invocation?scope=&cwd=    → { skill }
 *        body: { enabled }
 *   POST /skill-manager/api/skills/import?scope=&cwd=&overwrite=   → { skill }
 *        body: <zip binary>
 *
 * `scope` selects user-level vs one workspace's project-level skills; `cwd`
 * (the workspace directory) is required for project scope and is the only
 * client-supplied path — it is never a write target, only a lookup scope.
 * Reads ride the public `ctx.skills` read API (snapshot + get). Writes accept
 * only a skill NAME from the client; the target path is resolved server-side
 * from `ctx.skills.get(name, { cwd }).path`, so a client can never direct a
 * write to an arbitrary location. Everything is a pure catalog/browse/edit
 * surface — no skill content is created, deleted, or moved here.
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "@luoxunhao/dsh-skill-manager";
export declare const inject: string[];
/**
 * Plugin body: register the loopback-fenced API routes. Disposal of the
 * returned effect unregisters them (HMR-safe).
 * @param ctx - a context with `skills` and `webServer` ready.
 */
export declare function apply(ctx: Context): void;
