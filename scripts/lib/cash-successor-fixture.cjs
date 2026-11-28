// Synthetic protocol data only. No saved settings, credentials or business rows.
const { randomUUID, createHash } = require('node:crypto');
const { loadRegistry } = require('../../electron/db/schema-registry.cjs');
const { parseMixedCashGroup } = require('../../electron/sync/grouped-cash-receipt.cjs');
const { parseFinancialCorrection } = require('../../electron/sync/grouped-financial-corrections.cjs');
const hash = text => createHash('sha256').update(text).digest('hex');
function cashSuccessorFixture(kind='refund_v1') {
  const registry=loadRegistry(),branch='A',epoch=randomUUID(),origin=randomUUID(),terminal=randomUUID(),shift=randomUUID(),product=randomUUID();
  const stamp='2026-11-18T00:00:00.1234567Z',later='2026-11-18T00:01:00.1234567Z';
  const saleId=randomUUID(),itemId=randomUUID(),tenderId=randomUUID(),movementId=randomUUID(),refundMovement=randomUUID();
  const sale={id:saleId,bill_number:'OWNED-'+saleId,client_transaction_id:randomUUID(),store_id:branch,branch_id:branch,shift_id:shift,
    subtotal_amount:'10.000000000000',total_amount:'10.000000000000',discount_amount:'0.000000000000',tax_amount:'0.000000000000',
    payment_type:'cash',payments:[{id:tenderId,method:'cash',amount:'10.000000000000'}],points_earned:'0.000000000000',points_redeemed:'0.000000000000',
    is_exchange:false,is_refunded:false,created_at:stamp,paid_amount:'10.000000000000',change_amount:'0.000000000000',exchange_credit:'0.000000000000',
    coupon_discount:'0.000000000000',rounding_adjustment:'0.0000',row_version:'1'};
  const item={id:itemId,sale_id:saleId,branch_id:branch,product_id:product,product_name:'Owned fixture',quantity:1,unit_price:'10.000000000000',
    discount_percent:'0.000000000000',discount_amount:'0.000000000000',tax_rate:'0.000000000000',is_return:false,is_foc:false,created_at:stamp,
    coupon_discount:'0.000000000000',unit_cost:'2.000000000000',row_version:'1',refunded_qty:0};
  const tender={id:tenderId,source_type:'sale',sale_id:saleId,store_id:branch,shift_id:shift,terminal_id:origin,amount:'10.000000000000',method:'cash',kind:'payment',
    note:'',paid_at:stamp,created_at:stamp,updated_at:stamp,row_version:'1',status:'completed',metadata:{}};
  const movement={id:movementId,product_id:product,store_id:branch,terminal_id:origin,activity_type:'sale',reference:sale.bill_number,
    quantity_delta:-1,unit_cost:'2.000000000000',note:'',created_at:stamp,row_version:'1'};
  const names=['sales','sale_items','payment_transactions','item_activity_logs'];
  const changes=[sale,item,tender,movement].map((row_data,index)=>({table_name:names[index],entity_id:JSON.stringify({id:row_data.id}),row_version:'1',tombstone:false,row_data}));
  const cashGroup={seq:'1',operation_id:randomUUID(),changes,acceptance:{terminal_id:origin,installation_generation:randomUUID(),database_guid:randomUUID(),checkout_sha256:'a'.repeat(64)}};
  const cash=parseMixedCashGroup(cashGroup,branch,epoch,terminal,registry);
  const full=(name,value)=>Object.fromEntries(registry.tables.find(table=>table.cloudTable===name).columns.map(column=>{
    const field=column.cloudColumn;
    if(Object.hasOwn(value,field))return[field,field==='row_version'?Number(value[field]):value[field]];
    const type=column.sqlServerType;
    return[field,column.nullable?null:type==='bit'?false:type==='int'?0:type.startsWith('decimal')?'0':type==='datetimeoffset(7)'?stamp:type==='uniqueidentifier'?randomUUID():''];
  }));
  const fullSale=full('sales',{...sale,payments:JSON.stringify(sale.payments)}),fullItem=full('sale_items',item),fullTender=full('payment_transactions',{...tender,metadata:'{}'});
  const change=(name,row_data)=>({table_name:name,entity_id:JSON.stringify({[name==='stock_delta_applied'?'movement_id':'id']:row_data[name==='stock_delta_applied'?'movement_id':'id']}),
    row_version:String(name==='stock_delta_applied'?1:row_data.row_version),tombstone:false,row_data});
  let correctionChanges;
  if(kind==='refund_v1'){
    fullSale.is_refunded=true;fullSale.row_version=2;fullItem.refunded_qty=1;fullItem.row_version=2;
    correctionChanges=[change('sales',{id:saleId,store_id:branch,row_version:2,is_refunded:true}),
      change('sale_items',{id:itemId,sale_id:saleId,product_id:product,branch_id:branch,row_version:2,refunded_qty:1}),
      change('stock_delta_applied',{movement_id:refundMovement,item_id:itemId,product_id:product,store_id:branch,delta:1,applied_at:later}),
      change('products',{product_id:product,branch_balance:20,row_version:2})];
    correctionChanges[3].entity_id=JSON.stringify({id:product});
  }else{
    fullSale.payment_type='card';fullSale.row_version=2;fullSale.payments=JSON.stringify([{...sale.payments[0],method:'card'}]);
    fullTender.method='card';fullTender.row_version=2;fullTender.updated_at=later;
    correctionChanges=[change('sales',{id:saleId,store_id:branch,row_version:2,payment_type:'card',payments_count:1}),
      change('payment_transactions',{id:tenderId,sale_id:saleId,store_id:branch,row_version:2,method:'card',updated_at:later})];
  }
  const wire={seq:'2',operation_id:randomUUID(),financial:{kind,sale_id:saleId},changes:correctionChanges};
  const graph={scope_id:branch,epoch,seq:'2',operation_id:wire.operation_id,sale:fullSale,items:[fullItem],tenders:[fullTender]};
  const refresh=()=>{const payload_json=JSON.stringify(graph);wire.receipt_graph={payload_json,payload_sha256:hash(payload_json)};return parseFinancialCorrection(wire,branch);};
  const correction=refresh();
  return{registry,branch,epoch,origin,terminal,shift,product,stamp,later,cashGroup,cash,wire,graph,refresh,correction,hash,
    localRows:{sales:[structuredClone(fullSale)],sale_items:[structuredClone(fullItem)],payment_transactions:[structuredClone(fullTender)],
      item_activity_logs:[{...movement,row_version:1}]}};
}
module.exports={cashSuccessorFixture};
