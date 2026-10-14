/* First-party renderer; models are data. Runs inside a sandboxed opaque-origin frame. */
(async () => {
  const send = (type, extra = {}) => parent.postMessage({type: `tokenbird:live2d:${type}`, ...extra}, '*');
  let app;
  let model;
  try {
    const settings = JSON.parse(document.getElementById('model-data').textContent);
    PIXI.live2d.config.idleMotionGroup = 'idle';
    app = new PIXI.Application({view: document.querySelector('canvas'), width: innerWidth, height: innerHeight, backgroundAlpha: 0, antialias: true, resolution: Math.min(devicePixelRatio || 1, 2), autoDensity: true});
    app.ticker.maxFPS = 30;
    model = await PIXI.live2d.Live2DModel.from(settings, {autoInteract: false, autoUpdate: true});
    app.stage.addChild(model);
    const fit = () => {
      app.renderer.resize(innerWidth, innerHeight);
      model.scale.set(1);
      const scale = Math.min(innerWidth / model.width, innerHeight / model.height) * .96;
      model.scale.set(scale);
      model.x = (innerWidth - model.width) / 2;
      model.y = innerHeight - model.height;
    };
    fit();
    addEventListener('resize', fit);
    addEventListener('message', (event) => {
      if (event.source !== parent) return;
      if (event.data?.type === 'tokenbird:live2d:pause') {
        event.data.paused ? app.stop() : app.start();
      }
    });
    // Render before announcing readiness, so the parent can retain its fallback.
    app.renderer.render(app.stage);
    send('ready', {width: model.width, height: model.height});
    app.view.addEventListener('webglcontextlost', () => send('error', {message: 'WebGL context lost'}));
  } catch (error) {
    if (app) app.destroy(false, {children: true, texture: true, baseTexture: true});
    send('error', {message: String(error?.message || error)});
  }
  addEventListener('pagehide', () => { if (app && !app.destroyed) app.destroy(false, {children: true, texture: true, baseTexture: true}); }, {once: true});
})();
