import assert from "node:assert/strict";
import test from "node:test";
import { createOrbMotion } from "../public/orb-motion.js";

class Events extends EventTarget {
  hidden = false;
}
class Media extends Events {
  paused = true;
  playbackRate = 1;
  currentTime = 0;
  hidden = false;
  error = null;
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  querySelectorAll() { return [new Events(), new Events()]; }
}

function setup(t) {
  const activeVideo = new Media();
  const idleVideo = new Media();
  const poster = { hidden: true };
  const values = new Map();
  const classes = new Set();
  const container = { style: { setProperty: (key, value) => values.set(key, value) }, classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) } };
  const pageDocument = new Events();
  const motionPreference = new Events();
  motionPreference.matches = false;
  let changes = 0;
  const motion = createOrbMotion({ activeVideo, idleVideo, poster, container, pageDocument, motionPreference, onChange: () => { changes++; } });
  t.after(() => motion.dispose());
  return { motion, activeVideo, idleVideo, poster, values, classes, pageDocument, motionPreference, changes: () => changes };
}

test("animated orb starts only with playback and returns to the idle loop on pause", (t) => {
  const { motion, activeVideo, idleVideo } = setup(t);
  motion.setReady(true);
  assert.equal(activeVideo.paused, true);
  assert.equal(idleVideo.paused, false);
  motion.setPlaying(true);
  assert.equal(activeVideo.paused, false);
  assert.equal(idleVideo.paused, true);
  assert.equal(motion.shouldAnimate, true);
  motion.setPlaying(false);
  assert.equal(activeVideo.paused, true);
  assert.equal(idleVideo.paused, false);
  assert.equal(motion.shouldAnimate, false);
});

test("audio energy changes motion smoothly within safe limits", (t) => {
  const { motion, activeVideo, values } = setup(t);
  motion.setReady(true);
  motion.setPlaying(true);
  for (let i = 0; i < 30; i++) motion.setEnergy(1, 1, i * 250);
  assert.ok(Number(values.get("--orb-scale")) > 1.05);
  assert.ok(Number(values.get("--orb-scale")) <= 1.055);
  assert.ok(parseFloat(values.get("--orb-glow")) > 43);
  assert.ok(activeVideo.playbackRate >= 1 && activeVideo.playbackRate <= 1.25);
  motion.setPlaying(false);
  assert.equal(values.get("--orb-scale"), "1");
  assert.equal(activeVideo.playbackRate, 1);
});

test("reduced motion and background tabs pause both videos and the analyser", (t) => {
  const { motion, activeVideo, idleVideo, pageDocument, motionPreference } = setup(t);
  motion.setReady(true);
  motion.setPlaying(true);
  motionPreference.matches = true;
  motionPreference.dispatchEvent(new Event("change"));
  assert.equal(activeVideo.paused, true);
  assert.equal(idleVideo.paused, true);
  assert.equal(motion.shouldAnimate, false);
  motionPreference.matches = false;
  motionPreference.dispatchEvent(new Event("change"));
  assert.equal(activeVideo.paused, false);
  pageDocument.hidden = true;
  pageDocument.dispatchEvent(new Event("visibilitychange"));
  assert.equal(activeVideo.paused, true);
  assert.equal(motion.shouldAnimate, false);
  pageDocument.hidden = false;
  pageDocument.dispatchEvent(new Event("visibilitychange"));
  assert.equal(activeVideo.paused, false);
});

test("video failure exposes the supplied artwork as a static fallback", (t) => {
  const { motion, activeVideo, poster, classes } = setup(t);
  motion.setReady(true);
  motion.setPlaying(true);
  activeVideo.error = new Error("Unsupported media");
  activeVideo.dispatchEvent(new Event("error"));
  assert.equal(activeVideo.hidden, true);
  assert.equal(poster.hidden, false);
  assert.ok(classes.has("is-fallback"));
  assert.equal(motion.shouldAnimate, false);
});

test("boot motion stops when the app is ready and respects reduced motion", (t) => {
  const { motion, motionPreference } = setup(t);
  const bootVideo = new Media();
  const bootMotion = createOrbMotion({ activeVideo: new Media(), idleVideo: new Media(), bootVideo, poster: { hidden: true }, container: { style: { setProperty() {} }, classList: { add() {}, remove() {} } }, pageDocument: new Events(), motionPreference });
  t.after(() => bootMotion.dispose());
  bootMotion.setReady(false);
  assert.equal(bootVideo.paused, false);
  bootMotion.setReady(true);
  assert.equal(bootVideo.paused, true);
  bootMotion.setReady(false);
  motionPreference.matches = true;
  motionPreference.dispatchEvent(new Event("change"));
  assert.equal(bootVideo.paused, true);
});

test("stale rejected play promises cannot replace a deliberately paused video", async (t) => {
  const { motion, activeVideo, poster } = setup(t);
  let rejectPlay;
  activeVideo.play = () => { activeVideo.paused = false; return new Promise((_, reject) => { rejectPlay = reject; }); };
  motion.setReady(true);
  motion.setPlaying(true);
  motion.setPlaying(false);
  rejectPlay(Object.assign(new Error("Interrupted"), { name: "AbortError" }));
  await Promise.resolve();
  assert.equal(activeVideo.paused, true);
  assert.equal(poster.hidden, true);
});
