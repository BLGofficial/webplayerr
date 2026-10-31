const clamp = (value) => Math.min(1, Math.max(0, Number(value) || 0));

/** Keep decorative video playback separate from the music transport and analyser. */
export function createOrbMotion({
  activeVideo, idleVideo, bootVideo = null, poster, container,
  pageDocument = document,
  motionPreference = matchMedia("(prefers-reduced-motion: reduce)"),
  onChange = () => {},
}) {
  let playing = false;
  let ready = false;
  let failed = false;
  let bass = 0;
  let energy = 0;
  let lastRateUpdate = 0;
  const playVersions = new WeakMap();
  const sources = activeVideo.querySelectorAll("source");
  const lastSource = sources[sources.length - 1];

  const shouldAnimate = () => ready && playing && !failed && !pageDocument.hidden && !motionPreference.matches;

  function resetEffects() {
    bass = 0;
    energy = 0;
    container.style.setProperty("--orb-scale", "1");
    container.style.setProperty("--orb-energy", "0");
    container.style.setProperty("--orb-glow", "16px");
    container.style.setProperty("--orb-brightness", "1");
    container.style.setProperty("--orb-saturation", "1.08");
    activeVideo.playbackRate = 1;
  }

  function showFallback() {
    failed = true;
    activeVideo.hidden = true;
    poster.hidden = false;
    container.classList.add("is-fallback");
    onChange();
  }

  function recoverVideo() {
    if (activeVideo.error) return;
    failed = false;
    activeVideo.hidden = false;
    poster.hidden = true;
    container.classList.remove("is-fallback");
    sync();
  }

  function playWhenAllowed(video, allowed) {
    const version = (playVersions.get(video) || 0) + 1;
    playVersions.set(video, version);
    if (!allowed || (video === activeVideo && failed)) {
      video.pause();
      return;
    }
    try {
      const result = video.play();
      result?.catch((error) => {
        // A pause/new-track request can interrupt an earlier play promise.
        if (playVersions.get(video) !== version || error?.name === "AbortError") return;
        if (video === activeVideo) showFallback();
      });
    } catch {
      if (video === activeVideo) showFallback();
    }
  }

  function sync() {
    const motionAllowed = !pageDocument.hidden && !motionPreference.matches;
    const allowMotion = ready && motionAllowed;
    if (bootVideo) playWhenAllowed(bootVideo, !ready && motionAllowed);
    playWhenAllowed(activeVideo, allowMotion && playing);
    playWhenAllowed(idleVideo, allowMotion && !playing);
    if (!allowMotion || !playing) resetEffects();
    onChange();
  }

  function setEnergy(nextBass, nextEnergy, now = performance.now()) {
    if (!shouldAnimate() || failed) return;
    bass += (clamp(nextBass) - bass) * 0.18;
    energy += (clamp(nextEnergy) - energy) * 0.18;
    container.style.setProperty("--orb-scale", (1 + bass * 0.055).toFixed(4));
    container.style.setProperty("--orb-energy", energy.toFixed(4));
    container.style.setProperty("--orb-glow", `${(16 + energy * 28).toFixed(1)}px`);
    container.style.setProperty("--orb-brightness", (1 + energy * 0.16).toFixed(3));
    container.style.setProperty("--orb-saturation", (1.08 + energy * 0.3).toFixed(3));
    // Rate changes are infrequent and subtle; seeking every frame causes visible stutter.
    if (now - lastRateUpdate >= 240) {
      const rate = Math.round((1 + energy * 0.25) * 100) / 100;
      if (Math.abs(activeVideo.playbackRate - rate) >= 0.03) activeVideo.playbackRate = rate;
      lastRateUpdate = now;
    }
  }

  function reset() {
    activeVideo.currentTime = 0;
    resetEffects();
  }

  activeVideo.addEventListener("error", showFallback);
  lastSource?.addEventListener("error", showFallback);
  activeVideo.addEventListener("loadeddata", recoverVideo);
  pageDocument.addEventListener("visibilitychange", sync);
  motionPreference.addEventListener("change", sync);
  resetEffects();

  return {
    get shouldAnimate() { return shouldAnimate(); },
    setReady(value) { ready = Boolean(value); sync(); },
    setPlaying(value) { playing = Boolean(value); sync(); },
    setEnergy,
    reset,
    dispose() {
      activeVideo.pause();
      idleVideo.pause();
      bootVideo?.pause();
      activeVideo.removeEventListener("error", showFallback);
      lastSource?.removeEventListener("error", showFallback);
      activeVideo.removeEventListener("loadeddata", recoverVideo);
      pageDocument.removeEventListener("visibilitychange", sync);
      motionPreference.removeEventListener("change", sync);
    },
  };
}
