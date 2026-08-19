import type { ReactNode } from 'react';
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { SkillManagerApi } from './api.ts';
/** Registration-side business face for the section. */
export interface SkillManagerSectionInjected {
    api: SkillManagerApi;
}
/** Full section component props (runtime + owner + injected face). */
export type SkillManagerSectionProps = PropsRuntime<'settings.section'> & InjectFace<SkillManagerSectionInjected>;
/**
 * The section body: catalog header with a manual refresh plus the skill rows.
 */
export declare function SkillsSection(props: SkillManagerSectionProps): ReactNode;
