import {z} from 'zod';

// Wire shape only. Importing aggregate schemas must not load server authority
// checks or desktop persistence; those run at their existing admission boundary.
export const refundApprovalEvidenceSchema=z.object({approvalJson:z.string().min(2).max(48*1024),approvalAttestation:z.unknown()}).strict();
export const financialRefundApprovalSchema=z.object({operationJson:z.string().min(2).max(6*1024*1024),attestation:z.unknown(),refundApproval:refundApprovalEvidenceSchema}).strict();
