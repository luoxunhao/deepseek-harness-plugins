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
export declare const zh: {
    readonly nav: "技能";
    readonly intro: "浏览当前生效的技能目录，并逐个开关技能的调用策略";
    readonly refresh: "刷新";
    readonly loading: "加载中…";
    readonly empty: "没有可用的技能";
    readonly error: "加载失败";
    readonly toggleFailed: "保存失败";
    readonly source: "来源";
    readonly provider: "提供方";
    readonly path: "文件路径";
    readonly readOnly: "只读";
    readonly invocationTitle: "启用";
    readonly invocationDesc: "同时控制模型可调用与用户可调用";
    readonly enabled: "已启用";
    readonly disabled: "已关闭";
    readonly viewBody: "查看正文";
    readonly hideBody: "收起正文";
    readonly bodyLoadFailed: "正文加载失败";
    readonly toggles: "调用策略";
};
/** The en dictionary (key-set-equal to zh, enforced by the type annotation). */
export declare const en: Record<keyof typeof zh, string>;
/**
 * The dictionary namespace this plugin owns in the DSH locale registry.
 */
export declare const LOCALE_NS = "skillManager";
/**
 * Attach (or detach, with undefined) the DSH locale service. The section
 * re-renders on locale switches because the shell re-renders the settings
 * panel on a ledger bump; the plain `t()` reads the attached service.
 */
export declare function attachLocale(service: {
    getSnapshot(): {
        active: string;
    };
} | undefined): void;
/** Translate a copy key in the active locale (zh → zh, else en). */
export type CopyKey = keyof typeof zh;
/** Translate a copy key; `{name}` placeholders interpolate from `params`. */
export declare function t(key: CopyKey, params?: Record<string, string | number>): string;
