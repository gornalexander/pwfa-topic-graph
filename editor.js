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
    token: localStorage.getItem("pwfa_gh_token") || null,
    user: null,
    editing: false,
    undo: [],
    redo: [],
    clipboard: null,
    selectedId: null,
    linkDrag: null,
    pendingPapers: {},   // id -> paper object, fetched but not yet committed
  };

  // ---------- styles + UI ----------
  const style = document.createElement("style");
  style.textContent = `
    #editor-bar { position: fixed; top: 74px; left: 24px; z-index: 160; display: flex; gap: 8px; align-items: center; }
    #account-btn { height: 38px; padding: 0 13px; border-radius: 10px; border: 1px solid rgba(100,116,139,0.3);
      background: rgba(15,20,35,0.9); color: #cbd5e1; cursor: pointer; backdrop-filter: blur(12px);
      font: 500 12px Inter, sans-serif; display: flex; align-items: center; gap: 7px; white-space: nowrap; }
    #account-btn:hover { color: #fff; border-color: rgba(96,165,250,0.5); }
    #account-btn .dot { width: 7px; height: 7px; border-radius: 50%; background: #34d399; flex: none; }
    #account-menu { position: fixed; top: 118px; left: 24px; z-index: 161; display: none;
      flex-direction: column; background: rgba(15,20,35,0.97); border: 1px solid rgba(100,116,139,0.25);
      border-radius: 10px; padding: 6px; backdrop-filter: blur(12px); min-width: 150px; }
    #account-menu.show { display: flex; }
    #account-menu button { padding: 7px 10px; border-radius: 7px; border: none; background: none;
      color: #cbd5e1; font: 500 12px Inter, sans-serif; cursor: pointer; text-align: left; }
    #account-menu button:hover { background: rgba(51,65,85,0.7); color: #fff; }
    #edit-fab { width: 38px; height: 38px; padding: 0; display: none; align-items: center;
      justify-content: center; border-radius: 10px; border: 1px solid rgba(100,116,139,0.3);
      background: rgba(15,20,35,0.9); color: #cbd5e1; cursor: pointer; backdrop-filter: blur(12px); }
    #edit-fab.available { display: flex; }
    #edit-fab svg { width: 17px; height: 17px; }
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
    /* Deploy-status panel: persists across exiting edit mode. */
    #deploy-status { position: fixed; bottom: 24px; left: 24px; z-index: 250;
      display: none; max-width: 320px; padding: 12px 14px; border-radius: 10px;
      background: rgba(15,20,35,0.97); border: 1px solid rgba(100,116,139,0.3);
      color: #cbd5e1; font: 500 12px Inter; backdrop-filter: blur(12px);
      box-shadow: 0 8px 24px rgba(0,0,0,0.3); }
    #deploy-status.show { display: block; }
    #deploy-status.error { border-color: rgba(248,113,113,0.5); }
    #deploy-status .ds-row { display: flex; align-items: center; gap: 8px; }
    #deploy-status .ds-msg { line-height: 1.4; }
    #deploy-status .ds-spin { width: 12px; height: 12px; flex-shrink: 0;
      border: 2px solid rgba(96,165,250,0.3); border-top-color: #60a5fa;
      border-radius: 50%; animation: ds-spin 0.8s linear infinite; }
    #deploy-status.busy .ds-spin { display: inline-block; }
    #deploy-status:not(.busy) .ds-spin { display: none; }
    @keyframes ds-spin { to { transform: rotate(360deg); } }
    #deploy-status .ds-actions { margin-top: 10px; display: flex; gap: 6px; }
    #deploy-status .ds-btn { flex: 1; padding: 6px 10px; border-radius: 7px; cursor: pointer;
      border: 1px solid rgba(100,116,139,0.3); background: rgba(30,41,59,0.6);
      color: #cbd5e1; font: 600 11px Inter; text-align: center; }
    #deploy-status .ds-btn.primary { background: rgba(52,211,153,0.18);
      border-color: rgba(52,211,153,0.35); color: #6ee7b7; }
    #deploy-status .ds-btn:hover { filter: brightness(1.2); }
    #deploy-status kbd { background: rgba(51,65,85,0.7); border-radius: 4px;
      padding: 1px 5px; font: 600 11px ui-monospace, monospace; color: #e2e8f0; }
  `;
  document.head.appendChild(style);

  const fab = el("button", { id: "edit-fab", title: "Edit" });
  fab.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/>
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>`;
  const account = el("button", { id: "account-btn" });
  const accountMenu = el("div", { id: "account-menu" });
  accountMenu.innerHTML = `<button data-act="logout">Log out</button>`;
  const bar = el("div", { id: "editor-bar" });
  bar.append(account, fab);
  const toolbar = el("div", { id: "edit-toolbar" });
  const form = el("div", { id: "edit-form" });
  const statusEl = el("div", { id: "edit-status" });
  const deployEl = el("div", { id: "deploy-status" });
  document.body.append(bar, accountMenu, toolbar, form, statusEl, deployEl);

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

  // ---------- auth (login is independent of edit mode) ----------
  account.addEventListener("click", () => {
    if (state.user) accountMenu.classList.toggle("show");
    else login();
  });
  accountMenu.addEventListener("click", (e) => {
    if (e.target.dataset.act === "logout") { accountMenu.classList.remove("show"); logout(); }
  });
  document.addEventListener("click", (e) => {
    if (!accountMenu.contains(e.target) && e.target !== account) accountMenu.classList.remove("show");
  });

  // The pencil only appears once logged in; it just toggles edit mode.
  fab.addEventListener("click", () => {
    if (!state.user) { login(); return; }
    state.editing ? exitEdit() : enterEdit();
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
    localStorage.setItem("pwfa_gh_token", token);   // persists across browser sessions
    verify(true);
  }

  // Authenticate + update the account UI. Logging in does NOT enter edit mode.
  async function verify(announce) {
    if (!state.token) return;
    try {
      const r = await fetch("https://api.github.com/user", {
        headers: { Authorization: `Bearer ${state.token}`, Accept: "application/vnd.github+json" },
      });
      if (!r.ok) throw new Error("bad token");
      const u = await r.json();
      if (u.login !== CONFIG.allowedUser) { flash(`${u.login} is not allowed to edit`); logout(); return; }
      state.user = u.login;
      updateAccountUI();
      if (announce) flash(`Logged in as ${u.login}`);
    } catch (e) {
      state.token = null;
      state.user = null;
      localStorage.removeItem("pwfa_gh_token");
      updateAccountUI();
      if (announce) flash("Login failed or expired");
    }
  }

  function logout() {
    if (state.editing) exitEdit();
    state.token = null;
    state.user = null;
    localStorage.removeItem("pwfa_gh_token");
    updateAccountUI();
    flash("Logged out");
  }

  function updateAccountUI() {
    if (state.user) {
      account.innerHTML = `<span class="dot"></span>${state.user}`;
      account.title = "Account";
      fab.classList.add("available");
      if (!state.editing) fab.title = "Edit";
    } else {
      account.textContent = "Login";
      account.title = "Log in to edit";
      fab.classList.remove("available", "on");
      accountMenu.classList.remove("show");
    }
  }

  // ---------- edit mode ----------
  function enterEdit() {
    state.editing = true;
    fab.classList.add("on");
    fab.title = "Editing — click to exit";
    toolbar.classList.add("show");
    api.applyFilter(0);
    decorateForEdit();
  }
  function exitEdit() {
    state.editing = false;
    state.selectedId = null;
    fab.classList.remove("on");
    fab.title = "Edit";
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

  // Adding `from` as a parent of `to` makes a cycle iff `to` is already an
  // ancestor of `from` (walk `from`'s sources upward and look for `to`).
  function wouldCreateCycle(fromId, toId) {
    const seen = new Set();
    const stack = [fromId];
    while (stack.length) {
      const cur = stack.pop();
      if (cur === toId) return true;
      const t = api.topics.find(x => x.id === cur);
      for (const s of (t && t.sources) || []) {
        if (!seen.has(s.id)) { seen.add(s.id); stack.push(s.id); }
      }
    }
    return false;
  }

  function addLink(fromId, toId) {
    const target = api.topics.find(t => t.id === toId);
    if (!target) return;
    target.sources = target.sources || [];
    if (target.sources.some(s => s.id === fromId)) return flash("Link already exists");
    if (wouldCreateCycle(fromId, toId)) {
      return flash("Can't link — the target is already upstream of the source (would make a loop).");
    }
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
    // True when a verified, allowed user is logged in (inline-edit rights).
    canEdit: () => !!state.user,
    // Inline edit of a single field; mutates in memory and commits the changed file.
    setField: async (type, id, field, value) => {
      if (!state.user || !state.token) { flash("Log in to edit"); return false; }
      pushUndo();
      if (type === "topic") { const t = api.topics.find(x => x.id === id); if (!t) return false; t[field] = value; }
      else if (type === "paper") { if (!api.papers[id]) return false; api.papers[id][field] = value; }
      else return false;
      flash("Saving…");
      try {
        const f = type === "paper" ? "papers.js" : "topics.js";
        const content = type === "paper" ? serializePapers() : serializeTopics();
        await commitFile(f, content, `Editor: edit ${id} ${field}`);
        flash("Saved ✓ — live after Pages rebuild (~1 min)");
        return true;
      } catch (e) { flash("Save failed: " + (e.message || e)); return false; }
    },
    // Add a paper (fetched from a link) to a topic's publication list.
    addPaperByLink: async (topicId, link) => {
      if (!state.user || !state.token) { flash("Log in to edit"); return { ok: false, error: "not logged in" }; }
      if (!CONFIG.workerUrl) return { ok: false, error: "backend not configured" };
      const t = api.topics.find(x => x.id === topicId); if (!t) return { ok: false, error: "topic not found" };
      try {
        const r = await fetch(CONFIG.workerUrl + "/ai/draft", {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${state.token}` },
          body: JSON.stringify({ link, existingTopicIds: api.topics.map(x => x.id), existingTags: [...new Set(api.topics.flatMap(x => x.tags || []))] }),
        });
        const out = await r.json();
        if (!r.ok) throw new Error(out.error || "fetch failed");
        const paper = out.draft && out.draft.paper;
        if (!paper || !paper.id) throw new Error("no paper found at that link");
        pushUndo();
        if (!api.papers[paper.id]) { const { id: _id, ...rest } = paper; api.papers[paper.id] = rest; }
        t.paperIds = t.paperIds || [];
        if (!t.paperIds.includes(paper.id)) t.paperIds.push(paper.id);
        flash("Saving…");
        await commitFile("papers.js", serializePapers(), `Editor: add paper ${paper.id} to ${topicId}`);
        await commitFile("topics.js", serializeTopics(), `Editor: add paper ${paper.id} to ${topicId}`);
        flash("Saved ✓ — live after Pages rebuild (~1 min)");
        return { ok: true, key: paper.id, paper };
      } catch (e) { flash("Add paper failed: " + (e.message || e)); return { ok: false, error: e.message || String(e) }; }
    },
    removePaperFromTopic: async (topicId, paperKey) => {
      if (!state.user || !state.token) { flash("Log in to edit"); return false; }
      const t = api.topics.find(x => x.id === topicId); if (!t) return false;
      pushUndo();
      t.paperIds = (t.paperIds || []).filter(k => k !== paperKey);
      flash("Saving…");
      try { await commitFile("topics.js", serializeTopics(), `Editor: remove paper ${paperKey} from ${topicId}`); flash("Saved ✓"); return true; }
      catch (e) { flash("Save failed: " + (e.message || e)); return false; }
    },
    _forceEnable: (token) => { state.user = CONFIG.allowedUser; state.token = token || "test"; updateAccountUI(); enterEdit(); },
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
      <label>Add paper from link</label>
      <div class="ef-draft">
        <input id="ef-paper-link" placeholder="Paste DOI/arXiv link → fetch" />
        <button class="et-btn" id="ef-paper-add">Fetch</button>
      </div>
      <div class="et-hint" id="ef-paper-hint"></div>
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
    form.querySelector("#ef-paper-add").onclick = addPaperFromLink;
    form.querySelector("#ef-save").onclick = () => saveForm(isNew);
    form.querySelector("#ef-cancel").onclick = closeForm;
    if (!isNew) form.querySelector("#ef-del").onclick = () => { if (confirm("Delete this topic?")) removeTopic(t.id); };
  }
  function closeForm() { form.classList.remove("open"); state.pendingPapers = {}; }

  // Fetch a paper from a link and append it to the Paper IDs field. The paper
  // is registered in the DB only when the form is applied.
  async function addPaperFromLink() {
    const link = form.querySelector("#ef-paper-link").value.trim();
    const hint = form.querySelector("#ef-paper-hint");
    if (!link) return;
    if (!CONFIG.workerUrl) { hint.textContent = "Backend not configured."; return; }
    hint.textContent = "Fetching paper…";
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
      if (!r.ok) throw new Error(out.error || "fetch failed");
      const paper = out.draft && out.draft.paper;
      if (!paper || !paper.id) throw new Error("no paper found at that link");
      state.pendingPapers[paper.id] = paper;
      const field = form.querySelector("#ef-papers");
      const ids = field.value.split(",").map(s => s.trim()).filter(Boolean);
      if (!ids.includes(paper.id)) ids.push(paper.id);
      field.value = ids.join(", ");
      hint.innerHTML = `Added <b>${esc(paper.ref || paper.id)}</b> — click Apply to save.`;
      form.querySelector("#ef-paper-link").value = "";
    } catch (e) {
      hint.textContent = "Error: " + e.message;
    }
  }

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
    // Register any fetched-but-uncommitted papers referenced in paperIds.
    for (const pid of t.paperIds) {
      if (state.pendingPapers[pid] && !api.papers[pid]) {
        const { id: _id, ...rest } = state.pendingPapers[pid];
        api.papers[pid] = rest;
      }
    }
    state.pendingPapers = {};
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
    state.pendingPapers = {};
    const paperId = (draft.paper && draft.paper.id) ? draft.paper.id : "";
    if (paperId) state.pendingPapers[paperId] = draft.paper;
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

  // Add the drafted paper(s) to an existing topic instead of creating a new one.
  function attachPaperTo(existingId) {
    const t = api.topics.find(x => x.id === existingId);
    const ids = Object.keys(state.pendingPapers);
    if (!t || !ids.length) return;
    pushUndo();
    t.paperIds = t.paperIds || [];
    for (const pid of ids) {
      const { id: _id, ...rest } = state.pendingPapers[pid];
      api.papers[pid] = rest;
      if (!t.paperIds.includes(pid)) t.paperIds.push(pid);
    }
    state.pendingPapers = {};
    api.rebuild({ reheat: false });
    decorateForEdit();
    selectTopic(existingId);
    closeForm();
    flash(`Paper added to ${api.labelText(t)}`);
  }

  // ---------- save / commit ----------
  function serializePapers() {
    return `// Paper database for the PWFA research landscape graph.\n` +
      `// Key format: Journal.Volume.PageOrArticleId. Fields: title, ref, authors, doi, arxiv, me.\n` +
      `// Optional overrides: localPdf, abstract (string), keyResults (array) — set via inline editing.\n\n` +
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

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // Approximate a hard refresh (⌘⇧R): re-download the app files with
  // cache:"reload" (which refreshes their HTTP-cache entries), then reload so
  // the navigation serves the fresh copies instead of stale cached JS.
  async function hardReload() {
    const files = ["index.html", "config.js", "papers.js", "topics.js", "editor.js", ""];
    try {
      await Promise.all(files.map(f => fetch(f || ".", { cache: "reload" }).catch(() => {})));
    } catch (_) { /* ignore */ }
    location.reload();
  }

  function showDeploy(html, opts = {}) {
    deployEl.classList.add("show");
    deployEl.classList.toggle("busy", !!opts.spinner);
    deployEl.classList.toggle("error", !!opts.error);
    const actions = opts.done
      ? `<div class="ds-actions">
           <button class="ds-btn primary" id="ds-reload">Reload now</button>
           <button class="ds-btn" id="ds-close">Dismiss</button>
         </div>`
      : `<div class="ds-actions"><button class="ds-btn" id="ds-close">Hide</button></div>`;
    deployEl.innerHTML = `<div class="ds-row"><span class="ds-spin"></span><span class="ds-msg">${html}</span></div>${actions}`;
    const r = deployEl.querySelector("#ds-reload");
    if (r) r.onclick = hardReload;
    deployEl.querySelector("#ds-close").onclick = () => deployEl.classList.remove("show");
  }

  async function save() {
    if (!state.token) return flash("Not logged in");
    showDeploy("Committing to GitHub…", { spinner: true });
    const topicsContent = serializeTopics();
    try {
      await commitFile("papers.js", serializePapers(), "Editor: update papers.js");
      await commitFile("topics.js", topicsContent, "Editor: update topics.js");
    } catch (e) {
      showDeploy("Save failed: " + esc(e.message), { error: true, done: true });
      return;
    }
    // Off the live site (e.g. local file) there's no Pages deploy to watch.
    if (!location.hostname.endsWith("github.io") && !window.__pwfaForceDeploy) {
      showDeploy("Committed to GitHub ✓ — changes will appear on the live site after Pages rebuilds.", { done: true });
      return;
    }
    showDeploy("Committed ✓ — deploying to GitHub Pages… (~1 min)", { spinner: true });
    const deployed = await waitForDeploy(topicsContent);
    if (deployed) {
      showDeploy("Deployed ✓ — your changes are live. Click <b>Reload now</b> to load them (hard refresh).", { done: true });
    } else {
      showDeploy("Committed ✓, but the deploy is taking longer than usual. Try <b>Reload now</b> in a minute.", { done: true });
    }
  }

  // Poll the published topics.js (same origin on github.io) until it matches
  // what we just committed — i.e. the Pages deploy has actually gone live.
  async function waitForDeploy(expected) {
    const target = expected.trim();
    for (let i = 0; i < 60; i++) {
      try {
        const r = await fetch(`topics.js?cb=${Date.now()}`, { cache: "no-store" });
        if (r.ok && (await r.text()).trim() === target) return true;
      } catch (_) { /* keep polling */ }
      await sleep(4000);
    }
    return false;
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

  // Show the Login button immediately, then resume a stored session (staying in
  // view mode — login is independent of edit).
  updateAccountUI();
  if (state.token) verify(false);
})();
