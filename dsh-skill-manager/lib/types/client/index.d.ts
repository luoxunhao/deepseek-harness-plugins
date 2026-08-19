import type { Context } from '@deepseek-ai/cordis';
/** Required services (cordis fiber inject). */
export declare const inject: string[];
/**
 * Client plugin body.
 * @param ctx - the client cordis context (slots, locale).
 */
export declare function apply(ctx: Context): void;
