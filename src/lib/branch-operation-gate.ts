import { sameBranchId } from "./branch-id";

/** Keep a monetary operation's branch stable across asynchronous acknowledgements. */
export class BranchOperationGate {
  private operations = new Set<symbol>();
  private switching = false;
  begin(branchId: string, selectedBranchId: string): () => void {
    if (!sameBranchId(branchId, selectedBranchId)) throw new Error("This record belongs to another branch. Select its branch before continuing.");
    if (this.switching) throw new Error("The branch is changing. Please wait before continuing.");
    const token = Symbol();
    this.operations.add(token);
    return () => { this.operations.delete(token); };
  }
  beginSwitch(): () => void {
    if (this.switching || this.operations.size) throw new Error("Finish the current payment before changing branch.");
    this.switching = true;
    return () => { this.switching = false; };
  }
}
