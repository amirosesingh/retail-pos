import {createServerFn} from '@tanstack/react-start';
import {z} from 'zod';
import {stockHistoryRequestSchema} from './stock-history-validation';
import {stockHistoryMovementRequestSchema} from './stock-history-movements';
import {stockActivityRequestSchema} from './stock-activity-query';
const callerProofSchema=z.object({
 sessionToken:z.string().max(400).optional(),cashierToken:z.string().max(2000).optional(),terminalToken:z.string().max(200).optional(),
 accessToken:z.string().max(4000).optional(),deviceBindingProof:z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();
const inputSchema=callerProofSchema.extend({request:stockHistoryRequestSchema});
const movementInputSchema=callerProofSchema.extend({request:stockHistoryMovementRequestSchema});
const activityInputSchema=callerProofSchema.extend({request:stockActivityRequestSchema});
const openingInputSchema=callerProofSchema.extend({branchId:z.string().min(1).max(128)});
export const loadStockHistoryPageDirect=createServerFn({method:'POST'}).validator((input:unknown)=>inputSchema.parse(input))
 .handler(async({data})=>{
  const {request,...proof}=data;
  return(await import('./stock-history.server')).readStockHistoryPage(proof,request);
 });
export const loadStockHistoryMovementsDirect=createServerFn({method:'POST'}).validator((input:unknown)=>movementInputSchema.parse(input))
 .handler(async({data})=>{
  const {request,...proof}=data;
  return(await import('./stock-history.server')).readStockHistoryMovements(proof,request);
 });
export const loadStockActivityPageDirect=createServerFn({method:'POST'}).validator((input:unknown)=>activityInputSchema.parse(input))
 .handler(async({data})=>{
  const {request,...proof}=data;
  return(await import('./stock-activity.server')).readStockActivityPage(proof,request);
 });
export const recordStockRolloutOpeningDirect=createServerFn({method:'POST'}).validator((input:unknown)=>openingInputSchema.parse(input))
 .handler(async({data})=>{
  const {branchId,...proof}=data;
  return(await import('./stock-history.server')).recordStockRolloutOpening(proof,branchId);
 });
export const readStockRolloutReadinessDirect=createServerFn({method:'POST'}).validator((input:unknown)=>openingInputSchema.parse(input))
 .handler(async({data})=>{
  const {branchId,...proof}=data;
  return(await import('./stock-history.server')).readStockRolloutReadiness(proof,branchId);
 });
