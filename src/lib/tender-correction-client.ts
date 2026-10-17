import { hostedFunction } from "./hosted-function-client";
import { correctSaleTender as correctSaleTenderDirect } from "./tender-correction.functions";
export const correctSaleTender = hostedFunction("tender-correction.correctSaleTender", correctSaleTenderDirect);
