/** Windows GPU/driver redraws can flash the desktop behind a busy till. Set before app readiness. */
function configureWindowRendering(app, platform = process.platform) {
  if (platform !== "win32") return;
  app.disableHardwareAcceleration();
}
module.exports = { configureWindowRendering };
