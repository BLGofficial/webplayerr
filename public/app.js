import { createOrbMotion } from "./orb-motion.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const ui = {
  shell: $("#appShell"),
  loader: $("#bootScreen"),
  hero: $(".hero"),
  tracks: $("#trackList"),
  empty: $("#emptyState"),
  audio: $("#audio"),
  player: $("#playerDock"),
  idleOrb: $("#idleOrb"),
  activeOrb: $("#activeOrb"),
  activeOrbVideo: $("#activeOrbVideo"),
  activeOrbPoster: $("#activeOrbPoster"),
  canvas: $("#visualizerCanvas"),
  dialog: $("#connectDialog"),
  toast: $("#toast"),
};

const state = {
  tracks: [],
  currentIndex: -1,
  playing: false,
  filter: "all",
  query: "",
  connected: false,
  googleConfigured: false,
  source: "seed",
  audioContext: null,
  analyser: null,
  audioSource: null,
  frequencyData: null,
  animationFrame: 0,
  toastTimer: 0,
  installPrompt: null,
  seekDragging: false,
  favorites: readFavorites(),
};

const orbMotion = createOrbMotion({
  activeVideo: ui.activeOrbVideo,
  idleVideo: ui.idleOrb,
  bootVideo: $(".boot-orb"),
  poster: ui.activeOrbPoster,
  container: ui.activeOrb,
  onChange: scheduleVisualizer,
});
orbMotion.setReady(false);

function readFavorites() {
  try { return new Set(JSON.parse(localStorage.getItem("xyp3rn-favorites") || "[]")); }
  catch { return new Set(); }
}

function writeFavorites() {
  try { localStorage.setItem("xyp3rn-favorites", JSON.stringify([...state.favorites])); }
  catch { /* Local storage can be disabled; the player remains usable. */ }
}

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}` : `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function formatSize(bytes = 0) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatTag(track) {
  return track.mime_type === "audio/mpeg" || /\.mp3$/i.test(track.source_filename || "") ? "MP3" : "WAV";
}

function qualityLabel(track) {
  if (track.mime_type === "audio/mpeg" || track.codec === "mp3") return `${Math.round((track.bit_rate_bps || 0) / 1000)} KBPS`;
  if (track.codec === "pcm_f32le") return "32-BIT FLOAT";
  return `${track.bit_depth || "—"}-BIT PCM`;
}

function displaySubline(track) {
  const channels = track.channels === 2 ? "STEREO" : `${track.channels || "?"} CH`;
  return `${formatTag(track)} · ${track.sample_rate_hz ? `${Math.round(track.sample_rate_hz / 1000)} KHZ` : "AUDIO"} · ${channels}`;
}

async function loadCatalog() {
  try {
    const response = await fetch("/api/tracks", { headers: { Accept: "application/json" }, cache: "no-store" });
    if (response.status === 401) {
      state.tracks = [];
      state.source = "private";
      return;
    }
    if (!response.ok) throw new Error(`catalog ${response.status}`);
    const payload = await response.json();
    if (Array.isArray(payload.tracks) && payload.tracks.length) {
      state.tracks = payload.tracks;
      state.source = payload.source || "supabase";
      return;
    }
  } catch {
    state.tracks = [];
    state.source = "unavailable";
  }
}

async function loadRuntimeStatus() {
  try {
    const [configResponse, authResponse] = await Promise.all([
      fetch("/api/config", { cache: "no-store" }),
      fetch("/api/auth/status", { cache: "no-store" }),
    ]);
    if (configResponse.ok) {
      const config = await configResponse.json();
      state.googleConfigured = Boolean(config.googleConfigured);
    }
    if (authResponse.ok) {
      const auth = await authResponse.json();
      state.connected = Boolean(auth.connected);
    }
  } catch { /* Offline and static preview modes remain supported. */ }
  updateConnectionUI();
}

function updateConnectionUI() {
  const button = $("#driveButton");
  const sideButton = $("#sidebarConnect");
  button.classList.toggle("is-connected", state.connected);
  sideButton.classList.toggle("is-connected", state.connected);
  $("#driveButtonLabel").textContent = state.connected ? "Drive connected" : "Connect Drive";
  $("#driveDot").style.background = state.connected ? "#66d6a0" : "#555";
  $("#sidebarDriveDot").style.background = state.connected ? "#66d6a0" : "#555";
  $("#catalogStatus").textContent = state.source === "supabase" ? "SUPABASE CATALOG" : state.source === "private" ? "PRIVATE / CONNECT DRIVE" : state.source === "unavailable" ? "CATALOG OFFLINE" : "LOCAL CATALOG PREVIEW";
}

function visibleTracks() {
  const query = state.query.trim().toLowerCase();
  return state.tracks
    .map((track, index) => ({ track, index }))
    .filter(({ track }) => {
      const title = `${track.track_title || ""} ${track.source_filename || ""} ${track.artist || ""}`.toLowerCase();
      const typeMatch = state.filter === "all" || formatTag(track).toLowerCase() === state.filter;
      return typeMatch && (!query || title.includes(query));
    });
}

function renderCatalog() {
  const entries = visibleTracks();
  ui.tracks.innerHTML = entries.map(({ track, index }) => {
    const title = track.track_title || track.source_filename || "Untitled audio";
    const playing = state.playing && state.currentIndex === index;
    const selected = state.currentIndex === index;
    const number = String(index + 1).padStart(2, "0");
    return `<article class="track-row${selected ? " is-current" : ""}" data-index="${index}">
      <div class="track-main">
        <button class="track-play" type="button" data-play-index="${index}" aria-label="${playing ? "Pause" : "Play"} ${escapeHTML(title)}" title="${playing ? "Pause" : "Play"}">
          ${playing ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14" /></svg>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 4.8 12.5 7.2L7 19.2z" /></svg>'}
        </button>
        <div class="track-copy"><strong class="track-title" title="${escapeHTML(title)}">${escapeHTML(title)}</strong><span class="track-subtitle">${escapeHTML(track.artist || "XYP3RN AUDIO ARCHIVE")} · ${escapeHTML(number)}</span></div>
      </div>
      <span class="format-tag">${formatTag(track)}</span>
      <span class="quality-text">${qualityLabel(track)}</span>
      <span class="duration-text">${formatTime(Number(track.duration_seconds))}</span>
      <button class="row-menu" type="button" data-info-index="${index}" aria-label="Track details for ${escapeHTML(title)}" title="Track details">···</button>
    </article>`;
  }).join("");
  ui.empty.hidden = entries.length > 0;
  if (!entries.length && state.source === "private") {
    ui.empty.innerHTML = '<span class="empty-symbol">◌</span><strong>Your library is private</strong><span>Connect the Google Drive account that owns this archive.</span><button class="empty-connect" id="emptyConnectButton" type="button">Connect Drive <span>→</span></button>';
  } else if (!entries.length && state.source === "unavailable") {
    ui.empty.innerHTML = '<span class="empty-symbol">◌</span><strong>Catalog unavailable</strong><span>Check the app server and Supabase configuration.</span>';
  } else if (!entries.length) {
    ui.empty.innerHTML = '<span class="empty-symbol">∅</span><strong>No tracks found</strong><span>Try another title or clear the format filter.</span>';
  }
  const count = String(state.tracks.length).padStart(2, "0");
  $("#libraryCount").textContent = count;
  $("#sidebarTrackCount").innerHTML = `${count} <small>tracks</small>`;
  $("#navQueueCount").textContent = count;
  $("#queueCount").textContent = `${count} TRACK${state.tracks.length === 1 ? "" : "S"}`;
  const totalDuration = state.tracks.reduce((sum, item) => sum + Number(item.duration_seconds || 0), 0);
  $("#queueDuration").textContent = `~ ${formatTime(totalDuration)}`;
  renderQueue();
}

function renderQueue() {
  const current = currentTrack();
  $("#queueCurrentTitle").textContent = current?.track_title || "Choose a track";
  $("#queueCurrentSub").textContent = current ? `${formatTag(current)} · ${qualityLabel(current)}` : "XYP3RN MUSIC";
  $("#queueLive").classList.toggle("is-playing", state.playing);
  const upcoming = state.tracks.filter((_, index) => index !== state.currentIndex).slice(0, 6);
  $("#queueList").innerHTML = upcoming.map((track) => {
    const index = state.tracks.indexOf(track);
    return `<button class="queue-item${index === state.currentIndex ? " is-current" : ""}" data-queue-index="${index}" type="button">
      <span class="queue-number">${String(index + 1).padStart(2, "0")}</span>
      <span class="queue-title">${escapeHTML(track.track_title || track.source_filename)}</span>
      <span class="queue-time">${formatTime(Number(track.duration_seconds))}</span>
    </button>`;
  }).join("");
}

function currentTrack() { return state.tracks[state.currentIndex] || null; }

function setCurrentTrack(index) {
  state.currentIndex = index;
  const track = currentTrack();
  if (!track) return;
  const title = track.track_title || track.source_filename || "Untitled audio";
  $("#heroTrackTitle").textContent = title;
  $("#heroTrackMeta").textContent = `${formatTag(track)} · ${qualityLabel(track)}`;
  $("#queueCurrentTitle").textContent = title;
  $("#queueCurrentSub").textContent = displaySubline(track);
  $("#playerTitle").textContent = title;
  $("#playerArtist").textContent = track.artist || "XYP3RN AUDIO ARCHIVE";
  $("#qualityChip").textContent = qualityLabel(track);
  $("#durationTime").textContent = formatTime(Number(track.duration_seconds));
  $("#currentTime").textContent = "00:00";
  $("#seekBar").value = "0";
  updateSeekPaint();
  const like = $("#likeButton");
  like.classList.toggle("is-liked", state.favorites.has(track.drive_file_id));
  like.setAttribute("aria-pressed", String(state.favorites.has(track.drive_file_id)));
  renderCatalog();
}

function setupAudioGraph() {
  if (state.analyser || !window.AudioContext) return;
  try {
    state.audioContext = new AudioContext();
    state.analyser = state.audioContext.createAnalyser();
    state.analyser.fftSize = 1024;
    state.analyser.smoothingTimeConstant = 0.82;
    state.frequencyData = new Uint8Array(state.analyser.frequencyBinCount);
    state.audioSource = state.audioContext.createMediaElementSource(ui.audio);
    state.audioSource.connect(state.analyser);
    state.analyser.connect(state.audioContext.destination);
  } catch { state.analyser = null; }
}

function sizeCanvas() {
  const canvas = ui.canvas;
  const bounds = canvas.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const width = Math.round(bounds.width * dpr);
  const height = Math.round(bounds.height * dpr);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function scheduleVisualizer() {
  cancelAnimationFrame(state.animationFrame);
  state.animationFrame = 0;
  if (orbMotion.shouldAnimate && state.analyser) {
    state.animationFrame = requestAnimationFrame(drawVisualizer);
  } else {
    ui.canvas.getContext("2d")?.clearRect(0, 0, ui.canvas.width, ui.canvas.height);
  }
}

function drawVisualizer() {
  if (!orbMotion.shouldAnimate || !state.analyser) return;
  sizeCanvas();
  const canvas = ui.canvas;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  state.analyser.getByteFrequencyData(state.frequencyData);
  let bass = 0;
  let energy = 0;
  const count = Math.min(48, state.frequencyData.length);
  for (let i = 0; i < count; i++) { bass += state.frequencyData[i]; }
  for (let i = 0; i < state.frequencyData.length; i++) { energy += state.frequencyData[i]; }
  bass = bass / Math.max(1, count) / 255;
  energy = energy / Math.max(1, state.frequencyData.length) / 255;
  ctx.clearRect(0, 0, w, h);
  const cx = w * .5;
  const cy = h * .5;
  const radius = Math.min(w, h) * (.285 + bass * .018);

  const halo = ctx.createRadialGradient(cx, cy, radius * .56, cx, cy, radius * 1.36);
  halo.addColorStop(0, `rgba(89, 87, 218, ${.055 + energy * .12})`);
  halo.addColorStop(.58, `rgba(52, 218, 243, ${.018 + bass * .045})`);
  halo.addColorStop(1, "rgba(68, 61, 164, 0)");
  ctx.fillStyle = halo;
  ctx.beginPath(); ctx.arc(cx, cy, radius * 1.4, 0, Math.PI * 2); ctx.fill();

  for (let layer = 0; layer < 5; layer++) {
    const phase = performance.now() * .00022 + layer * .26;
    ctx.beginPath();
    const points = 160;
    for (let i = 0; i <= points; i++) {
      const a = i / points * Math.PI * 2;
      const bin = (i * 3 + layer * 19) % state.frequencyData.length;
      const amp = state.frequencyData[bin] / 255;
      const ripple = Math.sin(a * (5 + layer) + phase) * (3 + layer * 1.5) + amp * (10 + layer * 5);
      const r = radius * (.72 + layer * .075) + ripple * dpr;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r * .76;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    const gradient = ctx.createLinearGradient(cx - radius, cy, cx + radius, cy);
    gradient.addColorStop(0, `rgba(133, 112, 255, ${.12 + layer * .025})`);
    gradient.addColorStop(.48, `rgba(88, 237, 255, ${.18 + bass * .2})`);
    gradient.addColorStop(1, `rgba(185, 120, 255, ${.12 + layer * .025})`);
    ctx.strokeStyle = gradient;
    ctx.lineWidth = (1.05 - layer * .1) * dpr;
    ctx.shadowColor = "rgba(115, 183, 255, .7)";
    ctx.shadowBlur = (5 + bass * 8) * dpr;
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  orbMotion.setEnergy(bass, energy, performance.now());
  state.animationFrame = requestAnimationFrame(drawVisualizer);
}

function setVisualState(playing) {
  state.playing = playing;
  ui.hero.classList.toggle("is-playing", playing);
  ui.player.classList.toggle("is-playing", playing);
  orbMotion.setPlaying(playing);
  $("#heroStateText").textContent = playing ? "LIVE / AUDIO REACTIVE" : "SYSTEM READY";
  $("#orbCaption").innerHTML = playing ? "<i></i> LIVE SIGNAL / VIOLET" : "<i></i> STANDBY / GOLD";
  $("#playButton").setAttribute("aria-label", playing ? "Pause" : "Play");
  $("#playButton").title = playing ? "Pause" : "Play";
  renderCatalog();
  if (playing) {
    setupAudioGraph();
    if (state.audioContext?.state === "suspended") state.audioContext.resume().catch(() => {});
  }
  scheduleVisualizer();
}

function updateSeekPaint() {
  const range = $("#seekBar");
  const percent = Number(range.max) ? (Number(range.value) / Number(range.max)) * 100 : 0;
  range.style.setProperty("--progress", `${percent}%`);
}

async function startTrack(index, { resume = false } = {}) {
  const track = state.tracks[index];
  if (!track) return;
  if (state.currentIndex === index && state.playing && !resume) { ui.audio.pause(); return; }
  if (!state.connected) {
    setCurrentTrack(index);
    openConnectDialog();
    showToast(state.googleConfigured ? "Connect Google Drive to stream this private file." : "Add Google OAuth settings to enable private Drive playback.");
    return;
  }
  const sameTrack = state.currentIndex === index && ui.audio.src;
  if (!sameTrack || !resume) {
    setCurrentTrack(index);
    ui.audio.src = `/api/drive/${encodeURIComponent(track.drive_file_id)}`;
    ui.audio.load();
  }
  try {
    await ui.audio.play();
  } catch (error) {
    setVisualState(false);
    showToast(error?.name === "NotAllowedError" ? "Tap play again to allow audio playback." : "Drive could not stream this file. Check the connection and try again.");
  }
}

function togglePlayback() {
  if (!currentTrack()) {
    if (state.tracks.length) startTrack(0);
    return;
  }
  if (state.playing) {
    ui.audio.pause();
    return;
  }
  if (ui.audio.src && ui.audio.currentTime > 0 && !ui.audio.ended) startTrack(state.currentIndex, { resume: true });
  else startTrack(state.currentIndex);
}

function stopPlayback() {
  ui.audio.pause();
  try { ui.audio.currentTime = 0; } catch { /* Metadata may not have loaded yet. */ }
  orbMotion.reset();
  setVisualState(false);
  $("#currentTime").textContent = "00:00";
  $("#seekBar").value = "0";
  updateSeekPaint();
}

function nextTrack(direction = 1) {
  if (!state.tracks.length) return;
  const next = state.currentIndex < 0 ? 0 : (state.currentIndex + direction + state.tracks.length) % state.tracks.length;
  startTrack(next);
}

function showToast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add("is-visible");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => ui.toast.classList.remove("is-visible"), 3600);
}

function openConnectDialog() {
  $("#dialogSetupNote").hidden = state.googleConfigured;
  $("#dialogCopy").textContent = state.googleConfigured
    ? "Sign in to Google to stream the private tracks in your XYP3RN archive. Your audio stays in Drive; playback uses an authenticated, server-side stream."
    : "The library is connected to its catalog, but private playback needs your Google OAuth web client settings and server credentials. The setup guide shows each value and callback URL.";
  const link = $("#googleConnectLink");
  link.style.opacity = state.googleConfigured ? "1" : ".45";
  link.style.pointerEvents = state.googleConfigured ? "auto" : "none";
  link.setAttribute("aria-disabled", String(!state.googleConfigured));
  if (!ui.dialog.open) ui.dialog.showModal();
}

function renderTrackInfo(index) {
  const track = state.tracks[index];
  if (!track) return;
  showToast(`${track.track_title} · ${formatTag(track)} · ${qualityLabel(track)} · ${formatSize(Number(track.file_size_bytes))} · ${formatTime(Number(track.duration_seconds))}`);
}

function installListeners() {
  ui.tracks.addEventListener("click", (event) => {
    const play = event.target.closest("[data-play-index]");
    const info = event.target.closest("[data-info-index]");
    if (play) startTrack(Number(play.dataset.playIndex));
    else if (info) renderTrackInfo(Number(info.dataset.infoIndex));
  });
  ui.empty.addEventListener("click", (event) => { if (event.target.closest("#emptyConnectButton")) openConnectDialog(); });
  $("#queueList").addEventListener("click", (event) => {
    const item = event.target.closest("[data-queue-index]");
    if (item) startTrack(Number(item.dataset.queueIndex));
  });
  $("#searchInput").addEventListener("input", (event) => { state.query = event.target.value; renderCatalog(); });
  $("#filterButton").addEventListener("click", () => {
    state.filter = state.filter === "all" ? "wav" : state.filter === "wav" ? "mp3" : "all";
    $("#filterLabel").textContent = state.filter.toUpperCase();
    $("#filterButton").classList.toggle("is-active", state.filter !== "all");
    renderCatalog();
  });
  $("#playButton").addEventListener("click", togglePlayback);
  $("#stopButton").addEventListener("click", stopPlayback);
  $("#nextButton").addEventListener("click", () => nextTrack(1));
  $("#previousButton").addEventListener("click", () => {
    if (ui.audio.currentTime > 4) { ui.audio.currentTime = 0; return; }
    nextTrack(-1);
  });
  ui.audio.addEventListener("playing", () => setVisualState(true));
  ui.audio.addEventListener("pause", () => { if (!ui.audio.ended) setVisualState(false); });
  ui.audio.addEventListener("ended", () => { setVisualState(false); $("#currentTime").textContent = formatTime(ui.audio.duration); });
  ui.audio.addEventListener("loadedmetadata", () => { $("#durationTime").textContent = formatTime(ui.audio.duration || Number(currentTrack()?.duration_seconds)); });
  ui.audio.addEventListener("timeupdate", () => {
    if (!Number.isFinite(ui.audio.duration) || state.seekDragging) return;
    $("#currentTime").textContent = formatTime(ui.audio.currentTime);
    $("#seekBar").value = String(Math.round(ui.audio.currentTime / ui.audio.duration * 1000));
    updateSeekPaint();
  });
  const seekBar = $("#seekBar");
  seekBar.addEventListener("input", () => {
    state.seekDragging = true;
    updateSeekPaint();
    const duration = Number.isFinite(ui.audio.duration) ? ui.audio.duration : Number(currentTrack()?.duration_seconds);
    $("#currentTime").textContent = formatTime(duration * Number(seekBar.value) / 1000);
  });
  seekBar.addEventListener("change", () => {
    if (Number.isFinite(ui.audio.duration)) ui.audio.currentTime = ui.audio.duration * Number(seekBar.value) / 1000;
    state.seekDragging = false;
  });
  $("#volumeBar").addEventListener("input", (event) => {
    ui.audio.volume = Number(event.target.value);
    $("#muteButton").setAttribute("aria-label", ui.audio.volume === 0 ? "Unmute audio" : "Mute audio");
  });
  $("#muteButton").addEventListener("click", () => {
    ui.audio.muted = !ui.audio.muted;
    $("#muteButton").setAttribute("aria-label", ui.audio.muted ? "Unmute audio" : "Mute audio");
    $("#volumeBar").value = ui.audio.muted ? "0" : String(ui.audio.volume || .78);
  });
  $("#likeButton").addEventListener("click", () => {
    const track = currentTrack();
    if (!track) return;
    if (state.favorites.has(track.drive_file_id)) state.favorites.delete(track.drive_file_id);
    else state.favorites.add(track.drive_file_id);
    writeFavorites();
    const button = $("#likeButton");
    button.classList.toggle("is-liked", state.favorites.has(track.drive_file_id));
    button.setAttribute("aria-pressed", String(state.favorites.has(track.drive_file_id)));
  });
  const openDrive = () => {
    if (state.connected) { showToast("Google Drive is connected. Your files remain private."); return; }
    openConnectDialog();
  };
  $("#driveButton").addEventListener("click", openDrive);
  $("#sidebarConnect").addEventListener("click", openDrive);
  $("#closeDialog").addEventListener("click", () => ui.dialog.close());
  ui.dialog.addEventListener("click", (event) => { if (event.target === ui.dialog) ui.dialog.close(); });
  $$("[data-scroll]").forEach((button) => button.addEventListener("click", () => {
    const target = document.getElementById(button.dataset.scroll);
    if (target === $("#queuePanel") && matchMedia("(max-width: 860px)").matches) target.classList.toggle("is-open");
    else target?.scrollIntoView({ behavior: "smooth", block: "start" });
    $$(".nav-link").forEach((item) => item.classList.toggle("active", item === button));
  }));
  $("#queueToggle").addEventListener("click", () => $("#queuePanel").classList.toggle("is-open"));
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); $("#searchInput").focus(); }
    if (event.code === "Space" && !/INPUT|TEXTAREA|BUTTON/.test(document.activeElement?.tagName || "")) { event.preventDefault(); togglePlayback(); }
    if (event.key === "Escape") $("#queuePanel").classList.remove("is-open");
  });
  window.addEventListener("resize", sizeCanvas, { passive: true });
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.installPrompt = event;
    $("#installButton").hidden = false;
  });
  $("#installButton").addEventListener("click", async () => {
    if (!state.installPrompt) return;
    state.installPrompt.prompt();
    await state.installPrompt.userChoice.catch(() => null);
    state.installPrompt = null;
    $("#installButton").hidden = true;
  });
}

async function boot() {
  ui.audio.volume = .78;
  ui.audio.crossOrigin = "anonymous";
  ui.idleOrb.pause();
  installListeners();
  const minimumLoad = new Promise((resolve) => setTimeout(resolve, 700));
  await Promise.allSettled([loadCatalog(), loadRuntimeStatus()]);
  renderCatalog();
  await minimumLoad;
  ui.loader.classList.add("is-done");
  ui.shell.classList.add("is-ready");
  ui.shell.setAttribute("aria-hidden", "false");
  orbMotion.setReady(true);
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  if (new URLSearchParams(location.search).get("connected") === "1") showToast("Google Drive connected. Choose any track to start playback.");
  if (new URLSearchParams(location.search).get("connection") === "failed") showToast("Google Drive connection did not finish. Try again when ready.");
}

boot().catch((error) => {
  ui.loader.classList.add("is-done");
  ui.shell.classList.add("is-ready");
  ui.shell.setAttribute("aria-hidden", "false");
  showToast(error?.message || "XYP3RN Music could not finish loading.");
});
