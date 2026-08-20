import { readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { isModelInvocable, isSkillName, isUserInvocable } from "@deepseek-ai/dsh-skill";
import { homedir } from "node:os";
//#region src/trust-fence.ts
function header(headers, name) {
	const value = headers[name];
	return typeof value === "string" ? value : void 0;
}
/** Normalized URL of a Host-header authority, or undefined when unparsable. */
function parseAuthority(authority) {
	try {
		return new URL(`http://${authority}`);
	} catch {
		return;
	}
}
/** Whether a normalized URL hostname names the local loopback authority. */
function isLoopbackHostname(hostname) {
	if (hostname === "localhost" || hostname === "[::1]") return true;
	const parts = hostname.split(".");
	return parts.length === 4 && parts[0] === "127" && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}
/** Canonical authority form: hostname, or hostname:port when a port was written. */
function canonicalAuthority(entry, entryUrl) {
	const port = entryUrl.port !== "" ? entryUrl.port : new URL(`https://${entry}`).port;
	return port === "" ? entryUrl.hostname : `${entryUrl.hostname}:${port}`;
}
/** Whether the request authority matches a trustedHosts entry (exact or port-less). */
function isTrustedAuthority(hostUrl, trustedHosts) {
	return trustedHosts.some((entry) => {
		const entryUrl = parseAuthority(entry);
		if (entryUrl === void 0) return false;
		return canonicalAuthority(entry, entryUrl) === entryUrl.hostname ? entryUrl.hostname === hostUrl.hostname : entryUrl.host === hostUrl.host;
	});
}
/**
* Decide whether one skill-manager request may reach the plugin routes.
* @param request - node HTTP request facts (headers).
* @param trustedHosts - non-loopback authorities this deployment serves.
* @returns true when the Host is ours (loopback or trusted) and browser markers are same-origin.
*/
function isTrustedApiRequest(request, trustedHosts) {
	const host = header(request.headers, "host");
	if (host === void 0) return false;
	const hostUrl = parseAuthority(host);
	if (hostUrl === void 0) return false;
	if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false;
	if (header(request.headers, "sec-fetch-site") === "cross-site") return false;
	const origin = header(request.headers, "origin");
	if (origin === void 0) return true;
	try {
		return new URL(origin).host === hostUrl.host;
	} catch {
		return false;
	}
}
//#endregion
//#region src/frontmatter.ts
/** Split a skill file into its frontmatter head, interior lines, and tail. */
function frontmatterSlices(source) {
	const open = /^---(\r?\n)/.exec(source);
	if (open === null) return void 0;
	const eol = open[1];
	const head = open[0];
	const closing = source.indexOf(`${eol}---`, head.length);
	if (closing === -1) return void 0;
	const inner = source.slice(head.length, closing);
	const tail = source.slice(closing);
	return {
		head,
		lines: inner.length === 0 ? [] : inner.split(eol),
		tail,
		eol
	};
}
/**
* Set (or remove, with `value === undefined`) one raw invocation key in a
* skill file's frontmatter. Everything except the affected key's line is
* preserved byte-for-byte (including the file's newline style).
* @param source - the full skill file text.
* @param key - which raw frontmatter key to edit.
* @param value - the boolean to write, or `undefined` to remove the key.
* @returns the rewritten text, or `undefined` when the source has no
*   frontmatter block (callers must not write such files).
*/
function setFrontmatterKey(source, key, value) {
	const block = frontmatterSlices(source);
	if (block === void 0) return void 0;
	const { head, tail, eol } = block;
	const pattern = new RegExp(`^${escapeRegex(key)}\\s*:.*$`);
	const index = block.lines.findIndex((line) => pattern.test(line));
	let lines = block.lines;
	if (value === void 0) {
		if (index !== -1) lines = lines.filter((_, i) => i !== index);
	} else if (index !== -1) lines = lines.map((line, i) => i === index ? `${key}: ${value}` : line);
	else lines = [...lines, `${key}: ${value}`];
	return head + lines.join(eol) + tail;
}
/**
* Apply a partial raw-keyed patch to a skill file: set each provided key,
* leave omitted keys untouched. Fails (returns `undefined`) only when the
* source has no frontmatter block.
*/
function applyFrontmatterPatch(source, patch) {
	let next = source;
	for (const entry of Object.entries(patch)) {
		const [key, value] = entry;
		const out = setFrontmatterKey(next, key, value);
		if (out === void 0) return void 0;
		next = out;
	}
	return next;
}
/**
* Return the instruction body that follows a skill file's frontmatter block
* (the text after the closing `---`), or `undefined` when there is no
* frontmatter. Callers trim as DSH does. Works on both LF and CRLF files.
*/
function stripFrontmatterBody(source) {
	const block = frontmatterSlices(source);
	if (block === void 0) return void 0;
	return block.tail.slice(block.eol.length + 3);
}
/**
* Minimal scalar parser for a skill file's frontmatter. Skill frontmatter is
* flat scalar YAML (`name`, `description`, `whenToUse`, `disable-model-invocation`,
* `user-invocable`); this reads only top-level `key: value` lines and ignores
* nested/indented content. Booleans are normalized from the YAML spellings
* `true`/`false`/`yes`/`no`. Works on both LF and CRLF files.
* @param source - the full skill file text.
* @returns the parsed top-level scalar fields, or `undefined` without a block.
*/
function parseFrontmatterScalars(source) {
	const block = frontmatterSlices(source);
	if (block === void 0) return void 0;
	const out = {};
	for (const line of block.lines) {
		if (line.length === 0 || line.startsWith(" ") || line.startsWith("	")) continue;
		const match = /^([A-Za-z0-9-]+):\s*(.*)$/.exec(line);
		if (match === null) continue;
		const key = match[1];
		const raw = match[2].trim();
		if (/^(true|yes)$/i.test(raw)) out[key] = true;
		else if (/^(false|no)$/i.test(raw)) out[key] = false;
		else if (raw.length > 0) out[key] = raw;
		else out[key] = "";
	}
	return out;
}
function escapeRegex(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
//#endregion
//#region src/user-skills.ts
/**
* User-scope disk skill discovery via node fs.
*
* `ctx.skills` is the canonical merged registry, but in a web profile whose
* host provides a project-scoped `fs` service (e.g. `dsh-codex-project`), the
* skill-filesystem provider reads every root through that `ctx.fs` and a
* project sandbox cannot `resolve()` out-of-project roots such as
* `~/.agents/skills` — so user-scope disk skills vanish from the snapshot.
*
* This module re-reads the two user roots (`~/.agents/skills` and
* `$DSH_HOME/skills`) directly with node fs and parses the same frontmatter
* contract DSH uses (name, description, `disable-model-invocation`,
* `user-invocable`). The catalog merge keeps registry rows authoritative and
* appends only user disk skills the registry did not surface; invocation
* writes fall back to these disk locators when `ctx.skills.get(name)` cannot
* see the skill.
*/
/** The two user-scope roots this module enumerates (source → directory). */
function userSkillRoots() {
	const home = homedir();
	const dshHome = process.env.DSH_HOME ?? join(home, ".dsh");
	return [{
		source: "user-agents",
		path: join(home, ".agents", "skills")
	}, {
		source: "user-dsh",
		path: join(dshHome, "skills")
	}];
}
/** Parse one skill file's text into a disk skill row, or `undefined` if invalid. */
function parseDiskSkillFile(raw, path, source) {
	const data = parseFrontmatterScalars(raw);
	if (data === void 0) return void 0;
	const name = data.name;
	const description = data.description;
	if (typeof name !== "string" || typeof description !== "string") return void 0;
	if (!isSkillName(name)) return void 0;
	return {
		name,
		description,
		whenToUse: typeof data.whenToUse === "string" ? data.whenToUse : void 0,
		source,
		path,
		modelInvocable: data["disable-model-invocation"] !== true,
		userInvocable: data["user-invocable"] !== false
	};
}
/** Enumerate user-scope disk skills across every configured user root. */
async function discoverUserSkills() {
	const out = [];
	for (const root of userSkillRoots()) {
		let entries;
		try {
			entries = await readdir(root.path, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			const name = entry.name;
			let filePath;
			if (entry.isDirectory()) filePath = join(root.path, name, "SKILL.md");
			else if (entry.isFile() && name.endsWith(".md")) filePath = join(root.path, name);
			else continue;
			let raw;
			try {
				raw = await readFile(filePath, "utf8");
			} catch {
				continue;
			}
			const skill = parseDiskSkillFile(raw, filePath, root.source);
			if (skill !== void 0) out.push(skill);
		}
	}
	return out;
}
/** Find one user-scope disk skill by name, or `undefined`. */
async function findDiskSkill(name) {
	return (await discoverUserSkills()).find((skill) => skill.name === name);
}
//#endregion
//#region src/skills.ts
/**
* Skill catalog assembly and per-skill invocation writes over `ctx.skills`.
*
* The registry (`@deepseek-ai/dsh-skill`) owns discovery, merging, and the
* resolved invocation policy; this module only READS the catalog through the
* public read API (snapshot + get) and WRITES back the two frontmatter keys
* at the skill's own discovered disk path. There is no provider/root
* enumeration and no write root configuration: the write target for a skill
* is always `ctx.skills.get(name).path`, so a client can never steer a write
* to an arbitrary location — only the skill name crosses the wire.
*/
/** Skill sources that must never be written by this plugin (no disk file of ours). */
const NON_TOGGLEABLE_SOURCES = ["bundled", "runtime"];
/** A user-facing write failure (skill unknown, not toggleable, no frontmatter). */
var SkillWriteError = class extends Error {
	constructor(message) {
		super(message);
	}
};
/** Whether a skill may be toggled: it has a disk path and is not read-only by source. */
function isToggleable(def) {
	if (def.path === void 0) return false;
	return !NON_TOGGLEABLE_SOURCES.includes(def.source);
}
/** Shape one loaded skill into the UI row. */
function toManagedSkill(def) {
	return {
		name: def.name,
		description: def.description,
		whenToUse: def.whenToUse,
		source: def.source,
		provider: def.provider,
		modelInvocable: isModelInvocable(def),
		userInvocable: isUserInvocable(def),
		toggleable: isToggleable(def),
		path: def.path
	};
}
/** Shape one user-scope disk skill into the UI row (always toggleable). */
function diskToManagedSkill(skill) {
	return {
		name: skill.name,
		description: skill.description,
		whenToUse: skill.whenToUse,
		source: skill.source,
		provider: skill.source,
		modelInvocable: skill.modelInvocable,
		userInvocable: skill.userInvocable,
		toggleable: true,
		path: skill.path
	};
}
/**
* Merge registry rows with user disk rows. Registry rows are authoritative
* (the merged winning candidates); a disk row only fills a name the registry
* did not surface. Result is alphabetically sorted.
*/
function mergeManagedSkills(registry, disk) {
	const byName = new Map(registry.map((row) => [row.name, row]));
	for (const row of disk) if (!byName.has(row.name)) byName.set(row.name, row);
	return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
/**
* Assemble the full merged skill catalog as UI rows. Registry rows (the
* canonical merged snapshot) are authoritative; user-scope disk skills the
* registry cannot surface (project-scoped `ctx.fs` masks them) are appended.
* @param ctx - a context with the `skills` service ready.
* @param discoverDisk - disk-skill enumerator (injectable for tests).
* @returns alphabetically sorted, invocation-resolved skill rows.
*/
async function listManagedSkills(ctx, discoverDisk = discoverUserSkills) {
	const { skills } = await ctx.skills.snapshot();
	const rows = [];
	for (const summary of skills) {
		if (!isSkillName(summary.name)) continue;
		const def = await ctx.skills.get(summary.name);
		if (def === void 0) continue;
		rows.push(toManagedSkill(def));
	}
	return mergeManagedSkills(rows, (await discoverDisk()).map(diskToManagedSkill));
}
/**
* Translate the master enabled flag into the two raw frontmatter keys, always
* writing BOTH keys so model and user invocation stay in sync. The model key
* is negated: enabling writes `disable-model-invocation: false`, disabling
* writes `disable-model-invocation: true`; the user key is positive:
* `user-invocable: true` on enable, `false` on disable.
*/
function toFrontmatterPatch(patch) {
	return {
		"disable-model-invocation": !patch.enabled,
		"user-invocable": patch.enabled
	};
}
/**
* Write one invocation policy change to a skill's own frontmatter file. The
* single {@link InvocationPatch.enabled} flag sets model AND user invocation
* together (both frontmatter keys are always written, in sync).
* @param ctx - a context with the `skills` service ready.
* @param name - the skill to edit (validated against the skill-name grammar).
* @param patch - `{ enabled }`: true → both invocable, false → both disabled.
* @param resolveDisk - user-disk locator (injectable for tests).
* @returns the refreshed skill row after the write.
* @throws {@link SkillWriteError} when the name is invalid, the skill is
*   unknown, not toggleable, or its file carries no frontmatter.
*/
async function setInvocation(ctx, name, patch, resolveDisk = findDiskSkill) {
	if (!isSkillName(name)) throw new SkillWriteError(`invalid skill name: ${name}`);
	const def = await ctx.skills.get(name);
	if (def !== void 0 && isToggleable(def)) {
		const path = def.path;
		const next = applyFrontmatterPatch(await readFile(path, "utf8"), toFrontmatterPatch(patch));
		if (next === void 0) throw new SkillWriteError(`skill file has no frontmatter block: ${path}`);
		await atomicWrite(path, next);
		const updated = await ctx.skills.get(name);
		if (updated === void 0) throw new SkillWriteError(`skill vanished after write: ${name}`);
		return toManagedSkill(updated);
	}
	const disk = await resolveDisk(name);
	if (disk !== void 0) {
		const next = applyFrontmatterPatch(await readFile(disk.path, "utf8"), toFrontmatterPatch(patch));
		if (next === void 0) throw new SkillWriteError(`skill file has no frontmatter block: ${disk.path}`);
		await atomicWrite(disk.path, next);
		const refreshed = parseDiskSkillFile(await readFile(disk.path, "utf8"), disk.path, disk.source);
		if (refreshed === void 0) throw new SkillWriteError(`skill vanished after write: ${name}`);
		return diskToManagedSkill(refreshed);
	}
	if (def === void 0) throw new SkillWriteError(`unknown skill: ${name}`);
	throw new SkillWriteError(`skill is not toggleable: ${name} (source: ${def.source})`);
}
/**
* Read one skill's instruction body. Prefers the registry-loaded definition
* (`ctx.skills.get`); when the registry cannot surface a user-scope disk skill
* (a project `fs` masks the user roots), falls back to reading the skill file
* directly and stripping its frontmatter. The body is trimmed as DSH trims.
* @param ctx - a context with the `skills` service ready.
* @param name - the skill to read.
* @param resolveDisk - user-disk locator (injectable for tests).
* @returns the skill body, or `undefined` when the skill is unknown.
*/
async function getSkillBody(ctx, name, resolveDisk = findDiskSkill) {
	if (!isSkillName(name)) return void 0;
	const def = await ctx.skills.get(name);
	if (def !== void 0) return def.content;
	const disk = await resolveDisk(name);
	if (disk === void 0) return void 0;
	return stripFrontmatterBody(await readFile(disk.path, "utf8"))?.trim();
}
/**
* Atomic replace: write a sibling temp file, then rename over the target. On
* Windows a rename over an existing target can transiently fail with EPERM
* when the target is momentarily held (real-time AV scanning, a brief watcher
* handle); a few retries absorb that, and a final EPERM falls back to an
* in-place overwrite, which Windows tolerates for an existing file. The target
* is a tiny markdown file and DSH's watcher uses awaitWriteFinish, so the
* in-place fallback cannot be mistaken for a partial write.
*/
async function atomicWrite(path, content) {
	const tmp = join(dirname(path), `.${basename(path)}.skill-manager-${process.pid}-${randomBytes(4).toString("hex")}.tmp`);
	await writeFile(tmp, content, "utf8");
	for (let attempt = 0; attempt < 3; attempt += 1) try {
		await rename(tmp, path);
		return;
	} catch (error) {
		const code = error?.code;
		if (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY") throw error;
		if (attempt === 2) {
			await writeFile(path, content, "utf8");
			await rm(tmp, { force: true });
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 60));
	}
}
//#endregion
//#region src/index.ts
const name = "dsh-skill-manager";
const inject = ["skills", "webServer"];
const API_PREFIX = "/skill-manager/api";
/** Routes that can never be read-only browse targets of a trusted host. */
const TRUSTED_HOSTS = [];
/** Handle every /skill-manager/api request: fence, route, respond. */
async function handleApi(ctx, req, res) {
	if (!isTrustedApiRequest(req, TRUSTED_HOSTS)) {
		sendJson(res, 403, { error: "forbidden" });
		return;
	}
	const path = new URL(req.url ?? "/", "http://local").pathname;
	try {
		if (req.method === "GET" && path === `${API_PREFIX}/skills`) {
			sendJson(res, 200, { skills: await listManagedSkills(ctx) });
			return;
		}
		const bodyMatch = /^\/skill-manager\/api\/skills\/([^/]+)\/body$/.exec(path);
		if (req.method === "GET" && bodyMatch) {
			const name = decodeURIComponent(bodyMatch[1] ?? "");
			const content = await getSkillBody(ctx, name);
			if (content === void 0) {
				sendJson(res, 404, { error: `unknown skill: ${name}` });
				return;
			}
			sendJson(res, 200, { content });
			return;
		}
		const toggleMatch = /^\/skill-manager\/api\/skills\/([^/]+)\/invocation$/.exec(path);
		if (req.method === "PUT" && toggleMatch) {
			const name = decodeURIComponent(toggleMatch[1] ?? "");
			const body = await readJson(req);
			const enabled = typeof body?.enabled === "boolean" ? body.enabled : void 0;
			if (enabled === void 0) {
				sendJson(res, 400, { error: "missing enabled boolean" });
				return;
			}
			sendJson(res, 200, { skill: await setInvocation(ctx, name, { enabled }) });
			return;
		}
		sendJson(res, 404, { error: "not found" });
	} catch (error) {
		if (error instanceof SkillWriteError) {
			sendJson(res, 400, { error: error.message });
			return;
		}
		ctx.logger.warn(`[dsh-skill-manager] route error: ${error instanceof Error ? error.stack : String(error)}`);
		sendJson(res, 500, {
			error: "internal error",
			detail: error instanceof Error ? error.message : String(error)
		});
	}
}
function sendJson(res, status, body) {
	res.writeHead(status, { "content-type": "application/json" });
	res.end(JSON.stringify(body));
}
async function readJson(req) {
	const chunks = [];
	for await (const chunk of req) chunks.push(chunk);
	const text = Buffer.concat(chunks).toString("utf8");
	if (text.length === 0) return void 0;
	try {
		return JSON.parse(text);
	} catch {
		return;
	}
}
/**
* Plugin body: register the loopback-fenced API routes. Disposal of the
* returned effect unregisters them (HMR-safe).
* @param ctx - a context with `skills` and `webServer` ready.
*/
function apply(ctx) {
	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: API_PREFIX,
		handler: (req, res) => handleApi(ctx, req, res)
	}), "dsh-skill-manager: api routes");
}
//#endregion
export { apply, inject, name };
