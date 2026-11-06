import {createElement as h,type ReactNode}from"react";
import{renderToStaticMarkup}from"react-dom/server";
import{expect,it,vi}from"vitest";
vi.mock("recharts",()=>({Tooltip:({content}:{content:(props:unknown)=>ReactNode})=>content({active:true,label:"2026-11-06",payload:[{name:"Revenue",dataKey:"revenue",value:0,color:"#123456"}]})}));
import{ChartPlotScope,TradingChartCard,TradingTooltip}from"@/platforms/web/components/pos/TradingChartLayout";
it("keeps transparent tooltip text and caller formatting, including actual zero values",()=>{
 const html=renderToStaticMarkup(h(TradingTooltip,{formatter:value=>[`B$${Number(value).toFixed(2)}`,"Collected"],labelFormatter:label=>`Business day ${String(label)}`}));
 expect(html).toContain("Business day 2026-11-06");expect(html).toContain("Collected:");expect(html).toContain("B$0.00");
 expect(html).toContain("background:transparent");expect(html).toContain("box-shadow:none");expect(html).toContain("color:var(--foreground)");expect(html).not.toContain('style="color:#123456');
});
it("hides old numeric footers and plots while the requested range is unconfirmed",()=>{
 const html=renderToStaticMarkup(h(ChartPlotScope,{phase:"waiting",stamp:2,children:h(TradingChartCard,{title:"Revenue share",footer:h("p",null,"Old share B$123.00"),children:h("p",null,"Old plot B$456.00")})}));
 expect(html).toContain("Waiting for confirmed graph data");expect(html).not.toContain("B$123.00");expect(html).not.toContain("B$456.00");
});
