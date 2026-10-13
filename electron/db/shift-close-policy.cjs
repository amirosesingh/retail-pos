/** The opener is audit metadata. Cross-terminal closure retains its extra gate. */
function mayCloseShift({ differentTerminal, isAdmin, canManageOthers, canClose, allowHandover }) {
  return isAdmin === true || canManageOthers === true || (canClose === true && (!differentTerminal || allowHandover === true));
}
module.exports = { mayCloseShift };
