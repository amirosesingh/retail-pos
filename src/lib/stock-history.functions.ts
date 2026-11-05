import {createServerFn} from '@tanstack/react-start';
import {z} from 'zod';
import {stockHistoryRequestSchema} from './stock-history-validation';
const inputSchema=z.object({
 sessionToken:z.string().max(400).optional(),cashierToken:z.string().max(2000).optional(),terminalToken:z.string().max(200).optional(),
 accessToken:z.string().max(4000).optional(),deviceBindingProof:z.string().regex(/^[a-f0-9]{64}$/).optional(),
 request:stockHistoryRequestSchema,
}).strict();
export const loadStockHistoryPageDirect=createServerFn({method:'POST'}).validator((input:unknown)=>inputSchema.parse(input))
 .handler(async({data})=>{
  const {request,...proof}=data;
  return(await import('./stock-history.server')).readStockHistoryPage(proof,request);
 });
