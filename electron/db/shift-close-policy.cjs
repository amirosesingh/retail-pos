/** Ownership is separate from the Close shift grant checked at IPC entry. */
function mayCloseShift({ differentOperator, differentTerminal, isAdmin, canManageOthers, canClose, allowHandover }) {
  return !(differentOperator || differentTerminal) || isAdmin === true || canManageOthers === true || (canClose === true && allowHandover === true);
}
module.exports = { mayCloseShift };
