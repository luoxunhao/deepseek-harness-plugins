window.__ModuleLoader__.load({
	id: "@luoxunhao/dsh-skill-manager",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/locales.ts
		/**
		* Minimal zh/en copy for the skill-manager settings section. Copy follows the
		* DSH i18n system: the client apply attaches the locale service through
		* {@link attachLocale}, and `t()` resolves the active locale from it (the
		* Host-backed preference wins over the raw browser language and switches
		* live). Without an attached service (standalone/test compositions) the
		* browser language is used. The dictionaries are also registered into the
		* DSH locale registry under {@link LOCALE_NS}.
		*/
		/** The zh dictionary (also registered under {@link LOCALE_NS}). */
		const zh = {
			nav: "技能",
			intro: "浏览当前生效的技能目录，并逐个开关技能的调用策略",
			refresh: "刷新",
			loading: "加载中…",
			empty: "没有可用的技能",
			error: "加载失败",
			toggleFailed: "保存失败",
			source: "来源",
			provider: "提供方",
			path: "文件路径",
			readOnly: "只读",
			invocationTitle: "启用",
			invocationDesc: "同时控制模型可调用与用户可调用",
			enabled: "已启用",
			disabled: "已关闭",
			viewBody: "查看正文",
			hideBody: "收起正文",
			bodyLoadFailed: "正文加载失败",
			toggles: "调用策略",
			userTab: "用户级",
			projectTab: "项目级",
			workspace: "工作区",
			selectWorkspace: "选择工作区",
			noWorkspaces: "没有可用的工作区",
			projectEmpty: "当前工作区没有项目级技能"
		};
		/** The en dictionary (key-set-equal to zh, enforced by the type annotation). */
		const en = {
			nav: "Skills",
			intro: "Browse the merged skill catalog and toggle each skill's invocation policy",
			refresh: "Refresh",
			loading: "Loading…",
			empty: "No skills available",
			error: "Failed to load",
			toggleFailed: "Failed to save",
			source: "Source",
			provider: "Provider",
			path: "File path",
			readOnly: "Read-only",
			invocationTitle: "Enable",
			invocationDesc: "Controls both model-invocable and user-invocable",
			enabled: "On",
			disabled: "Off",
			viewBody: "View body",
			hideBody: "Hide body",
			bodyLoadFailed: "Failed to load body",
			toggles: "Invocation policy",
			userTab: "User-level",
			projectTab: "Project-level",
			workspace: "Workspace",
			selectWorkspace: "Select workspace",
			noWorkspaces: "No workspaces available",
			projectEmpty: "This workspace has no project-level skills"
		};
		/**
		* The dictionary namespace this plugin owns in the DSH locale registry.
		*/
		const LOCALE_NS = "skillManager";
		/** The DSH locale service attached by the client apply (absent → browser detection). */
		let localeService;
		/**
		* Attach (or detach, with undefined) the DSH locale service. The section
		* re-renders on locale switches because the shell re-renders the settings
		* panel on a ledger bump; the plain `t()` reads the attached service.
		*/
		function attachLocale(service) {
			localeService = service;
		}
		/** The active locale id ('zh' | 'en'). */
		function activeLocale() {
			return localeService?.getSnapshot().active ?? (typeof navigator !== "undefined" ? navigator.language : "") ?? "en";
		}
		/** Translate a copy key; `{name}` placeholders interpolate from `params`. */
		function t(key, params) {
			let text = (activeLocale().toLowerCase().startsWith("zh") ? zh : en)[key];
			if (params !== void 0) for (const [name, value] of Object.entries(params)) text = text.replaceAll(`{${name}}`, String(value));
			return text;
		}
		//#endregion
		//#region src/client/SkillsSection.tsx
		/**
		* The skill-manager settings section: the merged skill catalog as rows, each
		* expandable to read the skill's instruction body, and each offering a single
		* enable toggle that drives model AND user invocation together (offered only
		* for skills that are toggleable — a disk file this plugin may edit). Reads
		* and writes ride the injected {@link SkillManagerApi} face; the read-only
		* sources (bundled, runtime) render with a 只读 marker and a disabled switch.
		*/
		const card = {
			display: "flex",
			flexDirection: "column",
			gap: "8px"
		};
		const rowCard = {
			border: "1px solid var(--dsw-alias-border-base, #e2e2e8)",
			borderRadius: "10px",
			padding: "10px 12px"
		};
		const rowHeader = {
			display: "flex",
			alignItems: "flex-start",
			justifyContent: "space-between",
			gap: "12px"
		};
		const nameLine = {
			display: "flex",
			alignItems: "center",
			gap: "8px",
			fontWeight: 600
		};
		const badge = {
			fontSize: "11px",
			padding: "1px 7px",
			borderRadius: "999px",
			border: "1px solid var(--dsw-alias-border-base, #e2e2e8)",
			color: "var(--dsw-alias-text-muted, #6b6b76)"
		};
		const readOnlyBadge = {
			...badge,
			color: "#b15c00",
			borderColor: "#e5b16a"
		};
		const desc = {
			margin: "4px 0 0",
			fontSize: "13px",
			color: "var(--dsw-alias-text-muted, #6b6b76)"
		};
		const toggles = {
			display: "flex",
			flexDirection: "column",
			gap: "6px",
			marginTop: "10px",
			borderTop: "1px solid var(--dsw-alias-border-base, #e2e2e8)",
			paddingTop: "10px"
		};
		const toggleRow = {
			display: "flex",
			alignItems: "center",
			gap: "8px",
			fontSize: "13px"
		};
		const toggleLabel = {
			display: "flex",
			flexDirection: "column",
			gap: "1px",
			flex: 1
		};
		const toggleTitle = { fontWeight: 500 };
		const toggleDesc = {
			fontSize: "12px",
			color: "var(--dsw-alias-text-muted, #6b6b76)"
		};
		const meta = {
			fontSize: "12px",
			color: "var(--dsw-alias-text-muted, #6b6b76)",
			wordBreak: "break-all"
		};
		const bodyBox = {
			marginTop: "10px",
			padding: "10px",
			fontSize: "13px",
			lineHeight: 1.55,
			whiteSpace: "pre-wrap",
			fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
			background: "var(--dsw-alias-bg-layer-2, #f5f5f7)",
			borderRadius: "8px",
			maxHeight: "320px",
			overflow: "auto"
		};
		const errorText = {
			color: "#c0392b",
			fontSize: "13px"
		};
		const linkButton = {
			background: "none",
			border: "none",
			padding: "0",
			color: "var(--dsw-accent, #2563eb)",
			cursor: "pointer",
			fontSize: "13px"
		};
		const refreshRow = {
			display: "flex",
			alignItems: "center",
			justifyContent: "space-between"
		};
		const tabs = {
			display: "flex",
			gap: "6px",
			borderBottom: "1px solid var(--dsw-alias-border-base, #e2e2e8)",
			paddingBottom: "6px"
		};
		const tab = {
			background: "none",
			border: "none",
			padding: "4px 10px",
			borderRadius: "8px",
			cursor: "pointer",
			fontSize: "13px",
			color: "var(--dsw-alias-text-muted, #6b6b76)"
		};
		const tabActive = {
			...tab,
			color: "var(--dsw-accent, #2563eb)",
			background: "var(--dsw-accent-soft, rgba(37,99,235,0.12))",
			fontWeight: 600
		};
		const select = {
			padding: "4px 8px",
			borderRadius: "8px",
			border: "1px solid var(--dsw-alias-border-base, #e2e2e8)",
			fontSize: "13px",
			background: "var(--dsw-alias-bg-layer-1, #ffffff)",
			color: "inherit"
		};
		/** One rendered catalog row. */
		function SkillRow({ skill, api, scope, cwd, onChange }) {
			const [expanded, setExpanded] = (0, react.useState)(false);
			const [body, setBody] = (0, react.useState)(null);
			const [bodyError, setBodyError] = (0, react.useState)(null);
			const [pending, setPending] = (0, react.useState)({});
			const toggleBody = (0, react.useCallback)(() => {
				if (expanded) {
					setExpanded(false);
					return;
				}
				setExpanded(true);
				if (body !== null) return;
				setBodyError(null);
				api.getBody(skill.name, scope, cwd).then(setBody).catch((error) => setBodyError(error instanceof Error ? error.message : String(error)));
			}, [
				expanded,
				body,
				api,
				skill.name,
				scope,
				cwd
			]);
			const onToggle = (0, react.useCallback)((enabled) => {
				setPending({ enabled });
				api.setInvocation(skill.name, { enabled }, scope, cwd).then((next) => {
					setPending({});
					onChange(next);
				}).catch(() => {
					setPending({});
					setBodyError(t("toggleFailed"));
				});
			}, [
				api,
				skill.name,
				onChange,
				scope,
				cwd
			]);
			const enabled = skill.modelInvocable && skill.userInvocable;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: rowCard,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: rowHeader,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: nameLine,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: skill.name }),
								skill.toggleable ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: readOnlyBadge,
									children: t("readOnly")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: badge,
									children: skill.source
								})
							]
						}), skill.description !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: desc,
							children: skill.description
						}) : null] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: linkButton,
							onClick: toggleBody,
							children: expanded ? t("hideBody") : t("viewBody")
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: toggles,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: toggleRow,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "checkbox",
									disabled: !skill.toggleable,
									checked: enabled,
									onChange: (e) => onToggle(e.target.checked)
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									style: toggleLabel,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: toggleTitle,
										children: t("invocationTitle")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: toggleDesc,
										children: t("invocationDesc")
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: toggleDesc,
									children: enabled ? t("enabled") : t("disabled")
								})
							]
						})
					}),
					skill.path !== void 0 && skill.toggleable ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						style: {
							...meta,
							margin: "8px 0 0"
						},
						children: [
							t("path"),
							": ",
							skill.path
						]
					}) : null,
					expanded ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: bodyBox,
						children: bodyError !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: errorText,
							children: bodyError
						}) : body ?? t("loading")
					}) : null
				]
			});
		}
		/**
		* The section body: a user/project tab switcher, a workspace dropdown for the
		* project tab, a refresh action, and the skill rows for the active scope.
		*/
		function SkillsSection(props) {
			const { api } = props;
			const [scope, setScope] = (0, react.useState)("user");
			const [workspaces, setWorkspaces] = (0, react.useState)([]);
			const [selectedWsId, setSelectedWsId] = (0, react.useState)(null);
			const [skills, setSkills] = (0, react.useState)(null);
			const [error, setError] = (0, react.useState)(null);
			const [pending, setPending] = (0, react.useState)(false);
			const selectedWs = workspaces.find((ws) => ws.id === selectedWsId);
			const load = (0, react.useCallback)((target, ws) => {
				setError(null);
				setPending(true);
				if (target === "project" && ws === void 0) {
					setSkills([]);
					setPending(false);
					return;
				}
				api.list(target, target === "project" ? ws?.path : void 0).then(setSkills).catch((err) => setError(err instanceof Error ? err.message : String(err))).finally(() => setPending(false));
			}, [api]);
			(0, react.useEffect)(() => {
				api.listWorkspaces().then((list) => {
					setWorkspaces(list);
					if (list.length > 0) setSelectedWsId(list[0].id);
				}).catch(() => setWorkspaces([]));
				load("user");
			}, [api, load]);
			const switchScope = (0, react.useCallback)((next) => {
				setScope(next);
				if (next === "project") load("project", workspaces.find((ws) => ws.id === selectedWsId));
				else load("user");
			}, [
				load,
				workspaces,
				selectedWsId
			]);
			const onWorkspaceChange = (0, react.useCallback)((id) => {
				setSelectedWsId(id);
				load("project", workspaces.find((ws) => ws.id === id));
			}, [load, workspaces]);
			const refresh = (0, react.useCallback)(() => {
				if (scope === "project") load("project", workspaces.find((ws) => ws.id === selectedWsId));
				else load("user");
			}, [
				scope,
				load,
				workspaces,
				selectedWsId
			]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				style: card,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: tabs,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: scope === "user" ? tabActive : tab,
							onClick: () => switchScope("user"),
							children: t("userTab")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: scope === "project" ? tabActive : tab,
							onClick: () => switchScope("project"),
							children: t("projectTab")
						})]
					}),
					scope === "project" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: refreshRow,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							style: {
								...meta,
								display: "flex",
								alignItems: "center",
								gap: "6px"
							},
							children: [t("workspace"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
								style: select,
								value: selectedWsId ?? "",
								onChange: (e) => onWorkspaceChange(e.target.value),
								children: workspaces.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: "",
									children: t("noWorkspaces")
								}) : workspaces.map((ws) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
									value: ws.id,
									children: [
										ws.title,
										" — ",
										ws.path
									]
								}, ws.id))
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: linkButton,
							onClick: refresh,
							children: pending ? t("loading") : t("refresh")
						})]
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: refreshRow,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: meta,
							children: t("intro")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: linkButton,
							onClick: refresh,
							children: pending ? t("loading") : t("refresh")
						})]
					}),
					error !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: errorText,
						children: error
					}) : null,
					skills === null && error === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: meta,
						children: t("loading")
					}) : null,
					skills !== null && skills.length === 0 && error === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: meta,
						children: scope === "project" ? t("projectEmpty") : t("empty")
					}) : null,
					skills === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							display: "flex",
							flexDirection: "column",
							gap: "8px"
						},
						children: skills.map((skill) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SkillRow, {
							skill,
							api,
							scope,
							cwd: scope === "project" ? selectedWs?.path : void 0,
							onChange: (next) => setSkills((prev) => prev?.map((row) => row.name === next.name ? next : row) ?? null)
						}, skill.name))
					})
				]
			});
		}
		//#endregion
		//#region src/client/api.ts
		/** One wire failure. */
		var SkillManagerApiError = class extends Error {
			status;
			constructor(status, message) {
				super(message);
				this.status = status;
			}
		};
		/** Build the query string for a skill scope (cwd only for project scope). */
		function scopeQuery(scope, cwd) {
			const params = new URLSearchParams();
			params.set("scope", scope);
			if (scope === "project" && cwd !== void 0 && cwd !== "") params.set("cwd", cwd);
			const query = params.toString();
			return query === "" ? "" : `?${query}`;
		}
		/** The typed client API face exposed to the section component. */
		function createSkillManagerApi() {
			return {
				/** List the skill catalog for a scope (user, or one workspace's project skills). */
				async list(scope, cwd) {
					const res = await fetch(`/skill-manager/api/skills${scopeQuery(scope, cwd)}`);
					if (!res.ok) throw await apiError("list", res);
					return (await res.json()).skills;
				},
				/** List the host's registered workspaces for the project-level dropdown. */
				async listWorkspaces() {
					const res = await fetch("/skill-manager/api/workspaces");
					if (!res.ok) throw await apiError("listWorkspaces", res);
					return (await res.json()).workspaces;
				},
				/** Read one skill's instruction body for a scope. */
				async getBody(name, scope = "user", cwd) {
					const res = await fetch(`/skill-manager/api/skills/${encodeURIComponent(name)}/body${scopeQuery(scope, cwd)}`);
					if (!res.ok) throw await apiError("getBody", res);
					return (await res.json()).content;
				},
				/** Enable/disable a skill's invocation for a scope (sets model AND user together). */
				async setInvocation(name, patch, scope = "user", cwd) {
					const res = await fetch(`/skill-manager/api/skills/${encodeURIComponent(name)}/invocation${scopeQuery(scope, cwd)}`, {
						method: "PUT",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ enabled: patch.enabled })
					});
					if (!res.ok) throw await apiError("setInvocation", res);
					return (await res.json()).skill;
				}
			};
		}
		async function apiError(method, res) {
			let text = "";
			try {
				text = (await res.json()).error ?? "";
			} catch {
				text = await res.text().catch(() => "");
			}
			const message = text !== "" ? text : `${method}: HTTP ${res.status}`;
			return new SkillManagerApiError(res.status, message);
		}
		//#endregion
		//#region src/client/index.tsx
		/** Required services (cordis fiber inject). */
		const inject = ["slots", "locale"];
		/**
		* Client plugin body.
		* @param ctx - the client cordis context (slots, locale).
		*/
		function apply(ctx) {
			attachLocale(ctx.locale);
			ctx.effect(() => {
				const offZh = ctx.locale.register(LOCALE_NS, "zh", zh);
				const offEn = ctx.locale.register(LOCALE_NS, "en", en);
				return () => {
					offZh();
					offEn();
				};
			}, "dsh-skill-manager: dictionaries");
			const api = createSkillManagerApi();
			const injected = () => ({ api });
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "skill-manager",
				order: 100,
				label: () => t("nav"),
				inject: injected
			}, SkillsSection));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map