// ============================================================
// Editor mode for the PWFA graph.
// Gated behind GitHub login (only CONFIG.allowedUser). Talks to the
// Cloudflare Worker (CONFIG.workerUrl) for OAuth + AI drafting, and commits
// papers.js / topics.js back to the repo via the GitHub API.
// ============================================================

(function () {
  const api = window.graphApi;
  if (!api) { console.error("graphApi not found"); return; }

  const state = {
    token: sessionStorage.getItem("pwfa_gh_token") || null,
    user: null,
    editing: false,
    undo: [],
    redo: [],
    clipboard: null,
    selectedId: null,
    linkDrag: null,
    pendingPaper: null,
  };

  // ---------- styles + UI ----------
  const style = document.createElement("style");
  style.textContent = `
    #edit-fab { position: fixed; top: 74px; left: 24px; z-index: 160;
      padding: 8px 16px; border-radius: 10px; border: 1px solid rgba(100,116,139,0.3);
      background: rgba(15,20,35,0.9); color: #cbd5e1; font: 500 13px Inter, sans-serif;
      cursor: pointer; backdrop-filter: blur(12px); }
    #edit-fab:hover { color: #fff; border-color: rgba(96,165,250,0.5); }
    #edit-fab.on { background: rgba(96,165,250,0.25); color: #fff; }
    #edit-toolbar { position: fixed; top: 116px; left: 24px; z-index: 160;
      display: none; flex-direction: column; gap: 6px; width: 180px;
      background: rgba(15,20,35,0.95); border: 1px solid rgba(100,116,139,0.25);
      border-radius: 12px; padding: 10px; backdrop-filter: blur(12px); }
    #edit-toolbar.show { display: flex; }
    .et-btn { padding: 7px 10px; border-radius: 8px; border: 1px solid rgba(100,116,139,0.25);
      background: rgba(30,41,59,0.5); color: #cbd5e1; font: 500 12px Inter, sans-serif;
      cursor: pointer; text-align: left; }
    .et-btn:hover { background: rgba(51,65,85,0.7); color: #fff; }
    .et-btn.primary { background: rgba(52,211,153,0.18); border-color: rgba(52,211,153,0.35); color: #6ee7b7; }
    .et-row { display: flex; gap: 6px; }
    .et-row .et-btn { flex: 1; text-align: center; }
    .et-hint { font: 400 10px Inter, sans-serif; color: #64748b; line-height: 1.4; margin-top: 2px; }
    #edit-form { position: fixed; right: -460px; top: 0; width: 440px; height: 100vh;
      background: rgba(13,17,30,0.98); border-left: 1px solid rgba(100,116,139,0.25);
      backdrop-filter: blur(20px); padding: 24px; overflow-y: auto; z-index: 210;
      transition: right 0.3s cubic-bezier(0.4,0,0.2,1); }
    #edit-form.open { right: 0; }
    #edit-form h2 { font: 600 16px Inter; margin-bottom: 16px; color: #e2e8f0; }
    #edit-form label { display: block; font: 600 10px Inter; text-transform: uppercase;
      letter-spacing: 0.6px; color: #64748b; margin: 12px 0 4px; }
    #edit-form input, #edit-form textarea, #edit-form select {
      width: 100%; padding: 8px 10px; border-radius: 8px; border: 1px solid rgba(100,116,139,0.25);
      background: rgba(15,20,35,0.8); color: #e2e8f0; font: 400 12px Inter; outline: none; }
    #edit-form textarea { resize: vertical; min-height: 60px; }
    #edit-form input:focus, #edit-form textarea:focus { border-color: rgba(96,165,250,0.5); }
    .ef-actions { display: flex; gap: 8px; margin-top: 20px; }
    .ef-actions .et-btn { flex: 1; text-align: center; }
    .ef-draft { display: flex; gap: 6px; margin-bottom: 8px; }
    .ef-draft input { flex: 1; }
    .ef-list-item { display: flex; gap: 6px; align-items: center; margin-bottom: 4px; }
    .ef-list-item input { flex: 1; }
    .ef-del { cursor: pointer; color: #f87171; padding: 0 6px; }
    .node.selected .node-circle { stroke-dasharray: 4 3; }
    .link-hit { stroke: transparent; stroke-width: 10px; cursor: pointer; }
    #edit-status { position: fixed; bottom: 70px; left: 50%; transform: translateX(-50%);
      z-index: 200; padding: 8px 16px; border-radius: 8px; background: rgba(15,20,35,0.95);
      border: 1px solid rgba(100,116,139,0.3); color: #cbd5e1; font: 500 12px Inter;
      opacity: 0; transition: opacity 0.2s; pointer-events: none; }
    #edit-status.show { opacity: 1; }
  `;
  document.head.appendChild(style);

  const fab = el("button", { id: "edit-fab", textContent: "Edit" });
  const toolbar = el("div", { id: "edit-toolbar" });
  const form = el("div", { id: "edit-form" });
  const statusEl = el("div", { id: "edit-status" });
  document.body.append(fab, toolbar, form, statusEl);

  toolbar.innerHTML = `
    <button class="et-btn primary" data-act="add">+ Add topic</button>
    <div class="et-row">
      <button class="et-btn" data-act="copy">Copy</button>
      <button class="et-btn" data-act="paste">Paste</button>
    </div>
    <div class="et-row">
      <button class="et-btn" data-act="undo">Undo</button>
      <button class="et-btn" data-act="redo">Redo</button>
    </div>
    <button class="et-btn primary" data-act="save">Save to GitHub</button>
    <button class="et-btn" data-act="exit">Exit edit mode</button>
    <div class="et-hint">Click a bubble to edit. Click a link to delete it.
      Drag bubble→bubble to link. ⌘Z/⌘⇧Z undo/redo, ⌘C/⌘V copy/paste.</div>
  `;

  function el(tag, props) { return Object.assign(document.createElement(tag), props || {}); }

  function flash(msg) {
    statusEl.textContent = msg;
    statusEl.classList.add("show");
    clearTimeout(flash._t);
    flash._t = setTimeout(() => statusEl.classList.remove("show"), 2200);
  }

  // ---------- auth ----------
  fab.addEventListener("click", () => {
    if (state.editing) { exitEdit(); return; }
    if (state.user) { enterEdit(); return; }
    login();
  });

  function login() {
    if (!CONFIG.workerUrl) {
      flash("Set CONFIG.workerUrl (deploy the worker) — see editor/README.md");
      return;
    }
    const popup = window.open(CONFIG.workerUrl + "/auth/login", "pwfa-oauth", "width=620,height=720");
    function onMsg(e) {
      if (!e.data || e.data.type !== "pwfa-oauth") return;
      window.removeEventListener("message", onMsg);
      if (popup) try { popup.close(); } catch (_) {}
      if (e.data.token) { setToken(e.data.token); } else { flash("Login failed"); }
    }
    window.addEventListener("message", onMsg);
  }

  function setToken(token) {
    state.token = token;
    sessionStorage.setItem("pwfa_gh_token", token);
    verify(true);
  }

  // enter=true only right after an explicit login; on page-load session
  // restore (enter=false) we stay in view mode until the user clicks Edit.
  async function verify(enter) {
    if (!state.token) return;
    try {
      const r = await fetch("https://api.github.com/user", {
        headers: { Authorization: `Bearer ${state.token}`, Accept: "application/vnd.github+json" },
      });
      if (!r.ok) throw new Error("bad token");
      const u = await r.json();
      if (u.login !== CONFIG.allowedUser) { flash(`${u.login} is not allowed to edit`); return; }
      state.user = u.login;
      fab.title = `Logged in as ${u.login} — click to edit`;
      if (enter) { flash(`Logged in as ${u.login}`); enterEdit(); }
    } catch (e) {
      state.token = null;
      sessionStorage.removeItem("pwfa_gh_token");
      flash("Login expired — click Edit to log in again");
    }
  }

  // ---------- edit mode ----------
  function enterEdit() {
    state.editing = true;
    fab.classList.add("on");
    fab.textContent = "Editing";
    toolbar.classList.add("show");
    api.applyFilter(0);
    decorateForEdit();
  }
  function exitEdit() {
    state.editing = false;
    state.selectedId = null;
    fab.classList.remove("on");
    fab.textContent = "Edit";
    toolbar.classList.remove("show");
    closeForm();
    api.rebuild({ reheat: false });
  }

  // Called by renderGraph() after every (re)render.
  function decorateForEdit() {
    if (!state.editing) return;
    const link = api.svg.selectAll("g").selectAll("line"); // current links
    // Link delete: widen hit area + click to remove.
    api.g.selectAll("line")
      .style("pointer-events", "stroke")
      .attr("stroke-width", 4)
      .attr("cursor", "pointer")
      .on("click", function (event, d) {
        event.stopPropagation();
        removeLink(linkSrc(d), linkTgt(d));
      });
    // Node link-drag (replaces reposition drag while editing).
    api.node.call(d3.drag()
      .on("start", linkDragStart)
      .on("drag", linkDragMove)
      .on("end", linkDragEnd));
    // Selection outline.
    api.node.classed("selected", d => d.id === state.selectedId);
  }

  function linkSrc(d) { return typeof d.source === "object" ? d.source.id : d.source; }
  function linkTgt(d) { return typeof d.target === "object" ? d.target.id : d.target; }

  // ---------- link drag ----------
  let tempLine = null;
  let dragMoved = false;
  function linkDragStart(event, d) {
    dragMoved = false;
    state.linkDrag = { from: d.id };
    tempLine = api.g.append("line")
      .attr("stroke", "rgba(96,165,250,0.8)").attr("stroke-width", 2)
      .attr("stroke-dasharray", "4 3")
      .attr("x1", d.x).attr("y1", d.y).attr("x2", d.x).attr("y2", d.y);
  }
  function linkDragMove(event) {
    if (!tempLine) return;
    dragMoved = true;
    tempLine.attr("x2", event.x).attr("y2", event.y);
  }
  function linkDragEnd(event, d) {
    if (tempLine) { tempLine.remove(); tempLine = null; }
    state.linkDrag = null;
    if (!dragMoved) return; // treat as click (handled by onNodeClick)
    const target = nodeAt(event.x, event.y);
    if (target && target.id !== d.id) addLink(d.id, target.id);
  }
  function nodeAt(x, y) {
    let best = null, bestD = Infinity;
    for (const n of api.data.nodes) {
      const dist = Math.hypot(n.x - x, n.y - y);
      if (dist < n.size + 4 && dist < bestD) { best = n; bestD = dist; }
    }
    return best;
  }

  // ---------- mutations (each snapshots for undo) ----------
  function snapshot() {
    return JSON.stringify({ topics: api.topics, papers: api.papers });
  }
  function pushUndo() {
    state.undo.push(snapshot());
    if (state.undo.length > 100) state.undo.shift();
    state.redo.length = 0;
  }
  function applySnapshot(snap) {
    const obj = JSON.parse(snap);
    api.topics.length = 0;
    obj.topics.forEach(t => api.topics.push(t));
    Object.keys(api.papers).forEach(k => delete api.papers[k]);
    Object.assign(api.papers, obj.papers);
    api.rebuild({ reheat: false });
    decorateForEdit();
  }
  function undo() {
    if (!state.undo.length) return flash("Nothing to undo");
    state.redo.push(snapshot());
    applySnapshot(state.undo.pop());
    flash("Undo");
  }
  function redo() {
    if (!state.redo.length) return flash("Nothing to redo");
    state.undo.push(snapshot());
    applySnapshot(state.redo.pop());
    flash("Redo");
  }

  function addLink(fromId, toId) {
    const target = api.topics.find(t => t.id === toId);
    if (!target) return;
    target.sources = target.sources || [];
    if (target.sources.some(s => s.id === fromId)) return flash("Link already exists");
    pushUndo();
    target.sources.push({ id: fromId, type: "related" });
    api.rebuild({ reheat: false });
    decorateForEdit();
    flash(`Linked ${fromId} → ${toId}`);
  }
  function removeLink(fromId, toId) {
    const target = api.topics.find(t => t.id === toId);
    if (!target || !target.sources) return;
    const i = target.sources.findIndex(s => s.id === fromId);
    if (i < 0) return;
    pushUndo();
    target.sources.splice(i, 1);
    api.rebuild({ reheat: false });
    decorateForEdit();
    flash("Link removed");
  }
  function removeTopic(id) {
    const i = api.topics.findIndex(t => t.id === id);
    if (i < 0) return;
    pushUndo();
    api.topics.splice(i, 1);
    // Drop dangling sources referencing it.
    api.topics.forEach(t => { if (t.sources) t.sources = t.sources.filter(s => s.id !== id); });
    api.rebuild({ reheat: false });
    decorateForEdit();
    closeForm();
    flash("Topic removed");
  }

  function copySelected() {
    if (!state.selectedId) return flash("Select a bubble first");
    const t = api.topics.find(x => x.id === state.selectedId);
    if (!t) return;
    state.clipboard = JSON.parse(JSON.stringify(t));
    flash(`Copied "${t.label.replace(/\n/g, ' ')}"`);
  }
  function paste() {
    if (!state.clipboard) return flash("Clipboard empty");
    pushUndo();
    const copy = JSON.parse(JSON.stringify(state.clipboard));
    let base = copy.id.replace(/_copy\d*$/, ""), id = base + "_copy", n = 2;
    while (api.topics.some(t => t.id === id)) id = base + "_copy" + (n++);
    copy.id = id;
    copy.rank = undefined;          // let it be recomputed
    copy.sources = [];              // pasted as disconnected
    api.topics.push(copy);
    api.rebuild({ reheat: true });
    decorateForEdit();
    selectTopic(id);
    openEditForm(copy);
    flash("Pasted — set its links");
  }

  // ---------- selection + click ----------
  function selectTopic(id) {
    state.selectedId = id;
    api.node.classed("selected", d => d.id === id);
  }

  // Hook called by index.html onNodeClick. Return true to consume.
  window.editor = {
    onRender: () => decorateForEdit(),
    onNodeClick: (d) => {
      if (!state.editing) return false;
      if (dragMoved) return true; // a link drag, not a click
      selectTopic(d.id);
      openEditForm(api.topics.find(t => t.id === d.id));
      return true;
    },
    isEditing: () => state.editing,
    _forceEnable: (token) => { state.user = CONFIG.allowedUser; state.token = token || "test"; enterEdit(); },
  };

  // ---------- edit/add form ----------
  function openEditForm(topic) {
    const isNew = !topic;
    const t = topic || { id: "", label: "", status: "partial", tags: [], description: "", openQuestions: "", sources: [], paperIds: [] };
    form.innerHTML = `
      <h2>${isNew ? "Add topic" : "Edit topic"}</h2>
      ${isNew ? `<div class="ef-draft">
        <input id="ef-link" placeholder="Paste DOI/arXiv link → AI draft" />
        <button class="et-btn primary" id="ef-draft-btn">Draft</button></div>
        <div class="et-hint" id="ef-draft-hint"></div>` : ""}
      <label>ID</label><input id="ef-id" value="${esc(t.id)}" ${isNew ? "" : "readonly"} />
      <label>Label (use \\n for two lines)</label>
      <input id="ef-label" value="${esc((t.label || '').replace(/\n/g, '\\n'))}" />
      <label>Status</label>
      <select id="ef-status">
        ${["solved", "partial", "unsolved", "category"].map(s => `<option ${t.status === s ? "selected" : ""}>${s}</option>`).join("")}
      </select>
      <label>Tags (comma separated)</label>
      <input id="ef-tags" value="${esc((t.tags || []).join(", "))}" />
      <label>Description</label><textarea id="ef-desc">${esc(t.description || "")}</textarea>
      <label>Open questions</label><textarea id="ef-oq">${esc(t.openQuestions || "")}</textarea>
      <label>Paper IDs (comma separated)</label>
      <input id="ef-papers" value="${esc((t.paperIds || []).join(", "))}" />
      <label>Sources (id:type, comma separated)</label>
      <input id="ef-sources" value="${esc((t.sources || []).map(s => s.id + ":" + s.type).join(", "))}" />
      <div class="ef-actions">
        <button class="et-btn primary" id="ef-save">Apply</button>
        ${isNew ? "" : `<button class="et-btn" id="ef-del" style="color:#f87171">Delete</button>`}
        <button class="et-btn" id="ef-cancel">Cancel</button>
      </div>`;
    form.classList.add("open");

    if (isNew) form.querySelector("#ef-draft-btn").onclick = draftFromLink;
    form.querySelector("#ef-save").onclick = () => saveForm(isNew);
    form.querySelector("#ef-cancel").onclick = closeForm;
    if (!isNew) form.querySelector("#ef-del").onclick = () => { if (confirm("Delete this topic?")) removeTopic(t.id); };
  }
  function closeForm() { form.classList.remove("open"); state.pendingPaper = null; }

  function saveForm(isNew) {
    const v = id => form.querySelector(id).value.trim();
    const id = v("#ef-id");
    if (!id) return flash("ID required");
    if (isNew && api.topics.some(t => t.id === id)) return flash("ID already exists");
    pushUndo();
    let t = isNew ? { id } : api.topics.find(x => x.id === id);
    if (isNew) api.topics.push(t);
    t.label = v("#ef-label").replace(/\\n/g, "\n");
    t.status = v("#ef-status");
    t.tags = v("#ef-tags").split(",").map(s => s.trim()).filter(Boolean);
    t.description = v("#ef-desc");
    t.openQuestions = v("#ef-oq") || null;
    t.paperIds = v("#ef-papers").split(",").map(s => s.trim()).filter(Boolean);
    t.sources = v("#ef-sources").split(",").map(s => s.trim()).filter(Boolean).map(pair => {
      const [sid, type] = pair.split(":");
      return { id: sid.trim(), type: (type || "related").trim() };
    });
    // Register a drafted paper in the DB if its id is referenced here.
    if (state.pendingPaper && t.paperIds.includes(state.pendingPaper.id)) {
      const { id: pid, ...rest } = state.pendingPaper;
      api.papers[pid] = rest;
    }
    state.pendingPaper = null;
    api.rebuild({ reheat: isNew });
    decorateForEdit();
    selectTopic(id);
    closeForm();
    flash("Applied");
  }

  async function draftFromLink() {
    const link = form.querySelector("#ef-link").value.trim();
    const hint = form.querySelector("#ef-draft-hint");
    if (!link) return;
    if (!CONFIG.workerUrl) { hint.textContent = "Worker not configured — see editor/README.md"; return; }
    hint.textContent = "Reading the paper & drafting…";
    try {
      const r = await fetch(CONFIG.workerUrl + "/ai/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${state.token}` },
        body: JSON.stringify({
          link,
          existingTopicIds: api.topics.map(t => t.id),
          existingTags: [...new Set(api.topics.flatMap(t => t.tags || []))],
        }),
      });
      const out = await r.json();
      if (!r.ok) throw new Error(out.error || "draft failed");
      applyDraft(out.draft); // sets its own hint
    } catch (e) {
      hint.textContent = "Draft error: " + e.message;
    }
  }

  // Fill the (new-topic) form from the AI draft. Nothing is committed to the
  // data until the user clicks Apply (or "attach to existing").
  function applyDraft(draft) {
    state.pendingPaper = (draft.paper && draft.paper.id) ? draft.paper : null;
    const paperId = state.pendingPaper ? state.pendingPaper.id : "";
    const tp = draft.topic || {};
    const setv = (id, val) => { const e = form.querySelector(id); if (e) e.value = val; };
    setv("#ef-id", tp.id || "");
    setv("#ef-label", (tp.label || "").replace(/\n/g, "\\n"));
    if (tp.status) form.querySelector("#ef-status").value = tp.status;
    setv("#ef-tags", (tp.tags || []).join(", "));
    setv("#ef-desc", tp.description || "");
    setv("#ef-oq", tp.openQuestions || "");
    setv("#ef-papers", paperId);
    setv("#ef-sources", (tp.sources || []).map(s => s.id + ":" + s.type).join(", "));

    const hint = form.querySelector("#ef-draft-hint");
    const ex = draft.attachToExisting && api.topics.find(x => x.id === draft.attachToExisting);
    if (ex) {
      hint.innerHTML = `New topic drafted below — click <b>Apply</b> to create it. ` +
        `This paper may also fit existing <b>${esc(api.labelText(ex))}</b>: ` +
        `<a href="#" id="ef-attach">attach to that instead</a>.`;
      hint.querySelector("#ef-attach").onclick = (e) => { e.preventDefault(); attachPaperTo(ex.id); };
    } else {
      hint.textContent = "Draft ready — review and click Apply to create the topic.";
    }
  }

  // Add the drafted paper to an existing topic instead of creating a new one.
  function attachPaperTo(existingId) {
    const t = api.topics.find(x => x.id === existingId);
    if (!t || !state.pendingPaper) return;
    pushUndo();
    const { id, ...rest } = state.pendingPaper;
    api.papers[id] = rest;
    t.paperIds = t.paperIds || [];
    if (!t.paperIds.includes(id)) t.paperIds.push(id);
    state.pendingPaper = null;
    api.rebuild({ reheat: false });
    decorateForEdit();
    selectTopic(existingId);
    closeForm();
    flash(`Paper added to ${api.labelText(t)}`);
  }

  // ---------- save / commit ----------
  function serializePapers() {
    return `// Paper database for the PWFA research landscape graph.\n` +
      `// Key format: Journal.Volume.PageOrArticleId. Fields: title, ref, authors, doi, arxiv, me.\n\n` +
      `const papers = ${JSON.stringify(api.papers, null, 2)};\n`;
  }
  function serializeTopics() {
    return `// Topic graph for the PWFA research landscape.\n` +
      `// Each non-root node lists sources: [{ id, type }]. Rank 0 marks top pillars.\n\n` +
      `const topics = ${JSON.stringify(api.topics, null, 2)};\n`;
  }
  function b64(str) { return btoa(unescape(encodeURIComponent(str))); }

  async function commitFile(path, content, message) {
    const base = `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${path}`;
    const head = { Authorization: `Bearer ${state.token}`, Accept: "application/vnd.github+json" };
    const get = await fetch(`${base}?ref=${CONFIG.branch}`, { headers: head });
    const sha = get.ok ? (await get.json()).sha : undefined;
    const put = await fetch(base, {
      method: "PUT", headers: head,
      body: JSON.stringify({ message, content: b64(content), branch: CONFIG.branch, sha }),
    });
    if (!put.ok) throw new Error(`${path}: ${(await put.json()).message || put.status}`);
  }

  async function save() {
    if (!state.token) return flash("Not logged in");
    flash("Saving…");
    try {
      await commitFile("papers.js", serializePapers(), "Editor: update papers.js");
      await commitFile("topics.js", serializeTopics(), "Editor: update topics.js");
      flash("Saved to GitHub ✓");
    } catch (e) {
      flash("Save failed: " + e.message);
    }
  }

  // ---------- toolbar + keyboard ----------
  toolbar.addEventListener("click", (e) => {
    const act = e.target.dataset.act;
    if (!act) return;
    ({ add: () => openEditForm(null), copy: copySelected, paste, undo, redo, save, exit: exitEdit }[act] || (() => {}))();
  });

  document.addEventListener("keydown", (e) => {
    if (!state.editing) return;
    if (e.target.matches("input, textarea, select")) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) { e.preventDefault(); redo(); }
    else if (mod && e.key.toLowerCase() === "c") { e.preventDefault(); copySelected(); }
    else if (mod && e.key.toLowerCase() === "v") { e.preventDefault(); paste(); }
  });

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

  // Resume session if a token is already stored — but stay in view mode.
  if (state.token) verify(false);
})();
