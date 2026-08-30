function parseSoakDuration(argv = []) {
  const secondsArg = argv.find((value) => /^--soak-test-seconds=/.test(value));
  const minutesArg = argv.find((value) => /^--soak-test-minutes=/.test(value));
  const seconds = secondsArg ? Number(secondsArg.split("=")[1]) : minutesArg ? Number(minutesArg.split("=")[1]) * 60 : 0;
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.min(24 * 60 * 60 * 1000, Math.max(1000, Math.round(seconds * 1000)));
}

function evaluateSoakReport({ version, packaged, durationMs, startedAt, finishedAt, samples, events, display, speechReady }) {
  const expectedKioskViewport = { width: 1200, height: 1920, contentRotation: 0 };
  const bounds = display?.bounds || {};
  const displayMatched = bounds.width === expectedKioskViewport.width && bounds.height === expectedKioskViewport.height;
  const runtimeStable = events.rendererGone === 0 && events.unresponsive === 0 && events.loadError === 0 && samples.length > 0;
  const maxWorkingSetKb = samples.reduce((maximum, sample) => Math.max(maximum, sample.totalWorkingSetKb || 0), 0);
  return {
    ok: Boolean(runtimeStable && displayMatched && speechReady),
    version,
    packaged,
    startedAt,
    finishedAt,
    requestedDurationMs: durationMs,
    actualDurationMs: Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime()),
    expectedKioskViewport,
    display,
    gates: { runtimeStable, displayMatched, speechReady: Boolean(speechReady) },
    events,
    memory: { sampleCount: samples.length, maxWorkingSetKb, samples },
  };
}

function startSoakMonitor({ app, screen, window, speechReady, durationMs, sampleIntervalMs = 15000, onComplete }) {
  const startedAt = new Date().toISOString();
  const samples = [];
  const events = { rendererGone: 0, unresponsive: 0, loadError: 0 };
  let finished = false;
  let timeout;
  const onRendererGone = () => { events.rendererGone += 1; };
  const onUnresponsive = () => { events.unresponsive += 1; };
  const onLoadError = () => { events.loadError += 1; };
  window.webContents.on("render-process-gone", onRendererGone);
  window.webContents.on("unresponsive", onUnresponsive);
  window.webContents.on("did-fail-load", onLoadError);

  const sample = () => {
    const metrics = app.getAppMetrics();
    samples.push({
      atMs: Date.now(),
      processCount: metrics.length,
      totalWorkingSetKb: metrics.reduce((sum, metric) => sum + (Number(metric?.memory?.workingSetSize) || 0), 0),
    });
  };
  const interval = setInterval(sample, Math.max(1000, sampleIntervalMs));
  sample();

  const cleanup = () => {
    clearInterval(interval);
    clearTimeout(timeout);
    if (!window.isDestroyed()) {
      window.webContents.removeListener("render-process-gone", onRendererGone);
      window.webContents.removeListener("unresponsive", onUnresponsive);
      window.webContents.removeListener("did-fail-load", onLoadError);
    }
  };
  const finish = () => {
    if (finished) return;
    finished = true;
    sample();
    const display = screen.getDisplayMatching(window.getBounds());
    const report = evaluateSoakReport({
      version: app.getVersion(), packaged: app.isPackaged, durationMs, startedAt, finishedAt: new Date().toISOString(),
      samples, events, speechReady, display: display ? { id: display.id, rotation: display.rotation, scaleFactor: display.scaleFactor, bounds: display.bounds, workArea: display.workArea } : null,
    });
    cleanup();
    onComplete(report);
  };
  timeout = setTimeout(finish, durationMs);
  return () => { if (!finished) { finished = true; cleanup(); } };
}

module.exports = { evaluateSoakReport, parseSoakDuration, startSoakMonitor };
