import { hostedFunction } from "./hosted-function-client";
import { whoAmI as whoAmIDirect, holdRecordForEdit as holdRecordForEditDirect, resumeRecordEdit as resumeRecordEditDirect, withdrawRecordEdit as withdrawRecordEditDirect, logRecordEdit as logRecordEditDirect, getRecordEdits as getRecordEditsDirect, getRecentRecordEdits as getRecentRecordEditsDirect } from "./record-edits.functions";
export const whoAmI = hostedFunction("record-edits.whoAmI", whoAmIDirect);
export const holdRecordForEdit = hostedFunction("record-edits.holdRecordForEdit", holdRecordForEditDirect);
export const resumeRecordEdit = hostedFunction("record-edits.resumeRecordEdit", resumeRecordEditDirect);
export const withdrawRecordEdit = hostedFunction("record-edits.withdrawRecordEdit", withdrawRecordEditDirect);
export const logRecordEdit = hostedFunction("record-edits.logRecordEdit", logRecordEditDirect);
export const getRecordEdits = hostedFunction("record-edits.getRecordEdits", getRecordEditsDirect);
export const getRecentRecordEdits = hostedFunction("record-edits.getRecentRecordEdits", getRecentRecordEditsDirect);
