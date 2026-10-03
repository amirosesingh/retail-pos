// Node 24 can surface uv_os_get_passwd ENOMEM on some managed Windows
// terminals even though USERPROFILE and COMSPEC remain available. Capacitor's
// terminal helper only needs these values to identify the shell, so provide a
// narrowly scoped fallback for the native build command.
const os = require("node:os");

try {
  os.userInfo();
} catch (error) {
  if (error?.syscall !== "uv_os_get_passwd") throw error;
  os.userInfo = () => ({
    uid: -1,
    gid: -1,
    username: process.env.USERNAME ?? "",
    homedir: process.env.USERPROFILE ?? os.homedir(),
    shell: process.env.COMSPEC ?? "",
  });
}
