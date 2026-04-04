import type { AnalyzeCvRequest, AnalyzeCvResult, AnalyzeCvSection } from '@advance-academy/contracts/cv-optimizer';
import type { JobStatusResponse } from '@advance-academy/contracts/jobs';

export type AnalyzeCvDto = AnalyzeCvRequest;
export type AnalyzeCvSectionDto = AnalyzeCvSection;
export type AnalyzeCvResultDto = AnalyzeCvResult;
export type AnalyzeCvJobDto = JobStatusResponse<AnalyzeCvResultDto>;
