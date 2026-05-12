export type ValidationStatus = 'pass' | 'warnings' | 'issues';
export type ItemStatus = 'pass' | 'warn' | 'fail';

export interface ValidationItem {
  category: string;
  status: ItemStatus;
  title: string;
  description: string;
}

export interface ValidationResponse {
  overallStatus: ValidationStatus;
  items: ValidationItem[];
  summary: string;
}
